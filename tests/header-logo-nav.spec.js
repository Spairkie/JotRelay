// tests/header-logo-nav.spec.js
// The in-room header logo (#app-screen's .app-header) links to the
// create/join screen (/JotRelay/app/), not the marketing landing page — this
// header is only ever visible once you're already inside a room, so "start
// or join another room" is the useful destination, not the pitch page.
// #app-screen's markup (and this static href) is present in the DOM
// regardless of route — just hidden until that screen is active — so this
// doesn't need a real room/Supabase to verify.

import { test, expect } from '@playwright/test';

test('the header logo inside a room points to /JotRelay/app/, not the landing page', async ({ page }) => {
  await page.goto('/JotRelay/');
  // .href (the resolved property, not the raw attribute) — the href is a
  // <base>-relative "app/" in the markup (see index.html's header comment),
  // resolved to an absolute URL by the browser exactly like real navigation
  // would use.
  const href = await page.locator('.header-logo').evaluate((el) => el.href);
  expect(href).toBe(new URL('/JotRelay/app/', page.url()).href);
});
