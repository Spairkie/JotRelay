// JotRelay – app/comments-preview.js
// Comments (side panel + floating margin dots/bubble/composer) and the
// Write/Preview/Split markdown-mode switch. These two areas are tightly
// coupled in the original design — switching modes must re-apply comment
// anchors to the (re)mounted live surface and recompute margin-dot
// positions, so they're kept in one module rather than forced apart.

import { debounce, wireCodeBlockCopyButtons } from '../utils.js';
import { listComments, addComment, deleteComment } from '../comments.js';
import { canEdit, canUseChecklist, editBlockedReason } from '../permissions.js';
import { encryptContent, decryptContent, looksEncrypted } from '../encryption.js';
import { renderMarkdown, toggleChecklistItem } from '../markdown.js';
import { setCursorLine } from '../presence.js';
import * as LiveEditor from '../live-editor.js';
import * as UI from '../ui.js';
import { state, _EDITOR_MODE_KEY } from './state.js';
import { _closeSlashMenu } from './editor-behavior.js';
import { _uploadAndInsertImages } from './files-panel.js';

// ── Comments ───────────────────────────────────────────────────────────────────

// Matches syncpad_room_comments' anchor_text_len_check constraint
// (0013_comment_anchor_text.sql). A selection longer than this just isn't
// tracked for auto-delete (see _pruneDeletedCommentAnchors) — an edge case
// (commenting on almost the whole document) not worth the fragility of
// comparing/storing a huge snapshot.
const ANCHOR_TEXT_MAX = 4000;

/** The selection range a new comment would attach to, in whichever surface
 *  (plain textarea or CM6 live surface) is currently active. */
export function _currentSelectionRange() {
  if (state.markdownMode !== 'write' && LiveEditor.isMounted()) {
    return LiveEditor.getSelection();
  }
  const editor = document.getElementById('note-editor');
  if (!editor) return null;
  return { from: editor.selectionStart, to: editor.selectionEnd };
}

export async function _openCommentsPanel() {
  UI.openPanel('comments-panel');
  const range = canEdit() ? _currentSelectionRange() : null;
  const pendingAnchor = range && Number.isFinite(range.from) && Number.isFinite(range.to) ? range : null;
  const anchorPreviewText = pendingAnchor ? UI.getEditorValue().slice(pendingAnchor.from, pendingAnchor.to) : '';
  UI.setCommentComposer({
    pendingAnchor,
    anchorPreviewText,
    onSubmit: (text, anchor) => _submitComment(text, anchor),
  });
  // Only the panel-open fetch shows the loading state — _refreshComments()
  // is also called from the realtime subscription and after submit/delete,
  // where the panel already has content on screen and a loading flash would
  // just be flicker, not useful signal (same reasoning as version history's
  // setHistoryLoading, scoped to its own panel-open path for the same reason).
  UI.setCommentLoading(true);
  try {
    await _refreshComments();
  } finally {
    UI.setCommentLoading(false);
  }
}

export async function _submitComment(text, anchor) {
  if (!canEdit()) { UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning'); return; }
  try {
    const payloadText = state.encKey ? await encryptContent(text, state.encKey) : text;
    // Snapshot of the anchored text itself, so a later edit can be detected
    // as "the commented text is gone" and the comment auto-deleted (see
    // _pruneDeletedCommentAnchors). Point comments (no selection, just a
    // cursor position) have nothing to snapshot.
    let anchorText;
    if (anchor.to > anchor.from) {
      const raw = UI.getEditorValue().slice(anchor.from, anchor.to);
      // Check the length of what actually gets stored, not the plaintext —
      // AES-GCM's IV+tag overhead and base64 expansion mean an encrypted
      // room's ciphertext can run well past the plaintext's own length, and
      // the DB's anchor_text_len_check constraint applies to that stored
      // value. Checking post-encryption avoids ever sending an insert that
      // the constraint would reject.
      const candidate = state.encKey ? await encryptContent(raw, state.encKey) : raw;
      if (candidate.length <= ANCHOR_TEXT_MAX) anchorText = candidate;
    }
    await addComment(state.roomId, { anchorFrom: anchor.from, anchorTo: anchor.to, text: payloadText, anchorText });
    await _refreshComments();
    UI.showToast('Comment added.', 'success');
  } catch {
    UI.showToast('Could not add comment. Has supabase/migrations/0003_room_comments.sql been run?', 'error', 5000);
  }
}

export async function _deleteCommentClick(c) {
  if (!canEdit()) { UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning'); return; }
  const ok = await UI.showConfirm('Delete this comment?', { confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  try {
    await deleteComment(c.id);
    await _refreshComments();
  } catch {
    UI.showToast('Could not delete comment.', 'error');
  }
}

function _scrollAndSelectComment(c) {
  if (state.markdownMode !== 'write' && LiveEditor.isMounted()) {
    LiveEditor.scrollToPos(c.anchor_from);
  } else {
    const editor = document.getElementById('note-editor');
    if (editor) { editor.focus(); UI.setEditorSelection(c.anchor_from, c.anchor_to); }
  }
}

/** Jump from the side-panel list: scroll to the anchor, expand its floating
 *  bubble, and close panels so the note (and the bubble) are visible. */
function _jumpToComment(c) {
  _scrollAndSelectComment(c);
  state.activeCommentId = c.id;
  UI.closeAllPanels();
  _refreshFloatingComments();
}

/** Toggle a dot's floating bubble open/closed — used when clicking a margin
 *  dot directly. Opening also re-selects the anchored text (like the old
 *  jump-on-click behavior), so a dot click is both "show me this comment"
 *  and "take me to what it's about"; closing leaves the selection alone. */
function _toggleCommentBubble(id) {
  const opening = state.activeCommentId !== id;
  state.activeCommentId = opening ? id : null;
  if (opening) {
    const c = state.lastComments.find((x) => x.id === id);
    if (c) _scrollAndSelectComment(c);
  }
  _refreshFloatingComments();
}

/** Tap on a `.cm-comment-anchor` span (touch devices only — see
 *  live-editor.js's _isCoarsePointer gate) resolved to a document position;
 *  find the comment whose range covers it and open its floating bubble.
 *  This is the mobile substitute for the hover-sized margin dots, which
 *  CSS hides on touch. */
function _onCommentAnchorTap(pos) {
  const c = state.lastComments.find((x) =>
    Number.isFinite(x.anchor_from) && Number.isFinite(x.anchor_to) &&
    pos >= x.anchor_from && pos < x.anchor_to
  );
  if (c) _toggleCommentBubble(c.id);
}

/** Cycle the expanded comment forward/back through the note's comments in
 *  anchor order — used by both the floating bubble's and the side panel's
 *  Prev/Next controls, so "navigate the comments" works the same from
 *  either entry point (the merged cursor-chat + comments feature's main
 *  "navigatable" requirement). Does not close panels, so it also works
 *  while browsing from the side panel. */
export function _navigateComment(direction) {
  if (!state.lastComments.length) return;
  const sorted = [...state.lastComments].sort((a, b) => (a.anchor_from ?? 0) - (b.anchor_from ?? 0));
  const curIdx = sorted.findIndex((c) => c.id === state.activeCommentId);
  const nextIdx = curIdx === -1
    ? (direction > 0 ? 0 : sorted.length - 1)
    : (curIdx + direction + sorted.length) % sorted.length;
  const next = sorted[nextIdx];
  if (!next) return;
  _scrollAndSelectComment(next);
  state.activeCommentId = next.id;
  _refreshFloatingComments(true);
}

export async function _refreshComments() {
  try {
    const comments = await listComments(state.roomId);
    const currentText = UI.getEditorValue();
    const withPreviews = await Promise.all(comments.map(async (c) => {
      let preview = c.text || '';
      if (looksEncrypted(preview)) {
        if (!state.encKey) { preview = null; }
        else {
          try { preview = await decryptContent(preview, state.encKey); }
          catch { preview = null; }
        }
      }
      const anchorPreview = Number.isFinite(c.anchor_from) && Number.isFinite(c.anchor_to) && c.anchor_to > c.anchor_from
        ? currentText.slice(c.anchor_from, c.anchor_to)
        : null;
      // Decrypted creation-time snapshot of the anchored text, for
      // _pruneDeletedCommentAnchors' "has this text since been deleted?"
      // comparison — distinct from anchorPreview above, which is a fresh
      // slice of the CURRENT text at the same (static) offsets. Gated on
      // the room's actual encryption state rather than looksEncrypted()'s
      // content-shape heuristic: anchor_text is always ciphertext in an
      // encrypted room and always plaintext otherwise, so using the
      // heuristic here risks misreading ordinary plaintext that happens to
      // resemble ciphertext (e.g. a hex/base64-shaped snippet) as
      // encrypted, nulling out a snapshot that never needed decrypting and
      // permanently disabling auto-delete for that one comment.
      let anchorSnapshot = c.anchor_text || null;
      if (anchorSnapshot != null && state.encKey) {
        try { anchorSnapshot = await decryptContent(anchorSnapshot, state.encKey); }
        catch { anchorSnapshot = null; }
      }
      return { ...c, _preview: preview, _anchorPreview: anchorPreview, _anchorSnapshot: anchorSnapshot };
    }));
    UI.renderCommentsList(withPreviews, {
      onDelete: _deleteCommentClick,
      onJump:   _jumpToComment,
      onReply:  canEdit() ? (text, anchor) => _submitComment(text, anchor) : undefined,
      canDelete: canEdit(),
    });
    state.lastComments = withPreviews;
    UI.setCommentCountBadge(withPreviews.length);
    // The active bubble's comment may have just been deleted (by this
    // device or another) — nothing left to keep expanded.
    if (state.activeCommentId && !withPreviews.some((c) => c.id === state.activeCommentId)) {
      state.activeCommentId = null;
    }
    LiveEditor.setCommentAnchors(withPreviews.map((c) => ({ id: c.id, from: c.anchor_from, to: c.anchor_to })));
    _refreshFloatingComments();
  } catch {
    // Best-effort — a project that hasn't run supabase/migrations/0003_room_comments.sql
    // yet just never shows any comments. See the subscribeToComments() call site.
  }
}

// ── Floating comments (margin dots + expandable bubble) ──────────────────────
// Small markers in the editor's margin at each comment's anchor line, so
// comments are visible — and, via the merged cursor-chat UI, addable and
// viewable — while scrolling instead of only through the side panel.
// Reuses the exact offset-to-pixel machinery the old cursor-chat composer
// needed: UI.getCaretViewportCoords() (mirror-div, Write mode) and
// LiveEditor.coordsAtPos() (CM6, Preview/Split), both viewport-relative —
// converted here to .editor-wrap-relative since that's what the dots/bubble
// are positioned against (see .comment-margin-layer's CSS).

export function _refreshFloatingComments(animate = false) {
  const wrap = document.querySelector('.editor-wrap');
  if (!wrap || !state.lastComments.length) { UI.renderFloatingComments([]); return; }

  const wrapTop = wrap.getBoundingClientRect().top;
  const live = state.markdownMode !== 'write' && LiveEditor.isMounted();

  const dots = state.lastComments
    .map((c) => {
      if (!Number.isFinite(c.anchor_from)) return null;
      // coordsAtPos() only resolves a position that's currently drawn —
      // fall back to the height-map-based estimate for a comment anchored
      // outside the current viewport, or its dot would silently vanish
      // instead of just showing (approximately) where scrolling would land.
      const coords = live
        ? (LiveEditor.coordsAtPos(c.anchor_from) || { y: LiveEditor.estimateViewportY(c.anchor_from) })
        : UI.getCaretViewportCoords(c.anchor_from);
      if (!coords || !Number.isFinite(coords.y)) return null;
      return {
        id: c.id, y: coords.y - wrapTop, preview: c._anchorPreview || '',
        author: c.device_name, createdAt: c.created_at, text: c._preview,
      };
    })
    .filter(Boolean);

  // Comments anchored to the same line (or close together) land at the same
  // margin-gutter Y — .comment-dot has no horizontal spread (CSS: fixed
  // `right: 6px`), so without this, one dot fully occludes the other and the
  // covered one becomes unclickable. Stack them with a minimum vertical gap
  // instead, in anchor order (dots is already in state.lastComments' order,
  // which is anchor position order).
  const DOT_MIN_GAP = 14;
  let _prevY = -Infinity;
  for (const d of dots) {
    if (d.y < _prevY + DOT_MIN_GAP) d.y = _prevY + DOT_MIN_GAP;
    _prevY = d.y;
  }

  UI.renderFloatingComments(dots, {
    activeId: state.activeCommentId,
    animate,
    onToggle: _toggleCommentBubble,
    onDelete: (id) => {
      const c = state.lastComments.find((x) => x.id === id);
      if (c) _deleteCommentClick(c);
    },
    onNavigate: _navigateComment,
    canDelete: canEdit(),
  });
}

// ── Preview helpers ───────────────────────────────────────────────────────────

// Which surface(s) are actually visible in each mode — the write/live pair
// each mode "owns" (Split shows both). Used below to figure out which
// surface, if any, is newly *entering* on a given mode switch: a surface
// that was already visible keeps its own scrollTop across the display:none
// toggle for free (it's never remounted, just hidden/shown), so only a
// surface that's about to appear for the first time needs its scroll
// position transferred in from wherever the user just was.
const _MODE_SURFACES = { write: ['write'], preview: ['live'], split: ['write', 'live'] };
function _enteringSurfaces(fromMode, toMode) {
  const before = new Set(_MODE_SURFACES[fromMode] || []);
  return (_MODE_SURFACES[toMode] || []).filter((s) => !before.has(s));
}

// The source char-offset at the exact top of whichever surface is actually
// visible for `mode` right now — null if there's nothing meaningful to
// capture (Live isn't mounted, e.g. the static-preview fallback, which has
// no offset-mapping of its own). Read *before* anything about the switch
// touches the DOM, since "what was the user looking at" only means
// something relative to the surface about to be hidden. Exported: also
// used by room-lifecycle.js's periodic/on-teardown save of the persisted
// last-scroll-position (src/scroll-memory.js) — same "what's the user
// looking at right now" question, just asked on a timer instead of at a
// mode switch.
export function _captureTopOffset(mode) {
  if (mode === 'write') {
    const editor = document.getElementById('note-editor');
    return editor ? UI.getWriteOffsetAtTop() : null;
  }
  return LiveEditor.isMounted() ? LiveEditor.getOffsetAtTop() : null;
}

/**
 * Single entry point for every Write/Preview/Split mode change. Preview and
 * Split's right pane use the Typora-style editable CM6 surface; if it fails
 * to mount for any reason the old rendered-HTML preview is the fallback.
 */
export function _applyMarkdownMode(mode) {
  // Scroll-position transfer: capture where the user was (as a source
  // char-offset, not a scroll percentage — a plain textarea and CM6's
  // rendered view don't map onto each other proportionally in any way that
  // reads as "the same place," see live-editor.js/scroll-rail.js's own
  // getOffsetAtTop()/getWriteOffsetAtTop()) before the switch changes what's
  // visible, and apply it to whichever surface(s) are about to appear —
  // see _enteringSurfaces() below the entry point using it, further down.
  const fromMode = state.markdownMode;
  const topOffset = _captureTopOffset(fromMode);
  const entering = _enteringSurfaces(fromMode, mode);

  // The floating comment composer is positioned in viewport coordinates
  // specific to whichever surface was visible when it opened (the Write
  // textarea or the CM6 live view) — any mode switch invalidates that
  // position, so clear before switching rather than float a stale composer.
  UI.clearFloatingComments();
  _closeSlashMenu(); // Write-mode-only feature — never valid to keep open across a mode switch
  state.markdownMode = mode;
  state.showPreview  = mode !== 'write';
  try { localStorage.setItem(_EDITOR_MODE_KEY, mode); } catch {}

  let live = false;
  if (mode === 'preview' || mode === 'split') {
    const container = document.getElementById('note-live');
    if (container) {
      try {
        if (!LiveEditor.isMounted()) {
          LiveEditor.mount(container, UI.getEditorValue(), {
            onChange: _onLiveEditorChange,
            onCursorActivity: _onLiveCursorActivity,
            onImageFiles: (files) => { if (canEdit()) _uploadAndInsertImages(files); },
            onCommentAnchorTap: _onCommentAnchorTap,
            readOnly: !canEdit(),
          });
          // CM6 persists across later mode switches (mount() is only called
          // once, guarded above), so this scroll listener only needs wiring
          // here, not on every switch into Preview/Split.
          container.querySelector('.cm-scroller')?.addEventListener('scroll', () => _refreshFloatingComments());
        } else {
          LiveEditor.syncFromText(UI.getEditorValue());
          LiveEditor.setReadOnly(!canEdit());
        }
        live = LiveEditor.isMounted();
        // setCommentAnchors() silently no-ops while unmounted, so the very
        // first mount (or a remount after room navigation) needs today's
        // comments re-applied now that there's a view to receive them —
        // _refreshComments() itself only runs on room load/realtime events,
        // neither of which necessarily follows a later mode switch.
        if (live) {
          LiveEditor.setCommentAnchors(state.lastComments.map((c) => ({ id: c.id, from: c.anchor_from, to: c.anchor_to })));
        }
      } catch { live = false; }
    }
  }

  UI.setMarkdownMode(mode, () => renderMarkdown(UI.getEditorValue()), { live, syncScroll: state.syncScroll });
  // Transfer the captured scroll position onto whichever surface(s) just
  // became visible — instant, no animation, so the surface is already
  // showing the right place the moment it's revealed rather than visibly
  // catching up to it. Write is synchronous (a plain textarea measures
  // correctly the instant display flips); Live goes through refreshLayout()
  // (see its own comment) since a freshly-revealed CM6 container needs a
  // moment to re-measure before scrollTop math against it is trustworthy —
  // container visibility just changed and mount() alone doesn't know that.
  if (topOffset != null && entering.includes('write')) UI.scrollWriteOffsetToTop(topOffset);
  if (live) LiveEditor.refreshLayout(topOffset != null && entering.includes('live') ? topOffset : undefined);
  if (state.showPreview && !live) _wirePreviewClickOnce();

  _updateScrollSyncWiring();

  _refreshFloatingComments();
}

/**
 * (Re)apply the CM6 (Live/Split) proportional scroll-sync wiring for the
 * current mode/setting. Split out from _applyMarkdownMode so the Sync scroll
 * settings toggle can re-evaluate it immediately without re-running the rest
 * of a full mode switch (which would needlessly re-sync CM6 from the
 * textarea, clear floating comments, etc.).
 */
export function _updateScrollSyncWiring() {
  if (state.markdownMode === 'split' && state.syncScroll && LiveEditor.isMounted()) {
    LiveEditor.wireScrollSync(document.getElementById('note-editor'));
  } else {
    LiveEditor.unwireScrollSync();
  }
}

// User edits in the live surface flow back through the textarea's normal
// input pipeline (save/broadcast/word count/snapshot) — the textarea stays
// the single source every other module reads.
function _onLiveEditorChange(text) {
  const editor = document.getElementById('note-editor');
  if (!editor || !canEdit()) return;
  UI.setEditorValue(text);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// Cursor/selection movement in the live surface broadcasts the same
// presence payload the textarea's keyup/mouseup path does — line for the
// devices list, precise offset(s) for in-text remote carets/selections.
function _onLiveCursorActivity(head, anchor) {
  const before = UI.getEditorValue().slice(0, head);
  const line   = (before.match(/\n/g) || []).length + 1;
  setCursorLine(line, head, anchor);
}

// Opens a floating composer right at the current selection (or caret, if
// nothing is selected) on whichever surface is actually visible: the CM6
// live surface (Preview/Split) via its own coordsAtPos(), or the plain
// Write-mode textarea via the mirror-div measurement in ui.js (LiveEditor
// stays mounted-but-hidden after switching back to Write mode, so
// isMounted() alone isn't enough — the surface has to actually be the
// visible one for its coordinates to mean anything). Submitting always
// persists a real anchored comment via _submitComment() — this is the same
// entry point the Comments panel composer and context-menu "Add comment"
// action use, just opened inline instead of in the side panel.
export function _openFloatingCommentComposer() {
  if (!canEdit()) { UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning'); return; }
  const range = _currentSelectionRange();
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return;
  const live = state.markdownMode !== 'write' && LiveEditor.isMounted();
  const coords = live ? LiveEditor.coordsAtPos(range.from) : UI.getCaretViewportCoords(range.from);
  if (!coords) return;
  UI.openFloatingCommentComposer(coords, (text) => _submitComment(text, range));
}

export function _refreshPreviewIfActive() {
  if (state.markdownMode !== 'write') UI.refreshPreview(() => renderMarkdown(UI.getEditorValue()));
}

// Debounced variant — used on every keystroke so heavy markdown docs
// (50 KB+) don't re-render on every character and cause frame drops.
export const _debouncedRefreshPreview = debounce(_refreshPreviewIfActive, 300);

// Editing text above a comment's anchor shifts its offset downstream, so
// margin dots need to be recomputed after edits too — debounced for the
// same reason as preview refresh above.
export const _debouncedRefreshFloatingComments = debounce(_refreshFloatingComments, 300);

// "If the commented text is deleted, the comment is deleted too" — Google
// Docs/Notion-style behavior. anchor_from/anchor_to are static DB offsets,
// never re-mapped against edits made elsewhere in the document, so they
// drift the moment anything before them is inserted or removed — comparing
// the snapshot against a slice taken at those (now stale) offsets would
// misfire on any unrelated edit, not just one that actually touches the
// commented text. Checking whether the snapshot still occurs ANYWHERE in
// the current document sidesteps that: an edit anywhere else leaves the
// commented text intact and findable, so nothing is deleted; only actually
// removing/changing that exact text makes it stop matching everywhere. The
// tradeoff is a comment can survive if identical text happens to exist
// elsewhere too — a false negative, and a much safer failure mode than
// deleting a comment whose text was never touched. A comment with no
// snapshot (point comment, selection too long to track, or created before
// this feature existed) is left alone rather than guessed at.
export async function _pruneDeletedCommentAnchors() {
  if (!state.lastComments.length) return;
  const currentText = UI.getEditorValue();
  const stale = state.lastComments.filter((c) => {
    if (c._anchorSnapshot == null) return false;
    if (!Number.isFinite(c.anchor_from) || !Number.isFinite(c.anchor_to) || c.anchor_to <= c.anchor_from) return false;
    return !currentText.includes(c._anchorSnapshot);
  });
  if (!stale.length) return;
  await Promise.all(stale.map((c) => deleteComment(c.id).catch(() => {})));
  await _refreshComments();
}

// Debounced so a comment isn't deleted mid-keystroke while its text is only
// transiently different (e.g. typing inside the anchored range) — only a
// settled edit triggers the delete.
export const _debouncedPruneDeletedCommentAnchors = debounce(_pruneDeletedCommentAnchors, 600);

function _wirePreviewClickOnce() {
  if (state.previewObserverWired) return;
  state.previewObserverWired = true;
  wireCodeBlockCopyButtons(document.getElementById('note-preview'));
  document.getElementById('note-preview')?.addEventListener('click', (e) => {
    const cb = e.target;
    if (!(cb instanceof HTMLInputElement) || cb.type !== 'checkbox') return;
    if (!canUseChecklist()) {
      e.preventDefault();
      UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning');
      cb.checked = !cb.checked; // revert visual change
      return;
    }
    const idx = Number(cb.dataset.cbIndex);
    if (!Number.isFinite(idx)) return;
    const updated = toggleChecklistItem(UI.getEditorValue(), idx, cb.checked);
    UI.setEditorValue(updated);
    document.getElementById('note-editor')?.dispatchEvent(new Event('input', { bubbles: true }));
    _refreshPreviewIfActive();
  });
}
