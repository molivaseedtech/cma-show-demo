import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

let writeQueue = Promise.resolve();

function dataFile() {
  const directory = process.env.CMA_DATA_DIR || path.join(process.cwd(), 'data');
  return path.join(directory, 'content.json');
}

export async function readShows() {
  const file = dataFile();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.shows) ? parsed.shows : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      const seed = path.join(process.cwd(), 'data', 'content.json');
      if (file !== seed) {
        try {
          const raw = await fs.readFile(seed, 'utf8');
          const parsed = JSON.parse(raw);
          const shows = Array.isArray(parsed.shows) ? parsed.shows : [];
          await persist(shows);
          return shows;
        } catch (seedError) { if (seedError.code !== 'ENOENT') throw seedError; }
      }
      return [];
    }
    throw error;
  }
}

async function persist(shows) {
  const file = dataFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const body = JSON.stringify({ version: 1, shows }, null, 2) + '\n';
  await fs.writeFile(temp, body, { mode: 0o600 });
  await fs.rename(temp, file);
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
    publishBlog: input.publishBlog ?? false,
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
  const published = [];
  for (let index = 0; index < shows.length; index += 1) {
    const show = shows[index];
    if (show.status === 'scheduled' && show.publishAt && new Date(show.publishAt) <= now) {
      const stamp = now.toISOString();
      shows[index] = { ...show, status: 'published', publishAt: null, publishedAt: stamp, updatedAt: stamp };
      published.push(shows[index]);
    }
  }
  if (published.length) await writeShows(shows);
  return published;
}

export function publicShape(show) {
  return {
    id: show.id,
    slug: show.slug,
    title: show.title,
    episodeTitle: show.episodeTitle,
    excerpt: show.excerpt,
    publishBlog: show.publishBlog ?? true,
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
