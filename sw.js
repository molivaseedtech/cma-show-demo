/* Minimal service worker — prototype.
   In production this also subscribes to Web Push and receives 'push' events
   from the backend to notify users of new episodes / live streams / blog posts. */
const CACHE = 'cma-proto-v1';
const ASSETS = ['./index.html', './manifest.webmanifest', './icon.svg'];

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
