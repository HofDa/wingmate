// Bump this version whenever a cached application asset changes.
const VERSION = 'v9';
const CACHE_PREFIX = `wingmate:${self.registration.scope}:`;
const CACHE_NAME = CACHE_PREFIX + VERSION;
const APP_FILES = [
  './', './index.html', './styles.css', './app.js', './walk.js', './pwa.js',
  './manifest.webmanifest', './icons/wing.svg', './icons/icon-192.png',
  './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
  './classifier/features.js', './classifier/embedding.js', './classifier/classify.js',
  './classifier/morphometrics.js',
  './imaging/qc-ui.js', './imaging/worker.js', './imaging/pipeline.js',
  './imaging/normalization.js', './imaging/quality.js', './imaging/segmentation.js',
  './imaging/orientation.js', './imaging/matrix.js', './imaging/registration.js',
  './imaging/storage.js', './imaging/rig.js', './imaging/rig-store.js', './imaging/camera.js', './imaging/landmark-ui.js',
  './classifier/landmarks.js', './classifier/model.js', './classifier/model-store.js',
  './classifier/train-worker.js', './classifier/typed-json.js', './training.js', './shell.js',
];
const APP_URLS = new Set(APP_FILES.map(file => new URL(file, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(APP_FILES.map(file => new Request(new URL(file, self.registration.scope), { cache: 'reload' }))),
  ));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Updates wait until the user chooses to reload, or closes all app windows.
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Only the entry document and known application files belong in this cache.
  // Imported photos, graphs and references remain in their existing local storage.
  const entry = new URL('./', self.registration.scope);
  const index = new URL('./index.html', self.registration.scope);
  const isEntry = event.request.mode === 'navigate' &&
    (url.pathname === entry.pathname || url.pathname === index.pathname);
  if (!isEntry && !APP_URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(isEntry ? index.href : event.request) || fetch(event.request);
  })());
});
