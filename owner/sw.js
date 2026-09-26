/* Keeps a copy of the app's screens on the phone so it opens quickly and without signal.
   Bookings always come live from Supabase and are never stored here. */
const CACHE = 'bloom-bookings-v1';
const CALENDAR_LIB = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.21/index.global.min.js';
const SHELL = ['./', 'app.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png', '../site.js', '../bloom-events-logo.svg', CALENDAR_LIB];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  const ours = url.origin === self.location.origin || url.href === CALENDAR_LIB;
  if (request.method !== 'GET' || !ours) return;
  // Network first, so an update shows up the next time the app opens; the saved copy is the fallback offline.
  event.respondWith(fetch(request)
    .then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request, { ignoreSearch: true })
      .then(saved => saved || (request.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
