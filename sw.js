const CACHE = 'waice-v14';
const FILES = [
  './',
  './index.html',
  './style.css',
  './app.js', './js/state.js', './js/unordered-matcher.js', './js/ble-proto.js', './js/ble.js', './js/export.js', './js/recognize.js', './js/ui.js', './js/unordered.js', './js/interactions.js', './js/jg.js', './js/selfcheck.js', './js/sign.js', './js/relay.js', './js/geo.js', './js/phone.js', './js/jg-vector.js',
  './manifest.webmanifest',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './lib/jspdf.umd.min.js',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
