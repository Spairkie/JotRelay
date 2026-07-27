// tests/shortcuts.spec.js
// Keyboard shortcuts must work identically whether focus is in the plain
// Write-mode textarea or the CM6 live surface (Preview/Split) — the latter
// is the default mode for new rooms. shortcuts.js used to compute "am I in
// the editor?" by comparing document.activeElement against a reference to
// the plain <textarea> captured once at init, so every Ctrl-based shortcut
// (formatting, Find, add comment, etc.) silently no-op'd whenever the live
// surface actually had focus. These specifically click into the live
// surface's contenteditable content before dispatching keys, so they'd have
// caught that regression.

import { test, expect } from '@playwright/test';
import { createRoom, typeInEditor, setEditorMode, getEditorContent } from './helpers.js';

test.describe('Keyboard shortcuts inside the CM6 live surface', () => {
  test('Ctrl+B bolds the selection when focus is in the live surface, not the Write textarea', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'hello world');
    await setEditorMode(page, 'preview');

    // Force real DOM focus into CM6's contenteditable content, then select
    // "hello" via keyboard so the selection lives in CM6, not the (now
    // hidden) plain textarea.
    await page.locator('.note-live .cm-content').click();
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');

    await page.keyboard.press('Control+b');
    expect(await getEditorContent(page)).toBe('**hello** world');
  });

  test('Ctrl+Shift+/ opens the floating comment composer when focus is genuinely in the live surface', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'some text here');
    await setEditorMode(page, 'preview');

    await page.locator('.note-live .cm-content').click();
    await page.keyboard.press('Control+Shift+/');
    await expect(page.locator('.comment-floating-composer input')).toBeVisible();
  });

  test('Ctrl+F opens Find & Replace when focus is in the live surface', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'find me please');
    await setEditorMode(page, 'preview');

    await page.locator('.note-live .cm-content').click();
    await page.keyboard.press('Control+f');
    await expect(page.locator('#search-panel')).toHaveClass(/open/);
  });
});

test.describe('Renamed Alt+Shift shortcuts (moved off browser-claimed Ctrl/Cmd+Shift combos)', () => {
  test('Alt+Shift+P toggles preview mode', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'toggle me');
    await expect(page.locator('.editor-wrap')).toHaveClass(/mode-write/);
    await page.keyboard.press('Alt+Shift+p');
    await expect(page.locator('.editor-wrap')).toHaveClass(/mode-preview/);
  });

  test('Alt+Shift+T inserts a timestamp in the Write textarea', async ({ page }) => {
    await createRoom(page);
    await page.locator('#note-editor').click();
    await page.keyboard.press('Alt+Shift+t');
    const value = await getEditorContent(page);
    expect(value.length).toBeGreaterThan(0);
  });

  test('Alt+Shift+C copies the note to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await createRoom(page);
    await typeInEditor(page, 'copy this note');
    await page.locator('#note-editor').click();
    await page.keyboard.press('Alt+Shift+c');
    await expect(page.locator('.toast')).toContainText(/copied/i);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('copy this note');
  });

  test('Alt+Shift+S opens the share modal', async ({ page }) => {
    await createRoom(page);
    await page.locator('#note-editor').click();
    await page.keyboard.press('Alt+Shift+s');
    await expect(page.locator('#share-modal')).toHaveClass(/visible/);
  });

  test('the old Ctrl+Shift+T/C/P/K combos no longer do anything app-specific', async ({ page }) => {
    // These are the browser/OS-claimed combos (reopen-closed-tab, inspect
    // element, private window, Firefox web console) the app used to shadow.
    // Confirm the app itself no longer intercepts them — it can't assert
    // anything about the browser's own behavior, only that our handlers
    // aren't wired to preventDefault() them anymore.
    await createRoom(page);
    await typeInEditor(page, 'unchanged');
    await page.locator('#note-editor').click();
    await page.keyboard.press('Control+Shift+t');
    await page.keyboard.press('Control+Shift+c');
    expect(await getEditorContent(page)).toBe('unchanged');
    await expect(page.locator('#share-modal')).not.toHaveClass(/visible/);
  });
});
