const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { status: null, shows: [], active: null, filter: 'active', dirty: false };
const tokenKey = 'cma-admin-token';
const hostedPreview = location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('staticPreview');
const previewStorageKey = 'cma-hosted-preview-content';

async function previewShows() {
  const stored = localStorage.getItem(previewStorageKey);
  if (stored) return JSON.parse(stored);
  const response = await fetch(new URL('../data/content.json', location.href));
  const payload = await response.json();
  localStorage.setItem(previewStorageKey, JSON.stringify(payload.shows || []));
  return payload.shows || [];
}

function storePreviewShows(shows) {
  localStorage.setItem(previewStorageKey, JSON.stringify(shows));
}

async function previewApi(url, options = {}) {
  if (url === '/api/admin/status') return {
    demoMode: true, authRequired: false, timezone: 'America/New_York', providers: {
      openai: { ready: false, model: 'Connect backend to test' },
      localTranscription: { ready: false, model: '' }, localGeneration: { ready: false, model: '' },
      gemini: { ready: false, model: '' }, megaphone: { ready: false, mode: 'Setup next week' },
      twitch: { ready: false, channel: 'CarlaMarieandAnthony' }
    }
  };
  let shows = await previewShows();
  if (url === '/api/admin/shows' && (!options.method || options.method === 'GET')) return { shows };
  if (url === '/api/admin/shows' && options.method === 'POST') {
    const input = JSON.parse(options.body || '{}');
    const now = new Date().toISOString();
    const show = {
      id: crypto.randomUUID(), slug: `preview-${now.slice(0, 10)}`, status: 'draft', title: input.title || 'Untitled show', episodeTitle: '', excerpt: '',
      category: 'News', format: input.format || 'Livestream', duration: '', readTime: '', airDate: input.airDate || now, publishAt: null, publishedAt: null,
      source: { type: 'upload', url: '', assetId: '', twitchVideoId: '' }, media: { podcastUrl: '', twitchUrl: '', youtubeUrl: '', imageUrl: '' },
      transcript: '', bodyHtml: '', chapters: [], links: [], mentions: [], quote: '', ai: { provider: '', model: '', generatedAt: null },
      review: { blog: false, chapters: false, links: false, media: false }, createdAt: now, updatedAt: now
    };
    shows.unshift(show); storePreviewShows(shows); return { show };
  }
  const match = url.match(/^\/api\/admin\/shows\/([^/]+)(?:\/(publish|schedule|archive|generate|transcribe|download))?$/);
  if (match) {
    const index = shows.findIndex(show => show.id === match[1]);
    if (index < 0) throw new Error('Show not found in this preview.');
    if (!match[2] && options.method === 'PATCH') shows[index] = { ...shows[index], ...JSON.parse(options.body || '{}'), updatedAt: new Date().toISOString() };
    else if (match[2] === 'archive') shows[index] = { ...shows[index], status: 'archived', publishAt: null };
    else if (match[2] === 'publish') shows[index] = { ...shows[index], status: 'published', publishAt: null, publishedAt: new Date().toISOString() };
    else if (match[2] === 'schedule') {
      const body = JSON.parse(options.body || '{}');
      shows[index] = { ...shows[index], status: 'scheduled', publishAt: body.localPublishAt ? `${body.localPublishAt}:00-04:00` : body.publishAt };
    } else throw new Error('This action needs the secure CMA backend. The hosted demo keeps edits only in this browser.');
    storePreviewShows(shows); return { show: shows[index] };
  }
  if (url.startsWith('/api/admin/twitch/') || url.startsWith('/api/admin/uploads')) throw new Error('This action needs the secure CMA backend.');
  throw new Error('This preview action is not available.');
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function authHeaders() {
  const token = sessionStorage.getItem(tokenKey);
  return token ? { 'x-admin-token': token } : {};
}

async function api(url, options = {}) {
  if (hostedPreview) return previewApi(url, options);
  const response = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({ error: `Request failed (${response.status}).` }));
  if (response.status === 401) {
    const token = window.prompt('Enter the CMA admin token:');
    if (token) { sessionStorage.setItem(tokenKey, token); return api(url, options); }
  }
  if (!response.ok) {
    const details = Array.isArray(payload.details) ? ` Missing: ${payload.details.join(', ')}.` : '';
    throw new Error((payload.error || `Request failed (${response.status}).`) + details);
  }
  return payload;
}

let toastTimer;
function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 4200);
}

function markDirty() {
  if (!state.active) return;
  state.dirty = true;
  $('#save').disabled = false;
  $('#save-state').textContent = 'Unsaved changes';
}

function markSaved() {
  state.dirty = false;
  $('#save').disabled = true;
  $('#save-state').textContent = 'All changes saved';
}

function toCmaInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: state.status?.timezone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function tomorrowAtFour() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: state.status?.timezone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const tomorrow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return `${tomorrow.toISOString().slice(0, 10)}T04:00`;
}

function renderProviders() {
  const labels = {
    localTranscription: 'M4 transcription', localGeneration: 'M4 writing', openai: 'OpenAI cloud', gemini: 'Gemini backup', megaphone: 'Megaphone feed', twitch: 'Twitch VODs'
  };
  const providers = state.status?.providers || {};
  $('#provider-strip').innerHTML = Object.entries(labels).map(([key, label]) => {
    const item = providers[key] || {};
    return `<span class="provider-chip ${item.ready ? 'ready' : ''}" title="${esc(item.model || item.channel || item.mode || 'Not configured')}"><i></i><b>${label}</b>${item.ready ? ' ready' : ' setup needed'}</span>`;
  }).join('') + `<span class="provider-note">${state.status?.demoMode ? 'Hosted preview · edits stay in this browser' : 'Auto mode keeps source media private on the M4 whenever local tools are ready.'}</span>`;
  $('#timezone').textContent = state.status?.timezone || 'America/New_York';
}

function filteredShows() {
  if (state.filter === 'all') return state.shows;
  if (state.filter === 'published') return state.shows.filter(show => show.status === 'published');
  return state.shows.filter(show => ['draft', 'scheduled'].includes(show.status));
}

function renderList() {
  const shows = filteredShows();
  $('#show-list').innerHTML = shows.length ? shows.map(show => `
    <button class="show-item ${state.active?.id === show.id ? 'on' : ''}" data-id="${show.id}">
      <span class="show-meta"><span class="status ${show.status}">${esc(show.status)}</span><small>${new Date(show.airDate || show.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></span>
      <strong>${esc(show.title || show.episodeTitle || 'Untitled show')}</strong>
      <small>${esc(show.ai?.provider ? `${show.ai.provider} draft` : 'Waiting for transcript')}</small>
    </button>`).join('') : '<div class="loading">No packages here yet.</div>';
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value ?? '';
}

function renderRepeats() {
  const show = state.active;
  $('#chapters-list').innerHTML = (show.chapters || []).map((item, index) => `<div class="repeat-row">
    <input aria-label="Timestamp" value="${esc(item.time)}" data-kind="chapters" data-index="${index}" data-field="time">
    <input aria-label="Chapter title" value="${esc(item.title)}" data-kind="chapters" data-index="${index}" data-field="title">
    <span></span><button class="icon-btn" data-remove="chapters" data-index="${index}" title="Remove">×</button></div>`).join('') || '<div class="attached">No chapters yet.</div>';
  $('#links-list').innerHTML = (show.links || []).map((item, index) => `<div class="repeat-row link">
    <input aria-label="Label" value="${esc(item.label)}" data-kind="links" data-index="${index}" data-field="label" placeholder="Label">
    <input aria-label="URL" value="${esc(item.url)}" data-kind="links" data-index="${index}" data-field="url" placeholder="https://...">
    <input aria-label="Context" value="${esc(item.context)}" data-kind="links" data-index="${index}" data-field="context" placeholder="Why it came up">
    <button class="icon-btn" data-remove="links" data-index="${index}" title="Remove">×</button></div>`).join('') || '<div class="attached">No verified links yet.</div>';
  $('#mentions-list').innerHTML = (show.mentions || []).map((item, index) => `<div class="repeat-row mention">
    <input aria-label="Name" value="${esc(item.name)}" data-kind="mentions" data-index="${index}" data-field="name" placeholder="Name">
    <select aria-label="Type" data-kind="mentions" data-index="${index}" data-field="type">${['person','brand','product','place','show','story','other'].map(type => `<option ${item.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select>
    <input aria-label="Context" value="${esc(item.context)}" data-kind="mentions" data-index="${index}" data-field="context" placeholder="Context">
    <input aria-label="Verified URL" value="${esc(item.verifiedUrl)}" data-kind="mentions" data-index="${index}" data-field="verifiedUrl" placeholder="Verified URL">
    <button class="icon-btn" data-remove="mentions" data-index="${index}" title="Remove">×</button></div>`).join('') || '<div class="attached">No detected mentions yet.</div>';
}

function renderAiOutput() {
  const show = state.active;
  const output = $('#ai-output');
  if (!show.ai?.generatedAt) {
    output.className = 'ai-output';
    output.innerHTML = '<span>✦</span><p>Attach a transcript, then generate a synchronized editorial package.</p>';
    return;
  }
  output.className = 'ai-output ready';
  output.innerHTML = `
    <div class="metric"><strong>${(show.chapters || []).length}</strong><small>Chapters</small></div>
    <div class="metric"><strong>${(show.links || []).length}</strong><small>Verified URLs found</small></div>
    <div class="metric"><strong>${(show.mentions || []).length}</strong><small>Things mentioned</small></div>
    <div class="metric"><strong>${esc(show.ai.provider)}</strong><small>${esc(show.ai.model)}</small></div>`;
}

function renderActive() {
  const show = state.active;
  $('#empty-state').classList.toggle('hidden', Boolean(show));
  $('#workspace').classList.toggle('hidden', !show);
  if (!show) { $('#page-title').textContent = 'Production overview'; renderList(); return; }
  $('#page-title').textContent = show.title || show.episodeTitle || 'Untitled show';
  const status = show.status || 'draft';
  $('#status-label').textContent = status[0].toUpperCase() + status.slice(1);
  $('#status-dot').className = `status-dot ${status}`;
  $('#status-detail').textContent = status === 'scheduled' && show.publishAt ? `for ${new Date(show.publishAt).toLocaleString()}` : show.publishedAt ? `since ${new Date(show.publishedAt).toLocaleString()}` : '— private to CMA';

  setValue('#source-type', show.source?.type);
  setValue('#source-url', show.source?.url);
  setValue('#transcript', show.transcript);
  setValue('#editor-notes', show.editorNotes);
  setValue('#title', show.title);
  setValue('#episode-title', show.episodeTitle);
  setValue('#category', show.category);
  setValue('#format', show.format);
  setValue('#air-date', toCmaInput(show.airDate));
  setValue('#duration', show.duration);
  setValue('#excerpt', show.excerpt);
  setValue('#body-html', show.bodyHtml);
  $('#body-preview').innerHTML = show.bodyHtml || '<p style="color:#6d655b">The article preview will appear here.</p>';
  setValue('#quote', show.quote);
  setValue('#podcast-url', show.media?.podcastUrl);
  setValue('#twitch-url', show.media?.twitchUrl);
  setValue('#youtube-url', show.media?.youtubeUrl);
  setValue('#image-url', show.media?.imageUrl);
  setValue('#publish-at', show.publishAt ? toCmaInput(show.publishAt) : tomorrowAtFour());
  $('#review-blog').checked = Boolean(show.review?.blog);
  $('#review-chapters').checked = Boolean(show.review?.chapters);
  $('#review-links').checked = Boolean(show.review?.links);
  $('#review-media').checked = Boolean(show.review?.media);
  $('#attached-source').innerHTML = show.source?.assetId
    ? `<strong>Attached:</strong> ${esc(show.source.assetId)} · ready to transcribe`
    : show.source?.url ? `<strong>Linked:</strong> ${esc(show.source.url)}` : 'No source media attached yet.';
  renderRepeats();
  renderAiOutput();
  renderList();
  markSaved();
}

function collectForm() {
  const show = state.active;
  return {
    source: { ...(show.source || {}), type: $('#source-type').value, url: $('#source-url').value.trim() },
    transcript: $('#transcript').value,
    editorNotes: $('#editor-notes').value,
    title: $('#title').value.trim(),
    episodeTitle: $('#episode-title').value.trim(),
    category: $('#category').value,
    format: $('#format').value,
    airDate: $('#air-date').value ? new Date($('#air-date').value).toISOString() : show.airDate,
    duration: $('#duration').value.trim(),
    excerpt: $('#excerpt').value.trim(),
    bodyHtml: $('#body-html').value,
    chapters: show.chapters || [], links: show.links || [], mentions: show.mentions || [],
    quote: $('#quote').value.trim(),
    media: { podcastUrl: $('#podcast-url').value.trim(), twitchUrl: $('#twitch-url').value.trim(), youtubeUrl: $('#youtube-url').value.trim(), imageUrl: $('#image-url').value.trim() },
    review: { blog: $('#review-blog').checked, chapters: $('#review-chapters').checked, links: $('#review-links').checked, media: $('#review-media').checked }
  };
}

async function save(silent = false) {
  if (!state.active) return;
  const payload = await api(`/api/admin/shows/${state.active.id}`, { method: 'PATCH', body: JSON.stringify(collectForm()) });
  state.active = payload.show;
  const index = state.shows.findIndex(show => show.id === state.active.id);
  if (index >= 0) state.shows[index] = state.active;
  renderActive();
  if (!silent) toast('Draft saved.');
  return state.active;
}

async function load() {
  state.status = await api('/api/admin/status');
  const payload = await api('/api/admin/shows');
  state.shows = payload.shows;
  if (state.active) state.active = state.shows.find(show => show.id === state.active.id) || null;
  renderProviders();
  renderActive();
  if (state.status?.demoMode) toast('Hosted preview: edits stay in this browser. Secure integrations run from the CMA backend.');
}

async function createNew() {
  const now = new Date();
  const payload = await api('/api/admin/shows', { method: 'POST', body: JSON.stringify({ title: `CMA Show — ${now.toLocaleDateString([], { month: 'long', day: 'numeric' })}`, airDate: now.toISOString(), format: 'Livestream' }) });
  state.shows.unshift(payload.show);
  state.active = payload.show;
  renderActive();
  switchTab('source');
  toast('New show package created.');
}

function switchTab(tab) {
  $$('#tabs button').forEach(button => button.classList.toggle('on', button.dataset.tab === tab));
  $$('.tab-panel').forEach(panel => panel.classList.toggle('hidden', panel.dataset.panel !== tab));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function busy(button, label, task) {
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try { return await task(); }
  catch (error) { toast(error.message, 'error'); throw error; }
  finally { button.disabled = false; button.textContent = previous; }
}

async function action(endpoint, body = {}) {
  await save(true);
  const payload = await api(`/api/admin/shows/${state.active.id}/${endpoint}`, { method: 'POST', body: JSON.stringify(body) });
  state.active = payload.show;
  const index = state.shows.findIndex(show => show.id === state.active.id);
  if (index >= 0) state.shows[index] = state.active;
  renderActive();
  return state.active;
}

$('#new-show').addEventListener('click', createNew);
$('#empty-new').addEventListener('click', createNew);
$('#refresh').addEventListener('click', () => load().catch(error => toast(error.message, 'error')));
$('#save').addEventListener('click', () => save().catch(error => toast(error.message, 'error')));
$('#show-list').addEventListener('click', event => {
  const item = event.target.closest('[data-id]');
  if (!item) return;
  state.active = state.shows.find(show => show.id === item.dataset.id) || null;
  renderActive();
  $('.sidebar').classList.remove('open');
});
$('#filters').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  state.filter = button.dataset.filter;
  $$('#filters button').forEach(item => item.classList.toggle('on', item === button));
  renderList();
});
$('#tabs').addEventListener('click', event => { const button = event.target.closest('button'); if (button) switchTab(button.dataset.tab); });
$('#mobile-menu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));

$('#workspace').addEventListener('input', event => {
  const target = event.target;
  if (target.dataset.kind) {
    state.active[target.dataset.kind][Number(target.dataset.index)][target.dataset.field] = target.value;
  }
  if (target.id === 'body-html') $('#body-preview').innerHTML = target.value;
  markDirty();
});
$('#workspace').addEventListener('change', markDirty);
$('#workspace').addEventListener('click', event => {
  const add = event.target.closest('[data-add]');
  if (add) {
    const kind = add.dataset.add;
    if (kind === 'chapter') state.active.chapters.push({ time: '00:00', title: '' });
    if (kind === 'link') state.active.links.push({ label: '', url: '', context: '' });
    if (kind === 'mention') state.active.mentions.push({ name: '', type: 'other', context: '', searchQuery: '', verifiedUrl: '' });
    renderRepeats(); markDirty(); return;
  }
  const remove = event.target.closest('[data-remove]');
  if (remove) { state.active[remove.dataset.remove].splice(Number(remove.dataset.index), 1); renderRepeats(); markDirty(); }
});

$('#media-file').addEventListener('change', event => {
  const file = event.target.files?.[0]; if (!file || !state.active) return;
  const label = $('.file-btn');
  const labelText = label.querySelector('span');
  label.style.pointerEvents = 'none';
  labelText.textContent = 'Uploading…';
  (async () => {
    const response = await fetch(`/api/admin/uploads?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Upload failed.');
    state.active.source = { ...state.active.source, type: 'upload', assetId: payload.assetId, mimeType: payload.mimeType };
    $('#source-type').value = 'upload';
    await save(true);
    toast('Media attached and ready to transcribe.');
  })().catch(error => toast(error.message, 'error')).finally(() => {
    label.style.pointerEvents = '';
    labelText.textContent = 'Choose file';
    event.target.value = '';
  });
});

$('#download-source').addEventListener('click', event => busy(event.currentTarget, 'Downloading…', async () => {
  await action('download');
  toast('Source audio downloaded to the private server workspace.');
}).catch(() => {}));

$('#transcribe').addEventListener('click', event => busy(event.currentTarget, 'Transcribing…', async () => {
  await action('transcribe', { provider: $('#transcribe-provider').value });
  toast('Transcript ready. Review it before drafting.');
}).catch(() => {}));

$('#generate').addEventListener('click', event => busy(event.currentTarget, 'Generating package…', async () => {
  await action('generate', { provider: $('#generate-provider').value });
  switchTab('edit');
  toast('Full editorial package drafted. Nothing has been published.');
}).catch(() => {}));

async function publish(button) {
  return busy(button, 'Publishing…', async () => {
    await action('publish');
    toast('The episode page, chapters, blog, and mentions are live together.');
  }).catch(() => {});
}
$('#publish').addEventListener('click', event => publish(event.currentTarget));
$('#publish-secondary').addEventListener('click', event => publish(event.currentTarget));
$('#schedule').addEventListener('click', event => busy(event.currentTarget, 'Scheduling…', async () => {
  const value = $('#publish-at').value;
  if (!value) throw new Error('Choose a publish date and time.');
  await action('schedule', { localPublishAt: value, timezone: state.status?.timezone || 'America/New_York' });
  toast(`Package scheduled for ${value.replace('T', ' ')} Eastern.`);
}).catch(() => {}));
$('#archive').addEventListener('click', event => busy(event.currentTarget, 'Archiving…', async () => {
  await action('archive'); toast('Package archived.');
}).catch(() => {}));

$('#browse-twitch').addEventListener('click', async () => {
  const dialog = $('#twitch-dialog'); dialog.showModal();
  $('#twitch-videos').innerHTML = '<div class="loading">Loading Twitch VODs…</div>';
  try {
    const payload = await api('/api/admin/twitch/videos?limit=12');
    $('#twitch-videos').innerHTML = payload.videos.length ? payload.videos.map(video => `<article class="vod">
      <img src="${esc(video.thumbnailUrl)}" alt=""><div><h3>${esc(video.title)}</h3><p>${new Date(video.createdAt).toLocaleString()} · ${esc(video.duration)} · ${Number(video.views).toLocaleString()} views</p></div>
      <button class="btn tiny" data-vod='${esc(JSON.stringify(video))}'>Attach</button></article>`).join('') : '<div class="loading">No recent archived streams found.</div>';
  } catch (error) { $('#twitch-videos').innerHTML = `<div class="loading">${esc(error.message)}</div>`; }
});
$('#close-twitch').addEventListener('click', () => $('#twitch-dialog').close());
$('#twitch-videos').addEventListener('click', event => {
  const button = event.target.closest('[data-vod]'); if (!button) return;
  const video = JSON.parse(button.dataset.vod);
  state.active.source = { ...state.active.source, type: 'twitch', url: video.url, twitchVideoId: video.id };
  state.active.media = { ...state.active.media, twitchUrl: video.url, imageUrl: video.thumbnailUrl || state.active.media?.imageUrl };
  if (!state.active.episodeTitle) state.active.episodeTitle = video.title;
  renderActive(); markDirty();
  $('#twitch-dialog').close();
  toast('Twitch replay attached. Save, then download audio to transcribe it.');
});

$('#schedule-zone').textContent = 'Times are interpreted in America/New_York, even when CMA is traveling.';

load().catch(error => {
  toast(error.message, 'error');
  $('#empty-state').innerHTML = `<span class="empty-icon">!</span><h2>Control room unavailable</h2><p>${esc(error.message)}</p><button class="btn coral" onclick="location.reload()">Try again</button>`;
});
