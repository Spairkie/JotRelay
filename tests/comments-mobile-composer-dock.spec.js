// tests/comments-mobile-composer-dock.spec.js
// The floating "Add a comment…" composer (opened by the FAB, Ctrl+Shift+/,
// or the context menu) positions itself at the caret's viewport coordinates
// at open time — but that snapshot is taken BEFORE input.focus() opens the
// on-screen keyboard, and never gets corrected afterward. A caret in the
// lower half of the screen then ends up overlapping the bottom action bar
// once the keyboard (and --kb-inset) actually show up. Fixed by docking to
// the bottom on mobile instead (see ui/collab.js's openFloatingCommentComposer
// and modals.css's .comment-floating-composer-dock), same treatment already
// applied to Find & Replace's #search-panel.

import { test, expect } from '@playwright/test';

test('mobile floating comment composer docks above the keyboard instead of at stale caret coords', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto('/SyncPad/');

  const result = await page.evaluate(async () => {
    const UI = await import('/SyncPad/src/ui.js');
    // Caret near the bottom of the (pre-keyboard) viewport — the exact
    // scenario from the bug report.
    UI.openFloatingCommentComposer({ x: 100, y: 600 }, () => {});

    const wrap = document.querySelector('.comment-floating-composer');
    const hasDockClass = wrap.classList.contains('comment-floating-composer-dock');
    const hasInlineTop = !!wrap.style.top;
    const style = getComputedStyle(wrap);
    const positionBeforeKeyboard = style.position;
    const bottomBeforeKeyboard = wrap.getBoundingClientRect().bottom;

    const actionBarVisible = getComputedStyle(document.querySelector('.mobile-action-bar')).display !== 'none';

    // Simulate the keyboard opening (what keyboard-viewport.js does on a
    // real device via window.visualViewport's resize event). The dock has
    // its own 150ms "bottom" transition (so it glides, not jumps, when the
    // keyboard's height changes) — wait it out before reading the result.
    document.documentElement.style.setProperty('--kb-inset', '300px');
    await new Promise((r) => setTimeout(r, 250));
    const bottomAfterKeyboard = wrap.getBoundingClientRect().bottom;

    document.documentElement.style.removeProperty('--kb-inset');
    UI.closeFloatingCommentComposer?.();

    return { hasDockClass, hasInlineTop, positionBeforeKeyboard, bottomBeforeKeyboard, bottomAfterKeyboard, actionBarVisible };
  });

  expect(result.hasDockClass).toBe(true);
  expect(result.hasInlineTop).toBe(false);
  expect(result.positionBeforeKeyboard).toBe('fixed');
  // The action bar must be hidden while the composer is open (its footprint reclaimed).
  expect(result.actionBarVisible).toBe(false);
  // Once --kb-inset simulates a 300px keyboard, the composer's bottom edge
  // must rise by roughly that amount (stays glued above the keyboard).
  expect(result.bottomBeforeKeyboard - result.bottomAfterKeyboard).toBeGreaterThan(250);
});
