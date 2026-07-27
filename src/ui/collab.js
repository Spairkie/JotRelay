// SyncPad – ui/collab.js
// Split from the former monolithic ui.js — see src/ui.js for the barrel.
import { countWords, formatTimestamp, escapeHtml } from '../utils.js';

// ── Cursor chat (Figma-style ephemeral message near a caret) ──────────────────
// Bubbles live in #cursor-chat-layer, a full-viewport fixed layer — see
// style.css. Never persisted; a bubble is just a DOM node with a timer.

const _cursorChatBubbles = new Map(); // device_id -> { el, timer, id }
let _cursorChatComposerEl = null;
const CURSOR_CHAT_EMOJI = ['👍', '❤️', '😂', '🎉', '👀'];

/**
 * Open a small inline input at `{x, y}` (viewport coordinates, e.g. from
 * LiveEditor.coordsAtPos()) for composing a cursor-chat message. Only one
 * composer at a time — opening a new one discards any other in progress.
 * @param {{x:number, y:number}} coords
 * @param {(text: string) => void} onSubmit – called with the trimmed text on Enter; not called on cancel.
 */
export function openCursorChatComposer(coords, onSubmit) {
  closeCursorChatComposer();
  const layer = document.getElementById('cursor-chat-layer');
  if (!layer) return;

  const wrap = document.createElement('div');
  wrap.className = 'cursor-chat-composer';
  wrap.style.left = `${coords.x}px`;
  wrap.style.top  = `${coords.y}px`;

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 80;
  input.placeholder = 'Say something…';
  input.setAttribute('aria-label', 'Cursor chat message');
  wrap.appendChild(input);
  layer.appendChild(wrap);
  _cursorChatComposerEl = wrap;
  input.focus();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      closeCursorChatComposer();
      if (text) onSubmit?.(text);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeCursorChatComposer();
    }
  });
  input.addEventListener('blur', () => closeCursorChatComposer());
}

export function closeCursorChatComposer() {
  // Removing a focused input can synchronously fire its own 'blur' handler
  // (which also calls this function) before .remove() returns — null the
  // reference out first so that re-entrant call sees nothing to do, instead
  // of racing to remove the same node twice.
  const el = _cursorChatComposerEl;
  _cursorChatComposerEl = null;
  el?.remove();
}

/**
 * Show (or replace) an ephemeral cursor-chat bubble from `deviceId`, fading
 * out on its own after ~5s. A second message from the same device before
 * the first fades replaces it and resets the timer, rather than stacking.
 * Hovering the bubble reveals a small emoji quick-react row (any visible
 * bubble — yours or a remote one — can be reacted to, matching cursor
 * chat's own no-permission-gate design since neither writes to the note).
 * @param {{deviceId: string, deviceName: string, text: string, x: number, y: number, id: string}} msg
 * @param {(id: string, emoji: string) => void} [onReact]
 */
export function showCursorChatBubble({ deviceId, deviceName, text, x, y, id }, onReact) {
  const layer = document.getElementById('cursor-chat-layer');
  if (!layer) return;

  const existing = _cursorChatBubbles.get(deviceId);
  if (existing) { clearTimeout(existing.timer); existing.el.remove(); }

  const el = document.createElement('div');
  el.className = 'cursor-chat-bubble';
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  el.innerHTML = `
    <span class="cursor-chat-bubble-name">${escapeHtml(deviceName || 'Someone')}</span>
    <span class="cursor-chat-bubble-text">${escapeHtml(text)}</span>
    <div class="cursor-chat-bubble-badges"></div>
    <div class="cursor-chat-bubble-reacts">
      ${CURSOR_CHAT_EMOJI.map((em) => `<button type="button" data-emoji="${em}" aria-label="React with ${em}">${em}</button>`).join('')}
    </div>`;
  el.querySelectorAll('.cursor-chat-bubble-reacts button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      addCursorChatReaction(id, emoji); // optimistic local echo — self:false means we never receive our own broadcast back
      onReact?.(id, emoji);
    });
  });
  layer.appendChild(el);

  const timer = setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { el.remove(); _cursorChatBubbles.delete(deviceId); }, 400);
  }, 5000);
  _cursorChatBubbles.set(deviceId, { el, timer, id });

  // The bubble itself is a purely visual, viewport-positioned element — a
  // screen reader has no way to discover it otherwise, so announce it
  // through the same live region presence typing/join events use.
  const region = document.getElementById('presence-live-region');
  if (region) region.textContent = `${deviceName || 'Someone'} says: ${text}`;
}

/**
 * Attach a fading emoji badge to whichever currently-visible bubble has
 * `targetId` — a no-op if that bubble already faded out locally (the
 * reaction has nothing left to attach to, and that's fine; it's as ephemeral
 * as the message itself).
 * @param {string} targetId
 * @param {string} emoji
 */
export function addCursorChatReaction(targetId, emoji) {
  const entry = [..._cursorChatBubbles.values()].find((b) => b.id === targetId);
  const badges = entry?.el.querySelector('.cursor-chat-bubble-badges');
  if (!badges) return;
  const badge = document.createElement('span');
  badge.className = 'cursor-chat-reaction-badge';
  badge.textContent = emoji;
  badges.appendChild(badge);
  setTimeout(() => {
    badge.classList.add('out');
    setTimeout(() => badge.remove(), 300);
  }, 2200);
}

/** Clear every cursor-chat bubble/composer immediately — used on room navigation. */
export function clearCursorChat() {
  for (const { el, timer } of _cursorChatBubbles.values()) { clearTimeout(timer); el.remove(); }
  _cursorChatBubbles.clear();
  closeCursorChatComposer();
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
 * Render small dot markers in the editor's margin, one per comment, so
 * comments are visible while scrolling instead of only discoverable by
 * opening the side panel. `dots` are already positioned (editor-wrap-
 * relative pixel Y) by the caller — app.js owns converting an anchor
 * offset to a Y coordinate, since that requires reaching into whichever
 * surface (textarea or LiveEditor) is currently visible, which this
 * module intentionally doesn't know about.
 * @param {{id: string, y: number, preview: string}[]} dots
 * @param {(id: string) => void} onJump
 */
export function renderCommentMargin(dots, onJump) {
  const layer = document.getElementById('comment-margin-layer');
  if (!layer) return;
  layer.innerHTML = '';
  (dots || []).forEach((d) => {
    const dot = document.createElement('button');
    dot.className = 'comment-dot';
    dot.style.top = `${d.y}px`;
    dot.type = 'button';
    dot.title = d.preview ? `Comment: "${d.preview}"` : 'Jump to comment';
    dot.setAttribute('aria-label', 'Jump to comment');
    dot.addEventListener('click', () => onJump?.(d.id));
    layer.appendChild(dot);
  });
}

