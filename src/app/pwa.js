// SyncPad – app/pwa.js
// Service worker registration/update banner, the install-app prompt banner,
// and the "local drafts can't save" storage-full warning. Import for its
// side effects only — nothing here is exported.

import * as UI from '../ui.js';
import { BASE } from './state.js';

// ── PWA / Service Worker ──────────────────────────────────────────────────────
//
// v1: wait for controllerchange (the new SW has actually taken
// control) before reloading. SKIP_WAITING alone doesn't guarantee the new
// SW is in control of the page yet, which can cause split-version reloads.

if ('serviceWorker' in navigator) {
  let _refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_refreshing) return;
    _refreshing = true;
    location.reload();
  });

  navigator.serviceWorker
    .register(`${BASE}/service-worker.js`, { scope: `${BASE}/` })
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            UI.showUpdateBar(() => {
              worker.postMessage({ type: 'SKIP_WAITING' });
              // location.reload() now fires via controllerchange above.
            });
          }
        });
      });
    })
    .catch(() => {});
}

const INSTALL_DISMISSED_KEY = 'syncpad_install_dismissed';
let _deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstall = e;
  if (localStorage.getItem(INSTALL_DISMISSED_KEY) === '1') return;
  UI.showInstallBar(
    async () => { _deferredInstall?.prompt(); await _deferredInstall?.userChoice; _deferredInstall = null; },
    () => { localStorage.setItem(INSTALL_DISMISSED_KEY, '1'); }
  );
});

// ── Draft storage warning ─────────────────────────────────────────────────────
// Fires at most once per page load when offline.js detects QuotaExceededError.
// Using { once: true } so repeated keystrokes don't re-show the toast.
window.addEventListener('syncpad:draft-storage-full', () => {
  UI.showToast(
    'Browser storage is full — local drafts cannot be saved. Your notes still sync to the server.',
    'warning',
    8000,
  );
}, { once: true });
