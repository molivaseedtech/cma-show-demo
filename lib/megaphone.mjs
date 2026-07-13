const CMA_MEGAPHONE_RSS = 'https://feeds.megaphone.fm/GEMINIMEDIA5276993481';
let cache = { feedUrl: '', expiresAt: 0, episodes: [] };

function decodeXml(value = '') {
  return String(value)
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function tag(body, name) {
  const match = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return decodeXml(match?.[1] || '');
}

function enclosure(body) {
  return decodeXml(body.match(/<enclosure[^>]+url=["']([^"']+)["']/i)?.[1] || '');
}

export function parseMegaphoneFeed(xml = '') {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
    const body = match[1];
    const publishedAt = new Date(tag(body, 'pubDate'));
    return {
      id: tag(body, 'guid') || enclosure(body),
      title: tag(body, 'title') || 'The Morning Show Podcast',
      publishedAt: Number.isNaN(publishedAt.valueOf()) ? null : publishedAt.toISOString(),
      duration: tag(body, 'itunes:duration'),
      audioUrl: enclosure(body),
      episodeUrl: tag(body, 'link')
    };
  }).filter(episode => episode.audioUrl);
}

export async function getMegaphoneEpisodes(options = {}) {
  const feedUrl = options.feedUrl || process.env.MEGAPHONE_RSS_URL || CMA_MEGAPHONE_RSS;
  const limit = Math.max(1, Math.min(Number(options.limit || 25), 100));
  if (cache.feedUrl === feedUrl && cache.expiresAt > Date.now()) return cache.episodes.slice(0, limit);

  const response = await fetch(feedUrl, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml;q=0.9' },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`Megaphone RSS returned ${response.status}.`);
  const episodes = parseMegaphoneFeed(await response.text());
  cache = { feedUrl, expiresAt: Date.now() + 5 * 60 * 1000, episodes };
  return episodes.slice(0, limit);
}

export { CMA_MEGAPHONE_RSS };
