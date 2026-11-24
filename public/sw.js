const CACHE_NAME = '__CN_LAWYER_CACHE_VERSION__';
const PRECACHE_ASSETS = [
  /*__CN_LAWYER_PRECACHE_LIST__*/
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        const scopeUrl = new URL('./', self.registration.scope);
        const list =
          PRECACHE_ASSETS.length > 0
            ? PRECACHE_ASSETS
            : [
                scopeUrl.pathname,
                new URL('./index.html', scopeUrl).pathname,
                new URL('./manifest.webmanifest', scopeUrl).pathname,
              ];
        for (const asset of list) {
          try {
            await cache.add(asset);
          } catch {
            // Ignore optional asset cache miss during dev
          }
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never intercept cross-origin LLM API calls or /api/ relay endpoints
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  const isNav =
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html');

  if (isNav) {
    event.respondWith(
      fetch(new Request(event.request.url, { cache: 'no-cache', credentials: 'same-origin' }))
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((c) => c || caches.match(url.pathname))
            .then((c) => {
              if (c) return c;
              if (url.pathname.includes('/tool-assets/')) {
                return new Response('离线缓存尚未就绪，请联网刷新一次页面', {
                  status: 503,
                  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                });
              }
              const scopeRoot = new URL('./', self.registration.scope).pathname;
              const scopeIndex = new URL('./index.html', self.registration.scope).pathname;
              return caches.match(scopeIndex).then((r) => r || caches.match(scopeRoot));
            })
        )
    );
    return;
  }

  // Cache-first with background refresh for hashed bundles, fonts, logos, and offline laws corpus
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
