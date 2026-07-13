const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { status: null, user: null, shows: [], comments: [], current: null, step: 'source', saveTimer: null, saving: false, lastSavedAt: null };
const hostedPreview = location.hostname.endsWith('vercel.app') || location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('staticPreview');
const PREVIEW_SHOWS_KEY = 'cma-hosted-preview-content-v2';
const PREVIEW_ALERTS_KEY = 'cma-demo-alerts';

function applyAdminTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = value; localStorage.setItem('cma-theme', value);
  $$('[data-theme-toggle]').forEach(button => {
    button.querySelector('[aria-hidden]').textContent = value === 'dark' ? '☀' : '☾';
    const label = button.querySelector('span:last-child'); if (label) label.textContent = value === 'dark' ? 'Light' : button.classList.contains('login-theme') ? 'Dark mode' : 'Dark';
    button.setAttribute('aria-label', `Switch to ${value === 'dark' ? 'light' : 'dark'} mode`);
  });
}
applyAdminTheme(document.documentElement.dataset.theme);
$$('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => applyAdminTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')));

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function previewShows() {
  const stored = localStorage.getItem(PREVIEW_SHOWS_KEY);
  if (stored) return JSON.parse(stored);
  const payload = await fetch(new URL('../data/content.json', location.href)).then(response => response.json());
  const shows = payload.shows || []; localStorage.setItem(PREVIEW_SHOWS_KEY, JSON.stringify(shows)); return shows;
}

function storePreviewShows(shows) { localStorage.setItem(PREVIEW_SHOWS_KEY, JSON.stringify(shows)); }
function storePreviewAlert(input) {
  const alerts = JSON.parse(localStorage.getItem(PREVIEW_ALERTS_KEY) || '[]');
  const alert = { id: crypto.randomUUID(), ...input, createdAt: new Date().toISOString(), source: 'CM&A Demo' };
  localStorage.setItem(PREVIEW_ALERTS_KEY, JSON.stringify([alert, ...alerts].slice(0, 25)));
  localStorage.setItem('cma-community-alerts', JSON.stringify([alert, ...alerts].slice(0, 25)));
  return alert;
}
function previewComments() {
  const saved = JSON.parse(localStorage.getItem('cma-episode-comments') || '{}');
  return Object.entries(saved).flatMap(([episodeId, comments]) => comments.map(comment => ({ ...comment, episodeId, id: comment.id || `${episodeId}-${comment.time}-${comment.name}` }))).filter(comment => comment.pending !== false);
}

function easternDay(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.valueOf())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isPreferredActiveShow(candidate, current) {
  const candidateRank = Number(candidate.status === 'scheduled');
  const currentRank = Number(current.status === 'scheduled');
  if (candidateRank !== currentRank) return candidateRank > currentRank;
  return new Date(candidate.updatedAt || candidate.createdAt) > new Date(current.updatedAt || current.createdAt);
}

function activeDraftForDay(shows, input) {
  const day = easternDay(input.airDate || Date.now());
  return shows.filter(show => show.format === (input.format || 'Podcast') && ['draft', 'scheduled'].includes(show.status) && easternDay(show.airDate || show.createdAt) === day)
    .reduce((best, show) => !best || isPreferredActiveShow(show, best) ? show : best, null);
}

async function previewRequest(url, options = {}) {
  const method = options.method || 'GET';
  if (url === '/api/auth/session') return { loggedIn: true, user: { id: 'demo', name: 'CM&A Demo' }, choices: [] };
  if (url === '/api/auth/login') return { user: { id: 'demo', name: 'CM&A Demo' } };
  if (url === '/api/auth/logout') return { ok: true };
  if (url === '/api/admin/status') return { demoMode: true, timezone: 'America/New_York', providers: {
    openai: { ready: false }, localTranscription: { ready: false }, localGeneration: { ready: false }, gemini: { ready: false }, megaphone: { ready: false }, twitch: { ready: false }
  } };
  if (url === '/api/admin/alerts' && method === 'POST') return { alert: storePreviewAlert(JSON.parse(options.body || '{}')) };
  if (url === '/api/admin/comments' && method === 'GET') return { comments: previewComments() };
  const previewCommentRoute = url.match(/^\/api\/admin\/comments\/([^/]+)\/(approve|remove)$/);
  if (previewCommentRoute && method === 'POST') {
    const saved = JSON.parse(localStorage.getItem('cma-episode-comments') || '{}');
    for (const [episodeId, comments] of Object.entries(saved)) saved[episodeId] = comments.filter(comment => {
      const id = comment.id || `${episodeId}-${comment.time}-${comment.name}`; if (id !== decodeURIComponent(previewCommentRoute[1])) return true;
      if (previewCommentRoute[2] === 'approve') { comment.pending = false; return true; } return false;
    });
    localStorage.setItem('cma-episode-comments', JSON.stringify(saved)); return { comment: { id: decodeURIComponent(previewCommentRoute[1]) } };
  }
  if (url.startsWith('/api/admin/twitch/videos')) return { videos: [{ id: 'demo-vod', title: 'CM&A Live — demo replay', url: 'https://www.twitch.tv/CarlaMarieandAnthony', createdAt: new Date().toISOString(), duration: '1h 12m', thumbnailUrl: '../assets/cma-hero.webp' }] };
  let shows = await previewShows();
  if (url === '/api/admin/shows' && method === 'GET') return { shows };
  if (url === '/api/admin/shows' && method === 'POST') {
    const input = JSON.parse(options.body || '{}'); const now = new Date().toISOString();
    const existing = activeDraftForDay(shows, input);
    if (existing) return { show: existing, reused: true };
    const show = { id: crypto.randomUUID(), slug: `demo-${now.slice(0,10)}`, status: 'draft', title: input.title || 'Untitled show', episodeTitle: input.episodeTitle || '', excerpt: '', publishBlog: input.publishBlog ?? false, category: 'News', format: input.format || 'Podcast', duration: '', readTime: '', airDate: input.airDate || now, publishAt: null, publishedAt: null, source: { type: input.sourceType || 'upload', url: '', assetId: '', twitchVideoId: '' }, media: { podcastUrl: '', audioUrl: '', twitchUrl: '', youtubeUrl: '', imageUrl: '' }, transcript: '', bodyHtml: '', chapters: [], links: [], mentions: [], quote: '', review: { blog: false, chapters: false, links: false, media: false }, ai: {}, createdAt: now, updatedAt: now };
    shows = [show, ...shows]; storePreviewShows(shows); return { show, reused: false };
  }
  const match = url.match(/^\/api\/admin\/shows\/([^/]+)(?:\/(generate|transcribe|download|publish|schedule|archive))?$/);
  if (!match) throw new Error('That action is not available in the hosted preview.');
  const index = shows.findIndex(show => show.id === match[1]); if (index < 0) throw new Error('Show not found in this browser preview.');
  const body = JSON.parse(options.body || '{}'); let show = shows[index];
  if (!match[2] && method === 'PATCH') show = { ...show, ...body, updatedAt: new Date().toISOString() };
  if (match[2] === 'download') show = { ...show, source: { ...show.source, assetId: `demo-${Date.now()}.mp3`, filename: 'linked-audio.mp3' } };
  if (match[2] === 'transcribe') show = { ...show, transcript: show.transcript || '00:00 Carla Marie: Welcome to the demo transcript.\n00:14 Anthony: Here is the story listeners need this morning.' };
  if (match[2] === 'generate') show = { ...show, title: show.title || 'Today on the Carla Marie & Anthony Show', episodeTitle: show.episodeTitle || 'Today’s morning show', excerpt: 'The useful stories, links, and moments from today’s show.', bodyHtml: '<p>Here is the CM&amp;A-reviewed written companion for today’s episode.</p><h2>What you need to know</h2><p>Edit this text in plain language before publishing.</p>', chapters: [{ time: '00:00', title: 'Welcome to the show' }, { time: '00:14', title: 'The story you need' }], links: [{ label: 'CM&A on Twitch', url: 'https://www.twitch.tv/CarlaMarieandAnthony' }], mentions: [{ name: 'CM&A community', verifiedUrl: '', context: 'Listeners' }], quote: 'Here is the story listeners need this morning.', ai: { provider: 'demo', model: 'preview', generatedAt: new Date().toISOString() }, review: { ...show.review, blog: false, chapters: false, links: false } };
  if (match[2] === 'archive') show = { ...show, status: 'archived', publishAt: null };
  if (match[2] === 'schedule') show = { ...show, status: 'scheduled', publishAt: body.localPublishAt ? `${body.localPublishAt}:00-04:00` : body.publishAt };
  if (match[2] === 'publish') { show = { ...show, status: 'published', publishAt: null, publishedAt: new Date().toISOString() }; storePreviewAlert({ title: show.format === 'Livestream' ? 'The Twitch replay is ready' : 'A new episode is ready', body: show.episodeTitle || show.title, category: show.format === 'Livestream' ? 'twitch' : 'podcast', url: '/' }); }
  shows[index] = show; storePreviewShows(shows); return { show };
}

async function request(url, options = {}) {
  if (hostedPreview) return previewRequest(url, options);
  const response = await fetch(url, {
    credentials: 'same-origin', ...options,
    headers: { ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({ error: `Something went wrong (${response.status}).` }));
  if (response.status === 401 && !url.startsWith('/api/auth/')) showLogin();
  if (!response.ok) {
    const missing = Array.isArray(payload.details) ? ` Still needed: ${payload.details.join(', ')}.` : '';
    throw new Error((payload.error || 'Something went wrong.') + missing);
  }
  return payload;
}

let toastTimer;
function toast(message, kind = '') {
  const el = $('#toast'); el.textContent = message; el.className = `toast show ${kind}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = 'toast'; }, 4300);
}

function saveMessage(message, kind = '', savedAt = null) {
  const el = $('#save-status');
  if (message === 'Saved') {
    const date = new Date(savedAt || Date.now()); state.lastSavedAt = Number.isNaN(date.valueOf()) ? new Date() : date;
    el.textContent = `Saved · ${state.lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    el.title = `Last saved ${state.lastSavedAt.toLocaleString()}`;
  } else {
    el.textContent = message === 'Not saved' && state.lastSavedAt ? `Not saved · last saved ${state.lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : message;
  }
  el.className = `save-status ${kind}`;
}

function showLogin(session = {}) {
  $('#app').classList.add('hidden'); $('#login-screen').classList.remove('hidden');
  const choices = session.choices || [];
  $('#login-user').innerHTML = choices.length
    ? choices.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('')
    : '<option value="local">CM&amp;A on this Mac</option>';
  $('#login-password').required = choices.length > 0;
  $('#login-password').closest('label').classList.toggle('hidden', choices.length === 0);
}

async function startApp(user) {
  state.user = user || { name: 'CM&A' };
  $('#preview-banner').classList.toggle('hidden', !hostedPreview);
  $('#login-screen').classList.add('hidden'); $('#app').classList.remove('hidden');
  await loadData(); showDashboard();
}

async function boot() {
  try {
    const session = await request('/api/auth/session');
    if (!session.loggedIn) return showLogin(session);
    await startApp(session.user);
  } catch (error) {
    showLogin(); $('#login-error').textContent = error.message;
  }
}

async function loadData() {
  const [status, content, moderation] = await Promise.all([request('/api/admin/status'), request('/api/admin/shows'), request('/api/admin/comments')]);
  state.status = status; state.shows = content.shows; state.comments = moderation.comments || [];
  const latestSave = state.shows.map(show => show.updatedAt || show.createdAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0]; saveMessage('Saved', '', latestSave || Date.now());
  if (state.current) state.current = state.shows.find(show => show.id === state.current.id) || null;
  renderConnections(); renderDashboard(); renderModeration();
}

function showDashboard() {
  clearTimeout(state.saveTimer);
  $('#editor').classList.add('hidden'); $('#dashboard').classList.remove('hidden');
  $('#header-title').textContent = 'Publishing workspace';
  const firstName = (state.user?.name || 'CM&A').split(' ')[0];
  $('#welcome-name').textContent = `${firstName}, what are we working on?`;
  renderDashboard();
}

function iconFor(show) { return show.format === 'Livestream' ? '◉' : show.format === 'Article' ? '✎' : '🎙'; }
function dateLabel(show) { return new Date(show.airDate || show.createdAt).toLocaleDateString([], { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }); }

function row(show) {
  const status = show.status === 'scheduled' && show.publishAt ? `Scheduled ${new Date(show.publishAt).toLocaleString([], { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET` : show.status;
  return `<button class="episode-row" data-open="${show.id}"><span class="row-icon">${iconFor(show)}</span><span><strong>${esc(show.title || show.episodeTitle || 'Untitled')}</strong><small>${dateLabel(show)} · ${show.format === 'Livestream' ? 'Twitch show' : show.format === 'Article' ? 'Post' : 'Podcast'}</small></span><span class="row-status ${show.status}">${esc(status)}</span></button>`;
}

function renderDashboard() {
  const active = state.shows.filter(show => ['draft', 'scheduled'].includes(show.status)).reduce((unique, show) => {
    const key = `${show.format}:${easternDay(show.airDate || show.createdAt)}`;
    const current = unique.get(key);
    if (!current || isPreferredActiveShow(show, current)) unique.set(key, show);
    return unique;
  }, new Map());
  const past = state.shows.filter(show => ['published', 'archived'].includes(show.status));
  $('#active-list').innerHTML = active.size ? [...active.values()].map(row).join('') : '<div class="empty-row">Nothing waiting—start a podcast, Twitch show, or post above.</div>';
  $('#past-list').innerHTML = past.length ? past.map(row).join('') : '<div class="empty-row">Past releases will appear here.</div>';
}

function renderModeration() {
  $('#comment-count').textContent = state.comments.length;
  $('#moderation-list').innerHTML = state.comments.length ? state.comments.map(comment => `<article class="moderation-item"><span><strong>${esc(comment.name)}</strong><small>${esc(comment.episodeTitle || 'Episode conversation')}</small></span><div class="moderation-actions"><button class="approve" data-comment-action="approve" data-comment-id="${esc(comment.id)}">Approve</button><button data-comment-action="remove" data-comment-id="${esc(comment.id)}">Remove</button></div><p>${esc(comment.comment)}</p></article>`).join('') : '<div class="moderation-empty">Nothing waiting right now.</div>';
}

function renderConnections() {
  const labels = { localTranscription: 'On-Mac transcription', localGeneration: 'On-Mac writing help', openai: 'OpenAI backup', gemini: 'Gemini backup', megaphone: 'Megaphone feed', twitch: 'Twitch replays' };
  const providers = state.status?.providers || {};
  $('#connections').innerHTML = Object.entries(labels).map(([key, label]) => {
    const provider = providers[key] || {};
    return `<div class="connection ${provider.ready ? 'ready' : ''}"><i></i><strong>${label}</strong><br>${provider.ready ? 'Ready' : 'Not connected yet'}</div>`;
  }).join('');
}

async function createNew(format) {
  const now = new Date();
  const names = { Podcast: `Morning Show Podcast — ${now.toLocaleDateString([], { month: 'long', day: 'numeric' })}`, Livestream: `CM&A Live — ${now.toLocaleDateString([], { month: 'long', day: 'numeric' })}`, Article: 'New post' };
  const payload = await request('/api/admin/shows', { method: 'POST', body: JSON.stringify({
    title: names[format], episodeTitle: format === 'Article' ? '' : names[format], airDate: now.toISOString(), format,
    sourceType: format === 'Livestream' ? 'twitch' : format === 'Article' ? 'manual' : 'upload', publishBlog: format === 'Article'
  }) });
  const existingIndex = state.shows.findIndex(show => show.id === payload.show.id);
  if (existingIndex >= 0) state.shows[existingIndex] = payload.show;
  else state.shows.unshift(payload.show);
  if (payload.reused) toast(`Today’s ${format === 'Livestream' ? 'Twitch show' : format.toLowerCase()} is already open. Picking up where you left off.`);
  openShow(payload.show, payload.show.status === 'scheduled' ? 'release' : format === 'Article' ? 'review' : 'source');
}

function openShow(show, step = 'source') {
  state.current = structuredClone(show); state.step = step;
  $('#dashboard').classList.add('hidden'); $('#editor').classList.remove('hidden');
  renderEditor(); goStep(step, false); window.scrollTo({ top: 0 });
}

function easternInput(iso) {
  if (!iso) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function nextFourEastern() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const afterMorningRelease = parts.hour >= 4;
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + (afterMorningRelease ? 1 : 0)));
  return `${next.toISOString().slice(0, 10)}T04:00`;
}

function setValue(selector, value) { const element = $(selector); if (element) element.value = value ?? ''; }

function renderEditor() {
  const show = state.current;
  const type = show.format === 'Livestream' ? 'Twitch show' : show.format === 'Article' ? 'Quick post' : 'Podcast';
  $('#header-title').textContent = show.title || show.episodeTitle || type;
  $('#type-badge').textContent = type; $('#type-badge').className = `type-badge ${show.format === 'Livestream' ? 'twitch' : show.format === 'Article' ? 'article' : ''}`;
  $('#episode-heading').textContent = show.title || show.episodeTitle || type;
  $('#episode-subtitle').textContent = show.status === 'scheduled' && show.publishAt ? `Scheduled for ${new Date(show.publishAt).toLocaleString([], { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} Eastern` : 'Nothing goes live until you say so.';
  $('#episode-fields').classList.toggle('hidden', show.format === 'Article');
  $('#source-options').classList.toggle('hidden', show.format === 'Article');
  $('#source-heading').textContent = show.format === 'Livestream' ? 'Choose today’s Twitch replay' : show.format === 'Article' ? 'Start writing' : 'Add the final podcast audio';
  $('#source-help').textContent = show.format === 'Livestream' ? 'The replay is usually available about 15 minutes after the stream ends.' : show.format === 'Article' ? 'No episode is needed for a quick post.' : 'Use the file Anthony finished in Adobe Audition. We’ll handle the transcript and first draft.';
  setValue('#source-url', show.source?.url); setValue('#editor-notes', show.editorNotes); setValue('#transcript', show.transcript); setValue('#review-transcript', show.transcript);
  setValue('#episode-title', show.episodeTitle); setValue('#duration', show.duration); setValue('#title', show.title); setValue('#excerpt', show.excerpt);
  $('#body-editor').innerHTML = show.bodyHtml || '';
  $('#publish-blog').checked = Boolean(show.publishBlog); updateBlogChoice();
  setValue('#quote', show.quote); setValue('#podcast-url', show.media?.podcastUrl); setValue('#audio-url', show.media?.audioUrl); setValue('#twitch-url', show.media?.twitchUrl); setValue('#youtube-url', show.media?.youtubeUrl); setValue('#image-url', show.media?.imageUrl);
  setValue('#publish-at', show.publishAt ? easternInput(show.publishAt) : nextFourEastern());
  $('#review-blog').checked = Boolean(show.review?.blog); $('#review-chapters').checked = Boolean(show.review?.chapters); $('#review-links').checked = Boolean(show.review?.links); $('#review-media').checked = Boolean(show.review?.media);
  renderSource(); renderRepeats(); renderReleaseSummary(); saveMessage('Saved', '', show.updatedAt || show.createdAt);
}

function renderSource() {
  const source = state.current.source || {};
  const hasTranscript = Boolean(state.current.transcript?.trim());
  const ready = Boolean(source.assetId || source.url || hasTranscript || state.current.format === 'Article');
  const text = hasTranscript && !source.assetId && !source.url
    ? `✓ Transcript ready${source.transcriptFilename ? `: ${source.transcriptFilename}` : ''} — no audio upload needed`
    : source.assetId ? `✓ File attached: ${source.filename || source.assetId.split('-').pop()}`
      : source.url ? `✓ Linked: ${source.url}`
        : state.current.format === 'Article' ? 'No episode needed for this post.' : 'No audio, transcript, or replay added yet.';
  $('#source-ready').textContent = text; $('#source-ready').classList.toggle('ready', ready);
}

function updateBlogChoice() {
  const on = $('#publish-blog').checked;
  $('#blog-fields').classList.toggle('hidden', !on); $('#blog-choice-label').textContent = on ? 'Add to Blog' : 'Episode only';
  $('#check-blog-row').classList.toggle('hidden', !on);
}

function renderRepeats() {
  const show = state.current;
  $('#links-list').innerHTML = (show.links || []).map((item, index) => `<div class="simple-row"><input aria-label="Link name" value="${esc(item.label)}" data-kind="links" data-index="${index}" data-field="label" placeholder="What it is"><input aria-label="Link URL" value="${esc(item.url)}" data-kind="links" data-index="${index}" data-field="url" placeholder="https://..."><button class="remove-button" data-remove="links" data-index="${index}" aria-label="Remove link">×</button></div>`).join('') || '<div class="empty-row">No links found. That’s okay.</div>';
  $('#mentions-list').innerHTML = (show.mentions || []).map((item, index) => `<div class="simple-row"><input aria-label="Mention name" value="${esc(item.name)}" data-kind="mentions" data-index="${index}" data-field="name" placeholder="Name or product"><input aria-label="Verified link" value="${esc(item.verifiedUrl)}" data-kind="mentions" data-index="${index}" data-field="verifiedUrl" placeholder="Optional verified link"><button class="remove-button" data-remove="mentions" data-index="${index}" aria-label="Remove item">×</button></div>`).join('') || '<div class="empty-row">No extra names or products to check.</div>';
  $('#chapters-list').innerHTML = (show.chapters || []).map((item, index) => `<div class="simple-row chapter"><input aria-label="Chapter time" value="${esc(item.time)}" data-kind="chapters" data-index="${index}" data-field="time" placeholder="00:00"><input aria-label="Chapter name" value="${esc(item.title)}" data-kind="chapters" data-index="${index}" data-field="title" placeholder="What happens here"><button class="remove-button" data-remove="chapters" data-index="${index}" aria-label="Remove chapter">×</button></div>`).join('') || '<div class="empty-row">Chapters will appear after the draft is prepared.</div>';
}

function renderReleaseSummary() {
  const show = state.current;
  const media = show.format === 'Livestream' ? 'Twitch replay' : show.format === 'Article' ? 'No episode' : 'Megaphone podcast';
  $('#release-summary').innerHTML = `<div class="summary-card"><span>Release</span><strong>${esc(show.episodeTitle || show.title || 'Untitled')}</strong></div><div class="summary-card"><span>Media</span><strong>${media}</strong></div><div class="summary-card"><span>Separate Blog post</span><strong>${show.publishBlog ? 'Included' : 'Not included'}</strong></div><div class="summary-card"><span>Links</span><strong>${(show.links || []).length + (show.mentions || []).filter(item => item.verifiedUrl).length} ready</strong></div>`;
}

function collect() {
  const show = state.current;
  return {
    source: { ...(show.source || {}), url: $('#source-url').value.trim() }, editorNotes: $('#editor-notes').value,
    transcript: $('#review-transcript').value || $('#transcript').value, episodeTitle: $('#episode-title').value.trim(), duration: $('#duration').value.trim(),
    publishBlog: $('#publish-blog').checked, title: $('#title').value.trim(), excerpt: $('#excerpt').value.trim(), bodyHtml: $('#body-editor').innerHTML,
    chapters: show.chapters || [], links: show.links || [], mentions: show.mentions || [], quote: $('#quote').value.trim(),
    media: { podcastUrl: $('#podcast-url').value.trim(), audioUrl: $('#audio-url').value.trim(), twitchUrl: $('#twitch-url').value.trim(), youtubeUrl: $('#youtube-url').value.trim(), imageUrl: $('#image-url').value.trim() },
    review: { blog: !$('#publish-blog').checked || $('#review-blog').checked, chapters: show.format === 'Article' || $('#review-chapters').checked, links: $('#review-links').checked, media: show.format === 'Article' || $('#review-media').checked }
  };
}

function queueSave() {
  if (!state.current) return;
  saveMessage('Saving…', 'saving'); clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveDraft(true).catch(error => { saveMessage('Not saved', 'error'); toast(error.message, 'error'); }), 750);
}

async function saveDraft(silent = false) {
  if (!state.current || state.saving) return state.current;
  state.saving = true; clearTimeout(state.saveTimer);
  try {
    const payload = await request(`/api/admin/shows/${state.current.id}`, { method: 'PATCH', body: JSON.stringify(collect()) });
    state.current = payload.show;
    const index = state.shows.findIndex(show => show.id === payload.show.id); if (index >= 0) state.shows[index] = payload.show;
    saveMessage('Saved', '', payload.show.updatedAt || Date.now()); renderSource(); renderReleaseSummary();
    if (!silent) toast('Saved.');
    return payload.show;
  } finally { state.saving = false; }
}

async function episodeAction(action, body = {}) {
  await saveDraft(true);
  const payload = await request(`/api/admin/shows/${state.current.id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
  state.current = payload.show;
  const index = state.shows.findIndex(show => show.id === payload.show.id); if (index >= 0) state.shows[index] = payload.show;
  renderEditor(); return payload.show;
}

function goStep(step, scroll = true) {
  state.step = step;
  $$('#steps button').forEach(button => {
    const order = ['source', 'review', 'release']; const current = order.indexOf(step); const index = order.indexOf(button.dataset.step);
    button.classList.toggle('active', button.dataset.step === step); button.classList.toggle('done', index < current);
  });
  $$('.step-panel').forEach(panel => panel.classList.toggle('hidden', panel.dataset.panel !== step));
  if (step === 'release') { renderReleaseSummary(); saveDraft(true).catch(() => {}); }
  if (scroll) window.scrollTo({ top: 100, behavior: 'smooth' });
}

async function withBusy(button, message, task) {
  const old = button.textContent; button.disabled = true; button.textContent = message;
  try { return await task(); } catch (error) { toast(error.message, 'error'); throw error; } finally { button.disabled = false; button.textContent = old; }
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#login-error').textContent = '';
  try {
    const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ user: $('#login-user').value, password: $('#login-password').value }) });
    $('#login-password').value = ''; await startApp(result.user);
  } catch (error) { $('#login-error').textContent = error.message; }
});

$('#logout').addEventListener('click', async () => { await request('/api/auth/logout', { method: 'POST', body: '{}' }); const session = await request('/api/auth/session'); showLogin(session); });
$('#go-home').addEventListener('click', showDashboard); $('#back-home').addEventListener('click', showDashboard);
$('#refresh').addEventListener('click', () => loadData().catch(error => toast(error.message, 'error')));
document.addEventListener('click', event => {
  const starter = event.target.closest('[data-new]'); if (starter) createNew(starter.dataset.new).catch(error => toast(error.message, 'error'));
  const opener = event.target.closest('[data-open]'); if (opener) { const show = state.shows.find(item => item.id === opener.dataset.open); if (show) openShow(show, show.status === 'scheduled' ? 'release' : 'review'); }
  const go = event.target.closest('[data-go]'); if (go) goStep(go.dataset.go);
  const step = event.target.closest('#steps [data-step]'); if (step) goStep(step.dataset.step);
  const moderation = event.target.closest('[data-comment-action]'); if (moderation) {
    request(`/api/admin/comments/${encodeURIComponent(moderation.dataset.commentId)}/${moderation.dataset.commentAction}`, { method: 'POST', body: '{}' }).then(() => { state.comments = state.comments.filter(comment => comment.id !== moderation.dataset.commentId); renderModeration(); toast(moderation.dataset.commentAction === 'approve' ? 'Comment approved.' : 'Comment removed.'); }).catch(error => toast(error.message, 'error'));
  }
  const add = event.target.closest('[data-add]'); if (add && state.current) {
    if (add.dataset.add === 'link') state.current.links.push({ label: '', url: '', context: '' });
    if (add.dataset.add === 'mention') state.current.mentions.push({ name: '', type: 'other', context: '', searchQuery: '', verifiedUrl: '' });
    if (add.dataset.add === 'chapter') state.current.chapters.push({ time: '00:00', title: '' });
    renderRepeats(); queueSave();
  }
  const remove = event.target.closest('[data-remove]'); if (remove && state.current) { state.current[remove.dataset.remove].splice(Number(remove.dataset.index), 1); renderRepeats(); queueSave(); }
});

$('#editor').addEventListener('input', event => {
  const target = event.target;
  if (target.dataset.kind) state.current[target.dataset.kind][Number(target.dataset.index)][target.dataset.field] = target.value;
  if (target.id === 'transcript') $('#review-transcript').value = target.value;
  if (target.id === 'review-transcript') $('#transcript').value = target.value;
  if (target.id === 'publish-blog') { state.current.publishBlog = target.checked; updateBlogChoice(); renderReleaseSummary(); }
  queueSave();
});
$('#editor').addEventListener('change', queueSave);

$('#media-file').addEventListener('change', event => {
  const file = event.target.files?.[0]; if (!file || !state.current) return;
  if (hostedPreview) {
    state.current.source = { ...state.current.source, type: 'upload', assetId: `preview-${Date.now()}`, filename: file.name, mimeType: file.type };
    saveDraft(true).then(() => { renderSource(); toast('Demo file attached. The audio was not uploaded.'); }).catch(error => toast(error.message, 'error'));
    return;
  }
  withBusy($('#make-draft'), 'Uploading audio…', async () => {
    const response = await fetch(`/api/admin/uploads?filename=${encodeURIComponent(file.name)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'The upload did not finish.');
    state.current.source = { ...state.current.source, type: 'upload', assetId: payload.assetId, filename: file.name, mimeType: payload.mimeType };
    await saveDraft(true); renderSource(); toast('Audio added.');
  }).catch(() => {});
});

$('#transcript-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file || !state.current) return;
  try {
    const transcript = await file.text();
    if (!transcript.trim()) throw new Error('That transcript file is empty.');
    $('#transcript').value = transcript; $('#review-transcript').value = transcript;
    state.current.transcript = transcript;
    state.current.source = { ...state.current.source, type: 'local-transcript', transcriptFilename: file.name };
    await saveDraft(true); renderSource();
    toast('Transcript added. The audio will stay on this Mac.');
  } catch (error) { toast(error.message || 'The transcript could not be read.', 'error'); }
  finally { event.target.value = ''; }
});

$('#download-source').addEventListener('click', event => withBusy(event.currentTarget, 'Getting audio…', async () => { await episodeAction('download'); toast('Audio is ready.'); }).catch(() => {}));

$('#make-draft').addEventListener('click', event => withBusy(event.currentTarget, 'Preparing your draft…', async () => {
  if (state.current.format === 'Article') { $('#publish-blog').checked = true; updateBlogChoice(); return goStep('review'); }
  await saveDraft(true);
  if (!state.current.transcript?.trim()) {
    if (!state.current.source?.assetId && state.current.source?.url) await episodeAction('download');
    if (!state.current.source?.assetId) throw new Error('Add the final audio, upload a transcript, or choose a Twitch replay first.');
    await episodeAction('transcribe', { provider: 'auto' });
  }
  await episodeAction('generate', { provider: 'auto' });
  goStep('review'); toast('Your draft is ready. Review only what you want to use.');
}).catch(() => {}));

$('#archive').addEventListener('click', event => withBusy(event.currentTarget, 'Archiving…', async () => { await episodeAction('archive'); showDashboard(); toast('Moved to past work.'); }).catch(() => {}));

$('#schedule').addEventListener('click', event => withBusy(event.currentTarget, 'Scheduling…', async () => {
  const value = $('#publish-at').value; if (!value) throw new Error('Choose a release date and time.');
  await episodeAction('schedule', { localPublishAt: value });
  $('#release-message').textContent = `✓ Scheduled for ${value.slice(5,10).replace('-', '/')} at ${value.slice(11)} Eastern`; $('#release-message').className = 'release-message success';
  toast('Everything is scheduled together.');
}).catch(() => {}));

$('#publish-now').addEventListener('click', event => withBusy(event.currentTarget, 'Publishing…', async () => { await episodeAction('publish'); $('#release-message').textContent = '✓ Live now'; $('#release-message').className = 'release-message success'; toast('The release is live.'); }).catch(() => {}));

$('#browse-twitch').addEventListener('click', async () => {
  $('#twitch-dialog').showModal(); $('#twitch-videos').innerHTML = '<p>Looking for recent shows…</p>';
  try {
    const payload = await request('/api/admin/twitch/videos?limit=12');
    $('#twitch-videos').innerHTML = payload.videos.length ? payload.videos.map(video => `<article class="vod"><img src="${esc(video.thumbnailUrl)}" alt=""><span><strong>${esc(video.title)}</strong><small>${new Date(video.createdAt).toLocaleString()} · ${esc(video.duration)}</small></span><button class="button secondary" data-vod='${esc(JSON.stringify(video))}'>Choose</button></article>`).join('') : '<p>No recent replays were found.</p>';
  } catch (error) { $('#twitch-videos').innerHTML = `<p>${esc(error.message)}</p>`; }
});
$('#close-twitch').addEventListener('click', () => $('#twitch-dialog').close());
$('#twitch-videos').addEventListener('click', event => {
  const button = event.target.closest('[data-vod]'); if (!button) return;
  const video = JSON.parse(button.dataset.vod);
  state.current.source = { ...state.current.source, type: 'twitch', url: video.url, twitchVideoId: video.id };
  state.current.media = { ...state.current.media, twitchUrl: video.url, imageUrl: video.thumbnailUrl || '' };
  if (!state.current.episodeTitle) state.current.episodeTitle = video.title;
  $('#source-url').value = video.url; $('#twitch-dialog').close(); renderSource(); queueSave(); toast('Replay selected.');
});

$('#open-alert').addEventListener('click', () => $('#alert-dialog').showModal());
$('#close-alert').addEventListener('click', () => $('#alert-dialog').close());
['alert-title', 'alert-body'].forEach(id => $(`#${id}`).addEventListener('input', () => {
  $('#alert-preview-title').textContent = $('#alert-title').value || 'Your title';
  $('#alert-preview-body').textContent = $('#alert-body').value || 'Your message will preview here.';
}));
$('#alert-form').addEventListener('submit', event => withBusy(event.submitter, 'Sending…', async () => {
  event.preventDefault();
  const payload = { category: $('#alert-category').value, title: $('#alert-title').value.trim(), body: $('#alert-body').value.trim(), url: $('#alert-url').value.trim() || '/' };
  await request('/api/admin/alerts', { method: 'POST', body: JSON.stringify(payload) });
  $('#alert-dialog').close(); event.currentTarget.reset(); $('#alert-preview-title').textContent = 'Your title'; $('#alert-preview-body').textContent = 'Your message will preview here.';
  toast(hostedPreview ? 'Demo alert sent in this browser.' : 'Alert queued for CM&A listeners.');
}).catch(() => {}));

boot();
