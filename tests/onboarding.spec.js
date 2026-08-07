// tests/onboarding.spec.js
// First-time product tour — see src/ui/onboarding.js. Only the tests that
// actually exercise the *auto-trigger* mechanism itself (isNewRoom: true on
// a genuinely new room) use createFreshRoom() — every other scenario here
// is testing the tour's own behavior once it's already open, which doesn't
// need a fresh server-side room at all: openTourDirectly() calls
// startOnboardingTour() directly against the shared fixture room via
// createRoom(), the same "reach the real module through the app's own
// already-loaded instance" technique remote-selection.spec.js uses for
// setRemoteCursors(). This matters beyond speed: this suite alone used to
// perform 9-10 real room-creation inserts, which combined with the rest of
// the full suite's own createFreshRoom()/Create-button/join flows lands
// close enough to the anonymous-write rate limit's 60-rooms-per-15-minutes-
// per-IP cap (see supabase/migrations/0010) to risk a RATE_LIMITED cascade
// through unrelated tests on a real network-connected run, with no
// headroom left for fixture bootstrapping or Playwright's own retries.
// Down to 3 real creations now (2 here, 1 in "does not reappear").
//
// createFreshRoom() itself seeds the tour's "seen" flag by default so its
// full-screen overlay doesn't intercept clicks in every *other* suite that
// uses it for an unrelated fresh room (settings.spec.js, history.spec.js,
// short-room-code.spec.js) — the one test below that still needs
// createFreshRoom() passes { skipOnboarding: false } to opt back out.

import { test, expect } from '@playwright/test';
import { createFreshRoom, createRoom, openMoreMenu } from './helpers.js';

async function openTourDirectly(page) {
  await page.evaluate(async () => {
    const { startOnboardingTour } = await import('/SyncPad/src/ui/onboarding.js');
    startOnboardingTour();
  });
}

test.describe('First-time onboarding tour', () => {
  test('walks through all 5 steps end to end and marks itself seen', async ({ page }) => {
    await createFreshRoom(page, { skipOnboarding: false });

    const overlay = page.locator('#sp-onboarding-overlay');
    await expect(overlay).toHaveClass(/visible/);
    await expect(page.locator('#sp-onboarding-count')).toHaveText('1 of 5');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Your note');
    await expect(page.locator('#sp-onboarding-back')).toBeDisabled();
    // Dots mirror the same progress the aria-live text announces, purely
    // decoratively (aria-hidden — see _ensureOnboardingDom()'s comment).
    await expect(page.locator('#sp-onboarding-dots .onboarding-dot')).toHaveCount(5);
    await expect(page.locator('#sp-onboarding-dots .onboarding-dot.is-active')).toHaveCount(1);

    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-count')).toHaveText('2 of 5');
    await expect(page.locator('#sp-onboarding-back')).toBeEnabled();

    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-count')).toHaveText('3 of 5');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Command palette');

    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-count')).toHaveText('4 of 5');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Share this room');

    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-count')).toHaveText('5 of 5');
    await expect(page.locator('#sp-onboarding-next')).toHaveText('Done');

    await page.click('#sp-onboarding-next');
    await expect(overlay).not.toHaveClass(/visible/);

    const seen = await page.evaluate(() => localStorage.getItem('syncpad_onboarding_seen'));
    expect(seen).toBe('true');
  });

  test('the Command Palette step opens the real More dropdown to spotlight it, and closes it on leaving', async ({ page }) => {
    await createRoom(page);
    await openTourDirectly(page);
    const moreDropdown = page.locator('#more-dropdown');

    await page.click('#sp-onboarding-next'); // step 2: mode toggle
    await expect(moreDropdown).not.toHaveClass(/open/);

    await page.click('#sp-onboarding-next'); // step 3: command palette
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Command palette');
    // The real dropdown, not a mock — its own "Command Palette" menu item is
    // the thing actually spotlighted, so it has to be genuinely open (see
    // _setMoreMenuOpen()'s comment on why a merely-laid-out-but-hidden
    // dropdown item's bounding rect wouldn't be the right one to highlight).
    await expect(moreDropdown).toHaveClass(/open/);
    await expect(page.locator('#btn-command-palette')).toBeVisible();

    await page.click('#sp-onboarding-next'); // step 4: share
    await expect(moreDropdown).not.toHaveClass(/open/);
  });

  test('Back navigates to the previous step', async ({ page }) => {
    await createRoom(page);
    await openTourDirectly(page);
    await expect(page.locator('#sp-onboarding-overlay')).toHaveClass(/visible/);

    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Source, Live, or Split');

    await page.click('#sp-onboarding-back');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Your note');
  });

  test('Skip tour dismisses immediately and marks the tour seen', async ({ page }) => {
    await createRoom(page);
    await openTourDirectly(page);
    const overlay = page.locator('#sp-onboarding-overlay');
    await expect(overlay).toHaveClass(/visible/);

    await page.click('#sp-onboarding-skip');
    await expect(overlay).not.toHaveClass(/visible/);

    const seen = await page.evaluate(() => localStorage.getItem('syncpad_onboarding_seen'));
    expect(seen).toBe('true');
  });

  test('Escape closes the tour', async ({ page }) => {
    await createRoom(page);
    await openTourDirectly(page);
    const overlay = page.locator('#sp-onboarding-overlay');
    await expect(overlay).toHaveClass(/visible/);

    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveClass(/visible/);
  });

  test('does not reappear on a second room creation in the same browser', async ({ page }) => {
    // This one genuinely needs two real createFreshRoom() calls — it's
    // testing that the "seen, ever" guarantee holds across two distinct
    // rooms, which openTourDirectly()'s manual trigger can't stand in for.
    await createFreshRoom(page, { skipOnboarding: false });
    await expect(page.locator('#sp-onboarding-overlay')).toHaveClass(/visible/);
    await page.click('#sp-onboarding-skip');

    await createFreshRoom(page, { skipOnboarding: false });
    // The overlay element only exists once the tour has ever been started,
    // so on this second room it should never even be created — asserting
    // "not visible" on a possibly-absent element via .count() rather than
    // toHaveClass avoids a false pass if it happened to linger with stale
    // classes instead of testing that it truly never fires again.
    await expect(page.locator('#sp-onboarding-overlay.visible')).toHaveCount(0);
  });

  test('focuses the Next button on open, traps Tab, and restores focus on close', async ({ page }) => {
    await createRoom(page);
    await openTourDirectly(page);
    await expect(page.locator('#sp-onboarding-overlay')).toHaveClass(/visible/);

    // A real auto-triggered tour opens right after startApp() has focused
    // the editor; openTourDirectly() runs against an already-loaded room
    // where the editor is focused the same way, so this still exercises
    // "the tour must claim focus for itself rather than leaving it on the
    // page underneath" against a realistic pre-tour focus target.
    await expect(page.locator('#sp-onboarding-next')).toBeFocused();

    // Tab trap: Back is disabled on step 1, so Tab from Next wraps to Skip.
    await page.keyboard.press('Tab');
    await expect(page.locator('#sp-onboarding-skip')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#sp-onboarding-next')).toBeFocused();

    await page.click('#sp-onboarding-skip');
    // Focus returns to whatever had it before the tour opened rather than
    // staying on the now-hidden Skip button or falling back to <body>.
    const focusedOutsideTour = await page.evaluate(() => {
      const el = document.activeElement;
      return !!el && el !== document.body && !document.getElementById('sp-onboarding-overlay')?.contains(el);
    });
    expect(focusedOutsideTour).toBe(true);
  });

  test('is removed from the tab order and accessibility tree once closed', async ({ page }) => {
    await createRoom(page);
    await openTourDirectly(page);
    await page.click('#sp-onboarding-skip');
    await expect(page.locator('#sp-onboarding-overlay')).toHaveAttribute('inert', '');
  });

  test('does not advertise Split mode on a narrow viewport where it is hidden', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await createRoom(page);
    await openTourDirectly(page);
    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Source or Live');
    const text = await page.locator('#sp-onboarding-text').textContent();
    expect(text).not.toContain('side by side');
  });

  test('"Take the Tour" in the More menu replays the tour even after it has already been seen', async ({ page }) => {
    // The shared fixture room never triggers isNewRoom, so the automatic
    // tour never fires here — exactly the situation the manual replay entry
    // point is for: hasSeenOnboarding() only gates that automatic trigger,
    // not startOnboardingTour() itself (see src/app/header.js's wiring).
    await createRoom(page);
    await page.evaluate(() => localStorage.setItem('syncpad_onboarding_seen', 'true'));
    await expect(page.locator('#sp-onboarding-overlay.visible')).toHaveCount(0);

    await openMoreMenu(page);
    await page.click('#btn-replay-tour');

    const overlay = page.locator('#sp-onboarding-overlay');
    await expect(overlay).toHaveClass(/visible/);
    await expect(page.locator('#sp-onboarding-count')).toHaveText('1 of 5');
    // Clicking it closed the More dropdown the same way every other item in
    // that menu does (closeMoreDropdown() in src/app/header.js) — it
    // shouldn't be left open behind the tour it just opened.
    await expect(page.locator('#more-dropdown')).not.toHaveClass(/open/);
    // Focus lands on a visible control (#btn-more), not the now-hidden
    // menu item that launched it — see header.js's replay handler.
    await page.click('#sp-onboarding-skip');
    await expect(page.locator('#btn-more')).toBeFocused();
  });
});
