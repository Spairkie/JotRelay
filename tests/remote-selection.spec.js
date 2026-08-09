// tests/remote-selection.spec.js
// Selection & viewport awareness: a remote collaborator's selected text
// range renders as a highlighted span (not just a caret) in the CM6 live
// surface, and the Devices panel's "Follow" toggle scrolls the local view
// to a followed device's position.
//
// Real multi-device presence isn't exercised here (no established
// multi-tab pattern in this suite) — LiveEditor.setRemoteCursors() is
// called directly with synthetic presence-shaped data, the same technique
// markdown.spec.js's withPreview() uses to exercise renderMarkdown()
// directly rather than through a second browser.

import { test, expect } from '@playwright/test';
import { createRoom, createFreshRoom, setEditorMode, typeInEditor, openPanel } from './helpers.js';

async function setRemoteCursors(page, cursors) {
  await page.evaluate(async (cursors) => {
    const LE = await import('/SyncPad/src/live-editor.js');
    LE.setRemoteCursors(cursors);
  }, cursors);
}

test.describe('Remote selection highlighting', () => {
  test('a remote collaborator with a real selection range renders a highlighted span', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, '# Title\n\nSome paragraph text here for selection testing.');
    await setEditorMode(page, 'preview');

    await setRemoteCursors(page, [{ id: 'dev-a', name: 'Alice', pos: 20, anchor: 5 }]);
    await expect(page.locator('.note-live .cm-remote-selection').first()).toBeVisible();
    await expect(page.locator('.note-live .cm-remote-caret')).toHaveCount(1);
  });

  test('a remote collaborator with a plain caret (no selection) renders no highlight', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, '# Title\n\nSome text.');
    await setEditorMode(page, 'preview');

    await setRemoteCursors(page, [{ id: 'dev-b', name: 'Bob', pos: 8, anchor: 8 }]);
    await expect(page.locator('.note-live .cm-remote-caret')).toHaveCount(1);
    await expect(page.locator('.note-live .cm-remote-selection')).toHaveCount(0);
  });
});

test.describe('Follow mode', () => {
  test('with only the local device connected, no Follow toggle is shown', async ({ page }) => {
    // Uses the *real* Presence subscription (unlike every other test in this
    // file, which injects synthetic data directly) — needs a room no other
    // test's connection could still be lingering in via Supabase Presence's
    // own disconnect-timeout window, which a DB-level content/settings reset
    // can't clear. createFreshRoom() (a genuinely new room_id) instead of
    // the shared reused fixture.
    await createFreshRoom(page);
    await openPanel(page, 'presence');
    // Only the local device is connected in this test, so the follow
    // button (only rendered for non-self rows) shouldn't appear yet.
    await expect(page.locator('.device-follow-btn')).toHaveCount(0);
  });

  test('a non-self device gets a Follow toggle that activates on click', async ({ page }) => {
    await createRoom(page);
    await openPanel(page, 'presence');

    await page.evaluate(async () => {
      const UI = await import('/SyncPad/src/ui.js');
      window.__jotrelayFollowed = null;
      UI.renderDevicesList(
        [
          { device_id: 'me', device_name: 'Me', isMe: true, read_only: false, typing: false, cursor_line: null },
          { device_id: 'dev-a', device_name: 'Alice', isMe: false, read_only: false, typing: false, cursor_line: 3 },
        ],
        'me',
        () => {},
        { followedDeviceId: null, onToggleFollow: (id) => { window.__jotrelayFollowed = id; } },
      );
    });

    const followBtn = page.locator('.device-follow-btn');
    await expect(followBtn).toHaveCount(1);
    await expect(followBtn).toHaveAttribute('aria-pressed', 'false');

    await followBtn.click();
    const followedId = await page.evaluate(() => window.__jotrelayFollowed);
    expect(followedId).toBe('dev-a');
  });
});

test.describe('Devices panel — joined time & followed-by indicator', () => {
  test('a non-self device with joined_at shows a relative "joined" chip; self never does', async ({ page }) => {
    await createRoom(page);
    await openPanel(page, 'presence');

    await page.evaluate(async () => {
      const UI = await import('/SyncPad/src/ui.js');
      UI.renderDevicesList(
        [
          { device_id: 'me', device_name: 'Me', isMe: true, read_only: false, typing: false, cursor_line: null, joined_at: Date.now() - 5000 },
          { device_id: 'dev-a', device_name: 'Alice', isMe: false, read_only: false, typing: false, cursor_line: null, joined_at: Date.now() - 5 * 60 * 1000 },
        ],
        'me',
        () => {},
        { followedDeviceId: null, onToggleFollow: () => {} },
      );
    });

    await expect(page.locator('.device-joined')).toHaveCount(1);
    await expect(page.locator('.device-joined')).toHaveText('5m ago');
  });

  test('a device followed by others shows a "Followed by N" chip on its own row only', async ({ page }) => {
    await createRoom(page);
    await openPanel(page, 'presence');

    await page.evaluate(async () => {
      const UI = await import('/SyncPad/src/ui.js');
      UI.renderDevicesList(
        [
          { device_id: 'me', device_name: 'Me', isMe: true, read_only: false, typing: false, cursor_line: null, followedByCount: 2 },
          { device_id: 'dev-a', device_name: 'Alice', isMe: false, read_only: false, typing: false, cursor_line: null, followedByCount: 0 },
        ],
        'me',
        () => {},
        { followedDeviceId: null, onToggleFollow: () => {} },
      );
    });

    const followedBy = page.locator('.device-followed-by');
    await expect(followedBy).toHaveCount(1);
    await expect(followedBy).toHaveText('👀 Followed by 2');
  });
});
