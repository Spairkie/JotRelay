// JotRelay – sync.js
// Coordinates two sync tracks:
//   • Live Typing Lane  – Supabase Broadcast ~250 ms throttle, ephemeral
//   • Save Lane         – Postgres, 1000 ms debounce + flush on blur/unload
//
// Realtime payload contract:
//   Typing/activity lane is metadata-only.
//   Live snapshot lane may carry small unencrypted note content for fast UI
//   responsiveness. Encrypted rooms stay on DB-only content sync.
//
// Conflict contract:
//   Active typing (< 3 s) → queue remote updates, show notice.
//   Idle → apply remote updates immediately.
//
// Permission contract:
//   canEdit() and canBroadcastTyping() are checked at the input boundary.
//   Read-only / locked clients never trigger saves or typing broadcasts.

import { saveContent }           from './rooms.js';
import { saveRevision }          from './revisions.js';
import { broadcastTyping, broadcastLiveContent, LIVE_CONTENT_BROADCAST_MAX_CHARS } from './live-broadcast.js';
import { saveDraft, clearDraft } from './offline.js';
import { debounce, getDeviceId } from './utils.js';
import { canEdit, canBroadcastTyping, canBroadcastLiveContent, canReceiveLiveContent, getPermissionContext } from './permissions.js';

const IDLE_THRESHOLD_MS     = 3000;
const SAVE_DEBOUNCE_MS      = 1000;
// Version-history snapshots are throttled independently of the 1 s save
// debounce — one snapshot per this interval of active editing is plenty to
// browse history without a revision row on every keystroke pause.
const SNAPSHOT_THROTTLE_MS  = 2 * 60 * 1000;

// ── Module state ──────────────────────────────────────────────────────────────

let _roomId           = null;
let _encryptFn        = null; // async (plaintext: string) → ciphertext: string
let _decryptFn        = null; // async (ciphertext: string) → plaintext: string
let _getEditorVal     = null;
let _setEditorVal     = null;
let _onStatusChange   = null;
let _onPendingRemote  = null;
let _onDismissPending = null;

let _localLastEditAt           = 0;
let _pendingRemoteContent      = null;
let _pendingRemoteTimestamp    = null;
let _applyingRemote            = false;
let _seqNum                    = 0;
let _lastSnapshotAt            = 0;
// Mirrors the 'saving'/'saved'/'error' values already passed to
// _onStatusChange (UI.setStatus) — tracked here too so hasUnsavedChanges()
// (app/pwa.js's beforeunload warning) can query it without the UI layer
// needing to expose its own displayed text back out.
let _saveStatus                = 'saved';
// Bumped by every onLocalInput() call. _debouncedSave's debounce() wrapper
// only guards the TIMER — if a save already escaped its timer and is
// awaiting the network when a newer edit schedules another one, both can
// genuinely run concurrently. Comparing this against the value captured at
// the start of a completing save lets a stale (older) completion detect
// it's been superseded and skip overwriting _saveStatus back to 'saved' or
// clearing the draft a newer, not-yet-saved edit still needs.
let _saveGeneration            = 0;

// ── Init / Destroy ────────────────────────────────────────────────────────────

export function initSync(opts) {
  _roomId           = opts.roomId;
  _encryptFn        = opts.encryptFn        || null;
  _decryptFn        = opts.decryptFn        || null;
  _getEditorVal     = opts.getEditorVal;
  _setEditorVal     = opts.setEditorVal;
  _onStatusChange   = opts.onStatusChange   || (() => {});
  _onPendingRemote  = opts.onPendingRemote  || (() => {});
  _onDismissPending = opts.onDismissPending || (() => {});

  _localLastEditAt           = 0;
  _pendingRemoteContent      = null;
  _pendingRemoteTimestamp    = null;
  _applyingRemote            = false;
  _seqNum                    = 0;
  _lastSnapshotAt            = 0;
  _saveStatus                = 'saved';
  _saveGeneration            = 0;
}

export function setEncryption(encryptFn, decryptFn) {
  _encryptFn = encryptFn;
  _decryptFn = decryptFn;
}

/** True while there's a durable-save write queued or in flight (debounced,
 *  not yet confirmed written) or the last attempt failed outright — used by
 *  app/pwa.js's beforeunload warning. Local drafts (offline.js) already
 *  save synchronously on every keystroke, so nothing typed is ever actually
 *  lost from this device; what's genuinely at risk here is the OTHER
 *  connected devices missing this edit, or (rarer) this device's own
 *  localStorage being cleared before the durable write lands. */
export function hasUnsavedChanges() {
  return _saveStatus !== 'saved';
}

export function destroySync() {
  _debouncedSave.cancel?.();
  _roomId    = null;
  _encryptFn = null;
  _decryptFn = null;
  _saveStatus = 'saved'; // cancelled, not failed — nothing left to warn about
}

// ── Local input handler ───────────────────────────────────────────────────────
// Called from the textarea 'input' event. Returns a Promise (fire-and-forget OK).

export async function onLocalInput() {
  if (_applyingRemote) return;
  // If editing is blocked (read-only URL, room lock, or encryption with no
  // key), do nothing. The editor should already be readonly, but defend the
  // boundary here too so a stray keystroke never causes a save or broadcast.
  if (!canEdit()) return;

  // Set the typing timestamp synchronously so conflict detection is accurate
  _localLastEditAt = Date.now();

  // Mark unsaved (and bump the generation counter _debouncedSave below
  // compares itself against) BEFORE the first await. saveDraft() below
  // awaits async encryption in an encrypted room; onLocalInput() itself is
  // called fire-and-forget from the textarea's 'input' listener, so a tab
  // closed while that encryption is still pending must already read as
  // unsaved — setting this after the await would leave a real in-flight
  // edit unprotected by hasUnsavedChanges()'s beforeunload warning.
  _onStatusChange('saving');
  _saveStatus = 'saving';
  _saveGeneration++;

  const plaintext = _getEditorVal();

  // Save draft immediately. Encrypted rooms store encrypted local drafts only;
  // if draft encryption fails, offline.js refuses to fall back to plaintext.
  await saveDraft(_roomId, plaintext, { encryptFn: _encryptFn });

  // Kick off debounced DB save
  _debouncedSave();

  // Broadcast metadata-only typing activity (no note text/ciphertext payload).
  // Skip broadcasting in read-only mode (canBroadcastTyping is false).
  if (canBroadcastTyping()) {
    broadcastTyping(++_seqNum);
  }

  // Live snapshots are best-effort responsiveness only. Supabase DB saves
  // remain the durable source of truth.
  // Encrypted rooms intentionally use DB-only content sync in v1 to avoid
  // plaintext live broadcast and repeated ciphertext payloads.
  if (canBroadcastLiveContent() && plaintext.length <= LIVE_CONTENT_BROADCAST_MAX_CHARS) {
    broadcastLiveContent(_seqNum, plaintext);
  }
}

export function onEditorBlur() { return _debouncedSave.flush?.(); }
export function flushSave()    { return _debouncedSave.flush?.(); }
// Every caller (room-lifecycle.js) uses this exclusively for "this room's
// content was just discarded out from under us" — a remote clear/expiry/
// view-once consumption/device-limit clear/switch to encrypted-no-key mode —
// always paired with clearDraft()/setContentNoSave(''). There's genuinely
// nothing left to save in any of those cases, so reset status here rather
// than leaving it stuck at whatever it was mid-edit — otherwise
// hasUnsavedChanges() keeps reporting true (spurious beforeunload warnings)
// for content that no longer exists to be unsaved.
export function cancelPendingSave() {
  _debouncedSave.cancel?.();
  _onStatusChange('saved');
  _saveStatus = 'saved';
}

// ── Debounced DB save ─────────────────────────────────────────────────────────

const _debouncedSave = debounce(async () => {
  if (!_roomId) return;

  // The generation current when THIS save started. debounce() only guards
  // the timer, not an already-running async body — if this save is still
  // awaiting the network when a newer edit bumps _saveGeneration and starts
  // its own save, this save's eventual completion must not report 'saved'
  // (a newer, not-yet-durable edit exists) or clear the draft that edit
  // still needs (see _saveGeneration's own comment above).
  const myGeneration = _saveGeneration;

  // Re-check permissions at execution time, not only when input occurred.
  // A save may have been queued before another device locked the room, switched
  // this client to read-only, or enabled encryption without this client having
  // the key. In those cases the queued save must not write stale/plaintext data.
  if (!canEdit()) {
    _onStatusChange('saved');
    _saveStatus = 'saved';
    return;
  }

  try {
    let content = _getEditorVal();
    if (_encryptFn) content = await _encryptFn(content);
    await saveContent(_roomId, content);
    if (_saveGeneration === myGeneration) {
      clearDraft(_roomId);
      _onStatusChange('saved');
      _saveStatus = 'saved';
    }
    _maybeSnapshot(content);
  } catch {
    if (_saveGeneration === myGeneration) {
      _onStatusChange('error');
      _saveStatus = 'error';
    }
  }
}, SAVE_DEBOUNCE_MS);

// Version-history snapshot, throttled to SNAPSHOT_THROTTLE_MS. Best-effort —
// a failed snapshot must never surface as a save error to the user, since the
// durable room content already saved successfully above.
function _maybeSnapshot(content) {
  const now = Date.now();
  if (now - _lastSnapshotAt < SNAPSHOT_THROTTLE_MS) return;
  _lastSnapshotAt = now;
  saveRevision(_roomId, content).catch(() => {});
}

/**
 * Explicit, non-throttled snapshot of the editor's current content — call
 * right before a destructive action (Clear note, Start New / view-once
 * reset, template replace/append) so the pre-change content is preserved in
 * history even if the periodic throttle window hasn't elapsed yet.
 */
export async function snapshotBeforeDestructiveChange() {
  if (!_roomId) return;
  try {
    let content = _getEditorVal();
    if (_encryptFn) content = await _encryptFn(content);
    await saveRevision(_roomId, content);
    _lastSnapshotAt = Date.now();
  } catch { /* best-effort */ }
}

// ── Remote: broadcast typing from another device ──────────────────────────────

export async function handleRemoteTyping(payload) {
  if (_applyingRemote) return;
  if (_mustIgnoreEncryptedRemote()) return;

  // Realtime typing is metadata-only. Remote content must arrive via DB changes.
  if (payload?.ts) _pendingRemoteTimestamp = payload.ts;
}

export function handleRemoteLiveContent(payload) {
  if (_applyingRemote) return;
  if (_mustIgnoreEncryptedRemote()) return;
  if (!canReceiveLiveContent()) return;
  if (!payload || payload.type !== 'content_live') return;
  if (typeof payload.content !== 'string') return;
  if (payload.content.length > LIVE_CONTENT_BROADCAST_MAX_CHARS) return;
  if (_isLocallyActive()) {
    _pendingRemoteContent = payload.content;
    _pendingRemoteTimestamp = payload.ts || null;
    _onPendingRemote(payload.content, 'live');
    return;
  }
  _applyContentSafe(payload.content);
  _onDismissPending();
}

// ── Reconnect reconciliation ───────────────────────────────────────────────────

/**
 * Reconcile with the server immediately after coming back online, BEFORE
 * flushing the queued debounced save.
 *
 * Supabase Realtime does not replay postgres_changes events that were missed
 * while a client's socket was disconnected — so a reconnect that just calls
 * flushSave() unconditionally can silently overwrite an edit another device
 * made during the outage, with no conflict prompt (unlike the live-typing
 * conflict path in handleRemoteDatabaseChange, which never sees this update
 * because it never arrives). Callers must loadRoom() fresh (a plain fetch,
 * bypassing Realtime entirely) and pass the result here first.
 *
 * Deliberately does NOT use the `_isLocallyActive()` 3 s idle window that
 * handleRemoteDatabaseChange() uses — an offline gap can be arbitrarily
 * longer than that window, so it can't be trusted to gate this decision.
 * Instead, any actual content divergence always routes through the same
 * pending-remote conflict prompt; an unchanged room just flushes normally.
 * @param {object|null} freshRoom  – the room row as returned by loadRoom()
 */
export async function reconcileAfterReconnect(freshRoom) {
  if (!_roomId || !freshRoom || freshRoom.updated_by_device === getDeviceId()) {
    _debouncedSave.flush?.();
    return;
  }
  if (_mustIgnoreEncryptedRemote()) { _debouncedSave.flush?.(); return; }

  let remoteText = freshRoom.content || '';
  if (_decryptFn && remoteText) {
    try { remoteText = await _decryptFn(remoteText); }
    catch { _debouncedSave.flush?.(); return; }
  }

  if (remoteText === _getEditorVal()) { _debouncedSave.flush?.(); return; }

  _debouncedSave.cancel?.();
  _pendingRemoteContent   = remoteText;
  _pendingRemoteTimestamp = freshRoom.updated_at || null;
  _onPendingRemote(remoteText, 'db');
}

// ── Remote: Postgres DB change ────────────────────────────────────────────────

export async function handleRemoteDatabaseChange(newRoom) {
  if (_applyingRemote) return;
  if (_mustIgnoreEncryptedRemote()) return;

  if (newRoom.updated_by_device === getDeviceId()) return;

  let remoteText = newRoom.content || '';
  if (_decryptFn && remoteText) {
    try { remoteText = await _decryptFn(remoteText); }
    catch { return; }
  }

  // Do not reject DB updates by comparing server updated_at to local Date.now().
  // Client clocks can drift; we only ignore our own writes via updated_by_device.

  if (_isLocallyActive()) {
    _pendingRemoteContent   = remoteText;
    _pendingRemoteTimestamp = newRoom.updated_at || null;
    _onPendingRemote(remoteText, 'db');
  } else {
    _applyContentSafe(remoteText);
    _onDismissPending();
  }
}

// ── Apply / dismiss pending remote update ─────────────────────────────────────

export function applyPendingRemote() {
  if (_pendingRemoteContent === null) return;
  _applyContentSafe(_pendingRemoteContent);
  _clearPending();
}

export function dismissPendingRemote() {
  _clearPending();
  _onDismissPending();
}

/** Returns the current pending remote content (or null). */
export function getPendingRemote() {
  return _pendingRemoteContent;
}

export function getPendingRemoteTs() {
  return _pendingRemoteTimestamp;
}

function _clearPending() {
  _pendingRemoteContent   = null;
  _pendingRemoteTimestamp = null;
}

// ── Set content without triggering a local save ───────────────────────────────

/** Apply text to the editor while suppressing the local-edit flag. */
export function setContentNoSave(plaintext) {
  _applyingRemote = true;
  try { _setEditorVal(plaintext); }
  finally { _applyingRemote = false; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _isLocallyActive() {
  return (Date.now() - _localLastEditAt) < IDLE_THRESHOLD_MS;
}

function _mustIgnoreEncryptedRemote() {
  const ctx = getPermissionContext();
  return !!ctx.isEncryptedNoKey && !_decryptFn;
}

/** Internal alias — same semantics as the public setContentNoSave. */
const _applyContentSafe = setContentNoSave;
