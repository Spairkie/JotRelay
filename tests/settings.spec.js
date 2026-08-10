// tests/settings.spec.js
// Settings panel: opening, expiration validation (no artificial minimum
// beyond a positive number of seconds), theme switching, file sort.

import { test, expect } from '@playwright/test';
import { createFreshRoom, openPanel, openMoreMenu, waitForToast } from './helpers.js';

async function openSettingsPanel(page) {
  if (await page.locator('#settings-panel.open').isVisible().catch(() => false)) return;
  await openMoreMenu(page);
  await page.locator('#btn-settings').click();
  await page.waitForSelector('#settings-panel.open', { timeout: 5000 });
}

test.describe('Settings panel', () => {
  test('opens and shows room settings', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await expect(page.locator('#settings-panel')).toBeVisible();
    // Should show some setting rows
    await expect(page.locator('#setting-passcode-btn')).toBeVisible();
  });

  test('expiration preset buttons are visible', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    // Expand expiration controls
    await page.locator('#setting-exp-btn').click();
    const expControls = page.locator('#setting-exp-controls');
    await expect(expControls).toBeVisible();
    // Should have at least one preset button
    await expect(page.locator('[data-exp-preset]').first()).toBeVisible();
  });

  test('30-second expiry preset is removed (B-2)', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-exp-btn').click();
    // The 30s preset chip must not exist — it was below the 5-minute minimum
    await expect(page.locator('[data-exp-preset="30s"]')).toHaveCount(0);
  });

  test('10-minute expiry preset is first and active by default (B-2)', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-exp-btn').click();
    // First preset chip should be the 10m one
    const firstChip = page.locator('[data-exp-preset]').first();
    await expect(firstChip).toHaveAttribute('data-exp-preset', '10m');
    await expect(firstChip).toHaveClass(/is-active/);
  });

  test('custom expiration accepts 1 second (no artificial floor)', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-exp-btn').click();
    await page.locator('[data-exp-preset="custom"]').click();
    await page.locator('#exp-custom-value').fill('1');
    await page.locator('#exp-custom-unit').selectOption('s');
    // Error should not be shown (we don't submit to DB in unit test context,
    // but client-side validation should pass — the apply btn click either
    // succeeds or shows a DB-level error, not a "too short" validation error).
    const errorEl = page.locator('#setting-exp-error');
    await page.locator('#setting-exp-apply-btn').click();
    if (await errorEl.isVisible()) {
      const text = await errorEl.textContent();
      expect(text).not.toMatch(/minimum/i);
    }
  });

  test('custom expiration rejects zero and negative values', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-exp-btn').click();
    await page.locator('[data-exp-preset="custom"]').click();
    await page.locator('#exp-custom-value').fill('0');
    await page.locator('#exp-custom-unit').selectOption('s');
    await page.locator('#setting-exp-apply-btn').click();
    await expect(page.locator('#setting-exp-error')).toContainText('greater than 0');
  });

  test('theme picker renders theme options', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    const themeOptions = page.locator('.theme-option');
    expect(await themeOptions.count()).toBeGreaterThanOrEqual(4);
  });

  test('clicking a theme option applies it to the document', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    const themes = page.locator('.theme-option');
    // Click the first theme option (Charcoal Amber) — the second option is
    // Midnight Blue, which is now the default (see theme.js's applyTheme():
    // the default theme is represented by *removing* data-theme rather than
    // setting it), so clicking it wouldn't produce an observable attribute.
    await themes.nth(0).click();
    // data-theme attribute on <html> should be updated
    const htmlTheme = await page.locator('html').getAttribute('data-theme');
    expect(htmlTheme).toBe('charcoal-amber');
  });

  test('switching themes re-tints the browser-tab favicon to match', async ({ page }) => {
    await createFreshRoom(page);
    const before = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');

    await openSettingsPanel(page);
    const themes = page.locator('.theme-option');
    // Use the first option (Charcoal Amber), not Midnight Blue — the room
    // already loads with Midnight Blue applied by default, so clicking it
    // would be a same-theme no-op and the favicon href wouldn't change.
    await themes.nth(0).click();

    const after = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
    expect(after).not.toBe(before);
    expect(after).toContain('data:image/svg+xml');
  });

  test('rapid theme switches never leave the PNG favicon fallback on a stale theme', async ({ page }) => {
    // Regression test: the PNG <link rel="icon"> fallbacks (what a browser
    // without SVG-favicon support actually displays) are re-rendered async
    // via an offscreen canvas. Switching themes twice in quick succession
    // starts two independent, unordered image-decode jobs — without a
    // generation token, an older theme's rasterization finishing after a
    // newer one's would win the final link.href and leave the PNG favicon
    // stuck on stale colors even though the page (and the SVG candidate)
    // already moved on. Artificially delay the FIRST call's decode so it
    // resolves after the second — the exact adversarial ordering the fix
    // has to survive — and confirm the final href still matches a clean,
    // uncontested rasterization of the theme actually applied last.
    await createFreshRoom(page);

    const reference = await page.evaluate(async () => {
      const { applyTheme } = await import('/JotRelay/src/theme.js');
      applyTheme('rose');
      await new Promise((r) => setTimeout(r, 400));
      return document.querySelector('link[rel="icon"][sizes="32x32"]').href;
    });

    const raced = await page.evaluate(async () => {
      const { applyTheme } = await import('/JotRelay/src/theme.js');
      const RealImage = window.Image;
      let callCount = 0;
      window.Image = function (...args) {
        const img = new RealImage(...args);
        const setSrc = Object.getOwnPropertyDescriptor(RealImage.prototype, 'src').set;
        Object.defineProperty(img, 'src', {
          set(v) {
            callCount++;
            const delay = callCount === 1 ? 250 : 20; // 1st call (midnight-blue) resolves LAST
            setTimeout(() => setSrc.call(img, v), delay);
          },
        });
        return img;
      };

      applyTheme('midnight-blue');
      applyTheme('rose');

      await new Promise((r) => setTimeout(r, 500));
      window.Image = RealImage;
      return document.querySelector('link[rel="icon"][sizes="32x32"]').href;
    });

    expect(raced).toBe(reference);
  });

  test('switching themes also re-tints apple-touch-icon (future "Add to Home Screen" installs)', async ({ page }) => {
    // apple-touch-icon isn't a room-scoped route element — it's static
    // index.html markup present regardless of route — so this doesn't need
    // a real room/Supabase to verify, unlike the SVG/PNG favicon tests
    // above (which exercise it through the Settings panel's theme picker).
    await page.goto('/JotRelay/');
    const result = await page.evaluate(async () => {
      const { applyTheme } = await import('/JotRelay/src/theme.js');
      const link = document.querySelector('link[rel="apple-touch-icon"]');
      const before = link.href;
      applyTheme('forest-green');
      await new Promise((r) => setTimeout(r, 300));
      return { before, after: link.href };
    });
    expect(result.after).not.toBe(result.before);
    expect(result.after).toContain('data:image/png');
  });

  test('theme picker does not overflow the settings panel horizontally', async ({ page }) => {
    // Regression test: .theme-picker's grid-template-columns: 1fr 1fr tracks
    // defaulted to their content's min-content width (the longest theme
    // label's full unwrapped text) instead of actually shrinking to fit,
    // because only .theme-label (not .theme-option, the grid item itself)
    // had overflow:hidden. That silently overflowed .panel-body
    // horizontally, which — because .panel-body already sets
    // overflow-y:auto — promoted overflow-x to auto too, producing an
    // unwanted sideways scroll. See styles/panels.css .theme-option's
    // min-width:0 for the fix.
    await createFreshRoom(page);
    await openSettingsPanel(page);
    const overflow = await page.evaluate(() => {
      const body   = document.querySelector('#settings-panel .panel-body');
      const picker = document.getElementById('theme-picker');
      return {
        bodyOverflowsX:   body.scrollWidth   > body.clientWidth,
        pickerOverflowsX: picker.scrollWidth > picker.clientWidth,
      };
    });
    expect(overflow.bodyOverflowsX).toBe(false);
    expect(overflow.pickerOverflowsX).toBe(false);
  });

  test('strip formatting on paste toggle is visible', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    const btn = page.locator('#setting-strip-paste-btn');
    await expect(btn).toBeVisible();
  });

  test('strip formatting on paste toggles between On and Off', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    const btn = page.locator('#setting-strip-paste-btn');

    // Default state is Off
    await expect(btn).toHaveText('Off');

    // Click to enable
    await btn.click();
    await expect(btn).toHaveText('On');

    // Click to disable
    await btn.click();
    await expect(btn).toHaveText('Off');
  });
});

test.describe('View-once mode', () => {
  test('view-once toggle button is visible in settings panel', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await expect(page.locator('#setting-vo-btn')).toBeVisible();
  });

  test('view-once status element is present', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await expect(page.locator('#setting-vo-status')).toBeVisible();
  });

  test('clicking view-once button toggles the status text', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    const btn    = page.locator('#setting-vo-btn');
    const status = page.locator('#setting-vo-status');

    const before = await status.textContent();
    await btn.click();
    // Status text should change after toggling
    await expect(status).not.toHaveText(before || '', { timeout: 5000 });
    // Toggle back
    await btn.click();
    await expect(status).toHaveText(before || '', { timeout: 5000 });
  });

  test('consumeViewOnce is atomic — two racing consumers cannot both win (SP-AUDIT-0006)', async ({ page }) => {
    const roomId = await createFreshRoom(page);

    // consumeViewOnceAtomic() conditions its UPDATE on viewed=false, so of
    // two consumers racing from the exact same pre-consumption room
    // snapshot (as two viewers opening the same view-once link nearly
    // simultaneously would), only one write can go through — never both,
    // and never neither.
    const result = await page.evaluate(async (rid) => {
      const { enableViewOnce, consumeViewOnce } = await import('/JotRelay/src/settings.js');
      const { loadRoom } = await import('/JotRelay/src/rooms.js');
      await enableViewOnce(rid);
      const room = await loadRoom(rid);
      const [a, b] = await Promise.all([
        consumeViewOnce(rid, room, false, 'seen by A'),
        consumeViewOnce(rid, room, false, 'seen by B'),
      ]);
      const after = await loadRoom(rid);
      return { a, b, viewed: after.viewed, clearedReason: after.cleared_reason };
    }, roomId);

    // Exactly one side won the race.
    expect(result.a !== result.b).toBe(true);
    expect(result.viewed).toBe(true);
    expect(result.clearedReason).toBe('view_once');
  });
});

test.describe('Device limit', () => {
  test('device limit toggle button and input are visible in settings panel', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await expect(page.locator('#setting-dl-btn')).toBeVisible();
    await expect(page.locator('#setting-dl-input')).toBeVisible();
  });

  test('rejects an out-of-range device count without enabling', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await page.fill('#setting-dl-input', '0');
    await page.click('#setting-dl-btn');
    await expect(page.locator('#setting-dl-status')).toContainText('Off', { timeout: 5000 });
    await expect(page.locator('#setting-dl-btn')).toHaveText('Enable');
  });

  test('clicking the button toggles the status text and disables the input while armed', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    const btn    = page.locator('#setting-dl-btn');
    const status = page.locator('#setting-dl-status');
    const input  = page.locator('#setting-dl-input');

    await input.fill('3');
    await btn.click();
    await expect(status).toContainText('Armed', { timeout: 5000 });
    await expect(btn).toHaveText('Disable');
    await expect(input).toBeDisabled();

    await btn.click();
    await expect(status).toContainText('Off', { timeout: 5000 });
    await expect(btn).toHaveText('Enable');
    await expect(input).toBeEnabled();
  });
});

test.describe('Lock editing', () => {
  test('lock editing button is visible in settings panel for owner', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    await expect(page.locator('#setting-lock-btn')).toBeVisible();
  });

  test('clicking lock button makes editor read-only', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    const lockBtn = page.locator('#setting-lock-btn');

    await lockBtn.click();
    // Wait for the setting to apply
    await page.waitForTimeout(1000);

    // Editor should be disabled / read-only
    const editor = page.locator('#note-editor');
    const isReadOnly = await editor.evaluate(el => el.readOnly || el.disabled);
    expect(isReadOnly).toBe(true);
  });

  test('clicking lock button again unlocks the editor', async ({ page }) => {
    await createFreshRoom(page);
    await openSettingsPanel(page);
    const lockBtn = page.locator('#setting-lock-btn');

    // Lock
    await lockBtn.click();
    await page.waitForTimeout(1000);

    // The settings panel stays open across the lock toggle (see
    // setting-lock-btn's handler in src/app/panels.js) — just click Unlock.
    await page.locator('#setting-lock-btn').click();
    await page.waitForTimeout(1000);

    // Editor should be editable again
    const editor = page.locator('#note-editor');
    const isReadOnly = await editor.evaluate(el => el.readOnly || el.disabled);
    expect(isReadOnly).toBe(false);
  });
});

test.describe('File sort', () => {
  test('file sort dropdown is visible in the files panel', async ({ page }) => {
    await createFreshRoom(page);
    await openPanel(page, 'files');
    const sortSelect = page.locator('#files-sort');
    await expect(sortSelect).toBeVisible();
  });

  test('file sort dropdown has the expected ordering options', async ({ page }) => {
    await createFreshRoom(page);
    await openPanel(page, 'files');
    const sortSelect = page.locator('#files-sort');
    const options = await sortSelect.locator('option').allTextContents();
    // Should include at least newest, oldest, name-asc, name-desc
    const joined = options.join(' ').toLowerCase();
    expect(joined).toContain('newest');
    expect(joined).toContain('oldest');
    expect(joined).toContain('name');
  });

  test('file sort defaults to "newest"', async ({ page }) => {
    await createFreshRoom(page);
    await openPanel(page, 'files');
    const sortSelect = page.locator('#files-sort');
    const value = await sortSelect.inputValue();
    expect(value).toBe('newest');
  });
});
