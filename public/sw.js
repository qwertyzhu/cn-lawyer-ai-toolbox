const RAW_CACHE_VERSION = '__CN_LAWYER_CACHE_VERSION__';
function getScopedCachePrefix() {
  try {
    const scopePath = new URL(self.registration.scope).pathname.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `cn-lawyer-ai-toolbox${scopePath}::`;
  } catch {
    return 'cn-lawyer-ai-toolbox::';
  }
}
const CACHE_NAME = `${getScopedCachePrefix()}${RAW_CACHE_VERSION}`;
const PRECACHE_ASSETS = [
  /*__CN_LAWYER_PRECACHE_LIST__*/
];

const HEAVY_PACK_PATTERNS = [
  'data/laws-offline.json',
  'data/spc-2025-templates.json',
  'fonts/ofl-noto-sans-sc-medium.woff2',
];

function isHeavyPackAsset(assetUrl) {
  return HEAVY_PACK_PATTERNS.some((p) => String(assetUrl).endsWith(p));
}

async function broadcastPackState(payload) {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      c.postMessage({ type: 'OFFLINE_PACK_STATE', ...payload });
    }
  } catch {
    // ignore
  }
}

let warmingPacks = false;

async function warmDeferredOfflinePacks() {
  if (warmingPacks) return;
  const scopeUrl = new URL('./', self.registration.scope);
  const packList =
    PRECACHE_ASSETS.length > 0
      ? PRECACHE_ASSETS.filter(isHeavyPackAsset)
      : HEAVY_PACK_PATTERNS.map((p) => new URL(`./${p}`, scopeUrl).pathname);

  if (packList.length === 0) return;
  warmingPacks = true;
  try {
    const cache = await caches.open(CACHE_NAME);
    let readyCount = 0;
    for (const p of packList) {
      const hit = await cache.match(p);
      if (hit) readyCount += 1;
    }
    if (readyCount >= packList.length) {
      await broadcastPackState({
        status: 'ready',
        readyCount,
        totalCount: packList.length,
      });
      return;
    }

    await broadcastPackState({
      status: 'syncing',
      readyCount,
      totalCount: packList.length,
    });

    for (const p of packList) {
      const hit = await cache.match(p);
      if (hit) continue;
      try {
        await cache.add(p);
        readyCount += 1;
        await broadcastPackState({
          status: readyCount >= packList.length ? 'ready' : 'syncing',
          readyCount,
          totalCount: packList.length,
        });
      } catch {
        // Interrupted / offline: leave accurate partial state for retry
      }
    }

    await broadcastPackState({
      status: readyCount >= packList.length ? 'ready' : 'partial',
      readyCount,
      totalCount: packList.length,
    });
  } finally {
    warmingPacks = false;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const scopeUrl = new URL('./', self.registration.scope);
      const fullList =
        PRECACHE_ASSETS.length > 0
          ? PRECACHE_ASSETS
          : [
              scopeUrl.pathname,
              new URL('./index.html', scopeUrl).pathname,
              new URL('./manifest.webmanifest', scopeUrl).pathname,
            ];
      // Tier 1: Only precache lightweight app-shell & offline calculator chunks during install
      // so SW activates quickly without competing with first-screen bandwidth on 4.6 MB data packs.
      const coreAssets = fullList.filter((a) => !isHeavyPackAsset(a));
      const batchSize = 4;
      for (let i = 0; i < coreAssets.length; i += batchSize) {
        const slice = coreAssets.slice(i, i + batchSize);
        await Promise.all(
          slice.map(async (asset) => {
            try {
              await cache.add(asset);
            } catch {
              // Ignore optional asset miss
            }
          })
        );
      }
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'RETRY_OFFLINE_PACKS') {
    event.waitUntil(warmDeferredOfflinePacks());
  }
});

self.addEventListener('activate', (event) => {
  const myPrefix = getScopedCachePrefix();
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(myPrefix) && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
      .then(() => warmDeferredOfflinePacks())
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
    const scopeIndex = new URL('./index.html', self.registration.scope).pathname;
    event.respondWith(
      fetch(new Request(event.request.url, { cache: 'no-cache', credentials: 'same-origin' }))
        .then((resp) => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return resp;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return (await caches.match(scopeIndex)) || Response.error();
        })
    );
    return;
  }

  // Cache-First with background refresh for hashed JS/CSS/font/JSON corpus
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResp) => {
          if (networkResp && networkResp.status === 200) {
            const copy = networkResp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
          }
          return networkResp;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
