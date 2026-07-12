import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_FILE = path.join(process.cwd(), 'data', 'content.json');
let writeQueue = Promise.resolve();

export async function readShows() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.shows) ? parsed.shows : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function persist(shows) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  const body = JSON.stringify({ version: 1, shows }, null, 2) + '\n';
  await fs.writeFile(temp, body, { mode: 0o600 });
  await fs.rename(temp, DATA_FILE);
}

export function writeShows(shows) {
  writeQueue = writeQueue.then(() => persist(shows));
  return writeQueue;
}

export async function listShows() {
  const shows = await readShows();
  return shows.sort((a, b) => new Date(b.airDate || b.createdAt) - new Date(a.airDate || a.createdAt));
}

export async function getShow(id) {
  return (await readShows()).find(show => show.id === id) || null;
}

export async function createShow(input = {}) {
  const now = new Date().toISOString();
  const show = {
    id: crypto.randomUUID(),
    slug: input.slug || `show-${now.slice(0, 10)}`,
    status: 'draft',
    title: input.title || 'Untitled show',
    episodeTitle: input.episodeTitle || '',
    excerpt: '',
    category: 'News',
    format: input.format || 'Livestream',
    duration: '',
    readTime: '',
    airDate: input.airDate || now,
    publishAt: null,
    publishedAt: null,
    source: { type: input.sourceType || 'upload', url: input.sourceUrl || '', assetId: '', twitchVideoId: '' },
    media: { podcastUrl: '', twitchUrl: '', youtubeUrl: '', imageUrl: '' },
    transcript: input.transcript || '',
    bodyHtml: '',
    chapters: [],
    links: [],
    mentions: [],
    quote: '',
    ai: { provider: '', model: '', generatedAt: null },
    review: { blog: false, chapters: false, links: false, media: false },
    createdAt: now,
    updatedAt: now
  };
  const shows = await readShows();
  shows.push(show);
  await writeShows(shows);
  return show;
}

export async function updateShow(id, patch) {
  const shows = await readShows();
  const index = shows.findIndex(show => show.id === id);
  if (index < 0) return null;
  const immutable = new Set(['id', 'createdAt', 'publishedAt']);
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => !immutable.has(key)));
  shows[index] = { ...shows[index], ...clean, id, createdAt: shows[index].createdAt, updatedAt: new Date().toISOString() };
  await writeShows(shows);
  return shows[index];
}

export async function publishShow(id, when = new Date()) {
  const shows = await readShows();
  const index = shows.findIndex(show => show.id === id);
  if (index < 0) return null;
  const now = when.toISOString();
  shows[index] = { ...shows[index], status: 'published', publishAt: null, publishedAt: now, updatedAt: now };
  await writeShows(shows);
  return shows[index];
}

export async function publishDueShows(now = new Date()) {
  const shows = await readShows();
  let changed = false;
  for (let index = 0; index < shows.length; index += 1) {
    const show = shows[index];
    if (show.status === 'scheduled' && show.publishAt && new Date(show.publishAt) <= now) {
      const stamp = now.toISOString();
      shows[index] = { ...show, status: 'published', publishAt: null, publishedAt: stamp, updatedAt: stamp };
      changed = true;
    }
  }
  if (changed) await writeShows(shows);
  return changed;
}

export function publicShape(show) {
  return {
    id: show.id,
    slug: show.slug,
    title: show.title,
    episodeTitle: show.episodeTitle,
    excerpt: show.excerpt,
    category: show.category,
    format: show.format,
    duration: show.duration,
    readTime: show.readTime,
    airDate: show.airDate,
    publishedAt: show.publishedAt,
    media: show.media,
    bodyHtml: show.bodyHtml,
    chapters: show.chapters,
    links: show.links,
    mentions: show.mentions,
    quote: show.quote
  };
}
