import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

let writeQueue = Promise.resolve();

function communityFile() {
  const directory = process.env.CMA_DATA_DIR || path.join(process.cwd(), 'data');
  return path.join(directory, 'community.json');
}

function seedFile() { return path.join(process.cwd(), 'data', 'community.json'); }

function emptyCommunity() { return { version: 1, checkins: [], alerts: [], comments: [] }; }

export async function readCommunity() {
  const file = communityFile();
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    return { ...emptyCommunity(), ...value, checkins: value.checkins || [], alerts: value.alerts || [], comments: value.comments || [] };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (file !== seedFile()) {
      try {
        const seed = JSON.parse(await fs.readFile(seedFile(), 'utf8'));
        await persist(seed);
        return { ...emptyCommunity(), ...seed };
      } catch (seedError) { if (seedError.code !== 'ENOENT') throw seedError; }
    }
    return emptyCommunity();
  }
}

async function persist(value) {
  const file = communityFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

function writeCommunity(value) {
  writeQueue = writeQueue.then(() => persist(value));
  return writeQueue;
}

function cleanText(value, max) {
  return String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const PLATFORM_SET = new Set(['twitch', 'spotify', 'apple', 'iheart', 'youtube', 'other']);

export async function addCheckin(input = {}) {
  const name = cleanText(input.name, 40);
  const city = cleanText(input.city, 50);
  const region = cleanText(input.region, 32).toUpperCase();
  const platforms = [...new Set((Array.isArray(input.platforms) ? input.platforms : []).map(value => String(value).toLowerCase()).filter(value => PLATFORM_SET.has(value)))].slice(0, 4);
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  if (!name || !city || !region) throw Object.assign(new Error('Add a name or handle, city, and state/region.'), { status: 400 });
  if (!platforms.length) throw Object.assign(new Error('Choose at least one listening platform.'), { status: 400 });
  const community = await readCommunity();
  const checkin = {
    id: crypto.randomUUID(), name, city, region, platforms,
    ...(Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
      ? { latitude: Math.round(latitude * 1000) / 1000, longitude: Math.round(longitude * 1000) / 1000 } : {}),
    createdAt: new Date().toISOString()
  };
  community.checkins = [checkin, ...community.checkins].slice(0, 250);
  await writeCommunity(community);
  return checkin;
}

export async function createAlert(input = {}) {
  const title = cleanText(input.title, 80);
  const body = cleanText(input.body, 180);
  if (!title || !body) throw Object.assign(new Error('Add an alert title and message.'), { status: 400 });
  const category = ['announcement', 'podcast', 'twitch', 'blog', 'merch', 'support'].includes(input.category) ? input.category : 'announcement';
  const url = /^https?:\/\//i.test(String(input.url || '')) || String(input.url || '').startsWith('/') ? cleanText(input.url, 300) : '/';
  const community = await readCommunity();
  const alert = { id: crypto.randomUUID(), title, body, category, url, source: cleanText(input.source || 'CMA', 30), createdAt: new Date().toISOString() };
  community.alerts = [alert, ...community.alerts].slice(0, 100);
  await writeCommunity(community);
  return alert;
}

export async function addComment(input = {}) {
  const episodeId = cleanText(input.episodeId, 120);
  const episodeTitle = cleanText(input.episodeTitle, 140);
  const userId = cleanText(input.userId, 80);
  const name = cleanText(input.name, 40);
  const comment = cleanText(input.comment, 500);
  if (!episodeId || !userId || !name || !comment) throw Object.assign(new Error('Sign in and add a comment.'), { status: 400 });
  const community = await readCommunity();
  const value = { id: crypto.randomUUID(), episodeId, episodeTitle, userId, name, comment, status: 'pending', createdAt: new Date().toISOString() };
  community.comments = [value, ...community.comments].slice(0, 1000);
  await writeCommunity(community);
  return value;
}

export async function listComments(status) {
  const community = await readCommunity();
  return status ? community.comments.filter(comment => comment.status === status) : community.comments;
}

export async function moderateComment(id, action) {
  const community = await readCommunity();
  const index = community.comments.findIndex(comment => comment.id === id);
  if (index < 0) return null;
  if (action === 'remove') community.comments.splice(index, 1);
  else community.comments[index] = { ...community.comments[index], status: 'approved', moderatedAt: new Date().toISOString() };
  await writeCommunity(community);
  return action === 'remove' ? { id, removed: true } : community.comments[index];
}

export async function publicCommunity() {
  const community = await readCommunity();
  return { checkins: community.checkins.slice(0, 100), alerts: community.alerts.slice(0, 20), comments: community.comments.filter(comment => comment.status === 'approved').slice(0, 300) };
}
