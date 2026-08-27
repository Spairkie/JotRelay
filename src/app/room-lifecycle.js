// JotRelay – app/room-lifecycle.js
// The core room lifecycle: route-driven boot, the join flow (create/load/
// passcode/encryption gates), startApp() (the single "make a loaded room
// interactive" entry point), realtime room-state transitions, the
// expiration timer, and full teardown on room navigation.

import {
  getDeviceId, getDeviceName, setDeviceName, generateRoomId,
  sanitizeRoomId, copyToClipboard, isMobile, isOnline, onOnlineChange,
  getUrlMode,
} from '../utils.js';
import { BRAND_NAME } from '../brand.js';
import {
  loadRoom, createRoom, clearRoomContent, subscribeToRoom,
  resolveReadOnlyShareLink, resolveRoomCode, recordRoomDeviceView,
} from '../rooms.js';
import {
  initBroadcast, destroyBroadcast,
  broadcastSettingsChange, cancelPendingTypingBroadcast, cancelPendingLiveContentBroadcast,
  broadcastClear, broadcastViewOnceCleared,
} from '../live-broadcast.js';
import { initPresence, destroyPresence, setPresenceHidden, updatePresenceDeviceName, setFollowing } from '../presence.js';
import {
  initSync, destroySync,
  flushSave, cancelPendingSave, snapshotBeforeDestructiveChange,
  handleRemoteTyping, handleRemoteLiveContent, handleRemoteDatabaseChange,
  setContentNoSave, applyPendingRemote, dismissPendingRemote, getPendingRemote, getPendingRemoteTs,
  setEncryption, reconcileAfterReconnect,
} from '../sync.js';
import { subscribeToFiles } from '../files.js';
import { subscribeToComments } from '../comments.js';
import {
  checkPasscode, unlockEncryption, handleExpiration, clearExpiration,
  resetViewOnceNote, consumeViewOnce,
} from '../settings.js';
import { encryptContent, decryptContent, looksEncrypted } from '../encryption.js';
import { BODY_MAX } from '../templates.js';
import { loadDraft, clearDraft, isDraftNewer } from '../offline.js';
import { saveScrollOffset, loadScrollOffset, clearScrollOffset } from '../scroll-memory.js';
import * as LiveEditor from '../live-editor.js';
import { setPermissionContext, canEdit, canChangeSettings, editBlockedReason } from '../permissions.js';
import { loadSavedTheme, THEMES, getSavedTheme, applyTheme } from '../theme.js';
import { destroyShortcuts } from '../shortcuts.js';
import { closeFootnotePopover } from '../footnote-popover.js';
import * as UI from '../ui.js';
import { initAdmin } from '../admin.js';
import { state, BASE, EXPIRATION_TIMER_MAX_DELAY_MS, _resolveInitialEditorMode } from './state.js';
import {
  RESERVED_ROOM_PATHS, SHORT_CODE_RE, _parseRoute,
  LAST_ROOM_KEY, RESUME_SUPPRESS_KEY, _isStandalonePwa, _rememberLastRoom, _rememberRecentRoom,
  _suppressNextResume,
} from './routing.js';
import { refreshFiles, openFileDeepLink } from './files-panel.js';
import { _refreshComments, _applyMarkdownMode, _refreshPreviewIfActive, _debouncedRefreshPreview, _debouncedPruneDeletedCommentAnchors, _pruneDeletedCommentAnchors, _captureTopOffset, _resetSplitPaneTracking } from './comments-preview.js';
import { _closeSlashMenu, _focusActiveEditorSurface } from './editor-behavior.js';
import { _selectExpirationPreset } from './panels.js';
import { wireEvents } from './wiring.js';
import { wireLandingEvents, wireContactEvents, wireMarketingPageEvents } from './landing.js';

async function _emptyContentForCurrentEncryption() {
  return state.encKey ? await encryptContent('', state.encKey) : '';
}

// Whether the persisted last-scroll-position (src/scroll-memory.js) is
// blocked for this room/session at all, regardless of timing — shared by
// both the read side (the initial restore) and the write side below.
//
// Never for an encrypted room: scroll-memory.js's fingerprint is a fast,
// unsalted hash of the *decrypted* text, persisted in plain localStorage —
// for a short or predictable note, that's an offline-verifiable oracle for
// guessing content without ever knowing the room passphrase, unlike
// offline.js's drafts (encrypted at rest for exactly this reason). Gated on
// the room's own encryption_enabled flag, not state.encKey — encKey is only
// *this device's currently-unlocked* key and is null both for a genuinely
// unencrypted room and for an encrypted one the passphrase hasn't been
// entered for yet, which would otherwise let the exact leak this guards
// against slip through while locked.
//
// Never once a view-once room has been consumed by this tab, or this
// device's own join is what hit the room's device limit, either: in both
// cases the server/draft are already cleared, but the plaintext
// intentionally stays visible in the editor until the user leaves — the
// same "content is gone but a guess-verification fingerprint survives it"
// concern the encryption gate exists for, just without encryption being
// the reason this content is meant to be ephemeral.
function _scrollMemoryBlocked() {
  return !!state.room?.encryption_enabled || state.viewOnceConsumedByThisSession || state.deviceLimitClearedByThisSession;
}

// Whether the initial *restore* (reading a previously-saved position) may
// run — only the blocked-or-not question above; by the time this read
// happens (inside startApp(), after content is already set for the current
// room) there's no room-identity or restore-ordering race left to guard
// against, unlike the write side below.
function _shouldReadScrollMemory() {
  return !_scrollMemoryBlocked();
}

// Whether a *write* (the periodic save or a teardown/page-exit flush) may
// run. Two timing gates on top of the same blocked-or-not question,
// both required:
//
// _roomContentReady: joinRoom() assigns state.roomId to the *new* room
// synchronously, before the awaited loadRoom() resolves and state.room/the
// editor's content catch up to it — during that window the shared textarea
// still holds the *previous* room's text (or, on this session's very first
// join, nothing meaningful yet), so a flush landing in that gap would
// otherwise save stale or wrong-room content under the new room's key.
// Flipped true only once startApp() has actually populated the editor for
// state.roomId, false the moment joinRoom() starts pointing state.roomId at
// a new target.
//
// _roomRestoreComplete: content being *correct* isn't enough on its own —
// between that point and the moment startApp() actually applies (or
// deliberately skips) the restored/fallback position, the editor sits at a
// temporary, usually-top position. A flush landing in *that* narrower
// window would silently overwrite a real, previously-saved deep position
// with this temporary one — the startup restore only ever reads it once,
// earlier, so nothing corrects it back afterward. Flipped true only once
// that restore decision has actually been made, whichever way it went.
let _roomContentReady = false;
let _roomRestoreComplete = false;
function _shouldWriteScrollMemory() {
  return _roomContentReady && _roomRestoreComplete && !_scrollMemoryBlocked();
}

// Bumped by teardownRealtimeSession() at the top of every joinRoom() call
// (see its own comment for why there, not just in startApp()) — lets a
// *stale* startApp() invocation recognize, once its own slow
// refreshFiles()/_refreshComments() awaits finally resolve, that a newer
// navigation has since superseded it. teardownRealtimeSession() clears
// state.scrollSaveTimer for whichever invocation is current *when it
// runs* — a stale invocation that hasn't reached its own
// `state.scrollSaveTimer = setInterval(...)` line yet at that point has
// nothing for it to clear, and resuming afterward to install its own
// interval would silently overwrite the *new* invocation's already-
// installed handle, leaking the new one running forever with no handle
// left to ever clear it. Checked immediately before that line, further down.
let _roomSessionGeneration = 0;

function _showQuarantinedScreen(room) {
  UI.setInfoScreen({
    title: 'Room unavailable',
    message: room?.quarantine_reason
      ? `This room has been quarantined by an administrator. Reason: ${room.quarantine_reason}`
      : 'This room has been quarantined by an administrator and is no longer accessible.',
  });
  UI.showScreen('info');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

const LEGAL_BACK_PATH_KEY = 'syncpad_legal_back_path';

// Contact/privacy/terms link to each other with plain <a href> tags — a
// real navigation/full page reload each time, not an in-app route swap —
// so their own "Back to JotRelay" link can't rely on in-memory state to know
// where the user actually came from. Reads what boot() stored in
// sessionStorage the last time a non-legal route loaded, and points every
// currently-visible legal screen's .legal-back-link at it (falling back to
// the marketing root if nothing was ever stored — e.g. a legal page
// reached directly, with no prior JotRelay visit this session).
function _wireLegalBackLink() {
  let backPath = `${BASE}/`;
  try { backPath = sessionStorage.getItem(LEGAL_BACK_PATH_KEY) || backPath; } catch {}
  document.querySelectorAll('.legal-screen:not(.hidden) .legal-back-link').forEach((a) => {
    a.href = backPath;
  });
}

/**
 * Record `path` (defaults to the current location) as the "Back to JotRelay"
 * target for the legal screens. boot() calls this on every real page load
 * (see below), but that only covers full navigations — creating/joining a
 * room from /app, clicking a recent room, and the standalone-PWA resume
 * redirect all change the URL via history.pushState()/replaceState() and
 * call joinRoom() directly without going through boot() again, so without
 * this being called from those sites too, the stored path would still say
 * "/app" (or "/") after the user is actually sitting in a room, and "Back to
 * JotRelay" from a legal page reached from that room's footer would send them
 * to the wrong place.
 */
export function recordLegalBackPath(path) {
  try { sessionStorage.setItem(LEGAL_BACK_PATH_KEY, path ?? (location.pathname + location.search)); } catch {}
}

export async function boot() {
  // Apply saved theme immediately to avoid flash
  loadSavedTheme();

  UI.showScreen('loading');

  // Load locally-stored monospace preference
  try { state.monospace = localStorage.getItem('syncpad_monospace') === '1'; } catch {}

  const redirectRoom = sessionStorage.getItem('syncpad_redirect_room');
  if (redirectRoom) {
    sessionStorage.removeItem('syncpad_redirect_room');
    // Preserve any query string (so ?mode=read survives the 404 redirect)
    const qs = location.search || '';
    history.replaceState(null, '', `${BASE}/${redirectRoom}${qs}`);
  }

  // URL mode (?mode=read)
  state.isReadOnly = getUrlMode() === 'read';

  const route = _parseRoute();

  // Remember the last non-legal path visited so the legal screens' own
  // "Back to JotRelay" links (see _wireLegalBackLink() below) can return the
  // user to wherever they actually came from — the marketing landing page,
  // /app, a room, admin, etc. — instead of always going to the marketing
  // root. Only updated on a non-legal route, so chaining between Contact/
  // Privacy/Terms's own cross-links doesn't overwrite this with each other.
  if (route.type !== 'contact' && route.type !== 'privacy' && route.type !== 'terms') {
    recordLegalBackPath();
  }

  if (route.type === 'share') {
    state.isReadOnly = true;
    state.shareToken = route.token;
    // index.html's Supabase <script> tag is deferred (so it doesn't block
    // first paint) but that's a SEPARATE execution queue from this module
    // script, not one shared ordered queue — the module graph can start
    // running before the deferred script has, especially with the
    // cache-first service worker making repeat-visit module loads
    // near-instant while the cross-origin CDN fetch still takes real
    // network time. window.__supabaseReady (resolved on that script's load
    // or error event) is the real ordering guarantee. Awaited only here and
    // at the other call sites below that actually reach Supabase-dependent
    // code (getSupabaseClient() in src/supabase.js) — the purely static
    // routes (app-landing, contact/privacy/terms, the no-resume landing
    // screen) never touch Supabase and must not be held behind this on a
    // slow/stalled CDN connection.
    await window.__supabaseReady;
    await joinReadOnlyShareRoute(route.token);
    return;
  }

  if (route.type === 'landing' && !redirectRoom) {
    // Standalone PWA launches resume the last room instead of showing landing,
    // unless the user just deliberately navigated Home (one-shot suppression).
    let suppressResume = false;
    try { suppressResume = sessionStorage.getItem(RESUME_SUPPRESS_KEY) === '1'; } catch {}
    if (suppressResume) { try { sessionStorage.removeItem(RESUME_SUPPRESS_KEY); } catch {} }

    let lastRoom = null;
    if (!suppressResume && _isStandalonePwa()) {
      try { lastRoom = localStorage.getItem(LAST_ROOM_KEY); } catch {}
    }

    if (lastRoom) {
      history.replaceState(null, '', `${BASE}/${lastRoom}`);
      recordLegalBackPath(`${BASE}/${lastRoom}`);
      await window.__supabaseReady;
      await joinRoom(lastRoom);
      return;
    }

    UI.showScreen('landing');
    wireMarketingPageEvents();
    return;
  }

  if (route.type === 'app-landing') {
    UI.showScreen('app-landing');
    wireLandingEvents();
    return;
  }

  if (route.type === 'admin') {
    UI.showScreen('admin');
    window.__supabaseReady.then(() => initAdmin()).catch((err) => {
      console.error('[admin] initAdmin failed:', err);
    });
    return;
  }

  if (route.type === 'contact' || route.type === 'privacy' || route.type === 'terms') {
    if (route.type === 'contact') wireContactEvents();
    UI.showScreen(route.type);
    _wireLegalBackLink();
    return;
  }

  if (route.type === 'info') {
    UI.setInfoScreen({ title: route.title, message: route.message });
    UI.showScreen('info');
    return;
  }

  if (route.type === 'share-target') {
    const roomId = generateRoomId();
    history.replaceState(null, '', `${BASE}/${roomId}`);
    await window.__supabaseReady;
    await joinRoom(roomId, { isNewRoom: true });
    _seedSharedContent(route.title, route.text, route.url);
    return;
  }

  const rawRoomId = redirectRoom || route.roomId || generateRoomId();
  const sanitizedRoomId = sanitizeRoomId(rawRoomId);
  const blockedRoom = RESERVED_ROOM_PATHS.has(sanitizedRoomId.toLowerCase());
  const roomId = blockedRoom ? generateRoomId() : sanitizedRoomId;

  if (!redirectRoom && (route.type !== 'room' || roomId !== route.roomId || blockedRoom)) {
    const qs = location.search || '';
    history.replaceState(null, '', `${BASE}/${roomId}${qs}`);
  }

  await window.__supabaseReady;
  await joinRoom(roomId);
}

/**
 * Seed a freshly-created room's content from a Web Share Target payload
 * (title/text/url query params, see routing.js's 'share-target' route).
 * Composes a small Markdown body and writes it through the same
 * setEditorValue()+dispatch('input') pipeline templates.js's
 * _onTemplateChosen() uses — that single 'input' listener (editor-
 * behavior.js's _wireEditorCore) is what enforces BODY_MAX, mirrors the
 * text into the Live/CM6 surface, and queues the normal debounced save, so
 * this reaches the same place a user pasting the same text would.
 */
function _seedSharedContent(title, text, url) {
  const parts = [];
  if (title.trim()) parts.push(`# ${title.trim()}`);
  if (text.trim())  parts.push(text.trim());
  if (url.trim())   parts.push(url.trim());
  if (!parts.length) return;

  // Strip control characters (besides newline/tab) a share payload could in
  // principle carry — this becomes Markdown source text, not HTML, so no
  // escapeHtml() call belongs here (src/markdown.js escapes at render time
  // like any other room content), but raw control chars have no legitimate
  // place in a note body either.
  // eslint-disable-next-line no-control-regex
  let body = parts.join('\n\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  if (body.length > BODY_MAX) {
    body = body.slice(0, BODY_MAX);
    UI.showToast(`Shared content trimmed to the ${BODY_MAX.toLocaleString()}-character limit.`, 'warning', 5000);
  }

  UI.setEditorValue(body);
  document.getElementById('note-editor')?.dispatchEvent(new Event('input', { bubbles: true }));
  UI.updateWordCount(UI.getEditorValue());
  _refreshPreviewIfActive();
}

// ── Join flow ─────────────────────────────────────────────────────────────────

export async function joinReadOnlyShareRoute(token) {
  UI.setLoadingMessage('Opening read-only share link…');
  try {
    const resolved = await resolveReadOnlyShareLink(token);
    if (!resolved?.room_id) {
      UI.setInfoScreen({
        title: 'Share link unavailable',
        message: 'This read-only link is invalid, disabled, or the room no longer exists.',
      });
      UI.showScreen('info');
      return;
    }
    await joinRoom(resolved.room_id);
  } catch {
    UI.setInfoScreen({
      title: 'Share link unavailable',
      message: 'This read-only link is invalid, disabled, or the room no longer exists.',
    });
    UI.showScreen('info');
  }
}

export async function joinRoom(roomId, { isNewRoom = false } = {}) {
  // Captured BEFORE teardownRealtimeSession(), which (defensively) resets
  // state.isReadOnly to false — read after that would silently lose ?mode=read
  // and /share/:token's forced-read-only signal on every single navigation.
  //
  // Forced read-only routes (?mode=read, /share/:token) are a UI/UX
  // convention, not a server-enforced boundary: room_id alone is sufficient
  // to write (see supabase/migrations/0009_revert_edit_token_write_gating.sql
  // for why — the edit-token model this replaced had a real cost in lost-
  // token lockouts and deployment fragility that outweighed its benefit for
  // a personal/demo project not meant to hold anything sensitive). A room
  // owner who needs a link that genuinely can't be used to edit should Lock
  // the room first — editing_locked is enforced server-side regardless of
  // how the write is attempted, unlike this route-based flag.
  const forcedReadOnly = state.isReadOnly;

  teardownRealtimeSession();
  _roomContentReady = false;
  _roomRestoreComplete = false;
  state.roomId = roomId;
  state.viewOnceConsumedByThisSession = false;
  state.deviceLimitClearedByThisSession = false;
  UI.setLoadingMessage('Loading room…');

  try {
    if (isNewRoom) {
      UI.setLoadingMessage('Creating room…');
      state.room = await createRoom(roomId);
      state.isReadOnly = false;
      history.replaceState(null, '', `${BASE}/${roomId}`);
    } else {
      const room = await loadRoom(roomId);

      if (!room && !forcedReadOnly && SHORT_CODE_RE.test(roomId)) {
        // A short code typed/pasted directly into the URL bar, not just the
        // landing page's join box — resolve it before falling through to
        // "create a room literally named after the code", which a code is
        // never meant to become.
        const resolvedId = await resolveRoomCode(roomId).catch(() => null);
        if (resolvedId) {
          history.replaceState(null, '', `${BASE}/${resolvedId}${location.search}`);
          return joinRoom(resolvedId);
        }
      }

      if (!room && !forcedReadOnly) {
        // Neither an existing room nor a resolvable code: visiting a URL
        // (typed, bookmarked, or a link shared before the room existed) for
        // a name nobody has taken yet creates it and opens it editable,
        // same as the landing page's Create Room button — this is the
        // original "join by name" behavior. A forced-read-only route
        // (?mode=read, /share/:token) never reaches this branch, so a
        // stale/expired read-only link can't be used to claim a fresh room.
        UI.setLoadingMessage('Creating room…');
        state.room = await createRoom(roomId);
        state.isReadOnly = false;
        history.replaceState(null, '', `${BASE}/${roomId}`);
      } else if (!room) {
        UI.setInfoScreen({
          title: 'Share link unavailable',
          message: 'This read-only link points to a room that does not exist.',
        });
        UI.showScreen('info');
        return;
      } else {
        state.isReadOnly = forcedReadOnly;
        state.room = room;
      }
    }
  } catch (err) {
    // Log the raw error so RLS / network failures are diagnosable in DevTools.
    console.error(`[${BRAND_NAME}] joinRoom failed for`, roomId, err);
    UI.showLoadingError(
      err?.code === 'RATE_LIMITED' ? err.message : 'Could not load room — check your connection and try again.',
      () => joinRoom(roomId, { isNewRoom }),  // retry callback
    );
    return;
  }

  // Cleared as soon as the loaded room is known to be encrypted — before
  // the quarantine check and the passcode gate below, not after either of
  // them. A room that's quarantined, or protected by a passcode, would
  // otherwise leave a pre-encryption fingerprint sitting in localStorage
  // indefinitely (quarantine has no unlock at all from here; a passcode
  // would only clear it once solved), even though encryption_enabled is
  // already known from this room row regardless of either gate. This
  // device may have last seen the room while it was still unencrypted
  // (offline or simply absent when some other device turned encryption
  // on) — neither the local enable path (panels.js) nor the live remote-
  // transition path elsewhere runs for a device that missed the change
  // entirely and only discovers it here, on its next cold load.
  if (state.room.encryption_enabled) clearScrollOffset(roomId);

  // Quarantine blocks the room entirely — before any passcode prompt,
  // decryption attempt, or editor initialization. quarantined_at/
  // quarantine_reason only exist if the optional admin-dashboard migration
  // has been applied; absent columns are simply undefined/falsy here, so
  // this is a no-op for installs that haven't run it.
  if (state.room.quarantined_at) {
    _showQuarantinedScreen(state.room);
    return;
  }

  if (state.room.passcode_hash) {
    UI.showScreen('passcode');
    const badge = document.getElementById('passcode-room-badge');
    if (badge) badge.textContent = roomId;
    return;
  }

  if (state.room.encryption_enabled) {
    UI.showScreen('encryption');
    const badge = document.getElementById('encryption-room-badge');
    if (badge) badge.textContent = roomId;
    return;
  }

  // isNewRoom only ever reaches here — a freshly created room has neither
  // a passcode nor encryption yet (both are Settings-panel opt-ins applied
  // after creation), so the two gates above can never intercept it. The
  // onPasscodeSubmit()/onEncryptionSubmit() handlers below call startApp()
  // with no argument for exactly that reason — they're wired to DOM form
  // submissions, entirely disconnected from this closure, and can only ever
  // be reached for an existing room being unlocked, never a new one.
  await startApp(isNewRoom);
}

// ── Auth handlers ─────────────────────────────────────────────────────────────

export async function onPasscodeSubmit() {
  const input    = document.getElementById('passcode-input');
  const passcode = input?.value || '';
  if (!passcode) { UI.showPasscodeError('Please enter the passcode.'); return; }

  UI.clearPasscodeError();
  const btn = document.getElementById('passcode-submit-btn');
  if (btn) btn.disabled = true;
  let ok = false;
  try {
    ok = await checkPasscode(state.room, passcode);
  } catch {
    if (btn) btn.disabled = false;
    UI.showPasscodeError('Could not verify the passcode. Please reload and try again.');
    return;
  }
  if (btn) btn.disabled = false;

  if (!ok) { UI.showPasscodeError('Incorrect passcode. Please try again.'); return; }

  if (state.room.encryption_enabled) {
    // Already cleared in joinRoom(), before this passcode gate even showed
    // — see its own comment for why that ordering matters.
    UI.showScreen('encryption');
    const badge = document.getElementById('encryption-room-badge');
    if (badge) badge.textContent = state.roomId;
    return;
  }
  await startApp();
}

export async function onEncryptionSubmit() {
  const input      = document.getElementById('encryption-input');
  const passphrase = input?.value || '';
  if (!passphrase) { UI.showEncryptionError('Please enter the encryption passphrase.'); return; }

  UI.clearEncryptionError();
  const btn = document.getElementById('encryption-submit-btn');
  // PBKDF2 key derivation takes 1-3 s — show a spinner so the UI doesn't
  // look frozen. Preserve the button label so we can restore it on error.
  const origLabel = btn?.textContent ?? 'Decrypt & Open';
  if (btn) { btn.disabled = true; btn.textContent = 'Decrypting…'; }

  try {
    const key = await unlockEncryption(passphrase, state.room.encryption_salt);
    if (!state.room.content || !looksEncrypted(state.room.content)) {
      throw new Error('Encrypted room content is missing or invalid.');
    }
    await decryptContent(state.room.content, key); // verify — throws if wrong passphrase
    state.encKey  = key;
    state.encSalt = state.room.encryption_salt;
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = origLabel; }
    UI.showEncryptionError('Wrong passphrase. Could not decrypt the note.');
    input?.focus(); input?.select();
    return;
  }
  await startApp();
}

// ── Start app ─────────────────────────────────────────────────────────────────

async function startApp(isNewRoom = false) {
  // Read, not incremented, here — teardownRealtimeSession() already bumps
  // this at the top of every joinRoom() call, including ones that never
  // reach this function at all (see its own comment for why that matters).
  const _myRoomSession = _roomSessionGeneration;
  UI.setLoadingMessage('Starting…');
  UI.showScreen('loading');

  // Remember this room for PWA "resume last room" (see _isStandalonePwa()).
  // Only for genuine editable visits — not read-only share links or
  // ?mode=read, which are bound to someone else's link rather than "my" room.
  if (!state.isReadOnly) _rememberLastRoom(state.roomId);
  _rememberRecentRoom(state.roomId, state.room?.room_name);

  // ── Expiration check ───────────────────────────────────────────────────────
  if (state.room.expires_at && new Date(state.room.expires_at) <= new Date()) {
    // Captured before the awaits below, not read from state.roomId
    // afterward — if the user navigates to a different room while either
    // request is in flight, state.roomId already points at that new room
    // by the time this continuation resumes (same _roomSessionGeneration
    // race as the scrollSaveTimer install further down), and this cleanup
    // must land on the room it was actually about, not whatever the shared
    // state has since moved on to.
    const _expiringRoomId = state.roomId;
    const didClear = await handleExpiration(_expiringRoomId, state.room, await _emptyContentForCurrentEncryption());
    // Only when the reset actually succeeded — handleExpiration() returns
    // false for a locked room or a network/RLS failure, leaving the
    // content (and any real remembered position for it) untouched; this
    // ran unconditionally in an earlier version and could delete a still-
    // valid position for a room whose expiration reset silently failed.
    //
    // Run immediately, outside the session-generation guard below: unlike
    // the state.room mutation, this is keyed to the captured
    // _expiringRoomId rather than any shared state, so it's safe (and
    // necessary) regardless of whether a newer navigation has since
    // superseded this invocation — a still-pending loadRoom() failing
    // afterward, or a superseding navigation, must not skip clearing a
    // reset that already genuinely happened.
    if (didClear) {
      // Expiration is an authoritative content reset like any other — a
      // remembered position saved against the old (now-cleared) content
      // would otherwise sit in localStorage until it happens to fail the
      // fingerprint check on some later visit, exactly the residue every
      // other reset path already clears this for.
      clearScrollOffset(_expiringRoomId);
    }
    if (_myRoomSession === _roomSessionGeneration) {
      state.room = await loadRoom(_expiringRoomId);
    }
  }

  // ── Decrypt content for display ────────────────────────────────────────────
  // Must happen BEFORE view-once consumption so the viewer actually sees the note.
  let displayContent = state.room.content || '';
  if (state.encKey && displayContent && looksEncrypted(displayContent)) {
    try { displayContent = await decryptContent(displayContent, state.encKey); }
    catch { displayContent = ''; }
  }

  // ── View-once: decide if this session should consume ───────────────────────
  // Use created_by_device (persists across refreshes) so the creator can't
  // accidentally consume their own note. Read-only viewers do NOT consume
  // view-once — they would be unable to keep editing afterward, and the
  // creator presumably wants real readers to consume it.
  const deviceId  = getDeviceId();
  const isCreator = state.room.created_by_device === deviceId;

  // ── Device limit: record this device's join, clearing the room once the
  // configured number of distinct devices has been reached ─────────────────
  // The creator's own devices don't consume a slot — same reasoning as
  // View-once's isCreator exclusion above. Best-effort: a Supabase project
  // that hasn't run supabase/migrations/0005_device_limit.sql yet just has
  // device_limit stay null forever, so this never fires for it.
  if (state.room.device_limit && !isCreator) {
    try {
      const result = await recordRoomDeviceView(state.roomId, deviceId);
      if (result.expired) {
        // Set — and the record cleared — immediately once result.expired is
        // known, before the awaited reload below, which can itself fail
        // (network). Same reasoning as view-once's own flag: this device's
        // join is what hit the limit and cleared the room server-side, but
        // the plaintext this device already had stays visible locally — a
        // scroll-memory record would keep exposing its fingerprint after
        // the content itself is gone, exactly the residue
        // _scrollMemoryBlocked() already exists to avoid. A reload failure
        // here would otherwise leave this flag (and the stale record)
        // unset even though the server-side clear already happened.
        state.deviceLimitClearedByThisSession = true;
        clearScrollOffset(state.roomId);
        state.room = await loadRoom(state.roomId);
      }
    } catch { /* non-fatal — see comment above */ }
  }

  const shouldConsumeViewOnce = (
    state.room.view_once &&
    !isCreator &&
    !state.room.viewed &&
    state.room.cleared_reason !== 'view_once'
  );

  // ── Initial permission context ─────────────────────────────────────────────
  _updatePermissionContext();

  // ── Render ─────────────────────────────────────────────────────────────────
  UI.showScreen('app');
  _renderRoomHeader();
  UI.setEncryptionBadge(!!state.room.encryption_enabled);
  UI.setViewOnceBadge(!!state.room.view_once);
  UI.renderSettingsPanel(state.room);
  UI.setStatus('connected');
  UI.setMonospace(state.monospace);
  UI.setFocusMode(state.focusMode);
  UI.setTypewriterMode(state.typewriterMode);
  UI.setCodeLineNumbers(state.codeLineNumbers);
  UI.setReadOnlyMode(state.isReadOnly);
  // Transient state for the loading screen only — safe before real content
  // exists because Write mode needs no content (Preview/Split mount the
  // live surface against the current editor value, which isn't set yet).
  // The user's actual remembered mode is applied below, once content is in
  // place; see _resolveInitialEditorMode() and the setContentNoSave() calls
  // further down.
  UI.setMarkdownMode('write', null);
  UI.setLockedMode(!!state.room.editing_locked);
  UI.renderThemePicker(THEMES, getSavedTheme(), (id) => applyTheme(id));

  initSync({
    roomId:           state.roomId,
    encryptFn:        state.encKey ? (pt) => encryptContent(pt, state.encKey) : null,
    decryptFn:        state.encKey ? (ct) => decryptContent(ct, state.encKey) : null,
    getEditorVal:     UI.getEditorValue,
    setEditorVal:     (text) => { UI.setEditorValue(text); LiveEditor.syncFromText(text); UI.updateWordCount(text); _refreshPreviewIfActive(); },
    onStatusChange:   UI.setStatus,
    onPendingRemote:  (remoteText) => UI.showRemoteNotice({
      onApply:   () => { applyPendingRemote();   UI.hideRemoteNotice(); },
      onKeep:    () => { dismissPendingRemote(); UI.hideRemoteNotice(); },
      onCopy:    async () => {
        const ok = await copyToClipboard(remoteText ?? getPendingRemote() ?? '');
        if (ok) UI.showToast('Remote content copied.', 'success');
        else    UI.showToast('Could not copy.', 'error');
      },
      onDismiss: () => { UI.hideRemoteNotice(); },
      localText:  UI.getEditorValue(),
      remoteText: remoteText,
      remoteTs:   getPendingRemoteTs(),
    }),
    onDismissPending: UI.hideRemoteNotice,
  });

  // Set initial content — prefer local draft if newer than DB.
  // Encrypted-room drafts are stored encrypted in localStorage and are only
  // decrypted after the room passphrase has already unlocked state.encKey.
  const draft = loadDraft(state.roomId);
  const draftText = await _decodeLocalDraft(draft);
  if (draftText !== null && isDraftNewer(draft, state.room.updated_at) && canEdit()) {
    setContentNoSave(draftText);
    UI.showToast('Restored unsaved local draft.', 'warning', 5000);
  } else {
    setContentNoSave(displayContent);
  }
  UI.updateWordCount(UI.getEditorValue());

  // The plain Write textarea is a single persistent DOM element reused
  // across an in-app join to a *different* room (no full page reload) — CM6
  // gets a brand-new view per room (mount() always destroy()s the old one
  // first, see live-editor.js), but the textarea's own scrollTop is not
  // reset by a plain .value assignment (confirmed live: assigning shorter
  // content does not itself clamp/reset scrollTop until a later real layout
  // pass touches it). Without this, a never-visited room joined right after
  // scrolling deep into a previous long room would silently inherit that
  // stale pixel position as its own "current" scroll below, rather than
  // genuinely starting at the top.
  //
  // Done immediately here, right after content is set — not later, next to
  // the _preFocusOffset capture below — because several awaited operations
  // (refreshFiles(), _refreshComments(), etc.) run between here and there
  // while the editor is already visible and interactive; resetting *after*
  // those would clobber any real scrolling the user did during that window
  // instead of just the stale carry-over this exists to fix.
  UI.scrollWriteOffsetToTop(0);
  // The editor now genuinely holds state.roomId's own content — see
  // _shouldWriteScrollMemory()'s own comment for why every scroll-memory
  // write is gated on this (not just this + encryption/view-once/device-
  // limit — see _roomRestoreComplete for the other half).
  _roomContentReady = true;

  // Apply the user's remembered editor mode now that real content exists —
  // Preview/Split mount the live surface against the current editor value,
  // so this has to run after setContentNoSave() above, not alongside the
  // 'write' placeholder set earlier for the loading screen.
  const _initialMode = _resolveInitialEditorMode();
  if (_initialMode !== 'write') _applyMarkdownMode(_initialMode);

  // The editor is visible and interactive from here on, but the actual
  // scroll-position restore below can't run until *after* focus (several
  // lines down) — see its own comment for why. Several awaited operations
  // (refreshFiles(), _refreshComments(), etc.) run in between, during which
  // a real user, especially on a slow connection, could already be
  // scrolling — applying a persisted/fallback position afterward would
  // otherwise clobber that regardless of which one it picked. A snapshot
  // taken here (content/mode already settled, nothing has focused anything
  // yet) and compared again right before focus is what detects that,
  // without conflating it with focus's *own* native scroll-to-caret effect
  // — which is a separate, already-handled case (see _preFocusOffset
  // below). Live may not be mounted yet if _initialMode is 'write' —
  // harmless null either way.
  const _startupWriteEl = document.getElementById('note-editor');
  const _startupLiveEl = document.querySelector('#note-live .cm-scroller');
  const _startupBaselineWriteTop = _startupWriteEl?.scrollTop ?? null;
  const _startupBaselineLiveTop = _startupLiveEl?.scrollTop ?? null;

  initBroadcast(state.roomId, {
    onRemoteTyping: async (payload) => {
      if (_isEncryptedWithoutKey()) return;
      UI.showTypingIndicator(payload.device_name || 'Someone');
      await handleRemoteTyping(payload);
      _refreshPreviewIfActive();
    },
    onRemoteLiveContent: async (payload) => {
      if (_isEncryptedWithoutKey()) return;
      await handleRemoteLiveContent(payload);
    },
    onRemoteSettings: async () => {
      // Another device changed settings — reload and re-render. Do NOT
      // re-broadcast here or it creates an echo loop.
      const prev = state.room;
      state.room = await loadRoom(state.roomId);
      await _handleRoomStateTransition(prev, state.room);
    },
    onRemoteFiles: async () => refreshFiles(),
    onRemoteClear: async () => {
      cancelPendingSave();
      cancelPendingTypingBroadcast();
      cancelPendingLiveContentBroadcast();
      clearDraft(state.roomId);
      clearScrollOffset(state.roomId);
      setContentNoSave('');
      UI.updateWordCount('');
      _refreshPreviewIfActive();
      _pruneDeletedCommentAnchors();
      UI.showToast('Note was cleared by another device.', 'warning');
    },
    onRemoteViewOnce: async () => {
      cancelPendingSave();
      cancelPendingTypingBroadcast();
      cancelPendingLiveContentBroadcast();
      clearDraft(state.roomId);
      clearScrollOffset(state.roomId);
      setContentNoSave('');
      UI.updateWordCount('');
      _refreshPreviewIfActive();
      _pruneDeletedCommentAnchors();
      UI.showToast('This note was view-once and has been cleared from the server.', 'warning', 6000);
    },
  });

  initPresence(state.roomId, (devices) => {
    UI.updateDeviceCount(devices.length);
    // A followed device that disconnected (or hid its presence) can't be
    // followed anymore — drop it rather than leaving a dead toggle active.
    if (state.followedDeviceId && !devices.some((d) => d.device_id === state.followedDeviceId && !d.isMe)) {
      state.followedDeviceId = null;
      setFollowing(null);
    }
    UI.renderDevicesList(devices, deviceId, (name) => {
      setDeviceName(name);
      // setDeviceName() trims/falls back to a fresh generated name for a
      // blank input, so read back the name that actually got applied
      // rather than trusting the raw input the rename came from.
      const applied = getDeviceName();
      updatePresenceDeviceName(applied);
      UI.showToast(`Renamed to "${applied}" — visible to everyone in this room.`, 'success');
    }, {
      followedDeviceId: state.followedDeviceId,
      onToggleFollow: (id) => {
        state.followedDeviceId = state.followedDeviceId === id ? null : id;
        setFollowing(state.followedDeviceId);
      },
    });
    // Render remote collaborators' carets/selections in the live surface
    // (no-op when it isn't mounted).
    LiveEditor.setRemoteCursors(
      devices
        .filter((d) => !d.isMe && typeof d.cursor_pos === 'number')
        .map((d) => ({ id: d.device_id, name: d.device_name, pos: d.cursor_pos, anchor: d.cursor_anchor })),
    );
    // "Follow" mode: jump the local view to the followed device's cursor as
    // it moves. Only meaningful where there's a real caret to scroll to —
    // the CM6 live surface — same gating the floating comment composer uses.
    if (state.followedDeviceId && state.markdownMode !== 'write' && LiveEditor.isMounted()) {
      const followed = devices.find((d) => d.device_id === state.followedDeviceId);
      if (followed && typeof followed.cursor_pos === 'number') {
        LiveEditor.scrollToPos(followed.cursor_pos);
      }
    }
  }, { readOnly: state.isReadOnly });
  // Re-applied on every room entry — destroyPresence() deliberately leaves
  // this preference alone since it's per-device, not room state (see
  // presence.js), so the fresh channel from initPresence() above always
  // starts back at the default until this runs.
  setPresenceHidden(state.hidePresence);

  state.unsubRoom = subscribeToRoom(state.roomId, async ({ event, room }) => {
    if (event === 'DELETE') {
      cancelPendingSave();
      cancelPendingTypingBroadcast();
      cancelPendingLiveContentBroadcast();
      if (state.expTimer) { clearTimeout(state.expTimer); state.expTimer = null; }
      UI.setEditorEditable(false);
      UI.showToast('This room no longer exists.', 'error', 6000);
      UI.setStatus('offline');
      return;
    }
    const prev = state.room;
    state.room = room;
    await _handleRoomStateTransition(prev, room);
  });

  state.unsubFiles = subscribeToFiles(state.roomId, () => refreshFiles());
  await refreshFiles();

  // `?file=<N>` deep link — see files-panel.js's onCopyLink(), which
  // generates these for encrypted files (a raw signed Storage URL is
  // useless without the room's key, but a link back into the app can go
  // through the room's normal passcode/encryption gate first). Handled here
  // rather than earlier because it needs state.encKey (only set once that
  // gate has passed) and the just-populated file list above. Stripped from
  // the URL after use so refreshing the room doesn't reopen the same file
  // every time.
  const fileParam = new URLSearchParams(location.search).get('file');
  if (fileParam != null && /^\d+$/.test(fileParam)) {
    const qs = new URLSearchParams(location.search);
    qs.delete('file');
    const rest = qs.toString();
    history.replaceState(null, '', `${BASE}/${state.roomId}${rest ? `?${rest}` : ''}`);
    openFileDeepLink(Number(fileParam));
  }

  // Best-effort: a Supabase project that hasn't run
  // supabase/migrations/0003_room_comments.sql yet just never shows any comments —
  // _refreshComments() swallows the failure rather than surfacing an error
  // toast for what is an entirely optional feature.
  state.unsubComments = subscribeToComments(state.roomId, () => _refreshComments());
  await _refreshComments();

  if (state.room.expires_at) setupExpirationTimer();

  wireEvents();

  // Passive browser 'online'/'offline' events are not a reliable signal on
  // their own (MDN documents this explicitly) — in practice that shows up
  // as a WiFi/mobile blip resolving without the OS-level interface ever
  // reporting "down" (so 'online' never fires), or the device sleeping/the
  // tab being backgrounded through the whole outage and waking up already
  // reconnected with no event ever delivered. Left alone, the app stays
  // stuck showing the offline banner and never re-runs _reconcileAndFlush()
  // until *something else* happens to touch the network — in practice, the
  // next keystroke's debounced save, which is what made this look like
  // "typing reconnects it" rather than a missed event. The two extra checks
  // below actively verify real connectivity instead of only ever reacting
  // to the passive event: the tab regaining visibility (laptop wake, phone
  // screen on, switching back from another app — exactly the scenarios
  // most likely to have swallowed the event), and a slow poll while
  // genuinely believed offline as a fallback for staying on the same tab
  // through a blip that never fires anything at all.
  let believedOffline = !isOnline();
  const applyOnline = () => {
    believedOffline = false;
    UI.hideOfflineBanner(); UI.setStatus('connected'); _reconcileAndFlush();
  };
  const applyOffline = () => {
    believedOffline = true;
    UI.showOfflineBanner(); UI.setStatus('offline');
  };
  const probeIfBelievedOffline = async () => {
    if (!believedOffline || !state.roomId) return;
    try { await loadRoom(state.roomId); applyOnline(); } catch { /* still offline */ }
  };
  // probeIfBelievedOffline() above only ever resyncs when the app already
  // *believes* it's offline (navigator.onLine went false, or a real
  // 'offline' event fired) — but mobile browsers routinely background a tab
  // for minutes without ever firing that event: the WebSocket is silently
  // suspended by the OS while navigator.onLine stays true the whole time.
  // Reopening the tab then hits probeIfBelievedOffline()'s early return and
  // does nothing, leaving stale content on screen with no visible sign
  // anything is wrong. This second, unconditional path resyncs on any real
  // signal that the app regained focus/visibility, independent of whatever
  // the browser's online/offline events did or didn't report — throttled so
  // an ordinary quick alt-tab doesn't cause a resync flash on every switch.
  const RESYNC_THROTTLE_MS = 15_000;
  let lastVisibilityResyncAt = 0;
  const resyncOnRegainedFocus = () => {
    if (!state.roomId) return;
    const now = Date.now();
    if (now - lastVisibilityResyncAt < RESYNC_THROTTLE_MS) return;
    lastVisibilityResyncAt = now;
    _reconcileAndFlush();
  };
  const cleanupOnlineEvent = onOnlineChange((online) => (online ? applyOnline() : applyOffline()));
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    // Mutually exclusive, not layered: probeIfBelievedOffline() already
    // fully covers the believed-offline case (loadRoom() + applyOnline()).
    // Running resyncOnRegainedFocus() too in that case would fire a second,
    // concurrent loadRoom()-driven reconcile racing the first one for no
    // reason — resyncOnRegainedFocus() exists specifically for the *other*
    // case, where the app never realized it went offline in the first place.
    if (believedOffline) probeIfBelievedOffline();
    else resyncOnRegainedFocus();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onFocus = () => resyncOnRegainedFocus();
  window.addEventListener('focus', onFocus);
  // bfcache restores (mobile back/forward navigation, some backgrounding
  // scenarios) fire 'pageshow' with persisted:true instead of/in addition to
  // 'visibilitychange' — cover it explicitly rather than assuming the other
  // two always fire together.
  const onPageShow = (e) => { if (e.persisted) resyncOnRegainedFocus(); };
  window.addEventListener('pageshow', onPageShow);
  const offlinePollId = setInterval(probeIfBelievedOffline, 20_000);
  state.onlineCleanup = () => {
    cleanupOnlineEvent();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('pageshow', onPageShow);
    clearInterval(offlinePollId);
  };
  if (believedOffline) UI.showOfflineBanner();

  // If the user already scrolled during the awaited operations above (see
  // the baseline snapshot's own comment), both the automatic focus below
  // and the restore/fallback that would normally follow it are skipped
  // entirely — focusing would trigger the very native scroll-to-caret
  // effect this mechanism exists to counteract, undoing the position the
  // user just landed on with nothing left to correct it back afterward,
  // and applying any offset (persisted or fallback) on top of that would
  // just be a second, different way of clobbering the same real scroll.
  const _startupWriteElNow = document.getElementById('note-editor');
  const _startupLiveElNow = document.querySelector('#note-live .cm-scroller');
  const _userInteractedDuringStartup =
    (_startupBaselineWriteTop != null && _startupWriteElNow && _startupWriteElNow.scrollTop !== _startupBaselineWriteTop) ||
    (_startupBaselineLiveTop != null && _startupLiveElNow && _startupLiveElNow.scrollTop !== _startupBaselineLiveTop);

  if (!_userInteractedDuringStartup) {
    // Captured *before* focusing below — a textarea/CM6 view auto-scrolls to
    // keep its own caret visible the instant it's focused, which (confirmed
    // live) can silently jump to wherever the caret happens to sit (typically
    // the very end of the document, from whatever the initial content
    // assignment left it at) — completely independent of any scroll-position
    // write already made, and not something that goes through a normal
    // scrollTop assignment this code could otherwise just run after. This is
    // "the position before that native behavior gets a chance to interfere,"
    // used as the fallback below when there's no remembered position to
    // restore, so focusing never gets the last word on scroll position by
    // simply defaulting to wherever it wants.
    const _preFocusOffset = _captureTopOffset(_initialMode);

    // Preview is now a possible starting mode (see _resolveInitialEditorMode()
    // above), where the plain textarea is hidden — UI.focusEditor() would
    // silently focus an invisible element and leave no visible caret anywhere.
    if (!isMobile() && !state.isReadOnly) _focusActiveEditorSurface();

    // Remembered scroll position (local-only, per room — see scroll-memory.js)
    // takes over from wherever things have landed so far, falling back to
    // _preFocusOffset (not simply doing nothing) when there's nothing to
    // restore — loadScrollOffset() returns null for a first-ever visit or
    // when the content's fingerprint doesn't match what was saved, and
    // either way the right behavior is "stay where this load already had it
    // before focus," not "let focus's own native caret-scroll decide."
    // Running after _focusActiveEditorSurface() above, not before, is what
    // lets this have the final say regardless of what focusing just did.
    //
    // Never for an encrypted room or a view-once room this tab has already
    // consumed — see _scrollMemoryBlocked()'s own comment for why.
    const _restoreOffset = _shouldReadScrollMemory() ? loadScrollOffset(state.roomId, UI.getEditorValue()) : null;
    const _finalOffset = _restoreOffset != null ? _restoreOffset : _preFocusOffset;
    if (_finalOffset != null) {
      if (_initialMode === 'write' || _initialMode === 'split') UI.scrollWriteOffsetToTop(_finalOffset);
      if ((_initialMode === 'preview' || _initialMode === 'split') && LiveEditor.isMounted()) {
        LiveEditor.refreshLayout(_finalOffset);
      }
    }
  }
  // The startup restore decision above has now been made either way
  // (applied or deliberately skipped for _userInteractedDuringStartup) —
  // see _roomRestoreComplete's own comment for why writes were blocked
  // until this exact point, not just _roomContentReady. Guarded by session
  // generation same as the scrollSaveTimer install just below: a *stale*
  // startApp() invocation resuming here (room A, superseded by room B
  // while A was awaiting refreshFiles()/_refreshComments()) must not set
  // this shared flag on B's behalf — B already reset it via
  // teardownRealtimeSession(), and A opening the write gate early would
  // let a flush overwrite B's still-unapplied saved position with B's own
  // temporary startup one, the exact bug this flag exists to prevent.
  if (_myRoomSession === _roomSessionGeneration) _roomRestoreComplete = true;
  // Periodic save while this room stays open, so returning later restores
  // roughly where the user left off — reuses _applyMarkdownMode()'s own
  // "what's at the top of whichever surface is visible" capture rather
  // than a second copy of that logic. A plain interval (not a scroll
  // listener) deliberately: this is a "remember for next time" feature, not
  // a live sync, so it doesn't need to react to every scroll — see
  // teardownRealtimeSession() for the matching cleanup and the final flush
  // on leaving this room. Skipped for an encrypted room or a consumed
  // view-once room — see _scrollMemoryBlocked()'s own comment for why.
  //
  // Only installed if this is still the current room session — see
  // _roomSessionGeneration's own comment for why a stale invocation
  // resuming here must not overwrite a newer one's already-installed timer.
  if (_myRoomSession === _roomSessionGeneration) {
    state.scrollSaveTimer = setInterval(() => {
      if (!_shouldWriteScrollMemory()) return;
      const offset = _captureTopOffset(state.markdownMode);
      if (offset != null) saveScrollOffset(state.roomId, UI.getEditorValue(), offset);
    }, 2000);
  }

  // ── View-once: consume AFTER the note is visible to the user ───────────────
  // Set state.consumingViewOnce so the subscribeToRoom postgres echo of our own
  // clear doesn't wipe the editor we just rendered.
  if (shouldConsumeViewOnce) {
    state.consumingViewOnce = true;
    try {
      const consumed = await consumeViewOnce(state.roomId, state.room, false, await _emptyContentForCurrentEncryption());
      if (consumed) {
        state.room = await loadRoom(state.roomId);
        state.viewOnceConsumedByThisSession = true;
        clearDraft(state.roomId);
        // _scrollMemoryBlocked() only gates *future* reads/writes —
        // an entry already saved during an earlier non-consuming visit, or
        // written by the periodic timer while this consume request was
        // still in flight, would otherwise keep the consumed plaintext's
        // length/hash in localStorage indefinitely. Same reasoning as the
        // encryption-enable path clearing its own equivalent residue.
        clearScrollOffset(state.roomId);
        _updatePermissionContext();
        broadcastViewOnceCleared();
        UI.showToast(
          'This was a view-once note. It has been cleared from the server, but remains visible on this device until you leave.',
          'warning', 8000
        );
      }
    } catch {
      // Race condition — another device may have consumed it first. Ignore.
    } finally {
      // If the Postgres echo never arrives, do not leave this client in a
      // permanent self-consumer state. We already reloaded state.room above when the
      // consume succeeded, so permission state remains correct.
      state.consumingViewOnce = false;
      _updatePermissionContext();
    }
  }

  // First-ever room creation in this browser gets a short coachmark tour —
  // gated by a localStorage flag (see ui/onboarding.js), not room state, so
  // it never shows again regardless of how many rooms this device creates
  // afterward. isNewRoom is never true for a forced-read-only route.
  if (isNewRoom && !UI.hasSeenOnboarding()) UI.startOnboardingTour();
}

async function _decodeLocalDraft(draft) {
  if (!draft) return null;
  if (!draft.encrypted) {
    // Legacy/plain drafts must not be restored into encrypted rooms. Clear them
    // so an older v1 test build cannot leave plaintext localStorage behind.
    if (state.room?.encryption_enabled) { clearDraft(state.roomId); return null; }
    return draft.content ?? '';
  }

  if (!state.encKey) {
    // Draft is encrypted but we have no key. The most common cause is that
    // encryption was removed from the room after the draft was saved — the
    // ciphertext is now permanently unreadable. Clear it and warn the user so
    // they know work may have been lost.
    if (!state.room?.encryption_enabled) {
      clearDraft(state.roomId);
      UI.showToast(
        'A local draft from when this room was encrypted could not be restored (encryption has since been removed). Draft discarded.',
        'warning',
        8000,
      );
    }
    return null;
  }
  try { return await decryptContent(draft.content || '', state.encKey); }
  catch {
    // Wrong/corrupt local draft ciphertext should not block room loading.
    clearDraft(state.roomId);
    return null;
  }
}

function _isEncryptedWithoutKey(room = state.room) {
  return !!room?.encryption_enabled && !state.encKey;
}

function _enterEncryptedNoKeyMode(newRoom, { showToast = false } = {}) {
  cancelPendingSave();
  cancelPendingTypingBroadcast();
  cancelPendingLiveContentBroadcast();
  state.encKey = null;
  state.encSalt = newRoom?.encryption_salt || null;
  setEncryption(null, null);
  clearDraft(state.roomId);
  setContentNoSave('');
  UI.updateWordCount('');
  _refreshPreviewIfActive();
  UI.showEncryptionLockedBanner(true, () => { location.reload(); });
  if (showToast) {
    UI.showToast('Encryption was enabled by another device. Reload to enter the passphrase.', 'warning', 7000);
  }
}

// ── Room state transitions (encryption / lock / view-once / clear) ───────────
//
// Called from BOTH the broadcast 'settings' handler and the postgres_changes
// subscription. Centralising the logic keeps the two paths consistent.
async function _handleRoomStateTransition(prev, newRoom) {
  if (!newRoom) return;

  // Live quarantine: an admin can quarantine a room while it's open in this
  // tab. Tear down and block immediately, before applying any other part of
  // this update, so no further content/settings changes are processed.
  if (newRoom.quarantined_at) {
    teardownRealtimeSession();
    _showQuarantinedScreen(newRoom);
    return;
  }

  // Save echoes from our own writes
  const ourId = getDeviceId();
  const isOwnWrite = newRoom.updated_by_device === ourId;

  // ── Encryption transitions ─────────────────────────────────────────────────
  // Apply encryption-mode changes BEFORE applying remote content. Otherwise a
  // client can try to decrypt newly-plaintext content after remote encryption is
  // disabled, or briefly render ciphertext after encryption is enabled.
  const wasEnc = !!prev?.encryption_enabled;
  const nowEnc = !!newRoom.encryption_enabled;
  let shouldApplyRemoteContent = prev?.content !== newRoom.content;

  if (nowEnc && !state.encKey) {
    // Encryption is active and this client does not have the key. This is not
    // only a transition guard: every future encrypted Broadcast/DB payload must
    // be ignored so ciphertext can never render in the editor.
    _enterEncryptedNoKeyMode(newRoom, { showToast: !wasEnc && !isOwnWrite });
    shouldApplyRemoteContent = false;
    // Same reasoning as panels.js's own local enable-encryption path: a
    // scroll-memory record saved while this room was still unencrypted is a
    // plaintext length + hash sitting in this device's localStorage, and
    // that path only ever runs on whichever device *initiates* the change —
    // every other already-connected peer only ever observes it here, via
    // this transition, so the record has to be cleared on this path too.
    if (!wasEnc) clearScrollOffset(state.roomId);
  } else if (wasEnc && !nowEnc) {
    // Encryption just got turned off. Switch sync.js back to plaintext BEFORE
    // applying the new room content, because newRoom.content is now plaintext.
    cancelPendingTypingBroadcast();
    cancelPendingLiveContentBroadcast();
    state.encKey = null;
    state.encSalt = null;
    setEncryption(null, null);
    UI.showEncryptionLockedBanner(false);
  } else if (nowEnc && state.encKey) {
    // Salt/key did not change, but make sure sync.js still has the active fns
    // after any room-state reload or subscription race.
    setEncryption(
      (pt) => encryptContent(pt, state.encKey),
      (ct) => decryptContent(ct, state.encKey),
    );
  }

  // Update permissions before any await so queued saves immediately see lock,
  // read-only, view-once-consumed, or encrypted-without-key state.
  _updatePermissionContext();

  // ── Apply remote DB content after encryption state is current ──────────────
  // Settings-only writes still change updated_by_device and DB-managed updated_at,
  // but they do not change content. Avoid treating those as stale remote text updates.
  if (shouldApplyRemoteContent) {
    await handleRemoteDatabaseChange(newRoom);
  }

  _renderRoomHeader();
  UI.renderSettingsPanel(state.room);
  UI.setEncryptionBadge(!!state.room.encryption_enabled);
  UI.setViewOnceBadge(!!state.room.view_once);
  UI.setLockedMode(!!state.room.editing_locked);

  // ── Clear/expired/view-once toasts ─────────────────────────────────────────
  if (newRoom.cleared_reason === 'expired' && prev?.cleared_reason !== 'expired') {
    cancelPendingSave();
    cancelPendingTypingBroadcast();
    cancelPendingLiveContentBroadcast();
    clearDraft(state.roomId);
    clearScrollOffset(state.roomId);
    setContentNoSave('');
    UI.updateWordCount('');
    UI.hideExpirationBar();
    _refreshPreviewIfActive();
    _pruneDeletedCommentAnchors();
    UI.showToast('This note expired and was cleared.', 'warning', 5000);
  }

  if (newRoom.cleared_reason === 'view_once' && prev?.cleared_reason !== 'view_once') {
    clearDraft(state.roomId);
    // v1: do not clear the local editor if WE were the consumer, but lock it so
    // the consumed note never gets saved back to the server.
    if (state.consumingViewOnce || state.viewOnceConsumedByThisSession || isOwnWrite) {
      state.consumingViewOnce = false;
      _updatePermissionContext();
    } else {
      cancelPendingSave();
      cancelPendingTypingBroadcast();
      cancelPendingLiveContentBroadcast();
      clearScrollOffset(state.roomId);
      setContentNoSave('');
      UI.updateWordCount('');
      _refreshPreviewIfActive();
      _pruneDeletedCommentAnchors();
      UI.showToast('This note was view-once and has been cleared from the server.', 'warning', 6000);
    }
  }

  if (newRoom.cleared_reason === 'device_limit' && prev?.cleared_reason !== 'device_limit') {
    clearDraft(state.roomId);
    if (isOwnWrite) {
      // This device's own join was the one that hit the limit — it already
      // has the content in hand from startApp() (captured before the
      // clearing write), so don't wipe what it just earned the right to see.
      _updatePermissionContext();
    } else {
      cancelPendingSave();
      cancelPendingTypingBroadcast();
      cancelPendingLiveContentBroadcast();
      clearScrollOffset(state.roomId);
      setContentNoSave('');
      UI.updateWordCount('');
      _refreshPreviewIfActive();
      _pruneDeletedCommentAnchors();
      UI.showToast('This room reached its device limit and has been cleared from the server.', 'warning', 6000);
    }
  }

  if (newRoom.expires_at) setupExpirationTimer();
  else UI.hideExpirationBar();

  _refreshPreviewIfActive();
  _updateViewOnceConsumedUI();
}

export function _updatePermissionContext() {
  setPermissionContext({
    isReadOnlyUrl:    state.isReadOnly,
    isEditingLocked:  !!state.room?.editing_locked,
    isEncryptedNoKey: !!state.room?.encryption_enabled && !state.encKey,
    isEncryptionEnabled: !!state.room?.encryption_enabled,
    isCleared:        !!state.room?.cleared_reason,
    isViewOnceConsumed: (state.room?.cleared_reason === 'view_once' && !!state.room?.viewed && !state.viewOnceConsumedByThisSession),
  });
  UI.setEditorEditable(canEdit());
  LiveEditor.setReadOnly(!canEdit()); // keep the live surface's gate in lockstep
  UI.setEditBlockedReason(editBlockedReason());
  _updateViewOnceConsumedUI();
}

function _updateViewOnceConsumedUI() {
  const consumed = state.room?.view_once && state.room?.cleared_reason === 'view_once' && !!state.room?.viewed && !state.viewOnceConsumedByThisSession;
  UI.setViewOnceConsumedPanel({
    visible: !!consumed,
    readOnly: !!state.isReadOnly,
    onGoHome: _suppressNextResume,
    onStartNew: async () => {
      if (state.isReadOnly) return;
      try {
        await snapshotBeforeDestructiveChange();
        await resetViewOnceNote(state.roomId, await _emptyContentForCurrentEncryption());
        clearDraft(state.roomId);
        clearScrollOffset(state.roomId);
        state.room = await loadRoom(state.roomId);
        state.viewOnceConsumedByThisSession = false;
        setContentNoSave('');
        UI.updateWordCount('');
        _refreshPreviewIfActive();
        _pruneDeletedCommentAnchors();
        _updatePermissionContext();
        _renderRoomHeader();
        UI.renderSettingsPanel(state.room);
        UI.setViewOnceBadge(!!state.room.view_once);
        broadcastSettingsChange();
        broadcastClear();
        UI.showToast('Room reset to a normal room.', 'success');
      } catch {
        UI.showToast('Could not reset this view-once note.', 'error');
      }
    },
  });
}

// ── Expiration timer ──────────────────────────────────────────────────────────

export function setupExpirationTimer() {
  clearTimeout(state.expTimer);
  state.expTimer = null;
  if (!state.room?.expires_at) return;
  const armExpirationTimer = () => {
    clearTimeout(state.expTimer);
    state.expTimer = null;
    if (!state.room?.expires_at) return;
    const remaining = new Date(state.room.expires_at) - Date.now();
    if (remaining <= 0) {
      // Captured before the awaits below, not read from state.roomId
      // afterward — if the user navigates to a different room while this
      // is in flight, state.roomId already points at that new room by the
      // time this continuation resumes, and clearScrollOffset() must land
      // on the room that actually expired, not whatever the shared state
      // has since moved on to (same reasoning as the startup-expiration
      // path above).
      const _expiringRoomId = state.roomId;
      void (async () => {
        const didClear = await handleExpiration(_expiringRoomId, state.room, await _emptyContentForCurrentEncryption());
        if (didClear) {
          clearScrollOffset(_expiringRoomId);
          setContentNoSave('');
          UI.updateWordCount('');
          UI.hideExpirationBar();
          _refreshPreviewIfActive();
          _pruneDeletedCommentAnchors();
          UI.showToast('This note expired and was cleared.', 'warning', 5000);
          broadcastSettingsChange();
        }
      })();
      return;
    }

    const nextDelay = Math.min(remaining, EXPIRATION_TIMER_MAX_DELAY_MS);
    state.expTimer = setTimeout(() => {
      armExpirationTimer();
    }, nextDelay);
  };

  UI.showExpirationBar(state.room.expires_at, async () => {
    if (!canChangeSettings()) { UI.showToast(editBlockedReason() || 'Cannot change settings.', 'warning'); return; }
    try {
      await clearExpiration(state.roomId);
      state.room = await loadRoom(state.roomId);
      UI.hideExpirationBar();
      broadcastSettingsChange();
      UI.showToast('Expiration removed.', 'success');
    } catch { UI.showToast('Could not remove expiration.', 'error'); }
  });

  armExpirationTimer();
}

export function _renderRoomHeader() {
  UI.setRoomName({
    roomId: state.roomId,
    roomName: state.room?.room_name || '',
    canEditTitle: canEdit() && !(state.room?.view_once && state.room?.cleared_reason === 'view_once' && !!state.room?.viewed && !state.viewOnceConsumedByThisSession),
  });
}

/**
 * Called when the browser regains connectivity, before letting the queued
 * debounced save flush. Realtime doesn't replay events missed while
 * offline, so fetch the room fresh (a plain REST read, independent of
 * Realtime) and let reconcileAfterReconnect() decide whether it's safe to
 * flush or whether a remote edit made during the outage needs the conflict
 * prompt instead of being silently overwritten. Best-effort: if the fetch
 * itself fails (still flaky connectivity), fall back to a normal flush
 * rather than leaving local edits stuck unsaved indefinitely.
 */
async function _reconcileAndFlush() {
  if (!state.roomId) return;
  let fresh = null;
  try { fresh = await loadRoom(state.roomId); } catch { /* fall through to flush below */ }
  if (fresh) state.room = fresh;
  await reconcileAfterReconnect(fresh);
}

/**
 * Final, synchronous flush of the persisted scroll position (scroll-
 * memory.js) for whichever room is currently open — the periodic save in
 * startApp() only runs every 2s, so without an explicit flush the last
 * couple seconds of scrolling before leaving would be lost. Shared by
 * teardownRealtimeSession() (in-app navigation away) and the page-exit
 * cleanup in editor-behavior.js (tab close/reload/back-forward, which never
 * runs teardownRealtimeSession() at all) — see that call site for why both
 * need their own hook into this. No-op for an encrypted room, a consumed
 * view-once room, or before this room's own startup has actually finished
 * — see _shouldWriteScrollMemory()'s own comment for why.
 */
export function flushScrollPosition() {
  if (!state.roomId || !_shouldWriteScrollMemory()) return;
  const offset = _captureTopOffset(state.markdownMode);
  if (offset != null) saveScrollOffset(state.roomId, UI.getEditorValue(), offset);
}

export function teardownRealtimeSession() {
  // Must run before anything below resets state.roomId/markdownMode/encKey
  // for the next room.
  //
  // Bumped here, not just inside startApp() — this runs unconditionally at
  // the top of every joinRoom() call, even one that ends up stopping at a
  // passcode/encryption/quarantine gate or an error screen and never
  // reaches startApp() at all. A stale startApp() invocation from the
  // *previous* room, still awaiting its own slow refreshFiles()/
  // _refreshComments() calls, needs to see every subsequent navigation as
  // superseding it — including one that doesn't get as far as starting a
  // new startApp() of its own — or it can still resume and leak its
  // interval with nothing left running to ever invalidate it.
  _roomSessionGeneration++;
  clearInterval(state.scrollSaveTimer);
  state.scrollSaveTimer = null;
  flushScrollPosition();
  _resetSplitPaneTracking();
  try { state.unsubRoom?.(); } catch {}
  try { state.unsubFiles?.(); } catch {}
  try { state.unsubComments?.(); } catch {}
  state.unsubRoom = null;
  state.unsubFiles = null;
  state.unsubComments = null;
  destroyPresence();
  destroyBroadcast();
  destroySync();
  UI.clearFloatingComments();
  // The onboarding tour isn't room-scoped state either (its "seen" flag is
  // deliberately never reset — see startOnboardingTour()), but an open tour
  // spotlights elements by CSS selector, not a stable reference, so leaving
  // it up across a navigation could end up highlighting the wrong element
  // once the new room's DOM settles.
  UI.endOnboardingTour();
  // A footnote popover isn't room-scoped state, but leaving one open across
  // a navigation would point it at a trigger element that's about to be
  // torn down/replaced.
  closeFootnotePopover();
  // Clear any showing "X is typing…" banner and its auto-hide timer so it
  // can never bleed into the next room's loading screen.
  UI.hideTypingIndicator();
  state.followedDeviceId = null;
  state.lastComments = [];
  state.activeCommentId = null;
  // A queued prune from the previous room's typing must not delete comments
  // in whatever room is joined next.
  _debouncedPruneDeletedCommentAnchors.cancel?.();
  UI.renderFloatingComments([]);
  UI.setCommentCountBadge(0);
  _closeSlashMenu();
  // Remove the keydown handler so wireEvents() can install fresh callbacks
  // on the next room join. DOM element listeners (editor, buttons, etc.) are
  // protected by the state.eventsWired guard and must NOT be reset here — resetting
  // state.eventsWired would cause them to accumulate on multi-room navigation.
  destroyShortcuts();
  cancelPendingTypingBroadcast();
  cancelPendingLiveContentBroadcast();
  // Clear stale search state so the next room starts with a clean search panel.
  state.searchMatches = [];
  state.searchIndex   = -1;
  state.searchTerm    = '';
  state.caseSensitive = false;
  const _scEl = document.getElementById('search-count');
  if (_scEl) _scEl.textContent = '';
  const _siEl = document.getElementById('search-input');
  if (_siEl) _siEl.value = '';
  // Reset the Aa toggle to case-insensitive so the next room starts fresh.
  const _caseEl = document.getElementById('search-case');
  if (_caseEl) { _caseEl.classList.remove('is-active'); _caseEl.setAttribute('aria-pressed', 'false'); }
  // Cancel any pending expiration timer. The callback closes over the
  // module-level state.roomId / state.room which will be updated to the NEXT room
  // before the timer fires — letting a stale timer run risks expiring the
  // wrong room.
  clearTimeout(state.expTimer);
  state.expTimer = null;
  // Remove the online/offline listener registered in startApp(). Without this
  // each room navigation accumulates a new listener on window, causing duplicate
  // flushSave calls and stale status updates after re-connecting.
  state.onlineCleanup?.();
  state.onlineCleanup = null;
  // Reset encryption keys so a key from an encrypted room is never used to
  // silently encrypt saves in a subsequent non-encrypted room.
  state.encKey  = null;
  state.encSalt = null;
  // Reset in-memory mode to a safe, content-independent placeholder so the
  // loading screen never shows a stale divider (mode-split, etc.) from the
  // previous room. This is NOT the mode the next room opens into — startApp()
  // applies the user's remembered mode (_resolveInitialEditorMode()) once
  // that room's content is actually loaded, which is what the next room
  // visibly starts in.
  state.markdownMode = 'write';
  state.showPreview  = false;
  UI.setMarkdownMode('write', null);
  // Tear down the live-preview surface so the next room mounts fresh rather
  // than briefly showing this room's content.
  LiveEditor.destroy();
  // Reset expiration preset — both the variable AND the settings-panel DOM
  // (preset button highlighting, custom-row visibility) — so a room where
  // "Custom" was selected doesn't leave the panel visually showing Custom
  // with its inputs open in the next room even though state.expPreset is back to
  // the default.
  _selectExpirationPreset('10m');
  // Exit bulk-select mode so the next room starts with a clean files panel.
  state.filesSelectMode = false;
  state.selectedFiles   = new Set();
  document.getElementById('files-bulk-bar')?.classList.add('hidden');
  document.getElementById('files-select-toggle')?.classList.remove('active');
  // Reset view-once consumption guard. If this flag is left true from a previous
  // room, the next room's handleRoomRealtime handler will silently skip a
  // view-once clear event that it should actually surface to the user.
  state.consumingViewOnce = false;
  // Cancel any queued debounced preview refresh from the previous room so it
  // does not fire in the next room's context and render stale content.
  _debouncedRefreshPreview.cancel?.();
  // Reset the preview-click listener guard so the next room can wire it when
  // the user enters preview mode. Without this, the guard stays true and the
  // listener is never re-wired after the first navigation.
  state.previewObserverWired = false;
  // Reset room object so stale room data never leaks into a subsequent session
  // (e.g. settings callbacks that fire after teardown read state.room for its values).
  state.room   = null;
  state.roomId = null;
  // Defense-in-depth: clear URL-derived flags. Both are re-set from the URL on
  // every room navigation (lines ~191–197) before being read, so there is no
  // functional bug if they linger. Clearing here ensures no stale value is
  // observable in the window between teardown and the next route resolution.
  state.isReadOnly = false;
  state.shareToken = null;
  // Reset the scroll-sync guard so it can re-wire on the next split-mode entry.
  UI.resetScrollSync();
  // Reset the presence announcer so the next room's already-connected devices
  // aren't announced to screen readers as having just joined.
  UI.resetPresenceAnnouncer();
}

export async function doClearNote() {
  try {
    await snapshotBeforeDestructiveChange();
    await clearRoomContent(state.roomId, 'manual', await _emptyContentForCurrentEncryption());
    clearScrollOffset(state.roomId);
    setContentNoSave('');
    UI.updateWordCount('');
    _refreshPreviewIfActive();
    _pruneDeletedCommentAnchors();
    broadcastClear('manual');
    UI.showToast('Note cleared.', 'success');
    state.room = await loadRoom(state.roomId);
    _updatePermissionContext();
  } catch { UI.showToast('Could not clear the note.', 'error'); }
}
