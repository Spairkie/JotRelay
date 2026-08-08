// tests/comments-mobile.spec.js
// Tap-to-view a comment's anchored text on touch devices (see live-editor.js's
// _isCoarsePointer-gated mousedown handler and comments-preview.js's
// _onCommentAnchorTap). The margin dot/bubble system (comment-dot) is CSS-
// hidden on touch — this is the substitute affordance, so it's tested
// directly against the CM6 module rather than through a real room (Supabase
// is unreachable in this sandbox — see tests/comments.spec.js's own
// "Comment threads" block for the same standalone-import pattern).

import { test, expect } from '@playwright/test';

test.describe('Comment anchor tap-to-view', () => {
  test('tapping a commented span on a coarse-pointer (touch) device reports the tapped position', async ({ page }) => {
    await page.goto('/SyncPad/');
    const result = await page.evaluate(async () => {
      const origMatchMedia = window.matchMedia;
      window.matchMedia = (q) => ({ matches: true, media: q, addListener() {}, removeListener() {} });

      const LiveEditor = await import('/SyncPad/src/live-editor.js');
      const container = document.createElement('div');
      document.body.appendChild(container);

      let tappedPos = null;
      LiveEditor.mount(container, 'Hello world, this is commented text.', {
        onChange: () => {},
        onCommentAnchorTap: (pos) => { tappedPos = pos; },
      });
      LiveEditor.setCommentAnchors([{ id: 'c1', from: 6, to: 11 }]); // "world"
      await new Promise((r) => setTimeout(r, 50));

      const span = container.querySelector('.cm-comment-anchor');
      if (span) {
        const rect = span.getBoundingClientRect();
        span.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        }));
      }

      window.matchMedia = origMatchMedia;
      LiveEditor.destroy();
      container.remove();
      return { foundSpan: !!span, tappedPos };
    });
    expect(result.foundSpan).toBe(true);
    expect(result.tappedPos).not.toBeNull();
    // Tapped somewhere inside the "world" anchor range [6, 11).
    expect(result.tappedPos).toBeGreaterThanOrEqual(6);
    expect(result.tappedPos).toBeLessThan(11);
  });

  test('tapping the same span on a fine-pointer (mouse) device does not intercept the click', async ({ page }) => {
    await page.goto('/SyncPad/');
    const result = await page.evaluate(async () => {
      // No matchMedia override — desktop Chromium reports pointer:fine,
      // hover:hover by default, so _isCoarsePointer() should read false.
      const LiveEditor = await import('/SyncPad/src/live-editor.js');
      const container = document.createElement('div');
      document.body.appendChild(container);

      let tappedPos = null;
      LiveEditor.mount(container, 'Hello world, this is commented text.', {
        onChange: () => {},
        onCommentAnchorTap: (pos) => { tappedPos = pos; },
      });
      LiveEditor.setCommentAnchors([{ id: 'c1', from: 6, to: 11 }]);
      await new Promise((r) => setTimeout(r, 50));

      const span = container.querySelector('.cm-comment-anchor');
      if (span) {
        const rect = span.getBoundingClientRect();
        span.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        }));
      }

      LiveEditor.destroy();
      container.remove();
      return { foundSpan: !!span, tappedPos };
    });
    expect(result.foundSpan).toBe(true);
    expect(result.tappedPos).toBeNull();
  });

  test('a real touch pointerdown is honored even when the device reports a fine primary pointer (hybrid touchscreen laptop)', async ({ page }) => {
    await page.goto('/SyncPad/');
    const result = await page.evaluate(async () => {
      // No matchMedia override — simulates a hybrid device where (pointer:
      // fine) / (hover: hover) both hold (mouse is the primary pointer),
      // but THIS interaction is a genuine finger tap on the touchscreen.
      const LiveEditor = await import('/SyncPad/src/live-editor.js');
      const container = document.createElement('div');
      document.body.appendChild(container);

      let tappedPos = null;
      LiveEditor.mount(container, 'Hello world, this is commented text.', {
        onChange: () => {},
        onCommentAnchorTap: (pos) => { tappedPos = pos; },
      });
      LiveEditor.setCommentAnchors([{ id: 'c1', from: 6, to: 11 }]); // "world"
      await new Promise((r) => setTimeout(r, 50));

      const span = container.querySelector('.cm-comment-anchor');
      if (span) {
        const rect = span.getBoundingClientRect();
        const coords = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
        span.dispatchEvent(new PointerEvent('pointerdown', { ...coords, pointerType: 'touch' }));
        span.dispatchEvent(new MouseEvent('mousedown', coords));
      }

      LiveEditor.destroy();
      container.remove();
      return { foundSpan: !!span, tappedPos };
    });
    expect(result.foundSpan).toBe(true);
    expect(result.tappedPos).not.toBeNull();
    expect(result.tappedPos).toBeGreaterThanOrEqual(6);
    expect(result.tappedPos).toBeLessThan(11);
  });
});
