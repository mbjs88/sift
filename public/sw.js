// Service worker — required for installability + share_target.
//
// IMPORTANT: navigations are NETWORK-FIRST. The previous version was cache-first
// for everything (including "/"), so after a redeploy the browser kept serving
// the OLD prerendered HTML — stale CSS, stale JS, a dead sign-in button. Now we
// always try the network for pages and hashed assets, and only fall back to
// cache when offline. Bumping the cache name evicts every old shell on activate.

const CACHE = 'sift-shell-v3';
const OFFLINE_ASSETS = ['/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;          // never touch POSTs etc.
  if (url.pathname.startsWith('/api/')) return; // API always hits the network

  // Network-first: get the freshest page/asset; cache a copy for offline; only
  // fall back to cache if the network fails.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/'))),
  );
});
