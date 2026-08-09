// JotRelay – footnote-popover.js
// Click/tap-to-toggle footnote preview popover, shared by the static
// preview (src/ui/editor.js) and the CM6 Live surface (src/live-editor.js)
// so the interaction — and its accessibility behavior — can't drift between
// the two renderers.
//
// Convention (matches littlefoot.js, the de-facto standard footnote-popover
// library, and the accessibility consensus for "disclosure with substantial
// interactive content"): triggered by click/Enter/Space, not hover — hover
// doesn't exist on touch, and this is a notes app used on phones as much as
// desktops. The trigger gets aria-expanded (a disclosure widget, not a
// role="tooltip" — ARIA tooltip content must be non-interactive, and this
// popover can contain links/code). Escape or an outside click/tap closes it
// and returns focus to the trigger.

let _open = null; // { trigger, el, cleanup }

function _closeOpen() {
  if (!_open) return;
  const { trigger, el, cleanup } = _open;
  cleanup();
  el.remove();
  trigger.setAttribute('aria-expanded', 'false');
  trigger.removeAttribute('aria-describedby');
  _open = null;
}

/**
 * Toggle a footnote popover anchored below `trigger`. Calling this again
 * for the same trigger closes it (true toggle); calling it for a different
 * trigger closes whichever popover was already open first.
 * @param {HTMLElement} trigger  the footnote reference element — gets
 *   aria-expanded/aria-describedby wired onto it
 * @param {string} html  the footnote's already-rendered, already-safe HTML
 *   (both callers pass their own trusted renderer's output — this module
 *   does no sanitizing of its own)
 */
export function toggleFootnotePopover(trigger, html) {
  if (_open?.trigger === trigger) { _closeOpen(); return; }
  _closeOpen();

  const el = document.createElement('div');
  el.className = 'footnote-popover';
  el.setAttribute('role', 'note');
  el.id = `footnote-popover-${Math.random().toString(36).slice(2)}`;
  el.innerHTML = html;
  el.tabIndex = -1;
  document.body.appendChild(el);

  const rect = trigger.getBoundingClientRect();
  el.style.top = `${rect.bottom + window.scrollY + 6}px`;
  el.style.left = `${rect.left + window.scrollX}px`;
  // Keep it on-screen horizontally — can only measure once it's in the DOM.
  const overflowRight = el.getBoundingClientRect().right - window.innerWidth + 12;
  if (overflowRight > 0) el.style.left = `${rect.left + window.scrollX - overflowRight}px`;

  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-describedby', el.id);

  const onKeydown = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    _closeOpen();
    trigger.focus();
  };
  const onDocMousedown = (e) => {
    if (trigger.contains(e.target) || el.contains(e.target)) return;
    _closeOpen();
  };
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onDocMousedown, true);

  _open = {
    trigger, el,
    cleanup: () => {
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('mousedown', onDocMousedown, true);
    },
  };
}

/** Close whichever footnote popover is currently open, if any — used when
 *  navigating away (room change, mode switch) so a stale popover can't be
 *  left pointing at a trigger that no longer exists. */
export function closeFootnotePopover() {
  _closeOpen();
}
