// tests/landing.spec.js
// Marketing landing page (/), the bare create/join screen (/app), "New
// room" navigation, "Join room" navigation.

import { test, expect } from '@playwright/test';
import { goToLanding, goToAppLanding, roomIdFromUrl, supabaseAvailable } from './helpers.js';

test.describe('Marketing landing page (/)', () => {
  test('renders nav logo, hero headline, and CTAs linking to /app/', async ({ page }) => {
    await goToLanding(page);
    await expect(page.locator('.lp-nav-logo')).toBeVisible();
    await expect(page.locator('.lp-h1')).toBeVisible();
    await expect(page.locator('.lp-sub')).toBeVisible();
    await expect(page.locator('.lp-btn-primary').first()).toBeVisible();
    await expect(page.locator('.lp-btn-primary').first()).toHaveAttribute('href', '/SyncPad/app/');
  });

  test('marketing sections and footer render', async ({ page }) => {
    await goToLanding(page);
    await expect(page.locator('#lp-features')).toBeAttached();
    await expect(page.locator('#lp-how')).toBeAttached();
    await expect(page.locator('#lp-trust')).toBeAttached();
    await expect(page.locator('.lp-footer')).toBeAttached();
  });

  test('feature tabs switch the active panel', async ({ page }) => {
    await goToLanding(page);
    const encryptionTab = page.locator('.lp-feature-tab[data-feature="encryption"]');
    await encryptionTab.scrollIntoViewIfNeeded();
    await expect(page.locator('.lp-feature-panel[data-feature-panel="sync"]')).toHaveClass(/active/);
    await encryptionTab.click();
    await expect(encryptionTab).toHaveClass(/active/);
    await expect(page.locator('.lp-feature-panel[data-feature-panel="encryption"]')).toHaveClass(/active/);
    await expect(page.locator('.lp-feature-panel[data-feature-panel="sync"]')).not.toHaveClass(/active/);
  });

  test('feature chips are visible on the hero', async ({ page }) => {
    await goToLanding(page);
    const chips = page.locator('.landing-chip');
    await expect(chips.first()).toBeVisible();
    expect(await chips.count()).toBeGreaterThanOrEqual(3);
  });
});

test.describe('App landing screen (/app)', () => {
  test('renders logo, tagline, and action buttons', async ({ page }) => {
    await goToAppLanding(page);
    // Scoped to #app-landing-screen — .landing-logo also matches the
    // marketing page's footer wordmark, which is in the DOM (just hidden)
    // at the same time.
    const screen = page.locator('#app-landing-screen');
    await expect(screen.locator('.landing-logo')).toBeVisible();
    await expect(screen.locator('.landing-tagline')).toBeVisible();
    await expect(page.locator('#landing-create-btn')).toBeVisible();
    await expect(page.locator('.landing-join-input')).toBeVisible();
    await expect(page.locator('.landing-join-btn')).toBeVisible();
  });

  test('"Back to SyncPad" link returns to the marketing page', async ({ page }) => {
    await goToAppLanding(page);
    await page.locator('.app-landing-back').click();
    // A real page navigation, not client-side routing — give it the same
    // budget as other full-reload waits in this suite (CDN scripts reload
    // from scratch, which is slow under a degraded/proxied network).
    await page.waitForSelector('#landing-screen:not(.hidden)', { timeout: 20_000 });
    expect(page.url()).toBe('http://localhost:5555/SyncPad/');
  });

  test('"New room" creates a room and navigates to app screen', { timeout: 60_000 }, async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked');
      return;
    }
    await goToAppLanding(page);
    await page.click('.landing-create-btn');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 25_000 });
    expect(page.url()).toMatch(/\/SyncPad\/[a-zA-Z0-9_-]+/);
  });

  test('"New room" URL contains a valid room ID (no reserved paths)', { timeout: 60_000 }, async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked');
      return;
    }
    await goToAppLanding(page);
    await page.click('.landing-create-btn');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 25_000 });
    const roomId = roomIdFromUrl(page.url());
    const reserved = ['admin', 'app', 'contact', 'privacy', 'terms', 'share'];
    expect(reserved).not.toContain(roomId);
    expect(roomId.length).toBeGreaterThan(0);
  });

  test('"Join room" input + button navigate to the typed room', { timeout: 60_000 }, async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked');
      return;
    }
    await goToAppLanding(page);
    // Use a unique ID so stale Supabase room state from prior runs cannot interfere.
    const roomId = `test-join-btn-${Date.now()}`;
    await page.fill('.landing-join-input', roomId);
    await page.click('.landing-join-btn');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 25_000 });
    expect(page.url()).toContain(roomId);
  });

  test('"Join room" also works by pressing Enter in the input', { timeout: 60_000 }, async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked');
      return;
    }
    await goToAppLanding(page);
    // Use a unique ID so stale Supabase room state from prior runs cannot interfere.
    const roomId = `test-join-enter-${Date.now()}`;
    await page.fill('.landing-join-input', roomId);
    await page.press('.landing-join-input', 'Enter');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 25_000 });
    expect(page.url()).toContain(roomId);
  });

  test('"Join room" falls back to treating an unresolvable short code as a literal room ID', { timeout: 60_000 }, async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked');
      return;
    }
    await goToAppLanding(page);
    // Shaped like a real short code (6 chars, short-code alphabet) but never
    // actually issued by get_or_create_room_code — resolveRoomCode() should
    // return null for it, and the join flow must fall through to joining it
    // as a literal room ID rather than erroring or getting stuck.
    await page.fill('.landing-join-input', 'K7X9BQ');
    await page.click('.landing-join-btn');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 25_000 });
    // sanitizeRoomId() lowercases room IDs, so the fallback path's URL uses
    // the lowercase form even though the typed code was uppercase.
    expect(page.url().toLowerCase()).toContain('k7x9bq');
  });

  test('navigating directly to a URL for a room that does not exist creates and opens it', { timeout: 60_000 }, async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked');
      return;
    }
    // Typing/following a URL for a name nobody has taken yet must behave
    // like the Create Room button (this is the "join by name" behavior the
    // join-box tests above exercise via the input; this test exercises the
    // same fallback via direct navigation, which goes through boot()'s
    // route handling instead of the join box).
    const roomId = `test-direct-nav-${Date.now()}`;
    await page.goto(`/SyncPad/${roomId}`);
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 25_000 });
    expect(page.url()).toContain(roomId);
  });

  test('recent rooms list is hidden when empty and shown when localStorage has entries', async ({ page }) => {
    await goToAppLanding(page);
    await expect(page.locator('#landing-recent')).toHaveClass(/hidden/);

    await page.evaluate(() => {
      localStorage.setItem('syncpad_recent_rooms', JSON.stringify([
        { id: 'test-recent-room', name: 'Test Recent Room', visitedAt: Date.now() },
      ]));
    });
    await page.reload();
    await page.waitForSelector('#app-landing-screen:not(.hidden)', { timeout: 10_000 });
    await expect(page.locator('#landing-recent')).not.toHaveClass(/hidden/);
    await expect(page.locator('.landing-recent-item')).toHaveCount(1);
    await expect(page.locator('.landing-recent-name')).toHaveText('Test Recent Room');
  });

  test('removing a recent room updates localStorage and the list', async ({ page }) => {
    await goToAppLanding(page);
    await page.evaluate(() => {
      localStorage.setItem('syncpad_recent_rooms', JSON.stringify([
        { id: 'test-recent-a', name: 'Room A', visitedAt: Date.now() },
        { id: 'test-recent-b', name: 'Room B', visitedAt: Date.now() },
      ]));
    });
    await page.reload();
    await page.waitForSelector('#app-landing-screen:not(.hidden)', { timeout: 10_000 });
    await expect(page.locator('.landing-recent-item')).toHaveCount(2);

    await page.locator('.landing-recent-remove').first().click();
    await expect(page.locator('.landing-recent-item')).toHaveCount(1);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('syncpad_recent_rooms')));
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('test-recent-b');
  });

  test('clicking a recent room navigates to it', async ({ page }) => {
    await goToAppLanding(page);
    await page.evaluate(() => {
      localStorage.setItem('syncpad_recent_rooms', JSON.stringify([
        { id: 'test-recent-click', name: 'Click Me', visitedAt: Date.now() },
      ]));
    });
    await page.reload();
    await page.waitForSelector('#app-landing-screen:not(.hidden)', { timeout: 10_000 });
    await page.locator('.landing-recent-item-btn').first().click();
    await expect(page).toHaveURL(/test-recent-click/);
  });
});
