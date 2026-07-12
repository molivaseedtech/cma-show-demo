import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const PACKAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'episodeTitle', 'excerpt', 'category', 'duration', 'readTime', 'bodyHtml', 'chapters', 'links', 'mentions', 'quote'],
  properties: {
    title: { type: 'string', description: 'Editorial headline for the unified episode and show-notes page.' },
    episodeTitle: { type: 'string', description: 'Concise podcast or livestream player headline.' },
    excerpt: { type: 'string', description: 'One-sentence homepage summary.' },
    category: { type: 'string', enum: ['News', 'Pop Culture', 'Games', 'Life'] },
    duration: { type: 'string', description: 'Duration when known, otherwise an empty string.' },
    readTime: { type: 'string', description: 'Estimated reading time such as 4 min read.' },
    bodyHtml: { type: 'string', description: 'Skimmable episode breakdown with The news you need and The part you’ll text a friend about sections, using only p, h2, ul, ol, li, strong, em tags.' },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['time', 'title'],
        properties: { time: { type: 'string' }, title: { type: 'string' } }
      }
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'url', 'context'],
        properties: { label: { type: 'string' }, url: { type: 'string' }, context: { type: 'string' } }
      }
    },
    mentions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type', 'context', 'searchQuery', 'verifiedUrl'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['person', 'brand', 'product', 'place', 'show', 'story', 'other'] },
          context: { type: 'string' },
          searchQuery: { type: 'string' },
          verifiedUrl: { type: 'string' }
        }
      }
    },
    quote: { type: 'string', description: 'One memorable verbatim quote from the transcript.' }
  }
};

const SYSTEM_PROMPT = `You are the editorial producer for The Carla Marie & Anthony Show (CMA), a warm, funny, fast morning podcast and livestream. Turn the supplied transcript into one synchronized publish package.

Accuracy rules:
- Use only claims present in the transcript. Never invent a fact, timestamp, link, sponsor, quote, or proper noun.
- A link URL may only be included when the literal URL appears in the transcript or source notes. Otherwise put the item in mentions with verifiedUrl set to an empty string so a human can verify it.
- Keep the hosts' conversational voice without pretending AI-written copy is a verbatim host statement.
- The quote must be verbatim. If no safe quote exists, return an empty string.
- Chapters must follow transcript timestamps when supplied. If timestamps are absent, use sequential estimated timestamps and make that clear in the chapter title.
- bodyHtml may only contain <p>, <h2>, <ul>, <ol>, <li>, <strong>, and <em>.
- The unified episode page should open with a short morning greeting and one-paragraph overview.
- Include an <h2>The news you need</h2> section followed by a short bullet list of the episode's most useful or important highlights. Do not force news that is not in the transcript.
- Include an <h2>The part you'll text a friend about</h2> section with a short grounded recap of the funniest, most surprising, or most shareable moment. If the transcript has no safe candidate, use <h2>The part worth sharing</h2> instead.
- Keep the page easy to skim and avoid repeating the verbatim quote card word-for-word in bodyHtml.
- Return only data matching the requested schema.`;

function promptFor(show) {
  return `SHOW DATE: ${show.airDate || ''}
SOURCE TYPE: ${show.source?.type || ''}
EDITOR NOTES: ${show.editorNotes || ''}
CURRENT TITLE (keep if strong): ${show.title || ''}

TRANSCRIPT:
${show.transcript}`;
}

function extractResponseText(payload) {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && part.text) return part.text;
    }
  }
  throw new Error('The model returned no text output.');
}

function parsePackage(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  for (const key of PACKAGE_SCHEMA.required) {
    if (!(key in parsed)) throw new Error(`AI package is missing ${key}.`);
  }
  return parsed;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { error: { message: text.slice(0, 500) } }; }
  if (!response.ok) throw new Error(payload.error?.message || `Provider request failed (${response.status}).`);
  return payload;
}

export async function generateOpenAI(show) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.');
  const model = process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-mini';
  const payload = await requestJson('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions: SYSTEM_PROMPT,
      input: promptFor(show),
      text: { format: { type: 'json_schema', name: 'cma_episode_package', strict: true, schema: PACKAGE_SCHEMA } }
    })
  });
  return { package: parsePackage(extractResponseText(payload)), provider: 'openai', model };
}

export async function generateOllama(show) {
  if (!process.env.OLLAMA_MODEL) throw new Error('OLLAMA_MODEL is not configured.');
  const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL;
  const payload = await requestJson(`${base.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: PACKAGE_SCHEMA,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: promptFor(show) }],
      options: { temperature: 0.2 }
    })
  });
  return { package: parsePackage(payload.message?.content), provider: 'ollama', model };
}

export async function generateGemini(show) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const payload = await requestJson(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\n${promptFor(show)}` }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: PACKAGE_SCHEMA, temperature: 0.2 }
    })
  });
  const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
  return { package: parsePackage(text), provider: 'gemini', model };
}

export async function generatePackage(show, requested = 'auto') {
  if (!show.transcript?.trim()) throw new Error('Add or generate a transcript first.');
  const order = requested === 'auto' ? ['ollama', 'openai', 'gemini'] : [requested];
  const errors = [];
  for (const provider of order) {
    try {
      if (provider === 'ollama') return await generateOllama(show);
      if (provider === 'openai') return await generateOpenAI(show);
      if (provider === 'gemini') return await generateGemini(show);
      throw new Error(`Unknown provider: ${provider}`);
    } catch (error) {
      errors.push(`${provider}: ${error.message}`);
    }
  }
  throw new Error(`No AI provider completed the draft. ${errors.join(' | ')}`);
}

export async function transcribeOpenAI(filePath, mimeType = 'audio/mpeg') {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.');
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
  form.append('response_format', 'text');
  form.append('file', new Blob([bytes], { type: mimeType }), path.basename(filePath));
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form
  });
  const text = await response.text();
  if (!response.ok) {
    try { throw new Error(JSON.parse(text).error?.message || `Transcription failed (${response.status}).`); }
    catch (error) { if (error instanceof SyntaxError) throw new Error(text.slice(0, 500)); throw error; }
  }
  return { transcript: text, provider: 'openai', model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe' };
}

function run(executable, args, timeoutMs = 60 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.slice(-1000) || `Local process exited with code ${code}.`));
    });
  });
}

export async function transcribeLocal(filePath) {
  const executable = process.env.LOCAL_WHISPER_BIN;
  const model = process.env.LOCAL_WHISPER_MODEL;
  if (!executable || !model) throw new Error('LOCAL_WHISPER_BIN and LOCAL_WHISPER_MODEL are required for on-device transcription.');
  const outputBase = `${filePath}.transcript`;
  await run(executable, ['-m', model, '-f', filePath, '-otxt', '-of', outputBase]);
  const transcript = await fs.readFile(`${outputBase}.txt`, 'utf8');
  await fs.unlink(`${outputBase}.txt`).catch(() => {});
  return { transcript, provider: 'whisper.cpp', model: path.basename(model) };
}

export async function transcribeFile(filePath, mimeType, requested = 'auto') {
  const order = requested === 'auto' ? ['local', 'openai'] : [requested];
  const errors = [];
  for (const provider of order) {
    try {
      if (provider === 'local') return await transcribeLocal(filePath);
      if (provider === 'openai') return await transcribeOpenAI(filePath, mimeType);
      throw new Error(`Unknown transcription provider: ${provider}`);
    } catch (error) {
      errors.push(`${provider}: ${error.message}`);
    }
  }
  throw new Error(`No transcription provider completed the job. ${errors.join(' | ')}`);
}

export { run as runLocalProcess };
