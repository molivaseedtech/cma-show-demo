/* Public-shell cache. API content remains network-backed and falls back to the
   embedded editorial demo when offline. */
const CACHE = 'cma-platform-v3-brand';
const ASSETS = ['./index.html', './manifest.webmanifest', './icon.svg', './assets/cma-logo.webp', './assets/cma-hero.webp', './assets/carla-marie.webp', './assets/anthony.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

/* Production: real pushes arrive here from the server */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: 'New episode is live!', body: 'Tap to listen now.' };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: './icon.svg', badge: './icon.svg'
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow('./index.html'));
});
