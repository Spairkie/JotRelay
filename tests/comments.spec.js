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
  await page.locator('#comments-panel .panel-close').click();
}

test.describe('Comments panel', () => {
  test('opening the panel on a fresh room shows the composer anchored to the live surface\'s default cursor position', async ({ page }) => {
    // Rooms default to Live/Preview mode (see _resolveInitialEditorMode() in
    // src/app/state.js), where the CM6 surface always reports a real cursor
    // position (0,0) from the moment it mounts — unlike the plain textarea,
    // there's no "unfocused, no selection at all" state to fall back to, so
    // the composer (anchored to the cursor) shows immediately rather than
    // the "select text first" hint.
    await createRoom(page);
    await openCommentsPanel(page);
    await expect(page.locator('#comment-composer')).toBeVisible();
    await expect(page.locator('#comment-composer-anchor')).toContainText('cursor position');
  });

  test('the composer shows a live character count, reset to 0 on each open', async ({ page }) => {
    await createRoom(page);
    await openCommentsPanel(page);
    const charcount = page.locator('#comment-composer-charcount');
    await expect(charcount).toHaveText('0 / 1000');

    await page.locator('#comment-composer-input').fill('hello');
    await expect(charcount).toHaveText('5 / 1000');

    await page.locator('#comments-panel .panel-close').click();
    await openCommentsPanel(page);
    await expect(charcount).toHaveText('0 / 1000');
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
    // The realtime echo of the second comment's own insert can still be
    // in flight (subscribeToComments() → _refreshComments()) right after
    // addCommentViaPanel()'s own 500ms wait returns, rebuilding the margin
    // dots out from under an immediate click. Give it a moment to settle.
    await page.waitForTimeout(500);

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

test.describe('Comment count badge', () => {
  test('the Comments tool button shows a count badge, hidden when there are no comments', async ({ page }) => {
    await createRoom(page);
    const badge = page.locator('#comment-count-badge');
    await expect(badge).toBeHidden();

    await typeInEditor(page, 'Some text to comment on, right here.');
    await addCommentViaPanel(page, 5, 9, 'first'); // "text"
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');

    await addCommentViaPanel(page, 15, 19, 'second'); // "on,"
    await expect(badge).toHaveText('2');
  });

  test('deleting a comment decrements the badge back to hidden', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to comment on.');
    await addCommentViaPanel(page, 5, 9, 'only comment');
    await expect(page.locator('#comment-count-badge')).toHaveText('1');

    await page.locator('.comment-dot').first().click();
    await page.locator('.comment-floating-bubble .comment-delete-btn').click();
    await page.locator('#sp-confirm-ok').click();
    await expect(page.locator('#comment-count-badge')).toBeHidden({ timeout: 3000 });
  });
});

test.describe('Auto-delete on anchored text removal', () => {
  // Google Docs/Notion-style behavior: a comment has no meaning once the
  // text it's attached to is gone. See comments-preview.js's
  // _pruneDeletedCommentAnchors(), debounced 600ms off the same 'input'
  // listener that drives preview/margin-dot refresh.
  test('deleting the exact text a comment is anchored to removes the comment', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to comment on, right here.');
    await addCommentViaPanel(page, 5, 9, 'delete me'); // "text"
    await expect(page.locator('.comment-dot')).toHaveCount(1);

    await page.locator('#note-editor').evaluate((el) => {
      el.focus();
      const v = el.value;
      el.value = v.slice(0, 5) + v.slice(9); // remove "text"
      el.setSelectionRange(5, 5);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.locator('.comment-dot')).toHaveCount(0, { timeout: 3000 });
  });

  test('editing text elsewhere in the document does not delete an unrelated comment', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'Some text to comment on, right here.');
    await addCommentViaPanel(page, 5, 9, 'keep me'); // "text"
    await expect(page.locator('.comment-dot')).toHaveCount(1);

    await page.locator('#note-editor').evaluate((el) => {
      el.focus();
      el.value += ' Appended, unrelated.';
      el.setSelectionRange(el.value.length, el.value.length);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(1000); // past the 600ms prune debounce
    await expect(page.locator('.comment-dot')).toHaveCount(1);
  });
});

test.describe('Comment threads (renderCommentsList grouping)', () => {
  // renderCommentsList() only touches static DOM (#comments-list lives in
  // #app-screen, present in the page regardless of route) and takes plain
  // objects — these exercise its grouping/rendering logic directly via
  // module import, with no room or Supabase involved, so they run even
  // when the CDN is blocked (unlike everything else in this file).
  async function render(page, comments, opts = {}) {
    await page.goto('/SyncPad/');
    await page.evaluate(async ([items, options]) => {
      const { renderCommentsList } = await import('/SyncPad/src/ui/collab.js');
      renderCommentsList(items, options);
    }, [comments, opts]);
  }

  const baseComment = (over) => ({
    id: 'c1', created_at: new Date().toISOString(), device_name: 'Alice',
    anchor_from: 0, anchor_to: 5, _preview: 'first', _anchorPreview: 'Hello',
    ...over,
  });

  test('comments sharing an exact anchor render as one thread with stacked messages', async ({ page }) => {
    await render(page, [
      baseComment({ id: 'c1', _preview: 'first message' }),
      baseComment({ id: 'c2', _preview: 'second message', device_name: 'Bob' }),
    ]);
    await expect(page.locator('.comment-thread')).toHaveCount(1);
    await expect(page.locator('.comment-thread-message')).toHaveCount(2);
    await expect(page.locator('.comment-thread-message').nth(0)).toContainText('first message');
    await expect(page.locator('.comment-thread-message').nth(1)).toContainText('second message');
  });

  test('comments with different anchors render as separate threads', async ({ page }) => {
    await render(page, [
      baseComment({ id: 'c1', anchor_from: 0, anchor_to: 5 }),
      baseComment({ id: 'c2', anchor_from: 10, anchor_to: 15, _anchorPreview: 'World' }),
    ]);
    await expect(page.locator('.comment-thread')).toHaveCount(2);
  });

  test('a thread reply calls onReply with the thread\'s anchor, not a fresh selection', async ({ page }) => {
    // onReply can't cross the page.evaluate() boundary as a live function
    // reference — stash the call args on window instead and assert on those.
    await page.goto('/SyncPad/');
    await page.evaluate(async () => {
      const { renderCommentsList } = await import('/SyncPad/src/ui/collab.js');
      window.__replyCalls = [];
      renderCommentsList([{
        id: 'c1', created_at: new Date().toISOString(), device_name: 'Alice',
        anchor_from: 3, anchor_to: 9, _preview: 'first', _anchorPreview: 'anchor text',
      }], { onReply: (text, anchor) => window.__replyCalls.push({ text, anchor }) });
    });
    await page.locator('.comment-thread-reply-input').fill('a reply');
    await page.locator('.comment-thread-reply-input').press('Enter');
    const calls = await page.evaluate(() => window.__replyCalls);
    expect(calls).toEqual([{ text: 'a reply', anchor: { from: 3, to: 9 } }]);
  });

  test('reply input is not rendered when onReply is omitted (read-only)', async ({ page }) => {
    await render(page, [baseComment()]);
    await expect(page.locator('.comment-thread-reply-input')).toHaveCount(0);
  });

  test('blurring the reply input saves it, and a following Enter/click does not double-submit', async ({ page }) => {
    await page.goto('/SyncPad/');
    await page.evaluate(async () => {
      const { renderCommentsList } = await import('/SyncPad/src/ui/collab.js');
      window.__replyCalls = [];
      renderCommentsList([{
        id: 'c1', created_at: new Date().toISOString(), device_name: 'Alice',
        anchor_from: 0, anchor_to: 5, _preview: 'first', _anchorPreview: 'Hello',
      }], { onReply: (text, anchor) => window.__replyCalls.push({ text, anchor }) });
    });
    await page.locator('.comment-thread-reply-input').fill('save on blur');
    // Blur alone should save the reply — no Enter press or explicit submit
    // button involved. #comments-panel is never actually opened by this
    // test (renderCommentsList() is called directly), so it's parked
    // off-screen via CSS transform — .blur() sidesteps the on-screen
    // actionability a .click() on some other element would need here.
    await page.locator('.comment-thread-reply-input').evaluate((el) => el.blur());
    const calls = await page.evaluate(() => window.__replyCalls);
    expect(calls).toEqual([{ text: 'save on blur', anchor: { from: 0, to: 5 } }]);
    // The input is drained on submit, so refocusing and pressing Enter again
    // (or any other stray blur) must not resend the same text.
    await expect(page.locator('.comment-thread-reply-input')).toHaveValue('');
  });

  test('Escape in the reply input discards instead of saving', async ({ page }) => {
    await page.goto('/SyncPad/');
    await page.evaluate(async () => {
      const { renderCommentsList } = await import('/SyncPad/src/ui/collab.js');
      window.__replyCalls = [];
      renderCommentsList([{
        id: 'c1', created_at: new Date().toISOString(), device_name: 'Alice',
        anchor_from: 0, anchor_to: 5, _preview: 'first', _anchorPreview: 'Hello',
      }], { onReply: (text, anchor) => window.__replyCalls.push({ text, anchor }) });
    });
    await page.locator('.comment-thread-reply-input').fill('never sent');
    await page.locator('.comment-thread-reply-input').press('Escape');
    const calls = await page.evaluate(() => window.__replyCalls);
    expect(calls).toEqual([]);
  });
});
