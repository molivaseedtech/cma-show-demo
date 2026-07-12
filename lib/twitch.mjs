let tokenCache = null;

function requireTwitch() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to enable VOD discovery.');
  return { clientId, clientSecret };
}

async function appToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const { clientId, clientSecret } = requireTwitch();
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
  const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || 'Twitch OAuth failed.');
  tokenCache = { value: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  return tokenCache.value;
}

async function helix(pathname, params) {
  const { clientId } = requireTwitch();
  const token = await appToken();
  const url = new URL(`https://api.twitch.tv/helix/${pathname}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || `Twitch API failed (${response.status}).`);
  return payload;
}

export async function listTwitchVideos(limit = 10) {
  const login = process.env.TWITCH_CHANNEL_LOGIN || 'CarlaMarieandAnthony';
  const users = await helix('users', { login });
  const user = users.data?.[0];
  if (!user) throw new Error(`Twitch channel ${login} was not found.`);
  const videos = await helix('videos', { user_id: user.id, type: 'archive', first: String(Math.min(Math.max(limit, 1), 100)) });
  return (videos.data || []).map(video => ({
    id: video.id,
    title: video.title,
    description: video.description,
    createdAt: video.created_at,
    publishedAt: video.published_at,
    duration: video.duration,
    url: video.url,
    thumbnailUrl: video.thumbnail_url?.replace('%{width}', '640').replace('%{height}', '360'),
    views: video.view_count
  }));
}
