// tests/tools-panel.spec.js
// The Tools panel's File section: "Copy Note" and "More Export Options",
// two quick actions added to make clipboard-copy and the richer Export modal
// reachable directly from Tools instead of only via keyboard shortcut,
// command palette, or the separate More > Export menu item.

import { test, expect } from '@playwright/test';
import { createRoom, openPanel, typeInEditor, waitForToast } from './helpers.js';

test.describe('Tools panel — File section', () => {
  test('Copy Note copies the editor content to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await createRoom(page);
    await typeInEditor(page, 'Hello from the Tools panel.');
    await openPanel(page, 'tools');

    await page.locator('#tool-copy').click();
    await waitForToast(page, /copied/i);

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('Hello from the Tools panel.');
  });

  test('More Export Options opens the Export modal', async ({ page }) => {
    await createRoom(page);
    await openPanel(page, 'tools');

    await page.locator('#tool-export-more').click();
    await expect(page.locator('#export-modal')).toBeVisible();
  });
});
