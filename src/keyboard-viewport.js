// JotRelay – keyboard-viewport.js
// Keeps the app's own bottom-anchored fixed UI (mobile action bar, the PWA
// install/update bars, toasts) — AND the actively-focused editor's own
// caret — above the on-screen keyboard on platforms where index.html's
// `interactive-widget=resizes-content` viewport hint has no effect —
// notably iOS Safari, which has no equivalent of it and never shrinks
// window.innerHeight for the keyboard. Also toggles body.keyboard-open
// (see the bottom of this file) so the bottom action bar can be hidden
// outright — not just repositioned — while any text surface is focused on
// mobile, reclaiming its footprint for the editor. Import for its side
// effects only — nothing here is exported.
//
// window.innerHeight stays fixed at the full (keyboard-including) screen
// height on those platforms, while window.visualViewport.height shrinks to
// the actually-visible area the instant the keyboard opens — the gap
// between the two is (approximately) how much of the bottom the keyboard
// now covers. Exposed as a live --kb-inset custom property rather than
// pushed into every affected element's own JS, so any current or future
// bottom-anchored fixed element can opt in with one CSS rule
// (`bottom: calc(<base> + var(--kb-inset, 0px))`) without this module
// needing to know about it. #app-screen itself pads its bottom by this same
// amount (see modals.css), which — through the editor's flex/grid "fill
// remaining height" chain (editor.css) — shrinks the actual editor box to
// stay above the keyboard too, not just the fixed UI.
//
// That CSS reflow alone isn't the whole fix, though: it's how NATIVE apps
// solve this too (iOS UIKit's keyboard-avoidance adjusts a scroll view's
// contentInset, shrinking its visible area) — but the second half of that
// native pattern is also re-scrolling the focused responder's frame into
// the now-smaller visible region, and neither a plain <textarea> nor
// CodeMirror 6 does that on its own just because an ancestor resized under
// it (their own "keep the caret visible" logic only runs on an actual
// selection/content change). Skipping that step is exactly the "only the
// bottom bar moves, the text you're typing doesn't" symptom — the box is
// correctly smaller, but whatever line the caret was on when the keyboard
// opened can still end up below it until the next keystroke's normal
// caret-follow catches up. _reflowCaretIntoView() below is that second
// step: re-trigger each surface's own native caret-visibility scroll
// against its current (post-resize) size, shortly after the resize settles.
import { scrollCaretIntoView as _scrollLiveCaretIntoView } from './live-editor.js';

if (window.visualViewport) {
  const root = document.documentElement;
  const _updateKeyboardInset = () => {
    const vv = window.visualViewport;
    // Pinch-zoom also shrinks visualViewport.height and shifts offsetTop —
    // indistinguishable from a keyboard using those two values alone. A
    // non-1 scale means the user is zoomed in, not (necessarily) facing a
    // keyboard; treat that as "no inset" rather than risk reflowing the
    // editor under a zoomed-in user's fingers as they pan, which would be
    // an accessibility regression for anyone relying on pinch-zoom.
    if (Math.abs(vv.scale - 1) > 0.01) {
      root.style.setProperty('--kb-inset', '0px');
      return;
    }
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--kb-inset', `${inset}px`);
  };

  let _reflowTimer = null;
  const _scheduleReflowCaretIntoView = () => {
    clearTimeout(_reflowTimer);
    // Long enough to clear #app-screen's own 0.15s padding-bottom
    // transition (modals.css) — nudging mid-transition would scroll
    // against a box size that's already stale a moment later, and the
    // keyboard's own open/close animation runs on a similar timescale.
    _reflowTimer = setTimeout(_reflowCaretIntoView, 180);
  };

  function _reflowCaretIntoView() {
    const active = document.activeElement;
    if (!active) return;

    if (active.id === 'note-editor') {
      // Re-applying the textarea's own current selection doesn't change
      // anything, but makes the browser re-run its native "keep the caret
      // visible" scroll against the textarea's current (post-resize) box
      // — the same trick used to nudge a textarea's internal scroll
      // programmatically since there's no direct "scroll to caret" API.
      try {
        active.setSelectionRange(active.selectionStart, active.selectionEnd, active.selectionDirection);
      } catch { /* selectionDirection unsupported on some input types — harmless no-op */ }
      return;
    }

    // The CM6 live surface (Preview/Split modes) — its own module knows
    // how to re-run its internal scroll-into-view; no-ops if unmounted or
    // unfocused.
    _scrollLiveCaretIntoView();
  }

  window.visualViewport.addEventListener('resize', () => { _updateKeyboardInset(); _scheduleReflowCaretIntoView(); });
  window.visualViewport.addEventListener('scroll', () => { _updateKeyboardInset(); _scheduleReflowCaretIntoView(); });
  _updateKeyboardInset();
}

// ── body.keyboard-open — reclaim the bottom action bar's footprint ─────────
// A separate signal from --kb-inset above, on purpose: --kb-inset is
// legitimately 0px whenever the platform's own interactive-widget=
// resizes-content viewport hint already shrinks the layout viewport for the
// keyboard (Android Chrome and friends) — correct for POSITIONING (nothing
// needs pushing up there), but that leaves no geometric gap to detect "the
// keyboard is open" on exactly those platforms. Focus entering a text
// surface is a reliable proxy on every mobile platform that matters here,
// regardless of which viewport-resize mechanism is in play — see
// modals.css's "KEYBOARD OPEN — MOBILE" rules for what this class does.
const MOBILE_BREAKPOINT_QUERY = '(max-width: 639px)';

function _isTextEditingElement(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const type = (el.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'color', 'image'].includes(type);
  }
  return !!el.isContentEditable;
}

document.addEventListener('focusin', (e) => {
  if (!_isTextEditingElement(e.target)) return;
  if (!window.matchMedia?.(MOBILE_BREAKPOINT_QUERY)?.matches) return;
  document.body.classList.add('keyboard-open');
});
document.addEventListener('focusout', (e) => {
  if (!_isTextEditingElement(e.target)) return;
  // Focus can move from one text surface straight to another (e.g. Tab
  // between fields) without the keyboard ever actually closing in between —
  // check on the next tick rather than removing the class immediately, so
  // that hop doesn't flash the action bar back in and out.
  setTimeout(() => {
    if (!_isTextEditingElement(document.activeElement)) {
      document.body.classList.remove('keyboard-open');
    }
  }, 50);
});

// ── Self-heal a stuck keyboard-open ─────────────────────────────────────
// focusout is this class's ONLY cleanup path above, and that's a real gap:
// removing a focused element from the DOM doesn't reliably fire it
// (inconsistent across browsers/mobile Safari — see
// closeFloatingCommentComposer()'s note in ui/collab.js, which works around
// it for one call site by blurring explicitly before removing). Android's
// back-button/gesture keyboard dismissal is a second, broader case with the
// same symptom: it's well documented that this closes the keyboard WITHOUT
// blurring the focused input at all, so no focusout ever fires there
// either. Either way the bottom action bar (and anything else gated by
// body.keyboard-open, see modals.css's "KEYBOARD OPEN — MOBILE" rules)
// stays hidden until something unrelated happens to blur/refocus a field
// correctly.
//
// Fix: cross-check against real geometry, which is reliable regardless of
// *why* the keyboard closed — a keyboard closing is fundamentally a
// viewport-size change, so it always raises a visualViewport (or window)
// resize even when no DOM focus event fires. Track the tallest viewport
// height seen at the current width (the no-keyboard baseline — mobile
// browser URL-bar auto-hide can also shrink the viewport, but only by
// ~50-100px, far less than a keyboard's 200px+), and treat a height back
// within a keyboard-sized margin of that peak as "the keyboard is actually
// closed," clearing the stuck class even though nothing ever blurred.
let _peakViewportHeight = 0;
let _peakViewportWidth  = 0;
let _lastViewportHeight = 0;
const KEYBOARD_HEIGHT_MARGIN = 150;

function _healStuckKeyboardOpen() {
  // Track the peak on every call, not just while keyboard-open is set — the
  // correct "no keyboard" baseline is only ever observed while the keyboard
  // genuinely isn't open, which is exactly when the class-gated early
  // return below would otherwise have skipped recording it, leaving no
  // real baseline to ever compare a later stuck-open state against.
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const w = window.innerWidth;
  if (w !== _peakViewportWidth) {
    // A width change (orientation flip) invalidates the old baseline, but
    // don't also run the heal check against it THIS call — if the keyboard
    // is still genuinely open post-rotation, its current (still-shrunk)
    // height would become the new "peak" and immediately measure as fully
    // recovered (delta 0), incorrectly clearing keyboard-open while the
    // keyboard is still on screen. Just reseed and wait for the next call.
    _peakViewportWidth = w; _peakViewportHeight = h; _lastViewportHeight = h;
    return;
  }
  if (h > _peakViewportHeight) _peakViewportHeight = h;
  // Only ever heal on a genuine recovery (height growing back), never on a
  // fresh shrink — otherwise a real keyboard shorter than the margin below
  // (landscape/split/floating keyboards can be under 150px) would measure
  // as "already recovered" the instant it opens, clearing keyboard-open on
  // a keyboard that's still genuinely up rather than only a stuck one.
  const isRecovering = h > _lastViewportHeight;
  _lastViewportHeight = h;

  if (!document.body.classList.contains('keyboard-open')) return;
  if (isRecovering && _peakViewportHeight - h < KEYBOARD_HEIGHT_MARGIN) {
    document.body.classList.remove('keyboard-open');
  }
}
window.addEventListener('resize', _healStuckKeyboardOpen);
if (window.visualViewport) window.visualViewport.addEventListener('resize', _healStuckKeyboardOpen);
_healStuckKeyboardOpen(); // seed the peak baseline immediately, not just on the first resize
