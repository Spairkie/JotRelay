// tests/timed-reveal.spec.js
// Timed reveal: the Settings panel UI (mirrors tests/settings.spec.js's
// Auto-expire coverage) and the actual join-time gate — a non-creator
// visitor sees #reveal-screen until reveal_at passes, while the room's
// creator always sees the room normally.

import { test, expect } from '@playwright/test';
import { createFreshRoom } from './helpers.js';

async function openSettingsPanel(page) {
  if (await page.locator('#settings-panel.open').isVisible().catch(() => false)) return;
  await page.locator('#btn-more').click();
  await expect(page.locator('#more-dropdown')).toHaveClass(/open/, { timeout: 2000 });
  await page.locator('#btn-settings').click();
  await page.waitForSelector('#settings-panel.open', { timeout: 5000 });
}

test.describe('Timed reveal — Settings panel', () => {
  test('timed reveal row and preset buttons are visible', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-reveal-btn').click();
    const controls = page.locator('#setting-reveal-controls');
    await expect(controls).toBeVisible();
    await expect(page.locator('[data-reveal-preset]').first()).toBeVisible();
  });

  test('10-minute reveal preset is first and active by default', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-reveal-btn').click();
    const firstChip = page.locator('[data-reveal-preset]').first();
    await expect(firstChip).toHaveAttribute('data-reveal-preset', '10m');
    await expect(firstChip).toHaveClass(/is-active/);
  });

  test('custom reveal delay rejects zero and negative values', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-reveal-btn').click();
    await page.locator('[data-reveal-preset="custom"]').click();
    await page.locator('#reveal-custom-value').fill('0');
    await page.locator('#reveal-custom-unit').selectOption('s');
    await page.locator('#setting-reveal-apply-btn').click();
    await expect(page.locator('#setting-reveal-error')).toContainText('greater than 0');
  });

  test('setting a reveal updates the status line, removing it restores the default', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-reveal-btn').click();
    await page.locator('[data-reveal-preset="1h"]').click();
    await page.locator('#setting-reveal-apply-btn').click();
    await expect(page.locator('#setting-reveal-status')).toContainText('Hidden from others until', { timeout: 5000 });
    await expect(page.locator('#setting-reveal-btn')).toHaveText('Modify');

    await page.locator('#setting-reveal-remove-btn').click();
    await expect(page.locator('#setting-reveal-status')).toContainText('Off', { timeout: 5000 });
    await expect(page.locator('#setting-reveal-btn')).toHaveText('Set reveal');
  });
});

test.describe('Timed reveal — join gate', () => {
  test('the creator always sees the room normally, even with a reveal armed', async ({ page }) => {
    const roomId = await createFreshRoom(page);
    await page.evaluate(async (rid) => {
      const { setTimedReveal } = await import('/JotRelay/src/settings.js');
      await setTimedReveal(rid, '1h');
    }, roomId);

    await page.reload();
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    await expect(page.locator('#reveal-screen')).toHaveClass(/hidden/);
  });

  test('a different device sees the reveal-screen countdown, then is auto-revealed once it elapses', async ({ page }) => {
    const roomId = await createFreshRoom(page);
    // A very short delay (3s) so the test can observe the auto-transition
    // without an artificially long wait.
    await page.evaluate(async (rid) => {
      const { setTimedReveal } = await import('/JotRelay/src/settings.js');
      await setTimedReveal(rid, '3s');
    }, roomId);

    // Simulate "a different device" the simple way: this device's own
    // identity (src/utils.js's getDeviceId(), persisted at
    // localStorage['syncpad_device_id']) is what created_by_device is
    // compared against — swapping it for a fresh id and reloading is
    // equivalent to a second device visiting, without the added flakiness
    // of coordinating two real browser contexts through a live Realtime
    // room for what is otherwise a pure client-side comparison.
    await page.evaluate(() => {
      localStorage.setItem('syncpad_device_id', crypto.randomUUID());
    });
    await page.reload();
    await page.waitForSelector('#reveal-screen:not(.hidden)', { timeout: 15_000 });
    await expect(page.locator('#app-screen')).toHaveClass(/hidden/);
    await expect(page.locator('#reveal-countdown')).not.toHaveText('', { timeout: 5000 });

    // The reveal-screen's own timer (see _showRevealScreen() in
    // src/app/room-lifecycle.js) re-runs joinRoom() once reveal_at passes —
    // no manual reload needed.
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15_000 });
    await expect(page.locator('#reveal-screen')).toHaveClass(/hidden/);
  });
});
