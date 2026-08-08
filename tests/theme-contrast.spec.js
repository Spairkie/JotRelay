// tests/theme-contrast.spec.js
// Accessibility guard: every theme's --text-inverse-on---accent combination
// (the widely-used filled-button style — .modal-btn-confirm, primary CTAs,
// Copy buttons, etc., see styles/*.css) must clear WCAG AA's 4.5:1 contrast
// ratio for normal-size text. paper-light and arctic originally shipped with
// accents that read 3.37:1 and 3.74:1 against white button text — this test
// exists so a future theme (or an edit to an existing one) can't silently
// reintroduce that gap.

import { test, expect } from '@playwright/test';
import { goToLanding } from './helpers.js';

test.describe('Theme accent contrast', () => {
  test('every theme\'s text-inverse-on-accent contrast is at least 4.5:1 (WCAG AA)', async ({ page }) => {
    await goToLanding(page);

    const results = await page.evaluate(async () => {
      const { THEMES, applyTheme } = await import('/SyncPad/src/theme.js');

      function lin(c) {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }
      function luminance(hex) {
        hex = hex.replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      }
      function contrast(a, b) {
        const l1 = luminance(a), l2 = luminance(b);
        const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
        return (hi + 0.05) / (lo + 0.05);
      }
      const out = [];
      for (const t of THEMES) {
        applyTheme(t.id);
        const cs = getComputedStyle(document.documentElement);
        // Custom properties return their raw declared text verbatim (not
        // resolved to rgb() the way a computed *used* color value would be),
        // and every theme declares --accent/--text-inverse as a literal hex
        // string — so this is already hex, just needs trimming.
        const accent = cs.getPropertyValue('--accent').trim();
        const inverse = cs.getPropertyValue('--text-inverse').trim();
        out.push({ id: t.id, ratio: contrast(accent, inverse) });
      }
      return out;
    });

    for (const { id, ratio } of results) {
      expect(ratio, `theme "${id}": text-inverse on accent contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
