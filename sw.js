// Service worker for the Grade math slide viewer.
// Keep this file in the SAME folder as that app's index.html.
//
//  - App shell (index.html): network-first (4 s timeout), falls back to the saved copy.
//  - Slide images (raw.githubusercontent.com): cache-first from the slides cache.
//    Slides are bulk-downloaded by index.html; anything missing is saved when first viewed.
//  - Everything else (Google Sheet, ntfy remote) is not touched.
//
// Cache names include this folder's URL, so several apps on one site never share data.
// Bump SHELL_V to discard old app-shell copies. Don't change SLIDES_V unless you want
// every slide re-downloaded (index.html must use the same name).

const SCOPE  = new URL('./', self.location.href).href;
const SHELL_V = 'shell-v1|';
const SHELL  = SHELL_V + SCOPE;
const SLIDES = 'slides-v1|' + SCOPE;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(['./', './index.html'].map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        // only this app's older shell caches
        .filter((k) => k.indexOf('shell-') === 0 && k.slice(-SCOPE.length) === SCOPE && k !== SHELL)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'raw.githubusercontent.com'){
    event.respondWith(slideResponse(req));
  } else if (url.origin === self.location.origin){
    event.respondWith(shellResponse(req));
  }
});

async function slideResponse(req){
  const cache = await caches.open(SLIDES);
  const hit = await cache.match(req.url, { ignoreVary: true });
  if (hit) return hit;
  try {
    // CORS mode gives a normal (non-opaque) response, which keeps storage use honest.
    const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) cache.put(req.url, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    return Response.error();
  }
}

function withTimeout(promise, ms){
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function shellResponse(req){
  const cache = await caches.open(SHELL);
  try {
    const res = await withTimeout(fetch(req), 4000);
    if (res && res.ok && !res.redirected) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = (await cache.match(req, { ignoreSearch: true })) ||
                (req.mode === 'navigate' ? ((await cache.match('./index.html')) || (await cache.match('./'))) : null);
    return hit || Response.error();
  }
}
