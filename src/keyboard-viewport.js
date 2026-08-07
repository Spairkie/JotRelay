// SyncPad – keyboard-viewport.js
// Keeps the app's own bottom-anchored fixed UI (mobile action bar, the PWA
// install/update bars, toasts) above the on-screen keyboard on platforms
// where index.html's `interactive-widget=resizes-content` viewport hint has
// no effect — notably iOS Safari, which has no equivalent of it and never
// shrinks window.innerHeight for the keyboard. Import for its side effects
// only — nothing here is exported.
//
// window.innerHeight stays fixed at the full (keyboard-including) screen
// height on those platforms, while window.visualViewport.height shrinks to
// the actually-visible area the instant the keyboard opens — the gap
// between the two is (approximately) how much of the bottom the keyboard
// now covers. Exposed as a live --kb-inset custom property rather than
// pushed into every affected element's own JS, so any current or future
// bottom-anchored fixed element can opt in with one CSS rule
// (`bottom: calc(<base> + var(--kb-inset, 0px))`) without this module
// needing to know about it.
if (window.visualViewport) {
  const root = document.documentElement;
  const _updateKeyboardInset = () => {
    const vv = window.visualViewport;
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--kb-inset', `${inset}px`);
  };
  window.visualViewport.addEventListener('resize', _updateKeyboardInset);
  window.visualViewport.addEventListener('scroll', _updateKeyboardInset);
  _updateKeyboardInset();
}
