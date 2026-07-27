// tests/comments.spec.js
// Comments — the merged cursor-chat + comments feature. A comment anchors to
// a text range and persists with the room (opt-in, cascades away with it —
// see supabase/migrations/0003_room_comments.sql). It can be added either
// from the Comments side panel, or from a floating composer opened right at
// the current selection — the add-comment FAB, Ctrl+Shift+/, or the editor
// context menu's "Add comment" action. A small dot in the editor's margin
// marks each comment; clicking it re-selects the anchored text and expands a
// floating bubble with the full text and Prev/Next navigation between
// comments, so comments are addable, viewable, and navigable without
// necessarily opening the side panel.

import { test, expect } from '@playwright/test';
import { createRoom, typeInEditor, getShareUrl } from './helpers.js';

/** Open the Tools panel, then the Comments panel from inside it. */
async function openCommentsPanel(page) {
  const toolsPanel = page.locator('#tools-panel');
  if (!await toolsPanel.evaluate(el => el.classList.contains('open'))) {
    await page.locator('#btn-more').click();
    await expect(page.locator('#more-dropdown')).toHaveClass(/open/, { timeout: 2000 });
    await page.locator('#btn-tools').click();
    await expect(toolsPanel).toHaveClass(/open/, { timeout: 3000 });
  }
  await page.locator('#tool-comments').click();
  await page.waitForSelector('#comments-panel.open', { timeout: 5000 });
}

/** Select a substring of the current editor value by character offsets. */
async function selectRange(page, from, to) {
  await page.locator('#note-editor').evaluate((el, [f, t]) => {
    el.focus();
    el.setSelectionRange(f, t);
  }, [from, to]);
}

/** Add a comment on `text` via the panel composer, then close the panel. */
async function addCommentViaPanel(page, from, to, text) {
  await selectRange(page, from, to);
  await openCommentsPanel(page);
  await page.locator('#comment-composer-input').fill(text);
  await page.locator('#comment-composer-btn').click();
  await page.waitForTimeout(500); // _refreshComments() + margin recompute
  await page.locator('.panel-close').click();
}

test.describe('Comments panel', () => {
  test('opening the panel with no selection shows the hint, not the composer', async ({ page }) => {
    await createRoom(page);
    await openCommentsPanel(page);
    await expect(page.locator('#comment-composer-hint')).toBeVisible();
  });

  test('selecting text in Write mode shows the composer with an anchor preview', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to comment on.');
    await selectRange(page, 5, 9); // "text"
    await openCommentsPanel(page);
    await expect(page.locator('#comment-composer')).toBeVisible();
    await expect(page.locator('#comment-composer-anchor')).toContainText('text');
  });

  test('comments panel is unavailable in read-only mode', async ({ page }) => {
    await createRoom(page);
    const readonlyUrl = await getShareUrl(page, 'readonly');
    await page.goto(readonlyUrl);
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    await openCommentsPanel(page);
    // data-readonly-hide keeps both the composer and the hint out of a
    // read-only viewer's panel — they can read comments, not add them.
    await expect(page.locator('#comment-composer')).toBeHidden();
    await expect(page.locator('#comment-composer-hint')).toBeHidden();
  });

  test('the add-comment FAB is hidden in read-only mode', async ({ page }) => {
    await createRoom(page);
    const readonlyUrl = await getShareUrl(page, 'readonly');
    await page.goto(readonlyUrl);
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    await expect(page.locator('#btn-add-comment-fab')).toBeHidden();
  });
});

test.describe('Floating comment composer', () => {
  test('the FAB opens a floating composer at the current selection', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to place a caret in.');
    await page.locator('#btn-add-comment-fab').click();
    await expect(page.locator('.comment-floating-composer input')).toBeVisible();
  });

  test('the keyboard shortcut (Ctrl+Shift+/) opens the floating composer', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to place a caret in.');
    await page.keyboard.press('Control+Shift+/');
    await expect(page.locator('.comment-floating-composer input')).toBeVisible();
  });

  test('Escape closes the composer without creating a comment', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to place a caret in.');
    await page.locator('#btn-add-comment-fab').click();
    const input = page.locator('.comment-floating-composer input');
    await input.fill('never sent');
    await input.press('Escape');
    await expect(page.locator('.comment-floating-composer')).toHaveCount(0);
    await expect(page.locator('.comment-dot')).toHaveCount(0);
  });

  test('submitting persists a real comment — a margin dot appears', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to place a caret in.');
    await page.locator('#btn-add-comment-fab').click();
    const input = page.locator('.comment-floating-composer input');
    await input.fill('a floating comment');
    await input.press('Enter');
    await expect(page.locator('.comment-floating-composer')).toHaveCount(0);
    await expect(page.locator('.comment-dot')).toHaveCount(1, { timeout: 3000 });
  });

  // The editor context menu's "Add comment" action is covered in
  // tests/editor-context-menu.spec.js, alongside its other actions.
});

test.describe('Floating comment bubble', () => {
  test('adding a comment shows a margin dot at its anchor, which re-selects the anchor on click', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to comment on, right here.');
    await addCommentViaPanel(page, 5, 9, 'margin dot test'); // "text"

    await expect(page.locator('.comment-dot')).toHaveCount(1);

    // Move the selection/caret elsewhere so a click on the dot is a
    // detectable change, then click it and confirm it re-selects the anchor.
    await page.locator('#note-editor').evaluate((el) => el.setSelectionRange(0, 0));
    await page.locator('.comment-dot').first().click();
    await page.waitForTimeout(200);
    const sel = await page.locator('#note-editor').evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd }));
    expect(sel).toEqual({ start: 5, end: 9 });
  });

  test('clicking a dot expands a bubble with the author and text', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to comment on, right here.');
    await addCommentViaPanel(page, 5, 9, 'bubble content test');

    await page.locator('.comment-dot').first().click();
    await expect(page.locator('.comment-floating-bubble')).toBeVisible();
    await expect(page.locator('.comment-floating-bubble-text')).toContainText('bubble content test');
  });

  test('clicking the same dot again collapses the bubble', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to comment on.');
    await addCommentViaPanel(page, 5, 9, 'toggle test');

    const dot = page.locator('.comment-dot').first();
    await dot.click();
    await expect(page.locator('.comment-floating-bubble')).toBeVisible();
    await dot.click();
    await expect(page.locator('.comment-floating-bubble')).toHaveCount(0);
  });

  test('deleting from the bubble removes the comment', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to comment on.');
    await addCommentViaPanel(page, 5, 9, 'delete me');

    await page.locator('.comment-dot').first().click();
    await page.locator('.comment-floating-bubble .comment-delete-btn').click();
    await page.locator('#sp-confirm-ok').click();
    await expect(page.locator('.comment-dot')).toHaveCount(0, { timeout: 3000 });
  });
});

test.describe('Comment navigation', () => {
  async function addTwoComments(page) {
    await typeInEditor(page, 'Hello world, this is a note with two things to comment on.');
    await addCommentViaPanel(page, 0, 5, 'first comment');  // "Hello"
    await addCommentViaPanel(page, 7, 12, 'second comment'); // "world"
  }

  test('Next/Prev in the floating bubble cycles between comments', async ({ page }) => {
    await createRoom(page);
    await addTwoComments(page);

    await page.locator('.comment-dot').first().click();
    const firstText = await page.locator('.comment-floating-bubble-text').textContent();

    await page.locator('.comment-nav-next').click();
    const secondText = await page.locator('.comment-floating-bubble-text').textContent();
    expect(secondText).not.toEqual(firstText);

    await page.locator('.comment-nav-prev').click();
    const backToFirst = await page.locator('.comment-floating-bubble-text').textContent();
    expect(backToFirst).toEqual(firstText);
  });

  test('Next/Prev in the panel header navigates without closing the panel', async ({ page }) => {
    await createRoom(page);
    await addTwoComments(page);
    await openCommentsPanel(page);

    await page.locator('#comment-panel-next').click();
    await expect(page.locator('#comments-panel')).toHaveClass(/open/);
    await expect(page.locator('.comment-floating-bubble')).toBeVisible();
  });
});
