// tests/routing.spec.js
// URL routing: admin, contact, privacy, terms, info screen,
// read-only share links, reserved paths.

import { test, expect } from '@playwright/test';
import { supabaseAvailable, goToAppLanding } from './helpers.js';

test.describe('URL routing', () => {
  test('/JotRelay/ shows the marketing landing screen', async ({ page }) => {
    await page.goto('/JotRelay/');
    await expect(page.locator('#landing-screen')).not.toHaveClass(/hidden/);
  });

  test('/JotRelay/app/ shows the bare create/join screen', async ({ page }) => {
    await goToAppLanding(page);
    await expect(page.locator('#app-landing-screen')).not.toHaveClass(/hidden/);
    await expect(page.locator('#landing-create-btn')).toBeVisible();
    await expect(page.locator('#landing-join-input')).toBeVisible();
  });

  test('marketing page CTAs link to /JotRelay/app/', async ({ page }) => {
    await page.goto('/JotRelay/');
    // .href (resolved property) — the markup uses <base>-relative "app/"
    // hrefs (see index.html's header comment), resolved to absolute URLs.
    const expected = new URL('/JotRelay/app/', page.url()).href;
    expect(await page.locator('.lp-nav-cta').evaluate((el) => el.href)).toBe(expected);
    expect(await page.locator('.lp-btn-primary').first().evaluate((el) => el.href)).toBe(expected);
    expect(await page.locator('.lp-hero-join-link').evaluate((el) => el.href)).toBe(expected);
  });

  test('/JotRelay/admin shows admin screen', async ({ page }) => {
    await page.goto('/JotRelay/admin');
    await expect(page.locator('#admin-screen')).not.toHaveClass(/hidden/);
  });

  test('/JotRelay/admin shows admin login form', async ({ page }) => {
    await page.goto('/JotRelay/admin');
    // Should show either the login form or the dashboard
    await page.waitForTimeout(2000); // let initAdmin() run
    const loginInput = page.locator('#admin-email, #admin-login-btn');
    // If not authenticated, login form should appear
    if (await loginInput.count() > 0) {
      await expect(loginInput.first()).toBeVisible();
    }
    // Either way the admin screen should be visible
    await expect(page.locator('#admin-screen')).not.toHaveClass(/hidden/);
  });

  test('/JotRelay/contact shows contact page', async ({ page }) => {
    await page.goto('/JotRelay/contact');
    await expect(page.locator('#contact-screen')).not.toHaveClass(/hidden/);
  });

  test('/JotRelay/privacy shows privacy page', async ({ page }) => {
    await page.goto('/JotRelay/privacy');
    await expect(page.locator('#privacy-screen')).not.toHaveClass(/hidden/);
  });

  test('/JotRelay/terms shows terms page', async ({ page }) => {
    await page.goto('/JotRelay/terms');
    await expect(page.locator('#terms-screen')).not.toHaveClass(/hidden/);
  });

  test('a legal page reached directly (no prior visit this session) falls back to the marketing root', async ({ page }) => {
    await page.goto('/JotRelay/privacy');
    await expect(page.locator('#privacy-screen .legal-back-link')).toHaveAttribute('href', '/JotRelay/');
  });

  test('"Back to JotRelay" returns to /app, not the marketing root, after visiting from there', async ({ page }) => {
    await page.goto('/JotRelay/app/');
    await page.goto('/JotRelay/privacy');
    await expect(page.locator('#privacy-screen .legal-back-link')).toHaveAttribute('href', '/JotRelay/app/');
  });

  test('"Back to JotRelay" is unaffected by chaining through other legal pages', async ({ page }) => {
    // Three real sequential navigations, each independently slow in this
    // environment (blocked external CDN fetches add real seconds per
    // page.goto — see other single-navigation tests in this file already
    // taking 15-27s), can comfortably exceed the default 30s test budget.
    test.setTimeout(90_000);
    await page.goto('/JotRelay/app/');
    await page.goto('/JotRelay/privacy');
    await page.goto('/JotRelay/terms');
    await expect(page.locator('#terms-screen .legal-back-link')).toHaveAttribute('href', '/JotRelay/app/');
  });

  test('/JotRelay/some-room-id shows app screen', async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked — room loading requires network access');
      return;
    }
    await page.goto('/JotRelay/test-routing-room');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    await expect(page.locator('#app-screen')).not.toHaveClass(/hidden/);
  });

  test('only one screen is visible at a time', async ({ page }) => {
    await page.goto('/JotRelay/');
    const screens = ['#landing-screen', '#app-landing-screen', '#loading-screen', '#passcode-screen',
      '#encryption-screen', '#app-screen', '#info-screen', '#contact-screen',
      '#privacy-screen', '#terms-screen', '#admin-screen'];
    const visible = await Promise.all(
      screens.map(async (sel) => {
        const el = page.locator(sel);
        if (await el.count() === 0) return false;
        const classes = await el.getAttribute('class') || '';
        return !classes.includes('hidden');
      })
    );
    const visibleCount = visible.filter(Boolean).length;
    expect(visibleCount).toBeLessThanOrEqual(1);
  });

  test('navigating browser back to the app-landing screen works', async ({ page }) => {
    if (!(await supabaseAvailable(page))) {
      test.skip(true, 'Supabase JS CDN blocked — room creation requires network access');
      return;
    }
    await goToAppLanding(page);
    await page.locator('.landing-create-btn').click();
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    await page.goBack();
    // Actually re-routes back to the app-landing screen (the last real
    // navigation before the room's pushState), not just a URL-bar change
    // with the app screen still frozen on-screen underneath it.
    await page.waitForSelector('#app-landing-screen:not(.hidden)', { timeout: 5000 });
    expect(page.url()).toContain('/JotRelay/app');
  });

  test('browser Back/Forward triggers a real re-route via popstate (no Supabase needed)', async ({ page }) => {
    const navigations = [];
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });

    await page.goto('/JotRelay/');
    await page.waitForSelector('#landing-screen:not(.hidden)');
    await page.evaluate(() => { window.__routingTestMarker = true; });
    navigations.length = 0;

    // A pushState-only URL change (what joining a room does) followed by
    // browser Back must produce a real re-route, not a silently-stale screen.
    await page.evaluate(() => history.pushState(null, '', '/JotRelay/some-fake-room-for-routing-test'));
    await page.goBack();
    await page.waitForTimeout(1000); // let the popstate-triggered reload settle

    // A genuine reload creates a fresh JS realm — the marker set before it
    // must be gone, and the frame must have navigated again after Back
    // (not just the single same-document transition goBack() itself causes).
    const markerGone = await page.evaluate(() => typeof window.__routingTestMarker === 'undefined');
    expect(markerGone).toBe(true);
    expect(navigations.length).toBeGreaterThanOrEqual(2);
  });

  test('Back after a hash-only navigation does not reload (would lose in-memory state, e.g. a consumed view-once note)', async ({ page }) => {
    await page.goto('/JotRelay/');
    await page.waitForSelector('#landing-screen:not(.hidden)');
    await page.evaluate(() => { window.__routingTestMarker = true; });

    // Following a same-page anchor link (e.g. a Markdown TOC entry) only
    // changes the hash — the path and query stay identical.
    await page.evaluate(() => history.pushState(null, '', location.pathname + '#some-heading'));
    await page.goBack();
    await page.waitForTimeout(700);

    const markerStillPresent = await page.evaluate(() => window.__routingTestMarker === true);
    expect(markerStillPresent).toBe(true);
  });

  test('Back still reloads after a real navigation, even once a prior hash-only Back has fired', async ({ page }) => {
    await page.goto('/JotRelay/');
    await page.waitForSelector('#landing-screen:not(.hidden)');

    // Exercise the hash-only path first so its no-op doesn't leave the
    // path/search tracker stale for the real navigation that follows.
    await page.evaluate(() => history.pushState(null, '', location.pathname + '#some-heading'));
    await page.goBack();
    await page.waitForTimeout(500);

    await page.evaluate(() => { window.__routingTestMarker = true; });
    await page.evaluate(() => history.pushState(null, '', '/JotRelay/another-fake-room'));
    await page.goBack();
    await page.waitForTimeout(1000);

    const markerGone = await page.evaluate(() => typeof window.__routingTestMarker === 'undefined');
    expect(markerGone).toBe(true);
  });
});
