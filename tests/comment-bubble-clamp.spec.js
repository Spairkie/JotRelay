// tests/comment-bubble-clamp.spec.js
// renderFloatingComments() (ui/collab.js) positions the expanded comment
// bubble by centering it (via CSS translateY(-50%)) on its dot's y — with no
// clamping, a comment anchored near the very top/bottom of the visible
// editor pane rendered the bubble partly or fully outside .editor-wrap's own
// overflow:hidden edge, invisible exactly when a user clicks a dot near the
// edge of the screen to read it. UI.renderFloatingComments() is called
// directly with synthetic dot data (the same technique remote-selection.spec.js
// uses for LiveEditor.setRemoteCursors()) so this doesn't need a real room or
// Supabase — only #comment-margin-layer/#md-toolbar from the static app
// shell, which exist in the DOM regardless of route (just behind
// #app-screen's .hidden class on the landing page).

import { test, expect } from '@playwright/test';
import { goToLanding } from './helpers.js';

async function showAppScreen(page) {
  await page.evaluate(() => document.getElementById('app-screen').classList.remove('hidden'));
}

test.describe('Floating comment bubble vertical clamping', () => {
  test('a comment anchored at the very top of the pane keeps its bubble fully below the toolbar', async ({ page }) => {
    await goToLanding(page);
    await showAppScreen(page);

    await page.evaluate(async () => {
      const UI = await import('/JotRelay/src/ui.js');
      UI.renderFloatingComments(
        [{ id: 'c1', y: 2, preview: 'top comment', text: 'A comment anchored right at the top edge.', author: 'Alice', createdAt: Date.now() }],
        { activeId: 'c1' },
      );
    });

    const bubble = page.locator('.comment-floating-bubble');
    await expect(bubble).toBeVisible();

    const toolbarBottom = await page.evaluate(() => document.getElementById('md-toolbar').getBoundingClientRect().bottom);
    const bubbleBox = await bubble.boundingBox();
    expect(bubbleBox.y).toBeGreaterThanOrEqual(toolbarBottom - 1); // -1px slack for subpixel rounding
  });

  test('a comment anchored at the very bottom of the pane keeps its bubble fully within the editor card', async ({ page }) => {
    await goToLanding(page);
    await showAppScreen(page);

    await page.evaluate(async () => {
      const UI = await import('/JotRelay/src/ui.js');
      const layer = document.getElementById('comment-margin-layer');
      const farBottom = layer.clientHeight - 2;
      UI.renderFloatingComments(
        [{ id: 'c2', y: farBottom, preview: 'bottom comment', text: 'A comment anchored right at the bottom edge.', author: 'Bob', createdAt: Date.now() }],
        { activeId: 'c2' },
      );
    });

    const bubble = page.locator('.comment-floating-bubble');
    await expect(bubble).toBeVisible();

    const wrapBottom = await page.evaluate(() => document.querySelector('.editor-wrap').getBoundingClientRect().bottom);
    const bubbleBox = await bubble.boundingBox();
    expect(bubbleBox.y + bubbleBox.height).toBeLessThanOrEqual(wrapBottom + 1); // +1px slack for subpixel rounding
  });
});
