// JotRelay – app/routing.js
// URL route parsing, PWA "resume last room" support, and the recent-rooms
// landing-page shortcut list. Also wires the two navigation-related
// top-level listeners (suppress-resume on any link back to the app root,
// and a full reload on real Back/Forward navigation) as import-time side
// effects, matching where they lived in the original monolithic app.js.

import { BASE, _stripBasePath } from './state.js';

// ── PWA last-room resume ───────────────────────────────────────────────────────
// When launched as an installed/standalone PWA, boot() skips the landing screen
// and reopens the last editable room the user visited, so the app behaves like a
// native app that reopens where you left off instead of a link-sharing tool that
// always starts at "create or join". Regular browser tabs are unaffected — this
// only applies when display-mode is standalone (or iOS's legacy navigator.standalone).
export const LAST_ROOM_KEY       = 'syncpad_last_room_id';
export const RESUME_SUPPRESS_KEY = 'syncpad_suppress_resume';

export function _isStandalonePwa() {
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
        || window.navigator?.standalone === true;
  } catch { return false; }
}

export function _rememberLastRoom(roomId) {
  try { localStorage.setItem(LAST_ROOM_KEY, roomId); } catch {}
}

// ── Recent rooms (landing page shortcut list) ───────────────────────────────
// Safe to persist plainly now that room_id alone grants access again (see
// supabase/migrations/0009_revert_edit_token_write_gating.sql) — there's no
// token that could leak by remembering more than the single "last room" slot
// above. Tracks every successful room visit, read-only included — this is a
// personal "places I've been" convenience, not tied to edit permission.
export const RECENT_ROOMS_KEY = 'syncpad_recent_rooms';
export const RECENT_ROOMS_MAX = 8;

export function _loadRecentRooms() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_ROOMS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((r) => r && typeof r.id === 'string') : [];
  } catch { return []; }
}

export function _rememberRecentRoom(roomId, name) {
  try {
    const list = _loadRecentRooms().filter((r) => r.id !== roomId);
    list.unshift({ id: roomId, name: (name || '').trim() || roomId, visitedAt: Date.now() });
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(list.slice(0, RECENT_ROOMS_MAX)));
  } catch {}
}

export function _forgetRecentRoom(roomId) {
  try {
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(_loadRecentRooms().filter((r) => r.id !== roomId)));
  } catch {}
}

// Any control that deliberately navigates to the app root ("Back to
// JotRelay" links, view-once "Go home" button, etc.) must call this first so
// boot() shows the real landing screen instead of immediately resuming back
// into this room. (The in-room header logo does NOT navigate here — see
// its own comment in index.html — so it isn't one of these.)
export function _suppressNextResume() {
  try { sessionStorage.setItem(RESUME_SUPPRESS_KEY, '1'); } catch {}
}

// A plain <a href="{BASE}/"> to the app root — every "Back to JotRelay" link
// on the contact/privacy/terms/info screens — is a real page navigation, so
// it can't be caught by the room-scoped, one-time wireEvents() wiring (some
// of those screens are reachable without ever joining a room in this
// session at all). One delegated listener here catches all of them,
// present and future, instead of wiring each link individually and risking
// new ones being missed.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]');
  if (!a) return;
  const rootUrl = `${location.origin}${BASE}/`;
  if (a.href === rootUrl || a.href === `${location.origin}${BASE}`) {
    _suppressNextResume();
  }
});

// The app changes the URL with history.pushState/replaceState (room joins,
// the admin route, contact-form success, etc.) but never listens for the
// browser's own Back/Forward buttons, which fire `popstate` without
// reloading — so the address bar changed but every on-screen room, panel,
// and realtime connection stayed exactly as they were. boot() is a single
// entry point with several one-shot, order-dependent side effects (consuming
// the PWA-resume-suppression flag, a sessionStorage 404-redirect, generating
// a fresh room id) that isn't safe to silently re-run mid-session on an
// arbitrary popstate. A full reload re-runs that same already-correct,
// already-tested boot sequence against the URL the browser just navigated
// to — the same trade-off the app already makes for "join a different room
// by editing the URL bar and pressing Enter".
//
// Following a same-page anchor link (e.g. a Markdown table-of-contents
// entry, href="#some-heading") and then pressing Back also fires popstate,
// even though the route itself hasn't changed — only the hash has. Reloading
// there would be actively harmful, not just an unnecessary flicker: a
// view-once note's only remaining copy after the server clears its content
// lives in memory (state.viewOnceConsumedByThisSession), so a reload at the wrong
// moment permanently loses it. Only reload when the path or query actually
// changed; a hash-only difference is left to the browser's own default
// same-page scroll-to-anchor behavior.
//
// _lastRoutePathAndSearch has to stay in sync with every history mutation,
// not just popstate — the app's own pushState/replaceState calls (room
// joins, the admin route, etc.) change the URL too, and if left unsynced
// the tracker goes stale the moment the app itself navigates, making the
// very next Back incorrectly look like a no-op hash change and silently
// skip the reload it actually needs. Wrapping both methods once here keeps
// it accurate regardless of which existing or future call site navigates.
let _lastRoutePathAndSearch = location.pathname + location.search;
const _origPushState    = history.pushState.bind(history);
const _origReplaceState = history.replaceState.bind(history);
history.pushState = (...args) => {
  _origPushState(...args);
  _lastRoutePathAndSearch = location.pathname + location.search;
};
history.replaceState = (...args) => {
  _origReplaceState(...args);
  _lastRoutePathAndSearch = location.pathname + location.search;
};
window.addEventListener('popstate', () => {
  const current = location.pathname + location.search;
  if (current === _lastRoutePathAndSearch) return;
  _lastRoutePathAndSearch = current;
  location.reload();
});

export const RESERVED_ROOM_PATHS = new Set(['admin', 'app', 'contact', 'privacy', 'terms', 'share', 'share-target', 'assets', 'src', 'styles', 'docs', 'presskit', 'scripts']);

// A bare 6-character code from the short-code alphabet (see
// supabase/migrations/0002_short_room_codes.sql) — distinct enough from
// generateRoomId()'s "adjective-noun-suffix" shape and from any
// sanitizeRoomId() output containing a URL/slash that a false-positive
// match against a deliberately-chosen custom room id is very unlikely.
// Resolution failure just falls through to the literal-room-id path,
// so this can never make a previously working join stop working.
export const SHORT_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/i;

export function _parseRoute() {
  const cleaned = _stripBasePath(location.pathname).replace(/^\/+|\/+$/g, '');
  if (!cleaned) return { type: 'landing' };

  if (cleaned === 'contact') return { type: 'contact' };
  if (cleaned === 'privacy') return { type: 'privacy' };
  if (cleaned === 'terms') return { type: 'terms' };
  if (cleaned === 'admin') return { type: 'admin' };
  // manifest.json's share_target — the OS/browser "Share to…" sheet GETs
  // this path (only reachable when JotRelay is installed as a PWA) with the
  // shared title/text/url as query params. Not a right-click "context menu"
  // integration (no browser API exposes that for third-party apps) — this
  // is the real mechanism behind "send to JotRelay" from another app.
  if (cleaned === 'share-target') {
    const params = new URLSearchParams(location.search);
    return {
      type: 'share-target',
      title: params.get('title') || '',
      text:  params.get('text')  || '',
      url:   params.get('url')   || '',
    };
  }
  // The bare create/join screen — split out from the marketing landing page
  // at `/` so the root can be pure marketing copy with CTAs linking here.
  // Named 'app-landing' (not 'app') because showScreen('app') already means
  // #app-screen, the room editor itself — see ui/core.js.
  if (cleaned === 'app') return { type: 'app-landing' };
  if (cleaned === 'share') {
    return {
      type: 'info',
      title: 'Share link unavailable',
      message: 'This read-only link is missing its token. Please use the full /share/:token URL.',
    };
  }

  const shareMatch = cleaned.match(/^share\/(.+)$/);
  if (shareMatch) {
    const token = shareMatch[1].replace(/^\/+|\/+$/g, '');
    if (!token) {
      return {
        type: 'info',
        title: 'Share link unavailable',
        message: 'This read-only link is missing its token. Please use the full /share/:token URL.',
      };
    }
    return { type: 'share', token };
  }

  return { type: 'room', roomId: cleaned };
}
