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

// A running installed PWA (desktop window, mobile home-screen launch) must
// never offer to install itself — there's nothing left to install, and a
// banner sitting there permanently reads as broken. display-mode:standalone
// covers desktop/Android installs; navigator.standalone is Safari's own
// pre-standard equivalent for an iOS home-screen launch, which never gets a
// 'display-mode' media feature at all. Checked once at startup (a page
// already running standalone doesn't flip modes mid-session) and persisted
// as an ordinary dismissal so a future non-standalone visit (e.g. the user
// opens the plain browser tab instead of the installed app) doesn't get a
// banner reoffered for a device that's already installed it once.
function _isStandalone() {
  return !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
}

if (_isStandalone()) {
  localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  UI.hideInstallBar();
}

let _deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstall = e;
  if (_isStandalone() || localStorage.getItem(INSTALL_DISMISSED_KEY) === '1') return;
  UI.showInstallBar(
    async () => {
      _deferredInstall?.prompt();
      const choice = await _deferredInstall?.userChoice;
      _deferredInstall = null;
      // 'appinstalled' below also fires on acceptance and is the more
      // reliable signal in general (a user can accept the native prompt and
      // then dismiss the OS's own install confirmation, or the reverse), but
      // acting on 'accepted' here too means the bar disappears immediately
      // on the common path instead of waiting on a second event that can
      // lag the prompt's own resolution by a moment.
      if (choice?.outcome === 'accepted') {
        localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
        UI.hideInstallBar();
      }
    },
    () => { localStorage.setItem(INSTALL_DISMISSED_KEY, '1'); }
  );
});

// Fires on every installation, regardless of which UI triggered it (this
// app's own Install button, the browser's address-bar install icon, an
// OS-level app-store-style install) — the one signal that's always right,
// so it's the backstop even though the Install button's own onInstall
// handler above already covers its own path.
window.addEventListener('appinstalled', () => {
  _deferredInstall = null;
  localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  UI.hideInstallBar();
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
