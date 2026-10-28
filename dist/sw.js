/* EnDict service worker: offline app shell.
 *
 * - Navigations: network first, cached index.html as the offline fallback.
 * - Hashed build assets / wasm / icons: cache first, refreshed on demand.
 * - Dictionary shards under /data/ are left to the app's IndexedDB cache and
 *   the HTTP cache, so the same bytes are not stored twice.
 */

const VERSION = 'endict-v2';
const SHELL = [
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('endict-') && key !== VERSION)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'endict:cache' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter(
    (url) => typeof url === 'string' && url.startsWith(self.location.origin),
  );
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await Promise.all(
        urls.slice(0, 40).map(async (url) => {
          try {
            const request = new Request(url);
            if (await cache.match(request)) return;
            const response = await fetch(request);
            if (response.ok) await cache.put(request, response);
          } catch {
            // Best effort: assets stay available through the HTTP cache.
          }
        }),
      );
    })(),
  );
});

function isDataRequest(url) {
  return url.pathname.includes('/data/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The manifest and shards manage their own freshness; don't intercept them.
  if (isDataRequest(url)) return;
  if (request.cache === 'no-cache' || request.cache === 'no-store') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(VERSION);
            await cache.put('./index.html', response.clone());
          }
          return response;
        } catch (error) {
          return (
            (await caches.match(request)) ||
            (await caches.match('./index.html')) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && (response.type === 'basic' || response.type === 'default')) {
          const cache = await caches.open(VERSION);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        return cached || Response.error();
      }
    })(),
  );
});
