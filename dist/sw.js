/* EnDict service worker (diagnostic build): relay illustrations to the backend.
 * Temporary build used to find out how the browser treats http:// fetches
 * made by a service worker on an https:// page.
 */

const VERSION = 'endict-diag';
const IMAGE_FILE = /\/images\/([a-z0-9][a-z0-9-]*\.webp)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function configuredServiceBase() {
  try {
    const cache = await caches.open('endict-settings');
    const response = await cache.match('/service-base');
    if (!response) return '';
    return (await response.text()).trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

async function probe(base, name) {
  const out = { base, name };
  const url = `${base}/images/${name}`;
  try {
    const r = await fetch(url);
    out.plain = `${r.status} ${r.type}`;
  } catch (e) {
    out.plain = 'ERR ' + String(e);
  }
  try {
    const r = await fetch(url, { mode: 'no-cors' });
    out.noCors = `${r.status} ${r.type}`;
  } catch (e) {
    out.noCors = 'ERR ' + String(e);
  }
  try {
    const r = await fetch(`${base}/health`);
    out.health = `${r.status} ${r.type}`;
  } catch (e) {
    out.health = 'ERR ' + String(e);
  }
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    out.noStore = `${r.status} ${r.type}`;
  } catch (e) {
    out.noStore = 'ERR ' + String(e);
  }
  return JSON.stringify(out);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const image = IMAGE_FILE.exec(url.pathname);
  if (!image) return;
  event.respondWith(
    (async () => {
      const base = await configuredServiceBase();
      if (!base) return new Response('diag: no base in cache', { status: 599 });
      const report = await probe(base, image[1]);
      return new Response(report, { status: 599, headers: { 'content-type': 'text/plain' } });
    })(),
  );
});
