import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { loadEnv, envFlag } from './lib/env.mjs';
import { createShow, getShow, listShows, publishDueShows, publishShow, publicShape, updateShow } from './lib/store.mjs';
import { generatePackage, runLocalProcess, transcribeFile } from './lib/ai.mjs';
import { listTwitchVideos } from './lib/twitch.mjs';
import { addCheckin, addComment, createAlert, listComments, moderateComment, publicCommunity } from './lib/community.mjs';

const ROOT = process.cwd();
loadEnv(ROOT);
const UPLOADS = process.env.CMA_UPLOAD_DIR || path.join(ROOT, 'uploads');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const JSON_LIMIT = 12 * 1024 * 1024;
const UPLOAD_LIMIT = 500 * 1024 * 1024;
const SESSION_COOKIE = 'cma_admin_session';
const SESSION_KEY = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const loginAttempts = new Map();
const checkinAttempts = new Map();
const commentAttempts = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp4': 'video/mp4'
};

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function errorJson(res, status, message, details) {
  json(res, status, { error: message, ...(details ? { details } : {}) });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON request body.'), { status: 400 }); }
}

function isLocal(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function adminUsers() {
  const users = {};
  if (process.env.CMA_CARLA_PASSWORD) users.carla = { name: 'Carla Marie', password: process.env.CMA_CARLA_PASSWORD };
  if (process.env.CMA_ANTHONY_PASSWORD) users.anthony = { name: 'Anthony', password: process.env.CMA_ANTHONY_PASSWORD };
  if (process.env.CMA_ADMIN_USERS) {
    try {
      for (const [id, password] of Object.entries(JSON.parse(process.env.CMA_ADMIN_USERS))) {
        if (typeof password === 'string' && password) users[id.toLowerCase()] = { name: id, password };
      }
    } catch { console.warn('CMA_ADMIN_USERS must be a JSON object.'); }
  }
  return users;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const index = value.indexOf('=');
    return [decodeURIComponent(index < 0 ? value : value.slice(0, index)), decodeURIComponent(index < 0 ? '' : value.slice(index + 1))];
  }));
}

function sessionToken(userId, expires = Date.now() + 12 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({ userId, expires })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function sessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const [payload, supplied] = token.split('.');
  if (!payload || !supplied) return null;
  const expected = crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('base64url');
  const left = Buffer.from(supplied); const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const user = adminUsers()[value.userId];
    return user && value.expires > Date.now() ? { id: value.userId, name: user.name } : null;
  } catch { return null; }
}

function passwordMatches(expected, supplied) {
  const left = Buffer.from(String(expected)); const right = Buffer.from(String(supplied));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function loginAllowed(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter(time => now - time < 15 * 60 * 1000);
  loginAttempts.set(key, recent);
  return { key, allowed: recent.length < 8 };
}

function checkinAllowed(req) {
  const key = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (checkinAttempts.get(key) || []).filter(time => now - time < 60 * 60 * 1000);
  if (recent.length >= 5) return false;
  checkinAttempts.set(key, [...recent, now]);
  return true;
}

function commentAllowed(req) {
  const key = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now(); const recent = (commentAttempts.get(key) || []).filter(time => now - time < 60 * 60 * 1000);
  if (recent.length >= 4) return false;
  commentAttempts.set(key, [...recent, now]); return true;
}

function authorized(req) {
  if (sessionUser(req)) return true;
  const configured = process.env.ADMIN_TOKEN;
  if (!configured) return Object.keys(adminUsers()).length === 0 && isLocal(req);
  const supplied = req.headers['x-admin-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!supplied) return false;
  const left = Buffer.from(String(configured));
  const right = Buffer.from(String(supplied));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cleanHtml(value = '') {
  return String(value)
    .replace(/<\/?(?:script|style|iframe|object|embed)[^>]*>/gi, '')
    .replace(/\s(?:on\w+|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/<(?!\/?(?:p|h2|ul|ol|li|strong|em|br)\b)[^>]+>/gi, '');
}

function normalizePatch(body) {
  const patch = { ...body };
  if ('bodyHtml' in patch) patch.bodyHtml = cleanHtml(patch.bodyHtml);
  if (patch.publishAt === '') patch.publishAt = null;
  return patch;
}

function timeZoneOffset(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
}

function zonedLocalToDate(value, timeZone) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw Object.assign(new Error('Choose a valid local publish date and time.'), { status: 400 });
  const [, year, month, day, hour, minute] = match.map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = new Date(desired);
  for (let pass = 0; pass < 2; pass += 1) result = new Date(desired - timeZoneOffset(result, timeZone));
  const check = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(result).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  if (check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute) {
    throw Object.assign(new Error(`That local time does not exist in ${timeZone} because of a daylight-saving transition.`), { status: 400 });
  }
  return result;
}

function readyProblems(show) {
  const problems = [];
  if (show.publishBlog && !show.title?.trim()) problems.push('Blog title');
  if (show.format !== 'Article' && !show.episodeTitle?.trim()) problems.push('Episode title');
  if (show.publishBlog && !show.bodyHtml?.trim()) problems.push('Blog body');
  if (show.format !== 'Article' && !show.transcript?.trim()) problems.push('Transcript');
  if (show.publishBlog && !show.review?.blog) problems.push('Blog review');
  if (show.format !== 'Article' && !show.review?.chapters) problems.push('Chapter review');
  if (!show.review?.links) problems.push('Links/mentions review');
  if (!show.review?.media) problems.push('Media review');
  return problems;
}

function applyGenerated(show, result) {
  const draft = result.package;
  return {
    title: draft.title,
    episodeTitle: draft.episodeTitle,
    excerpt: draft.excerpt,
    category: draft.category,
    duration: draft.duration || show.duration,
    readTime: draft.readTime,
    bodyHtml: cleanHtml(draft.bodyHtml),
    chapters: draft.chapters,
    links: draft.links,
    mentions: draft.mentions,
    quote: draft.quote,
    review: { blog: false, chapters: false, links: false, media: show.review?.media || false },
    ai: { provider: result.provider, model: result.model, generatedAt: new Date().toISOString() }
  };
}

function showAlert(show) {
  if (show.format === 'Livestream') return { title: 'The Twitch replay is ready', body: show.episodeTitle || show.title, category: 'twitch', url: show.media?.twitchUrl || '/' };
  if (show.format === 'Article') return { title: 'A new CMA Blog post is up', body: show.title, category: 'blog', url: '/' };
  return { title: 'A new podcast episode is ready', body: show.episodeTitle || show.title, category: show.publishBlog ? 'blog' : 'podcast', url: show.media?.podcastUrl || '/' };
}

async function publishDueAndNotify() {
  const shows = await publishDueShows();
  await Promise.all(shows.map(show => createAlert({ ...showAlert(show), source: 'automatic' })));
  return shows;
}

async function saveUpload(req, url) {
  const rawName = url.searchParams.get('filename') || 'source-audio';
  const safeName = path.basename(rawName).replace(/[^A-Za-z0-9._-]+/g, '-').slice(-120);
  const assetId = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  await fsp.mkdir(UPLOADS, { recursive: true });
  const destination = path.join(UPLOADS, assetId);
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > UPLOAD_LIMIT) req.destroy(Object.assign(new Error('Upload is larger than 500 MB.'), { status: 413 }));
  });
  await pipeline(req, fs.createWriteStream(destination, { mode: 0o600 }));
  return { assetId, filename: safeName, bytes: size, mimeType: req.headers['content-type'] || 'application/octet-stream' };
}

function assetPath(assetId) {
  const safe = path.basename(String(assetId || ''));
  if (!safe || safe !== assetId) throw Object.assign(new Error('Invalid asset ID.'), { status: 400 });
  return path.join(UPLOADS, safe);
}

async function downloadSource(show) {
  const sourceUrl = show.source?.url;
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) throw new Error('Add a valid Twitch, YouTube, or podcast media URL first.');
  const executable = process.env.LOCAL_MEDIA_DOWNLOADER || 'yt-dlp';
  await fsp.mkdir(UPLOADS, { recursive: true });
  const assetId = `${Date.now()}-${show.id}.mp3`;
  const target = path.join(UPLOADS, assetId);
  await runLocalProcess(executable, ['--no-playlist', '-x', '--audio-format', 'mp3', '-o', target, sourceUrl]);
  return { assetId, mimeType: 'audio/mpeg' };
}

async function api(req, res, url) {
  const pathname = url.pathname;
  if (pathname === '/api/public/content' && req.method === 'GET') {
    await publishDueAndNotify();
    const shows = (await listShows()).filter(show => show.status === 'published').map(publicShape);
    return json(res, 200, { shows, generatedAt: new Date().toISOString() });
  }

  if (pathname === '/api/public/community' && req.method === 'GET') {
    return json(res, 200, { ...(await publicCommunity()), discordInviteUrl: process.env.CMA_DISCORD_INVITE_URL || '', mapStyleUrl: process.env.CMA_MAP_STYLE_URL || '' });
  }

  if (pathname === '/api/public/checkins' && req.method === 'POST') {
    if (!checkinAllowed(req)) return errorJson(res, 429, 'That is enough check-ins for now. Try again later.');
    return json(res, 201, { checkin: await addCheckin(await readJson(req)) });
  }

  if (pathname === '/api/public/comments' && req.method === 'POST') {
    if (!commentAllowed(req)) return errorJson(res, 429, 'That is enough comments for now. Try again later.');
    return json(res, 201, { comment: await addComment(await readJson(req)) });
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, service: 'cma-show-platform', time: new Date().toISOString() });
  }

  if (pathname === '/api/auth/session' && req.method === 'GET') {
    const user = sessionUser(req);
    const users = adminUsers();
    return json(res, 200, {
      loggedIn: Boolean(user) || (Object.keys(users).length === 0 && isLocal(req)),
      user: user || (Object.keys(users).length === 0 && isLocal(req) ? { id: 'local', name: 'CMA' } : null),
      localSetup: Object.keys(users).length === 0 && isLocal(req),
      choices: Object.entries(users).map(([id, value]) => ({ id, name: value.name }))
    });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const attempt = loginAllowed(req);
    if (!attempt.allowed) return errorJson(res, 429, 'Too many attempts. Wait 15 minutes and try again.');
    const body = await readJson(req);
    const users = adminUsers();
    if (Object.keys(users).length === 0 && isLocal(req)) {
      const token = sessionToken('local');
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
      return json(res, 200, { user: { id: 'local', name: 'CMA' } });
    }
    const id = String(body.user || '').toLowerCase();
    if (!users[id] || !passwordMatches(users[id].password, body.password || '')) {
      loginAttempts.set(attempt.key, [...(loginAttempts.get(attempt.key) || []), Date.now()]);
      return errorJson(res, 401, 'That name and password do not match.');
    }
    const token = sessionToken(id);
    const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
    return json(res, 200, { user: { id, name: users[id].name } });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return json(res, 200, { ok: true });
  }

  const isAdminApi = pathname.startsWith('/api/admin/') || pathname === '/api/shortcuts/ingest';
  if (isAdminApi && !authorized(req)) return errorJson(res, 401, 'Admin access denied. Use localhost or provide the configured admin token.');

  if (pathname === '/api/admin/status' && req.method === 'GET') {
    return json(res, 200, {
      authRequired: Boolean(process.env.ADMIN_TOKEN || Object.keys(adminUsers()).length),
      user: sessionUser(req),
      timezone: process.env.CMA_TIMEZONE || 'America/New_York',
      providers: {
        openai: { ready: envFlag('OPENAI_API_KEY'), model: process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-mini' },
        localTranscription: { ready: envFlag('LOCAL_WHISPER_BIN') && envFlag('LOCAL_WHISPER_MODEL'), model: process.env.LOCAL_WHISPER_MODEL ? path.basename(process.env.LOCAL_WHISPER_MODEL) : '' },
        localGeneration: { ready: envFlag('OLLAMA_MODEL'), model: process.env.OLLAMA_MODEL || '' },
        gemini: { ready: envFlag('GEMINI_API_KEY'), model: process.env.GEMINI_MODEL || 'gemini-3.5-flash' },
        megaphone: {
          ready: envFlag('MEGAPHONE_RSS_URL'),
          provider: process.env.PODCAST_PROVIDER || 'megaphone',
          mode: envFlag('MEGAPHONE_API_TOKEN') ? 'enterprise API + RSS' : 'RSS verification'
        },
        twitch: { ready: envFlag('TWITCH_CLIENT_ID') && envFlag('TWITCH_CLIENT_SECRET'), channel: process.env.TWITCH_CHANNEL_LOGIN || 'CarlaMarieandAnthony' }
      }
    });
  }

  if (pathname === '/api/admin/shows' && req.method === 'GET') return json(res, 200, { shows: await listShows() });
  if (pathname === '/api/admin/shows' && req.method === 'POST') return json(res, 201, { show: await createShow(await readJson(req)) });
  if (pathname === '/api/admin/alerts' && req.method === 'POST') return json(res, 201, { alert: await createAlert({ ...(await readJson(req)), source: sessionUser(req)?.name || 'CMA' }) });
  if (pathname === '/api/admin/comments' && req.method === 'GET') return json(res, 200, { comments: await listComments('pending') });
  const commentRoute = pathname.match(/^\/api\/admin\/comments\/([^/]+)\/(approve|remove)$/);
  if (commentRoute && req.method === 'POST') {
    const comment = await moderateComment(decodeURIComponent(commentRoute[1]), commentRoute[2]);
    return comment ? json(res, 200, { comment }) : errorJson(res, 404, 'Comment not found.');
  }
  if (pathname === '/api/admin/uploads' && req.method === 'POST') return json(res, 201, await saveUpload(req, url));
  if (pathname === '/api/admin/twitch/videos' && req.method === 'GET') return json(res, 200, { videos: await listTwitchVideos(Number(url.searchParams.get('limit') || 10)) });

  const showRoute = pathname.match(/^\/api\/admin\/shows\/([^/]+)(?:\/(generate|transcribe|download|publish|schedule|archive))?$/);
  if (showRoute) {
    const id = decodeURIComponent(showRoute[1]);
    const action = showRoute[2];
    const show = await getShow(id);
    if (!show) return errorJson(res, 404, 'Show not found.');

    if (!action && req.method === 'GET') return json(res, 200, { show });
    if (!action && req.method === 'PATCH') return json(res, 200, { show: await updateShow(id, normalizePatch(await readJson(req))) });

    if (action === 'generate' && req.method === 'POST') {
      const body = await readJson(req);
      const result = await generatePackage(show, body.provider || 'auto');
      return json(res, 200, { show: await updateShow(id, applyGenerated(show, result)) });
    }

    if (action === 'download' && req.method === 'POST') {
      const asset = await downloadSource(show);
      return json(res, 200, { show: await updateShow(id, { source: { ...show.source, ...asset } }) });
    }

    if (action === 'transcribe' && req.method === 'POST') {
      const body = await readJson(req);
      const assetId = body.assetId || show.source?.assetId;
      if (!assetId) return errorJson(res, 400, 'Upload or download an audio/video source first.');
      const result = await transcribeFile(assetPath(assetId), body.mimeType || show.source?.mimeType || 'audio/mpeg', body.provider || 'auto');
      return json(res, 200, { show: await updateShow(id, { transcript: result.transcript, source: { ...show.source, assetId, mimeType: body.mimeType || show.source?.mimeType || 'audio/mpeg' }, ai: { ...show.ai, transcriptionProvider: result.provider, transcriptionModel: result.model } }) });
    }

    if (action === 'publish' && req.method === 'POST') {
      const problems = readyProblems(show);
      if (problems.length) return errorJson(res, 422, 'Complete the publish checklist first.', problems);
      const published = await publishShow(id);
      await createAlert({ ...showAlert(published), source: 'automatic' });
      return json(res, 200, { show: published });
    }

    if (action === 'schedule' && req.method === 'POST') {
      const body = await readJson(req);
      const timeZone = process.env.CMA_TIMEZONE || 'America/New_York';
      const publishAt = body.localPublishAt ? zonedLocalToDate(body.localPublishAt, timeZone) : new Date(body.publishAt);
      if (Number.isNaN(publishAt.valueOf()) || publishAt <= new Date()) return errorJson(res, 400, 'Choose a future publish time.');
      const problems = readyProblems(show);
      if (problems.length) return errorJson(res, 422, 'Complete the publish checklist first.', problems);
      return json(res, 200, { show: await updateShow(id, { status: 'scheduled', publishAt: publishAt.toISOString() }) });
    }

    if (action === 'archive' && req.method === 'POST') return json(res, 200, { show: await updateShow(id, { status: 'archived', publishAt: null }) });
  }

  if (pathname === '/api/shortcuts/ingest' && req.method === 'POST') {
    const body = await readJson(req);
    let show = await createShow({
      title: body.title || 'Shortcut import', episodeTitle: body.episodeTitle || body.title || '', transcript: body.transcript || '',
      sourceType: body.sourceType || 'shortcut', sourceUrl: body.sourceUrl || '', airDate: body.airDate || new Date().toISOString()
    });
    if (body.generate && show.transcript) {
      const result = await generatePackage(show, body.provider || 'auto');
      show = await updateShow(show.id, applyGenerated(show, result));
    }
    return json(res, 201, { show });
  }

  return false;
}

async function staticFile(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin/index.html';
  const relative = pathname.replace(/^\/+/, '');
  const publicRootFiles = new Set(['index.html', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png']);
  const publicAdminFiles = new Set(['admin/index.html', 'admin/admin.css', 'admin/admin.js']);
  if (!publicRootFiles.has(relative) && !publicAdminFiles.has(relative) && !relative.startsWith('assets/')) return false;
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(`${ROOT}${path.sep}`)) return false;
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return false;
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': relative.startsWith('admin/') ? 'no-store' : 'public, max-age=60'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
    return true;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (url.pathname.startsWith('/api/')) {
      const handled = await api(req, res, url);
      if (handled !== false) return;
    }
    if (await staticFile(req, res, url)) return;
    errorJson(res, 404, 'Not found.');
  } catch (error) {
    console.error(`[${new Date().toISOString()}]`, error);
    if (!res.headersSent) errorJson(res, error.status || 500, error.message || 'Unexpected server error.');
    else res.destroy();
  }
});

export function startServer() {
  const scheduler = setInterval(() => publishDueAndNotify().catch(error => console.error('Scheduler:', error)), 30_000);
  scheduler.unref();
  return server.listen(PORT, HOST, () => {
    console.log(`CMA platform running at http://${HOST}:${PORT}`);
    console.log(`Admin control room: http://${HOST}:${PORT}/admin`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();

export { server, cleanHtml, readyProblems, zonedLocalToDate };
