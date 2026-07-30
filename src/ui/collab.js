// SyncPad – ui/collab.js
// Split from the former monolithic ui.js — see src/ui.js for the barrel.
import { countWords, formatTimestamp, escapeHtml } from '../utils.js';

// ── Floating comment composer ───────────────────────────────────────────────
// A small inline input that opens right at the current selection/caret (the
// same "Figma cursor-chat" positioning this UI is built from), used by the
// comment FAB, the Ctrl+Shift+/ shortcut, and the editor context menu's "Add
// comment" action. Submitting always persists a real anchored comment —
// there's no separate ephemeral chat path anymore; comments' own realtime
// subscription (see comments.js/app.js) already shows new ones live to every
// connected device, without a redundant broadcast channel.
let _floatingComposerEl = null;

/**
 * @param {{x:number, y:number}} coords - viewport coordinates, e.g. from
 *   LiveEditor.coordsAtPos() or getCaretViewportCoords().
 * @param {(text: string) => void} onSubmit - called with the trimmed text on Enter; not called on cancel.
 */
export function openFloatingCommentComposer(coords, onSubmit) {
  closeFloatingCommentComposer();
  const layer = document.getElementById('comment-floating-layer');
  if (!layer) return;

  const wrap = document.createElement('div');
  wrap.className = 'comment-floating-composer';
  wrap.style.left = `${coords.x}px`;
  wrap.style.top  = `${coords.y}px`;

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 1000;
  input.placeholder = 'Add a comment…';
  input.setAttribute('aria-label', 'New comment');
  wrap.appendChild(input);
  layer.appendChild(wrap);
  _floatingComposerEl = wrap;
  input.focus();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      closeFloatingCommentComposer();
      if (text) onSubmit?.(text);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFloatingCommentComposer();
    }
  });
  input.addEventListener('blur', () => closeFloatingCommentComposer());
}

export function closeFloatingCommentComposer() {
  // Removing a focused input can synchronously fire its own 'blur' handler
  // (which also calls this function) before .remove() returns — null the
  // reference out first so that re-entrant call sees nothing to do, instead
  // of racing to remove the same node twice.
  const el = _floatingComposerEl;
  _floatingComposerEl = null;
  el?.remove();
}

/** Close the composer and collapse any expanded floating comment bubble
 *  immediately — used on room navigation. */
export function clearFloatingComments() {
  closeFloatingCommentComposer();
  renderFloatingComments([]);
}

// ── Remote update notice (4 actions: Apply / Keep mine / Copy remote / Dismiss) ─

export function showRemoteNotice({ onApply, onKeep, onCopy, onDismiss, localText, remoteText, remoteTs } = {}) {
  const el = document.getElementById('remote-notice');
  if (!el) return;
  el.classList.remove('hidden');

  // Populate meta line (time)
  const metaEl = document.getElementById('remote-notice-meta');
  if (metaEl) {
    if (remoteTs) {
      const ago = _relativeTime(remoteTs);
      metaEl.textContent = ago ? `· ${ago}` : '';
    } else {
      metaEl.textContent = '';
    }
  }

  // Populate word counts
  const countsEl = document.getElementById('remote-notice-counts');
  if (countsEl) {
    const localW  = localText  != null ? countWords(localText)  : null;
    const remoteW = remoteText != null ? countWords(remoteText) : null;
    if (localW != null && remoteW != null) {
      countsEl.textContent = `Your version: ${localW} words  ·  Incoming: ${remoteW} words`;
      countsEl.classList.remove('hidden');
    } else {
      countsEl.classList.add('hidden');
    }
  }

  const wire = (id, handler) => {
    const btn = el.querySelector(`#${id}`);
    if (!btn) return;
    btn.onclick = handler || null;
    btn.classList.toggle('hidden', !handler);
  };

  wire('remote-apply-btn',   onApply);
  wire('remote-keep-btn',    onKeep);
  wire('remote-copy-btn',    onCopy);
  wire('remote-dismiss-btn', onDismiss);
}

function _relativeTime(ts) {
  if (!ts) return '';
  // ts may be a Unix ms number (from live-broadcast) or an ISO string (from DB
  // updated_at). Coerce to ms so arithmetic doesn't produce NaN.
  const msTs  = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const diffMs = Date.now() - msTs;
  if (!isFinite(diffMs) || diffMs < 0) return 'just now';
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return `${Math.floor(diffMs / 3_600_000)}h ago`;
}

export function hideRemoteNotice() {
  document.getElementById('remote-notice')?.classList.add('hidden');
}

// ── Typing indicator ──────────────────────────────────────────────────────────

let _typingTimer = null;

export function showTypingIndicator(deviceName) {
  const el = document.getElementById('typing-indicator');
  if (!el) return;
  el.textContent = `${deviceName} is typing…`;
  el.classList.remove('hidden');
  document.getElementById('note-editor')?.classList.add('remote-typing');
  clearTimeout(_typingTimer);
  _typingTimer = setTimeout(hideTypingIndicator, 3500);
}

export function hideTypingIndicator() {
  clearTimeout(_typingTimer);
  document.getElementById('typing-indicator')?.classList.add('hidden');
  document.getElementById('note-editor')?.classList.remove('remote-typing');
}

// ── Comments ─────────────────────────────────────────────────────────────────

export function setCommentLoading(loading) {
  document.getElementById('comment-loading')?.classList.toggle('hidden', !loading);
}

/**
 * `pendingAnchor` is the range the next comment will be attached to (or
 * null when there's no usable selection/caret to anchor to — e.g. the
 * panel was opened before the editor ever had focus). `anchorPreviewText`
 * is a short snippet of the anchored text for the composer's own label.
 */
export function setCommentComposer({ pendingAnchor, anchorPreviewText, onSubmit } = {}) {
  const composer = document.getElementById('comment-composer');
  const hint     = document.getElementById('comment-composer-hint');
  const anchorEl = document.getElementById('comment-composer-anchor');
  const input    = document.getElementById('comment-composer-input');
  const btn      = document.getElementById('comment-composer-btn');
  if (!composer || !hint || !anchorEl || !input || !btn) return;

  if (!pendingAnchor) {
    composer.classList.add('hidden');
    hint.classList.remove('hidden');
    return;
  }
  hint.classList.add('hidden');
  composer.classList.remove('hidden');
  anchorEl.textContent = pendingAnchor.from === pendingAnchor.to
    ? 'On: cursor position (no text selected)'
    : `On: “${(anchorPreviewText || '').replace(/\s+/g, ' ').trim().slice(0, 80)}”`;
  input.value = '';

  btn.onclick = () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    onSubmit?.(text, pendingAnchor);
    input.value = '';
  };
}

/**
 * `comments` items: { id, created_at, device_id, device_name, anchor_from,
 * anchor_to, _preview, _anchorPreview }, where _preview is the caller's
 * already-decrypted (or plaintext) text — null if it couldn't be decrypted
 * (shown as a locked placeholder) — and _anchorPreview is a short snippet
 * of the anchored note text, if the caller could resolve one.
 */
export function renderCommentsList(comments, { onDelete, onJump, canDelete = true } = {}) {
  const list  = document.getElementById('comments-list');
  const empty = document.getElementById('comments-empty');
  if (!list) return;
  list.setAttribute('role', 'list');
  list.innerHTML = '';
  if (!comments?.length) { empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');

  comments.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'comment-item';
    item.setAttribute('role', 'listitem');
    const bodyHtml = c._preview == null
      ? '<span class="comment-text-locked">🔒 Encrypted — open with the passphrase to view</span>'
      : escapeHtml(c._preview);
    const anchorHtml = c._anchorPreview
      ? `<div class="comment-anchor-preview">On: "${escapeHtml(c._anchorPreview)}"</div>`
      : '';
    item.innerHTML = `
      <div class="comment-info">
        <div class="comment-meta">${escapeHtml(c.device_name || 'Someone')} · ${formatTimestamp(c.created_at)}</div>
        ${anchorHtml}
        <div class="comment-text">${bodyHtml}</div>
      </div>
      <div class="comment-actions">
        <button class="comment-jump-btn" title="Jump to this comment" aria-label="Jump to comment location"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg></button>
        ${canDelete ? '<button class="comment-delete-btn" title="Delete comment" aria-label="Delete comment"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>' : ''}
      </div>`;
    item.querySelector('.comment-jump-btn')?.addEventListener('click', () => onJump?.(c));
    item.querySelector('.comment-delete-btn')?.addEventListener('click', () => onDelete?.(c));
    list.appendChild(item);
  });
}

/**
 * Render floating comment markers in the editor's margin — one dot per
 * comment, so comments are visible while scrolling instead of only
 * discoverable by opening the side panel (this is the merged cursor-chat +
 * comments feature: comments are the single, persisted, floating, navigable
 * annotation type). Clicking a dot toggles an expanded bubble at that same
 * position showing the full comment (author/time/text) plus Prev/Next
 * navigation and delete, right where the annotation lives in the note
 * instead of only in the side panel list.
 *
 * `dots` are already positioned (editor-wrap-relative pixel Y) by the
 * caller — app.js owns converting an anchor offset to a Y coordinate, since
 * that requires reaching into whichever surface (textarea or LiveEditor) is
 * currently visible, which this module intentionally doesn't know about.
 *
 * @param {{id: string, y: number, preview: string, author: string, createdAt: string, text: string|null}[]} dots
 * @param {object} [opts]
 * @param {string|null} [opts.activeId] - which comment (if any) is expanded into a bubble
 * @param {(id: string) => void} [opts.onToggle] - dot clicked
 * @param {(id: string) => void} [opts.onDelete]
 * @param {(direction: 1|-1) => void} [opts.onNavigate]
 * @param {boolean} [opts.canDelete]
 * @param {boolean} [opts.animate] - true only for an explicit Prev/Next
 *   navigation, so the bubble slides to its new anchor; plain scroll/resize-
 *   triggered repositioning (the vast majority of calls) stays instant.
 */
export function renderFloatingComments(dots, { activeId, onToggle, onDelete, onNavigate, canDelete = true, animate = false } = {}) {
  const layer = document.getElementById('comment-margin-layer');
  if (!layer) return;

  // Dots are cheap and numerous, and don't need positional continuity
  // between themselves, so they're always rebuilt fresh.
  layer.querySelectorAll('.comment-dot').forEach((el) => el.remove());
  (dots || []).forEach((d) => {
    const dot = document.createElement('button');
    dot.className = 'comment-dot';
    dot.classList.toggle('active', d.id === activeId);
    dot.style.top = `${d.y}px`;
    dot.type = 'button';
    dot.title = d.preview ? `Comment: "${d.preview}"` : 'View comment';
    dot.setAttribute('aria-label', 'View comment');
    dot.addEventListener('click', () => onToggle?.(d.id));
    layer.appendChild(dot);
  });

  const active = (dots || []).find((d) => d.id === activeId);
  const existingBubble = layer.querySelector('.comment-floating-bubble');

  if (!active) {
    existingBubble?.remove();
    return;
  }

  // Reuse the existing bubble element (if there is one) instead of tearing
  // it down and rebuilding from scratch: navigating prev/next then animates
  // its position via the `top` transition on .comment-floating-bubble
  // (styles/editor.css) instead of jumping, and doesn't replay the one-time
  // "entering" animation on every click — only a genuinely new bubble
  // (first open, or reopened after being closed) gets that entrance.
  const bubble = existingBubble || document.createElement('div');
  // The transition-enabling class is only ever present for the specific
  // render call that asked for it — reset fresh here rather than toggled,
  // so a later scroll-triggered refresh (animate: false) never inherits it.
  bubble.className = `comment-floating-bubble${animate ? ' comment-bubble-navigating' : ''}`;
  bubble.style.top = `${active.y}px`;
  const bodyHtml = active.text == null
    ? '<span class="comment-text-locked">🔒 Encrypted — open with the passphrase to view</span>'
    : escapeHtml(active.text);
  bubble.innerHTML = `
    <div class="comment-floating-bubble-meta">${escapeHtml(active.author || 'Someone')} · ${formatTimestamp(active.createdAt)}</div>
    <div class="comment-floating-bubble-text">${bodyHtml}</div>
    <div class="comment-floating-bubble-actions">
      <button type="button" class="comment-nav-btn comment-nav-prev" aria-label="Previous comment">‹</button>
      <button type="button" class="comment-nav-btn comment-nav-next" aria-label="Next comment">›</button>
      ${canDelete ? '<button type="button" class="comment-delete-btn" aria-label="Delete comment" title="Delete comment"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>' : ''}
    </div>`;
  bubble.querySelector('.comment-nav-prev')?.addEventListener('click', () => onNavigate?.(-1));
  bubble.querySelector('.comment-nav-next')?.addEventListener('click', () => onNavigate?.(1));
  bubble.querySelector('.comment-delete-btn')?.addEventListener('click', () => onDelete?.(active.id));
  if (!existingBubble) layer.appendChild(bubble);
}

