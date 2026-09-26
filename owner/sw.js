/* Keeps a copy of the app's screens on the phone so it opens quickly and without signal.
   Bookings always come live from Supabase and are never stored here. */
const CACHE = 'bloom-bookings-v3';
const CALENDAR_LIB = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.21/index.global.min.js';
const SHELL = ['./', 'app.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png', '../site.js', '../bloom-events-logo.svg'];

self.addEventListener('install', event => {
  // The calendar library comes from a CDN; if it can't be reached now, it's saved the first time the app loads it.
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(SHELL).then(() => cache.add(CALENDAR_LIB).catch(() => {})))
    .then(() => self.skipWaiting()));
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
  const network = fetch(request);
  event.waitUntil(network.then(response => {
    if (!response.ok) return undefined;
    const copy = response.clone();
    return caches.open(CACHE).then(cache => cache.put(request, copy));
  }).catch(() => {}));
  // Network first, so an update shows up the next time the app opens. Without signal, or after
  // 4 seconds on a weak one, the saved copy is used instead.
  event.respondWith((async () => {
    const saved = caches.match(request, { ignoreSearch: true })
      .then(match => match || (request.mode === 'navigate' ? caches.match('./') : undefined));
    try {
      return await Promise.race([network, new Promise((resolve, reject) => setTimeout(() => reject(new Error('slow')), 4000))]);
    } catch {
      return (await saved) || network;
    }
  })());
});
