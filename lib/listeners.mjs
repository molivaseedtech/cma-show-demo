import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

let writeQueue = Promise.resolve();
let accountQueue = Promise.resolve();

function listenerFile() {
  const directory = process.env.CMA_DATA_DIR || path.join(process.cwd(), 'data');
  return path.join(directory, 'listeners.json');
}

async function readListeners() {
  try {
    const value = JSON.parse(await fs.readFile(listenerFile(), 'utf8'));
    return { version: 1, users: Array.isArray(value.users) ? value.users : [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, users: [] };
    throw error;
  }
}

function persist(value) {
  writeQueue = writeQueue.then(async () => {
    const file = listenerFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, file);
  });
  return writeQueue;
}

function clean(value, max) {
  return String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeEmail(value) { return clean(value, 180).toLowerCase(); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, passwordHash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}

function passwordMatches(user, supplied) {
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = crypto.scryptSync(String(supplied || ''), user.salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function publicListener(user) {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

async function createListener(input = {}) {
  const name = clean(input.name, 40);
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');
  if (name.length < 2) throw Object.assign(new Error('Add the name or handle you want listeners to see.'), { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Add a valid email address.'), { status: 400 });
  if (password.length < 8 || password.length > 128) throw Object.assign(new Error('Use a password between 8 and 128 characters.'), { status: 400 });

  const listeners = await readListeners();
  if (listeners.users.some(user => user.email === email)) throw Object.assign(new Error('That email already has an account. Sign in instead.'), { status: 409 });
  const value = { id: crypto.randomUUID(), name, email, ...hashPassword(password), createdAt: new Date().toISOString() };
  listeners.users.push(value);
  await persist(listeners);
  return publicListener(value);
}

export function registerListener(input = {}) {
  const task = accountQueue.then(() => createListener(input));
  accountQueue = task.catch(() => {});
  return task;
}

export async function authenticateListener(email, password) {
  const listeners = await readListeners();
  const user = listeners.users.find(value => value.email === normalizeEmail(email));
  return user && passwordMatches(user, password) ? publicListener(user) : null;
}

export async function getListener(id) {
  const listeners = await readListeners();
  return publicListener(listeners.users.find(user => user.id === id));
}
