// tests/onboarding.spec.js
// First-time product tour — see src/ui/onboarding.js. Every scenario needs
// a genuinely fresh room (isNewRoom: true triggers the tour), so these all
// use createFreshRoom() rather than the shared fixture room.

import { test, expect } from '@playwright/test';
import { createFreshRoom } from './helpers.js';

test.describe('First-time onboarding tour', () => {
  test('walks through all 4 steps end to end and marks itself seen', async ({ page }) => {
    await createFreshRoom(page);

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
    await createFreshRoom(page);
    await expect(page.locator('#sp-onboarding-overlay')).toHaveClass(/visible/);

    await page.click('#sp-onboarding-next');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Source, Live, or Split');

    await page.click('#sp-onboarding-back');
    await expect(page.locator('#sp-onboarding-title')).toHaveText('Your note');
  });

  test('Skip tour dismisses immediately and marks the tour seen', async ({ page }) => {
    await createFreshRoom(page);
    const overlay = page.locator('#sp-onboarding-overlay');
    await expect(overlay).toHaveClass(/visible/);

    await page.click('#sp-onboarding-skip');
    await expect(overlay).not.toHaveClass(/visible/);

    const seen = await page.evaluate(() => localStorage.getItem('syncpad_onboarding_seen'));
    expect(seen).toBe('true');
  });

  test('Escape closes the tour', async ({ page }) => {
    await createFreshRoom(page);
    const overlay = page.locator('#sp-onboarding-overlay');
    await expect(overlay).toHaveClass(/visible/);

    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveClass(/visible/);
  });

  test('does not reappear on a second room creation in the same browser', async ({ page }) => {
    await createFreshRoom(page);
    await expect(page.locator('#sp-onboarding-overlay')).toHaveClass(/visible/);
    await page.click('#sp-onboarding-skip');

    await createFreshRoom(page);
    // The overlay element only exists once the tour has ever been started,
    // so on this second room it should never even be created — asserting
    // "not visible" on a possibly-absent element via .count() rather than
    // toHaveClass avoids a false pass if it happened to linger with stale
    // classes instead of testing that it truly never fires again.
    await expect(page.locator('#sp-onboarding-overlay.visible')).toHaveCount(0);
  });
});
