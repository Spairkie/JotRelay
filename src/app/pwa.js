// JotRelay – app/pwa.js
// Service worker registration/update banner, the install-app prompt banner,
// and the "local drafts can't save" storage-full warning. Import for its
// side effects only — nothing here is exported.

import * as UI from '../ui.js';
import { BASE } from './state.js';
import { hasUnsavedChanges } from '../sync.js';

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

  const _promptForWaitingWorker = (worker) => {
    UI.showUpdateBar(() => {
      worker.postMessage({ type: 'SKIP_WAITING' });
      // location.reload() now fires via controllerchange above.
    });
  };

  navigator.serviceWorker
    .register(`${BASE}/service-worker.js`, { scope: `${BASE}/` })
    .then((reg) => {
      // A worker can already be sitting in `waiting` the instant this
      // registration resolves — e.g. another tab triggered the install
      // earlier in this session and the user hasn't accepted that update
      // yet. reg.addEventListener('updatefound', ...) below only fires for
      // an install that STARTS from this point forward, so without this
      // check, a fresh tab/reload would never surface the prompt for an
      // already-waiting worker until every other tab happened to close.
      if (reg.waiting && navigator.serviceWorker.controller) {
        _promptForWaitingWorker(reg.waiting);
      }

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            _promptForWaitingWorker(worker);
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
window.addEventListener('jotrelay:draft-storage-full', () => {
  UI.showToast(
    'Browser storage is full — local drafts cannot be saved. Your notes still sync to the server.',
    'warning',
    8000,
  );
}, { once: true });

// ── Warn before closing with an unsaved/unsynced edit ─────────────────────────
// Local drafts (offline.js) already persist every keystroke to localStorage,
// so nothing typed is ever truly lost — this specifically warns about the
// durable Postgres save not having confirmed yet (sync.js's hasUnsavedChanges()),
// which matters for OTHER connected devices missing this edit, and for this
// device's own durability if localStorage is ever cleared before the write
// lands. Only fires while something is genuinely pending/failed — not on
// every close, which would be pure nag for the overwhelmingly common case of
// nothing outstanding.
//
// Reliable for closing a browser tab/window (including a desktop-installed
// PWA's own window) — NOT reliable for a mobile home-screen PWA swiped away
// from the app switcher, which mobile browsers don't consistently fire
// beforeunload for at all. There's no cross-platform fix for that gap; the
// local draft above is what actually protects data in that case.
window.addEventListener('beforeunload', (e) => {
  if (!hasUnsavedChanges()) return;
  e.preventDefault();
  e.returnValue = ''; // required to trigger the native prompt in most browsers; the string itself is ignored/replaced with a generic browser message
});
