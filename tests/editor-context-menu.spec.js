// tests/editor-context-menu.spec.js
// Right-click context menu: clipboard (Cut/Copy/Paste), selection
// (Select all/Delete), and Add comment. Formatting actions (bold/italic/
// etc.) and the separate "Copy as plain text" action were removed from this
// menu — formatting is already one click away on the always-visible
// toolbar, and Copy itself is now context-aware (see _ctxCopy in
// editor-behavior.js) so a second plain-text-specific action is redundant.
//
// Playwright's synthetic right-click (page.mouse.click(..., {button:'right'}))
// doesn't reliably fire a real `contextmenu` DOM event across environments —
// dispatching one directly is the robust way to exercise this feature in tests
// (real browsers fire it reliably on an actual right-click; this only affects
// how the test simulates one).

import { test, expect } from '@playwright/test';
import { createRoom, typeInEditor, ensureWriteMode } from './helpers.js';

async function rightClickSelection(page, selectionStart, selectionEnd) {
  const editor = page.locator('#note-editor');
  // Set the selection and dispatch the contextmenu event in one atomic
  // evaluate() round-trip — splitting these across two separate calls
  // leaves a gap where something async (observed: unreliable specifically
  // for a read-only textarea) can intervene and reset selectionStart/End
  // back to the default before the second call's dispatch actually reads it.
  await editor.evaluate((el, [s, e]) => {
    el.selectionStart = s;
    el.selectionEnd = e;
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.x + 40, clientY: rect.y + 20 }));
  }, [selectionStart, selectionEnd]);
}

// Grants clipboard-read/write permission so Paste (navigator.clipboard.readText)
// and Copy (navigator.clipboard.writeText) actually round-trip in Chromium.
async function grantClipboardPermissions(context) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
}

test.describe('Editor selection context menu', () => {
  test('right-click with a selection shows the menu', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'hello selectable world');
    await rightClickSelection(page, 0, 5);
    await expect(page.locator('#editor-context-menu')).toHaveClass(/visible/);
  });

  test('right-click with no selection still shows the menu, with a reduced item set', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'hello world');
    await rightClickSelection(page, 0, 0);
    await expect(page.locator('#editor-context-menu')).toHaveClass(/visible/);
    // Selection-only actions are hidden when nothing is selected.
    await expect(page.locator('[data-ctx-action="cut"]')).toHaveClass(/hidden/);
    await expect(page.locator('[data-ctx-action="copy"]')).toHaveClass(/hidden/);
    // But actions that don't need a selection remain available.
    await expect(page.locator('[data-ctx-action="paste"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('[data-ctx-action="select-all"]')).not.toHaveClass(/hidden/);
  });

  test('Shift+right-click bypasses the custom menu', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'hello selectable world');
    const editor = page.locator('#note-editor');
    await editor.evaluate((el) => { el.selectionStart = 0; el.selectionEnd = 5; });
    await editor.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true, clientX: rect.x + 40, clientY: rect.y + 20 }));
    });
    await expect(page.locator('#editor-context-menu')).not.toHaveClass(/visible/);
  });

  test('a touchscreen long-press does not open the custom menu (defers to native selection UI)', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'hello selectable world');
    const editor = page.locator('#note-editor');
    // A real long-press fires `pointerdown` (pointerType: 'touch') before the
    // browser synthesizes `contextmenu` — reproduce that ordering directly,
    // since Playwright's synthetic contextmenu dispatch above doesn't carry
    // pointer type information the app-level handler could read from the
    // contextmenu event itself (see _wireEditorContextMenu, editor-behavior.js).
    await editor.evaluate((el) => {
      el.selectionStart = 0; el.selectionEnd = 5;
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: rect.x + 40, clientY: rect.y + 20 }));
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.x + 40, clientY: rect.y + 20 }));
    });
    await expect(page.locator('#editor-context-menu')).not.toHaveClass(/visible/);
  });

  test('a real mouse right-click after a touch interaction still opens the custom menu', async ({ page }) => {
    // Guards against the pointerType tracker getting stuck on 'touch' after
    // a hybrid device's touch interaction — a later genuine mouse
    // right-click (which fires its own pointerdown with pointerType:
    // 'mouse' before the contextmenu event, same as a real browser) must
    // still open the menu.
    await createRoom(page);
    await typeInEditor(page, 'hello selectable world');
    const editor = page.locator('#note-editor');
    await editor.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: rect.x + 10, clientY: rect.y + 10 }));
    });
    await editor.evaluate((el) => {
      el.selectionStart = 0; el.selectionEnd = 5;
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: rect.x + 40, clientY: rect.y + 20 }));
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.x + 40, clientY: rect.y + 20 }));
    });
    await expect(page.locator('#editor-context-menu')).toHaveClass(/visible/);
  });

  test('Add comment opens the floating composer at the selection', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'another selection here');
    await rightClickSelection(page, 8, 17); // "selection"
    await page.locator('[data-ctx-action="comment"]').click();
    await expect(page.locator('.comment-floating-composer input')).toBeVisible();
  });

  test('Escape closes the menu', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'hello world');
    await rightClickSelection(page, 0, 5);
    await expect(page.locator('#editor-context-menu')).toHaveClass(/visible/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor-context-menu')).not.toHaveClass(/visible/);
  });

  test('clicking outside the menu closes it without applying anything', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'hello world');
    await rightClickSelection(page, 0, 5);
    await expect(page.locator('#editor-context-menu')).toHaveClass(/visible/);
    await page.locator('.app-footer').click();
    await expect(page.locator('#editor-context-menu')).not.toHaveClass(/visible/);
    await expect(page.locator('#note-editor')).toHaveValue('hello world');
  });
});

test.describe('Editor context menu — clipboard actions', () => {
  test('Cut removes the selection and copies it to the clipboard', async ({ page, context }) => {
    await grantClipboardPermissions(context);
    await createRoom(page);
    await typeInEditor(page, 'hello selectable world');
    await rightClickSelection(page, 6, 16); // "selectable"
    await page.locator('[data-ctx-action="cut"]').click();
    await expect(page.locator('#note-editor')).toHaveValue('hello  world');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('selectable');
  });

  test('Copy leaves the text unchanged and copies the selection', async ({ page, context }) => {
    await grantClipboardPermissions(context);
    await createRoom(page);
    await typeInEditor(page, 'hello selectable world');
    await rightClickSelection(page, 0, 5);
    await page.locator('[data-ctx-action="copy"]').click();
    await expect(page.locator('#note-editor')).toHaveValue('hello selectable world');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('hello');
  });

  test('Paste inserts clipboard text at the caret', async ({ page, context }) => {
    await grantClipboardPermissions(context);
    await createRoom(page);
    await typeInEditor(page, 'hello world');
    await page.evaluate(() => navigator.clipboard.writeText('PASTED'));
    // Caret at position 5 (end of "hello"), no selection.
    await rightClickSelection(page, 5, 5);
    await page.locator('[data-ctx-action="paste"]').click();
    await expect(page.locator('#note-editor')).toHaveValue('helloPASTED world');
  });

  test('Paste replaces an active selection', async ({ page, context }) => {
    await grantClipboardPermissions(context);
    await createRoom(page);
    await typeInEditor(page, 'hello world');
    await page.evaluate(() => navigator.clipboard.writeText('there'));
    await rightClickSelection(page, 6, 11); // "world"
    await page.locator('[data-ctx-action="paste"]').click();
    await expect(page.locator('#note-editor')).toHaveValue('hello there');
  });
});

test.describe('Editor context menu — selection actions', () => {
  test('Select all selects the entire note', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'select everything please');
    await rightClickSelection(page, 0, 0);
    await page.locator('[data-ctx-action="select-all"]').click();
    const sel = await page.locator('#note-editor').evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd }));
    expect(sel).toEqual({ start: 0, end: 'select everything please'.length });
  });

  test('Delete removes the selection without touching the clipboard', async ({ page, context }) => {
    await grantClipboardPermissions(context);
    await createRoom(page);
    await page.evaluate(() => navigator.clipboard.writeText('untouched'));
    await typeInEditor(page, 'hello selectable world');
    await rightClickSelection(page, 6, 16); // "selectable"
    await page.locator('[data-ctx-action="delete"]').click();
    await expect(page.locator('#note-editor')).toHaveValue('hello  world');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('untouched');
  });
});

test.describe('Editor context menu — read-only viewers', () => {
  test('read-only viewers see Copy/Select all but not Cut/Paste/Delete', async ({ page }) => {
    const roomId = await createRoom(page);
    await typeInEditor(page, 'read only content here');
    // The Postgres write is debounced 1s behind typing (src/sync.js); without
    // waiting for it, the share link below is created and the page navigated
    // away before the save lands, so the freshly-loaded read-only view sees
    // whatever the room's body was before this test typed into it (empty for
    // a brand-new room) instead of 'read only content here'.
    await expect(page.locator('#status-text')).toHaveText('Saved', { timeout: 5000 });
    const shareUrl = await page.evaluate(async () => {
      const { getOrCreateReadOnlyShareLink } = await import('/JotRelay/src/rooms.js');
      const roomIdFromUrl = location.pathname.split('/').filter(Boolean).pop();
      const link = await getOrCreateReadOnlyShareLink(roomIdFromUrl);
      return link?.token;
    });
    test.skip(!shareUrl, 'read-only share links require the optional share-link migration');
    await page.goto(`/JotRelay/share/${shareUrl}`);
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    // This is a real page reload (not a client-side route change), so
    // wireEvents() — including the contextmenu listener — runs fresh here
    // and must be waited for, same as createRoom() already does.
    await page.waitForFunction(() => window.__jotrelayEventsWired === true, null, { timeout: 5000 });
    await ensureWriteMode(page);
    await rightClickSelection(page, 0, 4);
    await expect(page.locator('#editor-context-menu')).toHaveClass(/visible/);
    await expect(page.locator('[data-ctx-action="copy"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('[data-ctx-action="select-all"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('[data-ctx-action="cut"]')).toHaveClass(/hidden/);
    await expect(page.locator('[data-ctx-action="paste"]')).toHaveClass(/hidden/);
    await expect(page.locator('[data-ctx-action="delete"]')).toHaveClass(/hidden/);
  });
});
