// tests/comments-mobile-composer-rotation.spec.js
// The floating comment composer's mobile-vs-desktop mode was captured only
// at open time. Rotating a phone from narrow portrait to a landscape width
// above the 639px breakpoint while composing left the element stuck with
// .comment-floating-composer-dock (whose positioning is entirely
// media-query-driven and stops applying once the viewport widens past it)
// and no inline left/top either (the desktop branch that sets those never
// ran, since the composer opened in mobile mode) — collapsing to unstyled
// placement near the layer's origin. Fixed by re-evaluating on a
// matchMedia 'change' event while the composer is open.
//
// window.matchMedia can't be resized by Playwright's real viewport APIs
// mid-test without a full page reload, so this stubs matchMedia the same
// way tests/mobile-keyboard.spec.js stubs visualViewport — a fake
// MediaQueryList whose .matches and change-event firing are driven
// directly, standing in for an actual device rotation.

import { test, expect } from '@playwright/test';

test('rotating past the mobile breakpoint while the composer is open re-docks it instead of leaving it unstyled', async ({ page }) => {
  await page.goto('/JotRelay/');

  const result = await page.evaluate(async () => {
    const listeners = [];
    const fakeMq = {
      matches: true, // starts mobile (narrow portrait)
      addEventListener: (type, fn) => { if (type === 'change') listeners.push(fn); },
      removeEventListener: (type, fn) => {
        const i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      },
    };
    const realMatchMedia = window.matchMedia;
    window.matchMedia = (q) => (q === '(max-width: 639px)' ? fakeMq : realMatchMedia(q));

    const UI = await import('/JotRelay/src/ui.js');
    UI.openFloatingCommentComposer({ x: 120, y: 300 }, () => {});

    const wrap = document.querySelector('.comment-floating-composer');
    const dockedInitially = wrap.classList.contains('comment-floating-composer-dock');
    const hadInlineCoordsInitially = !!wrap.style.left;

    // Simulate rotating past the breakpoint (now landscape, desktop rules apply).
    fakeMq.matches = false;
    listeners.forEach((fn) => fn());

    const dockedAfterRotate = wrap.classList.contains('comment-floating-composer-dock');
    const leftAfterRotate = wrap.style.left;
    const topAfterRotate = wrap.style.top;

    window.matchMedia = realMatchMedia;
    UI.closeFloatingCommentComposer();
    // The change listener must also be torn down on close — leaves nothing
    // to react if the fake dispatched another change after this point.
    const stillListening = listeners.length;

    return { dockedInitially, hadInlineCoordsInitially, dockedAfterRotate, leftAfterRotate, topAfterRotate, stillListening };
  });

  expect(result.dockedInitially).toBe(true);
  expect(result.hadInlineCoordsInitially).toBe(false);
  // After "rotating" past the breakpoint: no longer docked, and real
  // coordinates were applied instead of being left unset.
  expect(result.dockedAfterRotate).toBe(false);
  expect(result.leftAfterRotate).not.toBe('');
  expect(result.topAfterRotate).not.toBe('');
  expect(result.stillListening).toBe(0);
});
