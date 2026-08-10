// tests/pwa.spec.js
// Installability and offline behavior — the two things a PWA install
// actually promises. None of this touches Supabase, so it runs everywhere
// the rest of the suite does.

import { test, expect } from '@playwright/test';

// playwright.config.js sets serviceWorkers: 'block' globally so app-logic
// tests can't be disrupted by clients.claim() mid-evaluate() — but that
// means no service worker can ever register at all, which is exactly what
// this file needs to test. Override it back to 'allow' here only.
test.use({ serviceWorkers: 'allow' });

// page.waitForFunction(asyncPredicate) does not reliably await an async
// predicate under the default 'raf' polling strategy — it can resolve on
// the first poll with whatever the (still-pending) promise's truthiness
// is, rather than its eventually-resolved value, so callers can end up
// racing ahead before the service worker has actually activated. Polling
// from the Node side with a real per-iteration page.evaluate() sidesteps
// that. It also has to tolerate the page navigating out from under it:
// src/app/pwa.js reloads the page itself the first time a service worker
// takes control (via the 'controllerchange' event), which destroys the
// execution context of whichever evaluate() call is in flight at that
// moment — not a failure, just a signal to keep polling once the reload
// settles.
async function waitForServiceWorkerReady(page, timeout = 30_000) {
  const start = Date.now();
  for (;;) {
    try {
      const scope = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg?.active && navigator.serviceWorker.controller ? reg.scope : null;
      });
      if (scope) return scope;
    } catch (err) {
      if (!/context was destroyed|Target closed|Target page.*closed/i.test(String(err))) throw err;
    }
    if (Date.now() - start > timeout) {
      throw new Error('service worker did not activate and take control in time');
    }
    await page.waitForTimeout(200);
  }
}

test.describe('PWA installability', () => {
  test('manifest.json is valid with no Chrome-reported errors', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'newCDPSession (Page.getAppManifest/getInstallabilityErrors) is Chromium-only');
    const client = await page.context().newCDPSession(page);
    await client.send('Page.enable');
    await page.goto('/JotRelay/');
    await waitForServiceWorkerReady(page);
    // getAppManifest().errors only covers manifest retrieval/parsing (a
    // missing field, invalid JSON) — a manifest that parses fine but whose
    // icons are unreachable or undecodable would still pass that check
    // while never actually being installable. getInstallabilityErrors()
    // is Chrome's real beforeinstallprompt verdict, so assert both.
    const manifest = await client.send('Page.getAppManifest');
    expect(manifest.url).toContain('/JotRelay/manifest.json');
    expect(manifest.errors).toEqual([]);

    const installability = await client.send('Page.getInstallabilityErrors');
    expect(installability.installabilityErrors).toEqual([]);
  });

  test('service worker registers, activates, and takes control of the page', async ({ page }) => {
    await page.goto('/JotRelay/');
    const scope = await waitForServiceWorkerReady(page);
    expect(scope).toContain('/JotRelay/');
  });

  test('a direct navigation to a real same-origin file serves that file, not the app shell', async ({ page }) => {
    // service-worker.js's fetch handler maps SPA-route navigations (no file
    // extension, e.g. a room URL) to the cached index.html shell — but a
    // navigation to an actual file (the landing page's "Watch recorded
    // demo" link opens presskit/video/demo.mp4 in a new tab) must serve its
    // own real content instead, even once this worker is in control.
    await page.goto('/JotRelay/');
    await waitForServiceWorkerReady(page);

    const response = await page.goto('/JotRelay/presskit/video/demo.mp4', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('video/mp4');
  });
});

test.describe('Offline behavior', () => {
  test('the landing page reloads and renders while offline', async ({ page, context }) => {
    await page.goto('/JotRelay/');
    await waitForServiceWorkerReady(page);

    await context.setOffline(true);
    const response = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page.locator('#landing-screen')).toBeVisible();
    await context.setOffline(false);
  });

  test('the app-landing and a room route both still render their shell while offline', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'newCDPSession (Network.clearBrowserCache) is Chromium-only');
    await page.goto('/JotRelay/');
    await waitForServiceWorkerReady(page);
    // A same-origin navigation while still online, before going offline —
    // without this, the very first navigation issued after setOffline(true)
    // can fail at the network layer (net::ERR_INTERNET_DISCONNECTED) before
    // the service worker's fetch handler gets a chance to intercept it at
    // all, even though the handler's own SPA-fallback logic (service-worker.js)
    // doesn't care which route it's for. One real online navigation in this
    // browser context first avoids that race.
    await page.goto('/JotRelay/app/');

    await context.setOffline(true);
    await page.goto('/JotRelay/app/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app-landing-screen')).toBeVisible();

    // The priming navigation above leaves the browser's ordinary HTTP
    // cache warm with cross-origin CDN responses (Supabase, etc.) —
    // service-worker.js deliberately bypasses every cross-origin request
    // (only same-origin gets the SPA-shell fallback), so without clearing
    // that cache this room check would silently pass off the back of an
    // HTTP cache hit rather than exercising a genuine cold offline boot.
    const client = await page.context().newCDPSession(page);
    await client.send('Network.clearBrowserCache');

    const roomResponse = await page.goto('/JotRelay/offline-shell-check-room', { waitUntil: 'domcontentloaded' });
    expect(roomResponse?.status()).toBe(200);
    // The room's own JS can't reach Supabase (cross-origin, un-cached, and
    // offline) and correctly surfaces the app's loading-error/retry UI
    // rather than hanging or crashing — asserting on that element, not
    // just <body>, actually exercises room boot instead of only the
    // always-present cached index.html shell underneath it.
    await expect(page.locator('#loading-retry-btn')).toBeVisible();
    await context.setOffline(false);
  });
});
