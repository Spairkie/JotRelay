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
  test('manifest.json is valid with no Chrome-reported errors', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Page.enable');
    await page.goto('/SyncPad/');
    // Chrome's own installability parser — the real signal it uses to
    // decide whether to fire beforeinstallprompt, not just "the file
    // fetches and JSON.parses".
    const manifest = await client.send('Page.getAppManifest');
    expect(manifest.url).toContain('/SyncPad/manifest.json');
    expect(manifest.errors).toEqual([]);
  });

  test('service worker registers, activates, and takes control of the page', async ({ page }) => {
    await page.goto('/SyncPad/');
    const scope = await waitForServiceWorkerReady(page);
    expect(scope).toContain('/SyncPad/');
  });
});

test.describe('Offline behavior', () => {
  test('the landing page reloads and renders while offline', async ({ page, context }) => {
    await page.goto('/SyncPad/');
    await waitForServiceWorkerReady(page);

    await context.setOffline(true);
    const response = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page.locator('#landing-screen')).toBeVisible();
    await context.setOffline(false);
  });

  test('the app-landing and a room route both still render their shell while offline', async ({ page, context }) => {
    await page.goto('/SyncPad/');
    await waitForServiceWorkerReady(page);
    // A same-origin navigation while still online, before going offline —
    // without this, the very first navigation issued after setOffline(true)
    // can fail at the network layer (net::ERR_INTERNET_DISCONNECTED) before
    // the service worker's fetch handler gets a chance to intercept it at
    // all, even though the handler's own SPA-fallback logic (service-worker.js)
    // doesn't care which route it's for. One real online navigation in this
    // browser context first avoids that race.
    await page.goto('/SyncPad/app/');

    await context.setOffline(true);
    await page.goto('/SyncPad/app/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app-landing-screen')).toBeVisible();

    const roomResponse = await page.goto('/SyncPad/offline-shell-check-room', { waitUntil: 'domcontentloaded' });
    expect(roomResponse?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
    await context.setOffline(false);
  });
});
