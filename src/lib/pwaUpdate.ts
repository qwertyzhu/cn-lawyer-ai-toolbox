import type { AiProviderConfig } from '../types/toolbox';

type UpdateListener = (available: boolean) => void;

export type OfflinePackStatusCode =
  | 'checking'
  | 'syncing'
  | 'ready'
  | 'partial'
  | 'dev_local';

export interface OfflinePackState {
  status: OfflinePackStatusCode;
  readyCount: number;
  totalCount: number;
}

type OfflinePackListener = (state: OfflinePackState) => void;

const HEAVY_PACK_SUFFIXES = [
  'data/laws-offline.json',
  'data/spc-2025-templates.json',
  'fonts/ofl-noto-sans-sc-medium.woff2',
];

let waitingRegistration: ServiceWorkerRegistration | null = null;
let updateAvailable = false;
let userRequestedUpdate = false;
let reloading = false;
const listeners = new Set<UpdateListener>();

const IS_PROD_ENV = Boolean((import.meta as { env?: { PROD?: boolean } }).env?.PROD);
const APP_BASE_URL = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';

let currentOfflineState: OfflinePackState = {
  status: IS_PROD_ENV ? 'checking' : 'dev_local',
  readyCount: 0,
  totalCount: HEAVY_PACK_SUFFIXES.length,
};
const packListeners = new Set<OfflinePackListener>();

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn(updateAvailable);
    } catch {
      // ignore subscriber error
    }
  }
}

function setOfflinePackState(next: OfflinePackState) {
  currentOfflineState = next;
  for (const fn of packListeners) {
    try {
      fn(currentOfflineState);
    } catch {
      // ignore subscriber error
    }
  }
}

export function getOfflinePackState(): OfflinePackState {
  return currentOfflineState;
}

export function onOfflinePackStateChange(listener: OfflinePackListener): () => void {
  packListeners.add(listener);
  listener(currentOfflineState);
  return () => {
    packListeners.delete(listener);
  };
}

export interface HonestAiReadiness {
  state: 'unconfigured' | 'untested' | 'verified';
  shortLabel: string;
  detailLabel: string;
}

export function describeAiReadiness(provider?: AiProviderConfig | null): HonestAiReadiness {
  const hasKey = Boolean(provider && (provider.apiKey.trim() || provider.apiKeyEncrypted));
  if (!provider || !hasKey) {
    return {
      state: 'unconfigured',
      shortLabel: 'AI 未配密钥',
      detailLabel: '本地工具免密钥可用 · AI 按需配置',
    };
  }
  const shortVendor = provider.name.split('（')[0].trim();
  if (provider.lastTestedAt) {
    return {
      state: 'verified',
      shortLabel: `AI 已测通 · ${shortVendor}`,
      detailLabel: `${shortVendor} 已通过连通性测试`,
    };
  }
  return {
    state: 'untested',
    shortLabel: `已存密钥（待测通）`,
    detailLabel: `${shortVendor} 已填密钥，可在「我的配置」点测试连通性`,
  };
}

function getScopedAppCachePrefix(): string {
  const baseUrl = new URL(APP_BASE_URL, window.location.origin);
  const scopeSlug = baseUrl.pathname.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `cn-lawyer-ai-toolbox${scopeSlug}::`;
}

export async function inspectOfflinePackReadiness(): Promise<OfflinePackState> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return currentOfflineState;
  }
  if (!IS_PROD_ENV) {
    const devState: OfflinePackState = {
      status: 'dev_local',
      readyCount: HEAVY_PACK_SUFFIXES.length,
      totalCount: HEAVY_PACK_SUFFIXES.length,
    };
    setOfflinePackState(devState);
    return devState;
  }
  try {
    const baseUrl = new URL(APP_BASE_URL, window.location.origin);
    const prefix = getScopedAppCachePrefix();
    const keys = await caches.keys();
    const appCaches = keys.filter(
      (k) => k.startsWith(prefix) || k.startsWith('cn-lawyer-ai-toolbox-v1-')
    );
    if (appCaches.length === 0) {
      const st: OfflinePackState = {
        status: navigator.onLine ? 'syncing' : 'partial',
        readyCount: 0,
        totalCount: HEAVY_PACK_SUFFIXES.length,
      };
      setOfflinePackState(st);
      return st;
    }

    const latestCache = await caches.open(appCaches[appCaches.length - 1]);
    let found = 0;
    for (const rel of HEAVY_PACK_SUFFIXES) {
      const targetUrl = new URL(rel, baseUrl).href;
      const match = await latestCache.match(targetUrl);
      if (match && match.ok) found += 1;
    }
    const next: OfflinePackState = {
      status: found >= HEAVY_PACK_SUFFIXES.length ? 'ready' : 'partial',
      readyCount: found,
      totalCount: HEAVY_PACK_SUFFIXES.length,
    };
    setOfflinePackState(next);
    return next;
  } catch {
    return currentOfflineState;
  }
}

export async function retryOfflinePacks(): Promise<OfflinePackState> {
  if (typeof window === 'undefined') return currentOfflineState;
  setOfflinePackState({
    status: 'syncing',
    readyCount: currentOfflineState.readyCount,
    totalCount: HEAVY_PACK_SUFFIXES.length,
  });

  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'RETRY_OFFLINE_PACKS' });
    }
    if ('caches' in window) {
      const baseUrl = new URL(APP_BASE_URL, window.location.origin);
      const prefix = getScopedAppCachePrefix();
      const keys = await caches.keys();
      const targetCacheName =
        keys.filter((k) => k.startsWith(prefix)).pop() || `${prefix}manual-packs`;
      const cache = await caches.open(targetCacheName);
      for (const rel of HEAVY_PACK_SUFFIXES) {
        const url = new URL(rel, baseUrl).href;
        const hit = await cache.match(url);
        if (!hit) {
          const resp = await fetch(url, { cache: 'no-cache' });
          if (resp.ok) {
            await cache.put(url, resp.clone());
          }
        }
      }
    }
  } catch {
    // inspectOfflinePackReadiness below will set accurate partial/ready status
  }
  return inspectOfflinePackReadiness();
}

function markUpdateReady(reg: ServiceWorkerRegistration) {
  waitingRegistration = reg;
  if (!updateAvailable) {
    updateAvailable = true;
    notifyListeners();
  }
}

export function onPwaUpdateAvailable(listener: UpdateListener): () => void {
  listeners.add(listener);
  if (updateAvailable) {
    listener(true);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function applyPwaUpdate(): void {
  userRequestedUpdate = true;
  if (waitingRegistration?.waiting) {
    waitingRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    window.setTimeout(() => {
      if (!reloading) {
        reloading = true;
        window.location.reload();
      }
    }, 1500);
    return;
  }
  if (!reloading) {
    reloading = true;
    window.location.reload();
  }
}

export function registerToolboxServiceWorker(swPath = '/sw.js'): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (ev) => {
    const data = ev.data;
    if (data && data.type === 'OFFLINE_PACK_STATE') {
      setOfflinePackState({
        status: data.status,
        readyCount: Number(data.readyCount) || 0,
        totalCount: Number(data.totalCount) || HEAVY_PACK_SUFFIXES.length,
      });
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (userRequestedUpdate && !reloading) {
        reloading = true;
        window.location.reload();
      }
    });

    const watchRegistration = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        markUpdateReady(reg);
      }
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            markUpdateReady(reg);
          }
        });
      });
    };

    navigator.serviceWorker
      .register(swPath, { updateViaCache: 'none' })
      .then((reg) => {
        watchRegistration(reg);
        window.setTimeout(() => {
          inspectOfflinePackReadiness().then((st) => {
            if (st.status !== 'ready' && navigator.onLine) {
              reg.active?.postMessage({ type: 'RETRY_OFFLINE_PACKS' });
            }
          });
        }, 900);

        reg.update().catch(() => {});
        let lastCheck = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && Date.now() - lastCheck > 5 * 60_000) {
            lastCheck = Date.now();
            reg.update().catch(() => {});
          }
        });
      })
      .catch(() => {
        setOfflinePackState({
          status: 'partial',
          readyCount: 0,
          totalCount: HEAVY_PACK_SUFFIXES.length,
        });
      });
  });
}
