/* Public-shell cache. API content remains network-backed and falls back to the
   embedded editorial demo when offline. */
const CACHE = 'cma-platform-v7-public-polish';
const ASSETS = ['./index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './data/podcast.json', './assets/cma-logo.webp', './assets/cma-hero.webp', './assets/carla-marie.webp', './assets/anthony.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(response => {
    if (e.request.method === 'GET' && response.ok) caches.open(CACHE).then(cache => cache.put(e.request, response.clone()));
    return response;
  }).catch(() => caches.match(e.request).then(response => response || caches.match('./index.html'))));
});

/* Production: real pushes arrive here from the server */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: 'New episode is live!', body: 'Tap to listen now.' };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: './icon-192.png', badge: './icon-192.png', data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || './'));
});
