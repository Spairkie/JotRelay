// JotRelay – scroll-memory.js
// Per-room "remembered scroll position" — restores where the user left off
// on a return visit, but only when the room's content hasn't changed since
// (a remote edit from another device, or the room being cleared/reset,
// invalidates it — see loadScrollOffset()'s fingerprint check; a changed
// document falls back to the caller's own default of starting at the top,
// which is what a changed document should get anyway).
//
// Local-only, per device: a room link is anonymous and shared by design
// (see CLAUDE.md's "room_id alone is a sufficient write credential"), so a
// server-side "last scroll position" would just be one visitor's position
// overwriting everyone else's. Matches offline.js's own
// syncpad_draft_<roomId> localStorage key pattern.

const PREFIX = 'syncpad_scroll_';

// Cheap, non-cryptographic hash (FNV-1a) — this only needs to detect "did
// the content change at all," not resist tampering, and has to run on every
// debounced save/restore without being noticeable even at BODY_MAX
// (50,000 chars).
function _fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${h >>> 0}`;
}

/**
 * Persist `offset` (a source char-offset — see scroll-rail.js/live-editor.js's
 * getOffsetAtTop() family) for `roomId`, tagged with a fingerprint of `text`
 * so a later visit can tell whether the content it's about to restore into
 * still matches what was saved against.
 */
export function saveScrollOffset(roomId, text, offset) {
  if (!roomId || !Number.isFinite(offset)) return;
  try {
    localStorage.setItem(PREFIX + roomId, JSON.stringify({ offset, fingerprint: _fingerprint(text) }));
  } catch {}
}

/**
 * The remembered offset for `roomId`, or null if there's nothing saved, or
 * `text` doesn't match what was saved against (content changed since — the
 * caller's normal default, starting at the top, is the right fallback for
 * a changed document anyway).
 */
export function loadScrollOffset(roomId, text) {
  if (!roomId) return null;
  try {
    const raw = localStorage.getItem(PREFIX + roomId);
    if (!raw) return null;
    const { offset, fingerprint } = JSON.parse(raw);
    if (!Number.isFinite(offset) || fingerprint !== _fingerprint(text)) return null;
    return offset;
  } catch {
    return null;
  }
}

/** Called when a room's content is authoritatively reset (e.g. cleared) so
 *  a stale offset never gets a chance to matter — not strictly necessary
 *  (a mismatched fingerprint already falls back to null), but avoids
 *  leaving a dead entry in localStorage forever. */
export function clearScrollOffset(roomId) {
  if (!roomId) return;
  try { localStorage.removeItem(PREFIX + roomId); } catch {}
}
