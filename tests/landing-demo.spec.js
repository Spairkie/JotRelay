// tests/landing-demo.spec.js
// The coded hero demo on the marketing landing page (/) — replaces the old
// autoplaying MP4. See src/app/landing-demo.js and
// docs/marketing-site.md#coded-hero-demo.

import { test, expect } from '@playwright/test';
import { goToLanding } from './helpers.js';

test.describe('Coded hero demo (/)', () => {
  test('the coded demo exists and the old autoplay video is gone', async ({ page }) => {
    await goToLanding(page);
    await expect(page.locator('#lp-demo')).toBeAttached();
    await expect(page.locator('.lp-demo-desktop')).toBeVisible();
    expect(await page.locator('#lp-demo-video').count()).toBe(0);
    expect(await page.locator('.lp-video-shell').count()).toBe(0);
    expect(await page.locator('video[autoplay]').count()).toBe(0);
  });

  test('CTA still links to /SyncPad/app/', async ({ page }) => {
    await goToLanding(page);
    await expect(page.locator('.lp-btn-primary').first()).toHaveAttribute('href', '/SyncPad/app/');
  });

  test('scene tabs switch the active scene', async ({ page }) => {
    await goToLanding(page);
    const demo = page.locator('#lp-demo');
    await expect(demo).toHaveAttribute('data-scene', 'write');

    await page.locator('.lp-demo-tab[data-scene="share"]').click();
    await expect(demo).toHaveAttribute('data-scene', 'share');
    await expect(page.locator('.lp-demo-tab[data-scene="share"]')).toHaveClass(/active/);
    await expect(page.locator('.lp-demo-tab[data-scene="share"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.lp-demo-tab[data-scene="write"]')).toHaveAttribute('aria-selected', 'false');
  });

  test('manual scene selection stops autoplay', async ({ page }) => {
    await goToLanding(page);
    await page.locator('.lp-demo-tab[data-scene="review"]').click();
    await expect(page.locator('#lp-demo-playpause')).toHaveAttribute('aria-pressed', 'false');
  });

  test('Play/Pause button toggles and updates its label', async ({ page }) => {
    await goToLanding(page);
    const btn = page.locator('#lp-demo-playpause');
    await expect(btn).toHaveAttribute('aria-label', 'Pause demo animation');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toHaveAttribute('aria-label', 'Play demo animation');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  test('Collaborate scene shows Alex\'s presence and the remote line', async ({ page }) => {
    await goToLanding(page);
    await page.locator('.lp-demo-tab[data-scene="collaborate"]').click();
    await expect(page.locator('#lp-demo-presence')).toHaveCSS('opacity', '1');
    await expect(page.locator('#lp-demo-text-3')).toHaveText('Confirm launch date with marketing');
  });

  test('Review scene highlights the line and shows the anchored comment', async ({ page }) => {
    await goToLanding(page);
    await page.locator('.lp-demo-tab[data-scene="review"]').click();
    await expect(page.locator('#lp-demo-comment')).toHaveCSS('opacity', '1');
    await expect(page.locator('.lp-demo-comment-text')).toContainText('Should this happen before final QA?');
  });

  test('Share scene shows permissions, a share URL, and a copy button', async ({ page }) => {
    await goToLanding(page);
    await page.locator('.lp-demo-tab[data-scene="share"]').click();
    await expect(page.locator('#lp-demo-share-view')).toHaveCSS('opacity', '1');
    await expect(page.locator('.lp-demo-share-url')).toHaveText('syncpad.app/product-launch-plan');
    await expect(page.locator('.lp-demo-perm[data-perm="edit"]')).toHaveClass(/active/);
    await page.locator('.lp-demo-perm[data-perm="view"]').click();
    await expect(page.locator('.lp-demo-perm[data-perm="view"]')).toHaveClass(/active/);
    await expect(page.locator('#lp-demo-perm-explain')).toContainText('view');
  });

  test('Handoff scene reaches the mobile surface', async ({ page }) => {
    await goToLanding(page);
    await page.locator('.lp-demo-tab[data-scene="handoff"]').click();
    await expect(page.locator('#lp-demo-handoff-view')).toHaveCSS('opacity', '1');
    await expect(page.locator('#lp-demo-mobile-body')).toContainText('Received');
    await expect(page.locator('#lp-demo-file-status')).toContainText('Sent');
  });

  test('reduced motion disables autoplay and skips the flight animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goToLanding(page);
    const demo = page.locator('#lp-demo');
    await expect(demo).toHaveAttribute('data-scene', 'write');
    // Longer than the write scene's own autoplay duration — under reduced
    // motion it must never auto-advance.
    await page.waitForTimeout(4000);
    await expect(demo).toHaveAttribute('data-scene', 'write');

    // Manual navigation must still work, instantly, under reduced motion.
    await page.locator('.lp-demo-tab[data-scene="handoff"]').click();
    await expect(demo).toHaveAttribute('data-scene', 'handoff');
    // .lp-demo-flying-file is the base class name (contains the substring
    // "flying"), so check the toggled token directly rather than regex-match
    // the class string.
    expect(await page.locator('#lp-demo-flying-file').evaluate((el) => el.classList.contains('flying'))).toBe(false);
    await expect(page.locator('#lp-demo-mobile-body')).toContainText('Received');
  });

  test('demo pauses while scrolled offscreen and resumes when back in view', { timeout: 30_000 }, async ({ page }) => {
    await goToLanding(page);
    const demo = page.locator('#lp-demo');
    await expect(demo).toHaveAttribute('data-scene', 'write');

    // #landing-screen (not window/document) is the actual scroll container —
    // it's position:fixed with its own overflow-y:auto — so scroll that.
    // Scroll the demo out of view, then wait past the Write scene's own
    // ~3.2s autoplay duration — it must not advance while offscreen.
    await page.evaluate(() => document.getElementById('landing-screen').scrollTo(0, 999999));
    await page.waitForTimeout(4200);
    await expect(demo).toHaveAttribute('data-scene', 'write');

    // Scroll back — autoplay should resume and eventually advance.
    await page.evaluate(() => document.getElementById('landing-screen').scrollTo(0, 0));
    await expect(demo).not.toHaveAttribute('data-scene', 'write', { timeout: 8000 });
  });

  test('no horizontal overflow at a narrow mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToLanding(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('demo.mp4 is never automatically requested, and no Supabase API requests happen on landing', async ({ page }) => {
    const requestedUrls = [];
    page.on('request', (req) => requestedUrls.push(req.url()));
    await goToLanding(page);
    await page.waitForTimeout(1500); // give autoplay/scene machinery a moment to settle
    expect(requestedUrls.some((u) => u.includes('demo.mp4'))).toBe(false);
    // The Supabase *library* script tag is shared boot infrastructure loaded
    // on every route (including this one) — that's just fetching a JS file,
    // not calling the backend. What must never happen on the landing page is
    // a request to the actual Supabase project (REST/Realtime/Auth/Storage).
    expect(requestedUrls.some((u) => u.includes('ddehkgdssdhhwpqljbiq.supabase.co'))).toBe(false);
  });

  test('no console or page errors on the landing page', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
      // Blocked third-party CDN requests (Supabase JS, Prism, QR code lib,
      // Google Fonts) are expected in this sandbox's network-restricted
      // test environment and logged by Chromium itself, not app code — see
      // supabaseAvailable() in helpers.js for the same caveat elsewhere in
      // this suite. Only app-code errors should fail this test.
      if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(msg.text());
    });
    await goToLanding(page);
    // Exercise every scene manually — the most likely place for a null-ref.
    for (const scene of ['collaborate', 'review', 'share', 'handoff', 'write']) {
      await page.locator(`.lp-demo-tab[data-scene="${scene}"]`).click();
      await page.waitForTimeout(100);
    }
    expect(errors).toEqual([]);
  });
});
