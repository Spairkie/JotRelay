// JotRelay – ui/collab.js
// Split from the former monolithic ui.js — see src/ui.js for the barrel.
import { countWords, formatTimestamp, escapeHtml, relativeTimeShort } from '../utils.js';

// ── Floating comment composer ───────────────────────────────────────────────
// A small inline input that opens right at the current selection/caret (the
// same "Figma cursor-chat" positioning this UI is built from), used by the
// comment FAB, the Ctrl+Shift+/ shortcut, and the editor context menu's "Add
// comment" action. Submitting always persists a real anchored comment —
// there's no separate ephemeral chat path anymore; comments' own realtime
// subscription (see comments.js/app.js) already shows new ones live to every
// connected device, without a redundant broadcast channel.
let _floatingComposerEl = null;
let _floatingComposerCleanupMq = null;

// Positions `wrap` for the desktop (caret-relative) path — coords is the
// raw caret position and, combined with the CSS translate(-8px,-100%)
// anchor, can place the composer partly or fully off-screen, most easily
// on narrow phones where the editor spans nearly the full viewport width.
// Nudges left/top back on-screen using the actual rendered box. Factored
// out of openFloatingCommentComposer() so the viewport-change handler
// below can re-run the exact same placement after switching INTO the
// desktop mode from the mobile dock, not just at initial open.
function _positionFloatingComposerDesktop(wrap, coords) {
  wrap.style.left = `${coords.x}px`;
  wrap.style.top  = `${coords.y}px`;
  const margin = 8;
  const rect = wrap.getBoundingClientRect();
  let dx = 0, dy = 0;
  if (rect.left < margin) dx = margin - rect.left;
  else if (rect.right > window.innerWidth - margin) dx = (window.innerWidth - margin) - rect.right;
  if (rect.top < margin) dy = margin - rect.top;
  if (dx || dy) {
    wrap.style.left = `${coords.x + dx}px`;
    wrap.style.top  = `${coords.y + dy}px`;
  }
}

/**
 * @param {{x:number, y:number}} coords - viewport coordinates, e.g. from
 *   LiveEditor.coordsAtPos() or getCaretViewportCoords().
 * @param {(text: string) => void} onSubmit - called with the trimmed text on
 *   Enter or on blur (clicking/tabbing away saves whatever was typed,
 *   same as Enter); not called on Escape or an empty input.
 */
export function openFloatingCommentComposer(coords, onSubmit) {
  closeFloatingCommentComposer();
  const layer = document.getElementById('comment-floating-layer');
  if (!layer) return;

  const wrap = document.createElement('div');
  wrap.className = 'comment-floating-composer';

  // On narrow viewports this docks to the bottom via CSS (see modals.css)
  // instead of the caret-relative position below — coords.y is a snapshot
  // taken BEFORE input.focus() opens the on-screen keyboard, and never
  // gets corrected afterward, so a caret anywhere in the lower half of the
  // screen ends up placing the composer on top of the bottom action bar
  // once the keyboard (and --kb-inset) actually show up. The bottom dock
  // sidesteps the staleness entirely by not depending on a pre-keyboard
  // coordinate at all — same fix already applied to Find & Replace (see
  // #search-panel's mobile rules).
  const mq = window.matchMedia?.('(max-width: 639px)');
  if (mq?.matches) {
    wrap.classList.add('comment-floating-composer-dock');
  } else {
    wrap.style.left = `${coords.x}px`;
    wrap.style.top  = `${coords.y}px`;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'comment-floating-composer-input';
  input.name = 'comment-floating-composer-input';
  input.autocomplete = 'off';
  input.maxLength = 1000;
  input.placeholder = 'Add a comment…';
  input.setAttribute('aria-label', 'New comment');
  wrap.appendChild(input);
  layer.appendChild(wrap);
  _floatingComposerEl = wrap;

  if (!mq?.matches) _positionFloatingComposerDesktop(wrap, coords);

  // Re-evaluate mobile-vs-desktop mode if the viewport crosses the
  // breakpoint WHILE the composer is still open (e.g. rotating a phone
  // mid-composition) — the dock class's positioning is entirely
  // media-query-driven and simply stops applying once the viewport widens
  // past it, and the desktop branch above never runs (no inline left/top)
  // when the composer opened in mobile mode, so without this the composer
  // would fall back to unstyled placement near the layer's origin instead
  // of just relocating.
  const onViewportChange = () => {
    const nowMobile = !!mq?.matches;
    wrap.classList.toggle('comment-floating-composer-dock', nowMobile);
    if (nowMobile) {
      wrap.style.left = '';
      wrap.style.top = '';
    } else {
      _positionFloatingComposerDesktop(wrap, coords);
    }
  };
  mq?.addEventListener?.('change', onViewportChange);
  _floatingComposerCleanupMq = () => mq?.removeEventListener?.('change', onViewportChange);

  input.focus();

  // Reading the value and clearing it in the same step makes this safe to
  // call from both blur and Enter without a double-submit: whichever fires
  // first drains the input, so the other sees nothing left to send.
  const trySubmit = () => {
    const text = input.value.trim();
    input.value = '';
    if (text) onSubmit?.(text);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      trySubmit();
      closeFloatingCommentComposer();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = ''; // discard even unsaved text — not a "save on blur" case
      closeFloatingCommentComposer();
    }
  });
  input.addEventListener('blur', () => {
    trySubmit();
    closeFloatingCommentComposer();
  });
}

export function closeFloatingCommentComposer() {
  // Removing a focused input can synchronously fire its own 'blur' handler
  // (which also calls this function) before .remove() returns — null the
  // reference out first so that re-entrant call sees nothing to do, instead
  // of racing to remove the same node twice.
  const el = _floatingComposerEl;
  _floatingComposerEl = null;
  // Explicitly blur before removing rather than relying on removal itself
  // to reliably fire blur/focusout — inconsistent across browsers/mobile
  // Safari in particular — which would otherwise leave
  // keyboard-viewport.js's body.keyboard-open class stuck (its only
  // cleanup path is focusout) after Enter/Escape closes this composer.
  // .blur() on an element that isn't actually focused is a harmless no-op,
  // and trySubmit()'s clear-before-read pattern above already makes this
  // safe to trigger a second time from the resulting blur event.
  el?.querySelector('input')?.blur();
  el?.remove();
  _floatingComposerCleanupMq?.();
  _floatingComposerCleanupMq = null;
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
      const ago = relativeTimeShort(remoteTs);
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

/** Total comment count shown on the Comments tool button, so a room's
 *  discussion is discoverable without opening the panel first. */
export function setCommentCountBadge(count) {
  const badge = document.getElementById('comment-count-badge');
  if (!badge) return;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('hidden', !count);
}

/**
 * `pendingAnchor` is the range the next comment will be attached to (or
 * null when there's no usable selection/caret to anchor to — e.g. the
 * panel was opened before the editor ever had focus). `anchorPreviewText`
 * is a short snippet of the anchored text for the composer's own label.
 */
export function setCommentComposer({ pendingAnchor, anchorPreviewText, onSubmit } = {}) {
  const composer  = document.getElementById('comment-composer');
  const hint      = document.getElementById('comment-composer-hint');
  const anchorEl  = document.getElementById('comment-composer-anchor');
  const input     = document.getElementById('comment-composer-input');
  const btn       = document.getElementById('comment-composer-btn');
  const charcount = document.getElementById('comment-composer-charcount');
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
  const maxLen = input.maxLength > 0 ? input.maxLength : 1000;
  if (charcount) {
    charcount.textContent = `0 / ${maxLen}`;
    input.oninput = () => { charcount.textContent = `${input.value.length} / ${maxLen}`; };
  }

  // Reading + clearing the value in one step makes this safe to call from
  // both blur and the button click without a double-submit: whichever
  // fires first drains the textarea, so the other finds nothing to send.
  // Escape discards instead of saving, matching the floating composer.
  const trySubmit = () => {
    const text = input.value.trim();
    input.value = '';
    if (text) onSubmit?.(text, pendingAnchor);
  };
  input.onblur = () => trySubmit();
  input.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); input.value = ''; input.blur(); }
  };
  btn.onclick = () => { trySubmit(); input.focus(); };
}

/**
 * `comments` items: { id, created_at, device_id, device_name, anchor_from,
 * anchor_to, _preview, _anchorPreview }, where _preview is the caller's
 * already-decrypted (or plaintext) text — null if it couldn't be decrypted
 * (shown as a locked placeholder) — and _anchorPreview is a short snippet
 * of the anchored note text, if the caller could resolve one.
 */
/** Group comments sharing an exact anchor range into one feed-style thread,
 *  in the order each thread's first (oldest) comment was created — `comments`
 *  is already chronological (listComments() orders by created_at). */
function _groupIntoThreads(comments) {
  const threads = [];
  const byAnchor = new Map();
  for (const c of comments) {
    const key = `${c.anchor_from}:${c.anchor_to}`;
    let thread = byAnchor.get(key);
    if (!thread) {
      thread = { anchorFrom: c.anchor_from, anchorTo: c.anchor_to, anchorPreview: c._anchorPreview, messages: [] };
      byAnchor.set(key, thread);
      threads.push(thread);
    }
    thread.messages.push(c);
  }
  return threads;
}

/**
 * `comments` items: { id, created_at, device_id, device_name, anchor_from,
 * anchor_to, _preview, _anchorPreview }, where _preview is the caller's
 * already-decrypted (or plaintext) text — null if it couldn't be decrypted
 * (shown as a locked placeholder) — and _anchorPreview is a short snippet
 * of the anchored note text, if the caller could resolve one. Comments that
 * share an exact anchor render as one feed-style thread — a stack of
 * messages under a single "On: ..." header — with its own reply box, rather
 * than each repeating the same anchor as an independent top-level card.
 */
export function renderCommentsList(comments, { onDelete, onJump, onReply, canDelete = true } = {}) {
  const list  = document.getElementById('comments-list');
  const empty = document.getElementById('comments-empty');
  if (!list) return;
  list.setAttribute('role', 'list');
  list.innerHTML = '';
  if (!comments?.length) { empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');

  _groupIntoThreads(comments).forEach((thread) => {
    const threadEl = document.createElement('div');
    threadEl.className = 'comment-thread';
    threadEl.setAttribute('role', 'listitem');

    const anchorHtml = thread.anchorPreview
      ? `<div class="comment-anchor-preview">On: "${escapeHtml(thread.anchorPreview)}"</div>`
      : '<div class="comment-anchor-preview">On: cursor position</div>';
    const messagesHtml = thread.messages.map((c) => {
      const bodyHtml = c._preview == null
        ? '<span class="comment-text-locked">🔒 Encrypted — open with the passphrase to view</span>'
        : escapeHtml(c._preview);
      return `
        <div class="comment-thread-message" data-comment-id="${escapeHtml(c.id)}">
          <div class="comment-info">
            <div class="comment-meta">${escapeHtml(c.device_name || 'Someone')} · ${formatTimestamp(c.created_at)}</div>
            <div class="comment-text">${bodyHtml}</div>
          </div>
          ${canDelete ? '<button class="comment-delete-btn" title="Delete comment" aria-label="Delete comment"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>' : ''}
        </div>`;
    }).join('');

    threadEl.innerHTML = `
      <div class="comment-thread-head">
        ${anchorHtml}
        <button class="comment-jump-btn" title="Jump to this location" aria-label="Jump to comment location"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg></button>
      </div>
      <div class="comment-thread-messages">${messagesHtml}</div>
      ${onReply ? `<div class="comment-thread-reply">
        <input type="text" class="comment-thread-reply-input" maxlength="1000" placeholder="Reply…" aria-label="Reply to this thread" />
      </div>` : ''}`;

    threadEl.querySelector('.comment-jump-btn')?.addEventListener('click', () => onJump?.(thread.messages[0]));
    threadEl.querySelectorAll('.comment-thread-message').forEach((msgEl) => {
      const id = msgEl.dataset.commentId;
      const c = thread.messages.find((m) => String(m.id) === id);
      msgEl.querySelector('.comment-delete-btn')?.addEventListener('click', () => onDelete?.(c));
    });

    const replyInput = threadEl.querySelector('.comment-thread-reply-input');
    if (replyInput) {
      // Same save-on-blur pattern as the main composer: read + clear in one
      // step so blur and Enter can never double-submit, whichever fires first.
      const trySubmitReply = () => {
        const text = replyInput.value.trim();
        replyInput.value = '';
        if (text) onReply?.(text, { from: thread.anchorFrom, to: thread.anchorTo });
      };
      replyInput.addEventListener('blur', trySubmitReply);
      replyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); trySubmitReply(); }
        else if (e.key === 'Escape') { e.preventDefault(); replyInput.value = ''; replyInput.blur(); }
      });
    }

    list.appendChild(threadEl);
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

