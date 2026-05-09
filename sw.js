const CACHE = 'creature-v1';
const STATIC = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const { hostname } = new URL(e.request.url);
  if (hostname.includes('inaturalist.org') || hostname.includes('nominatim.openstreetmap.org')) return;
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});
