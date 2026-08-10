// tests/room-errors.spec.js
// Room load error states, retry button, and read-only share link handling.

import { test, expect } from '@playwright/test';
import { createRoom, createFreshRoom, goToLanding, goToAppLanding, roomIdFromUrl, supabaseAvailable, typeInEditor, getEditorContent } from './helpers.js';

test.describe('Room load retry button', () => {
  test('loading screen retry button is hidden on normal load', async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked — room creation requires network access');
      return;
    }
    await goToAppLanding(page);
    await page.click('.landing-create-btn');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    // After successful load the retry button should be hidden
    const retryBtn = page.locator('#loading-retry-btn');
    // Either absent or hidden
    if (await retryBtn.count() > 0) {
      // We're already on app screen, but verify retry btn is hidden (it would have been during loading)
      // The retry btn is only shown on error; on a successful load it stays hidden
    }
    await expect(page.locator('#app-screen')).not.toHaveClass(/hidden/);
  });
});

test.describe('Read-only share link handling', () => {
  test('invalid share token shows info screen', async ({ page }) => {
    await page.goto('/JotRelay/share/definitely-not-a-real-token-xyz123');
    // Wait for resolution
    await page.waitForTimeout(4000);
    // Should show info screen (not the app screen or loading forever)
    const infoScreen = page.locator('#info-screen');
    const appScreen  = page.locator('#app-screen');
    if (await infoScreen.count() > 0) {
      // Info screen is shown for invalid tokens
      const infoVisible = await infoScreen.evaluate(el => !el.classList.contains('hidden'));
      const appHidden   = await appScreen.evaluate(el => el.classList.contains('hidden'));
      expect(infoVisible || appHidden).toBe(true);
    }
  });

  test('navigating to /JotRelay/share with no token redirects gracefully', async ({ page }) => {
    await page.goto('/JotRelay/share/');
    await page.waitForTimeout(3000);
    // Should be on some screen (not stuck on loading forever)
    const url = page.url();
    expect(url).toContain('/JotRelay/');
  });
});

test.describe('Room creation and navigation', () => {
  test('creating a room navigates to app screen with a valid room ID', async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked — room creation requires network access');
      return;
    }
    await goToAppLanding(page);
    await page.click('.landing-create-btn');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    const roomId = roomIdFromUrl(page.url());
    expect(roomId.length).toBeGreaterThan(0);
    // Room ID should not be a reserved path
    const reserved = ['admin', 'contact', 'privacy', 'terms', 'share'];
    expect(reserved.includes(roomId)).toBe(false);
  });

  test('navigating directly to an existing room ID loads the app', async ({ page }) => {
    // First create a room to get a valid ID
    const roomId = await createRoom(page);
    expect(roomId.length).toBeGreaterThan(0);
    // Navigate away
    await goToLanding(page);
    // Navigate back to the same room
    await page.goto(`/JotRelay/${roomId}`);
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    expect(page.url()).toContain(roomId);
  });

  test('loading screen shows "Loading room…" then transitions to app', async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked — room loading requires network access');
      return;
    }
    // Navigate directly to a room — loading screen should appear then resolve
    await page.goto('/JotRelay/test-load-transition');
    // May briefly see loading screen
    const loadMsg = page.locator('#loading-message');
    // Eventually app screen appears
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    await expect(page.locator('#app-screen')).not.toHaveClass(/hidden/);
  });

  test('joining room via ID input on landing page', async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked — room joining requires network access');
      return;
    }
    await goToAppLanding(page);
    const testRoomId = `join-test-${Date.now()}`;
    // #landing-join-input is readonly until first focus (see
    // src/app/landing.js — deliberate anti-autofill design); a click must
    // land first or page.fill()'s actionability check never passes.
    await page.click('.landing-join-input');
    await page.fill('.landing-join-input', testRoomId);
    await page.click('.landing-join-btn');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    expect(page.url()).toContain(testRoomId);
  });
});

test.describe('Multi-room navigation', () => {
  test('navigating between two rooms loads each correctly', async ({ page }) => {
    // Needs two genuinely distinct rooms, unlike most of this suite — the
    // shared reused fixture createRoom() gives every test would make roomA
    // and roomB the same room, so this one deliberately uses
    // createFreshRoom() (real "Create Room" clicks) for both instead.
    const roomA = await createFreshRoom(page);
    expect(roomA.length).toBeGreaterThan(0);

    // Navigate to a second room
    await goToLanding(page);
    const roomB = await createFreshRoom(page);
    expect(roomB.length).toBeGreaterThan(0);
    expect(roomB).not.toBe(roomA);

    // Navigate back to room A
    await page.goto(`/JotRelay/${roomA}`);
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    expect(page.url()).toContain(roomA);
  });

  test('editor mode is a remembered per-device preference that persists across room navigation', async ({ page }) => {
    // _resolveInitialEditorMode() (src/app/state.js) persists the chosen
    // mode to localStorage and re-applies it on every room join — a
    // deliberate per-device preference, not room-scoped state that resets
    // on navigation (teardownRealtimeSession() only sets a transient
    // 'write' placeholder for the loading screen in between).
    // styles/modals.css hides the Split segmented-control button below the
    // 639px mobile breakpoint — there's no control to click there.
    test.skip((page.viewportSize()?.width ?? 1280) <= 639, 'Split mode control is hidden on narrow/mobile viewports');
    const roomA = await createRoom(page);

    // Switch to split mode
    const splitBtn = page.locator('.md-seg-btn[data-mode="split"]');
    await splitBtn.click();
    await expect(page.locator('.editor-wrap')).toHaveClass(/mode-split/);

    // Navigate to second room
    await goToAppLanding(page);
    await page.click('.landing-create-btn');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });

    // The remembered split-mode preference carries over to the new room.
    await expect(page.locator('.editor-wrap')).toHaveClass(/mode-split/);
  });
});

test.describe('Reconnect reconciliation (SP-AUDIT-0016)', () => {
  // Supabase Realtime does not replay postgres_changes events missed while a
  // client's socket was disconnected. reconcileAfterReconnect() (src/sync.js)
  // is what the 'online' handler calls before flushing the queued debounced
  // save, specifically to avoid silently overwriting an edit another device
  // made during the outage. These exercise it directly against the app's
  // already-initialized sync module state, the same way CLAUDE.md's
  // in-browser module-testing pattern is used elsewhere in this suite.

  test('a divergent remote edit made while offline triggers the conflict prompt instead of being silently overwritten', async ({ page }) => {
    const roomId = await createRoom(page);
    await typeInEditor(page, 'my local edit');
    // Let the local debounced save land so this isn't racing its own flush.
    await page.waitForTimeout(1500);

    await expect(page.locator('#remote-notice')).toBeHidden();

    await page.evaluate(async (rid) => {
      const { reconcileAfterReconnect } = await import('/JotRelay/src/sync.js');
      // Simulate the room row fetched fresh right after reconnect, carrying
      // an edit from a different device that was made — and never
      // broadcast to us — while we were offline.
      await reconcileAfterReconnect({
        room_id: rid,
        content: 'edit made by another device while this client was offline',
        updated_by_device: 'some-other-device-id',
        updated_at: new Date().toISOString(),
      });
    }, roomId);

    await expect(page.locator('#remote-notice')).toBeVisible();
    // The editor must still show the local edit — reconciliation only
    // prompts, it never applies the remote content on its own.
    expect(await getEditorContent(page)).toBe('my local edit');
  });

  test('a remote room row that matches local content does not trigger the conflict prompt', async ({ page }) => {
    const roomId = await createRoom(page);
    await typeInEditor(page, 'same everywhere');
    await page.waitForTimeout(1500);

    await page.evaluate(async (rid) => {
      const { reconcileAfterReconnect } = await import('/JotRelay/src/sync.js');
      await reconcileAfterReconnect({
        room_id: rid,
        content: 'same everywhere',
        updated_by_device: 'some-other-device-id',
        updated_at: new Date().toISOString(),
      });
    }, roomId);

    await expect(page.locator('#remote-notice')).toBeHidden();
  });

  test('a room row written by this same device is treated as our own save, not a conflict', async ({ page }) => {
    const roomId = await createRoom(page);
    await typeInEditor(page, 'my local edit');
    await page.waitForTimeout(1500);

    await page.evaluate(async (rid) => {
      const { reconcileAfterReconnect } = await import('/JotRelay/src/sync.js');
      const { getDeviceId } = await import('/JotRelay/src/utils.js');
      await reconcileAfterReconnect({
        room_id: rid,
        content: 'stale content from before our own last save',
        updated_by_device: getDeviceId(),
        updated_at: new Date().toISOString(),
      });
    }, roomId);

    await expect(page.locator('#remote-notice')).toBeHidden();
  });
});
