const CACHE_NAME = 'mindex-cache-v2';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(URLS_TO_CACHE);

      try {
        const response = await fetch('/', { cache: 'no-store' });
        const html = await response.text();
        const assetMatches = html.match(/\/assets\/[^"' )]+\.(?:js|css)/g) || [];
        const uniqueAssets = [...new Set(assetMatches)];
        await cache.addAll(uniqueAssets);
      } catch (error) {
        console.warn('Failed to cache dynamic assets:', error);
      }
    })(),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', responseToCache));
          return response;
        })
        .catch(async () => (await caches.match('/index.html')) || (await caches.match('/offline.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cachedResponse) =>
        cachedResponse ||
        fetch(event.request)
          .then((response) => {
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, responseToCache));
            return response;
          })
          .catch(async () => {
            if (event.request.mode === 'navigate') {
              return (await caches.match('/offline.html')) || (await caches.match('/'));
            }
            return new Response('Offline', { status: 503, statusText: 'Offline' });
          }),
    ),
  );
});
