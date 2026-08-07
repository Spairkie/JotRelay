// tests/onboarding.spec.js
// First-time product tour — see src/ui/onboarding.js. Every scenario needs
// a genuinely fresh room (isNewRoom: true triggers the tour), so these all
// use createFreshRoom() rather than the shared fixture room — and every
// call passes { skipOnboarding: false }, since createFreshRoom() seeds the
// tour's "seen" flag by default so its full-screen overlay doesn't
// intercept clicks in every *other* suite that uses it for an unrelated
// fresh room (settings.spec.js, history.spec.js, short-room-code.spec.js).

import { test, expect } from '@playwright/test';
import { createFreshRoom } from './helpers.js';

test.describe('First-time onboarding tour', () => {
  test('walks through all 4 steps end to end and marks itself seen', async ({ page }) => {
    await createFreshRoom(page, { skipOnboarding: false });

    const overlay = page.locator('#sp-onboarding-overlay');
    await expect(overlay).toHaveClass(/visible/);
    await expect(page.locator('#sp-onboarding-count')).toHaveText('1 of 4');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Your note');
    await expect(page.locator('#sp-onboarding-back')).toBeDisabled();

    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-count')).toHaveText('2 of 4');
    await expect(page.locator('#sp-onboarding-back')).toBeEnabled();

    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-count')).toHaveText('3 of 4');

    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-count')).toHaveText('4 of 4');
    await expect(page.locator('#sp-onboarding-next')).toHaveText('Done');

    await page.click('#sp-onboarding-next');
    await expect(overlay).not.toHaveClass(/visible/);

    const seen = await page.evaluate(() => localStorage.getItem('syncpad_onboarding_seen'));
    expect(seen).toBe('true');
  });

  test('Back navigates to the previous step', async ({ page }) => {
    await createFreshRoom(page, { skipOnboarding: false });
    await expect(page.locator('#sp-onboarding-overlay')).toHaveClass(/visible/);

    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Source, Live, or Split');

    await page.click('#sp-onboarding-back');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Your note');
  });

  test('Skip tour dismisses immediately and marks the tour seen', async ({ page }) => {
    await createFreshRoom(page, { skipOnboarding: false });
    const overlay = page.locator('#sp-onboarding-overlay');
    await expect(overlay).toHaveClass(/visible/);

    await page.click('#sp-onboarding-skip');
    await expect(overlay).not.toHaveClass(/visible/);

    const seen = await page.evaluate(() => localStorage.getItem('syncpad_onboarding_seen'));
    expect(seen).toBe('true');
  });

  test('Escape closes the tour', async ({ page }) => {
    await createFreshRoom(page, { skipOnboarding: false });
    const overlay = page.locator('#sp-onboarding-overlay');
    await expect(overlay).toHaveClass(/visible/);

    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveClass(/visible/);
  });

  test('does not reappear on a second room creation in the same browser', async ({ page }) => {
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
    await createFreshRoom(page, { skipOnboarding: false });
    await expect(page.locator('#sp-onboarding-overlay')).toHaveClass(/visible/);

    // startApp() focuses the editor before the tour opens; the tour must
    // claim focus for itself rather than leaving it on the page underneath.
    await expect(page.locator('#sp-onboarding-next')).toBeFocused();

    // Tab trap: Back is disabled on step 1, so Tab from Next wraps to Skip.
    await page.keyboard.press('Tab');
    await expect(page.locator('#sp-onboarding-skip')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#sp-onboarding-next')).toBeFocused();

    await page.click('#sp-onboarding-skip');
    // Focus returns to whatever had it before the tour opened (the editor
    // surface, focused by startApp() just before the tour) rather than
    // staying on the now-hidden Skip button or falling back to <body>.
    const focusedOutsideTour = await page.evaluate(() => {
      const el = document.activeElement;
      return !!el && el !== document.body && !document.getElementById('sp-onboarding-overlay')?.contains(el);
    });
    expect(focusedOutsideTour).toBe(true);
  });

  test('is removed from the tab order and accessibility tree once closed', async ({ page }) => {
    await createFreshRoom(page, { skipOnboarding: false });
    await page.click('#sp-onboarding-skip');
    await expect(page.locator('#sp-onboarding-overlay')).toHaveAttribute('inert', '');
  });

  test('does not advertise Split mode on a narrow viewport where it is hidden', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await createFreshRoom(page, { skipOnboarding: false });
    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Source or Live');
    const text = await page.locator('#sp-onboarding-text').textContent();
    expect(text).not.toContain('side by side');
  });
});
