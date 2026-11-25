type UpdateListener = (available: boolean) => void;

let waitingRegistration: ServiceWorkerRegistration | null = null;
let updateAvailable = false;
let userRequestedUpdate = false;
let reloading = false;
const listeners = new Set<UpdateListener>();

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn(updateAvailable);
    } catch {
      // ignore subscriber error
    }
  }
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
    // Safety fallback if controllerchange doesn't fire within 1.5s
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

  window.addEventListener('load', () => {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // NEVER silently force-reload while the lawyer may be editing or running AI tasks.
      // Only reload after explicit user click on "立即刷新升级".
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
        // Check once on load; check gently on tab focus (never auto-reloads!)
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
        // Ignore SW registration failure on unsupported WebViews
      });
  });
}
