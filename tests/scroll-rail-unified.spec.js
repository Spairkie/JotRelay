// tests/scroll-rail-unified.spec.js
// Both editor surfaces' scroll rails share one mounting/positioning
// architecture (src/scroll-rail.js's ScrollRail + reposition()) and one
// smooth-scroll primitive (runSmoothScroll/isProgrammaticSmoothScroll +
// wireProportionalScrollSync) — this file covers the DOM ownership,
// geometry, visibility, and Split-mode sync guarantees that unification is
// supposed to hold. Per-surface tick/drag mechanics (thumb drag, single
// tick click, tick hover proximity) already have coverage in
// tests/live-editor-rendering.spec.js and aren't repeated here.

import { test, expect } from '@playwright/test';
import { createRoom, typeInEditor, setEditorMode } from './helpers.js';

const FILLER = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n'.repeat(30);
const DOC = `# Intro\n\n${FILLER}## Middle\n\n${FILLER}## End\n\n${FILLER}`;

test.describe('Scroll rail DOM ownership', () => {
  test('Live rail mounts under .editor-wrap, never inside .cm-editor', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC);
    await setEditorMode(page, 'preview');

    const rail = page.locator('.scroll-rail-live');
    await expect(rail).toBeVisible();
    expect(await rail.evaluate((el) => el.closest('.cm-editor'))).toBeNull();
    expect(await rail.evaluate((el) => el.parentElement === document.querySelector('.editor-wrap'))).toBe(true);
  });

  test('Write rail uses the same outer mounting strategy as the Live rail', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC); // typeInEditor leaves Write mode active
    const rail = page.locator('.scroll-rail-write');
    expect(await rail.evaluate((el) => el.parentElement === document.querySelector('.editor-wrap'))).toBe(true);
    expect(await rail.evaluate((el) => el.closest('.cm-editor'))).toBeNull();
  });
});

test.describe('Scroll rail geometry', () => {
  for (const [label, size] of [
    ['ordinary desktop width', { width: 1280, height: 900 }],
    ['wide desktop width', { width: 1800, height: 900 }],
  ]) {
    test(`Live rail hugs #note-live's own edges, not .cm-editor's inset ones (${label})`, async ({ page }) => {
      await page.setViewportSize(size);
      await createRoom(page);
      await typeInEditor(page, DOC);
      // Split mode gives #note-live real horizontal room to diverge from
      // .cm-editor by more than a couple of pixels at both widths.
      await setEditorMode(page, 'split');
      await page.locator('.note-live .cm-content').click();

      const rail = page.locator('.scroll-rail-live');
      await expect(rail).toBeVisible();

      const geom = await page.evaluate(() => {
        const rectOf = (sel) => document.querySelector(sel).getBoundingClientRect();
        const r = rectOf('#note-live');
        const cm = rectOf('#note-live .cm-editor');
        const rail = rectOf('.scroll-rail-live');
        return {
          liveTop: r.top, liveHeight: r.height, liveRight: r.right,
          cmRight: cm.right,
          railTop: rail.top, railHeight: rail.height, railRight: rail.right,
        };
      });

      // Tracks #note-live's own box...
      expect(Math.abs(geom.railTop - geom.liveTop)).toBeLessThan(2);
      expect(Math.abs(geom.railHeight - geom.liveHeight)).toBeLessThan(2);
      expect(Math.abs(geom.railRight - (geom.liveRight - 9))).toBeLessThan(2);

      // ...not .cm-editor's, which sits inset from it by #note-live's own
      // responsive padding. Assert that padding is actually non-trivial
      // here, or the rail-vs-.cm-editor divergence check below would pass
      // by coincidence rather than by testing anything real.
      const padding = geom.liveRight - geom.cmRight;
      expect(padding).toBeGreaterThan(8);
      expect(Math.abs(geom.railRight - (geom.cmRight - 9))).toBeGreaterThan(4);
    });
  }

  test('Split mode shows two rails in their own columns with no overlap', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC);
    await setEditorMode(page, 'split');
    await page.locator('.note-live .cm-content').click();

    const writeRail = page.locator('.scroll-rail-write');
    const liveRail = page.locator('.scroll-rail-live');
    await expect(writeRail).toBeVisible();
    await expect(liveRail).toBeVisible();

    const writeBox = await writeRail.boundingBox();
    const liveBox = await liveRail.boundingBox();
    expect(writeBox.x + writeBox.width).toBeLessThanOrEqual(liveBox.x);
  });
});

test.describe('Scroll rail visibility across modes', () => {
  test('mode switching never leaves a stale rail visible', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC); // starts in Write mode

    const writeRail = page.locator('.scroll-rail-write');
    const liveRail = page.locator('.scroll-rail-live');

    const expectFor = async (mode) => {
      if (mode === 'write') {
        await expect(writeRail).toBeVisible();
        await expect(liveRail).toBeHidden();
      } else if (mode === 'preview') {
        await expect(liveRail).toBeVisible();
        await expect(writeRail).toBeHidden();
      } else {
        await expect(writeRail).toBeVisible();
        await expect(liveRail).toBeVisible();
      }
    };

    await expectFor('write');
    for (const mode of ['preview', 'split', 'write', 'preview', 'split']) {
      await setEditorMode(page, mode);
      await expectFor(mode);
    }
  });
});

test.describe('Deliberate navigation smoothness', () => {
  test('clicking the bare rail track (not the thumb or a tick) jumps toward that position', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC);
    await setEditorMode(page, 'preview');
    await page.locator('.note-live .cm-content').click();

    const scroller = page.locator('.note-live .cm-scroller');
    const rail = page.locator('.scroll-rail-live');
    await expect(rail).not.toHaveCSS('height', '0px');

    const box = await rail.boundingBox();
    // Low on the track, well clear of the thumb (starts near the top) and
    // of any tick (ticks only hit-test meaningfully once hovered/faded in).
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12);

    // Asserted as an absolute "landed near the bottom" rather than "moved
    // forward from wherever it happened to start" — mode-switch scroll-
    // position transfer now carries over wherever Write was left (after
    // typeInEditor(), near the very end, since typing follows the caret),
    // and CM6's own selection/viewport bookkeeping can nudge scrollTop by a
    // few px on its own right after an explicit reset, so comparing
    // against a "before" snapshot here chases a moving target. A click 12px
    // from the very bottom of the track should land close to the maximum
    // scroll position regardless of where it started.
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop / (el.scrollHeight - el.clientHeight))).toBeGreaterThan(0.85);
  });

  test('[TOC] entry click smoothly navigates to its heading', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, `# Title\n\n[TOC]\n\n${FILLER}## Section A\n\n${FILLER}## Section B\n\n${FILLER}`);
    await setEditorMode(page, 'preview');
    await page.locator('.note-live .cm-content').click();
    await page.keyboard.press('Control+Home');

    const toc = page.locator('.note-live .cm-md-inline-toc');
    await expect(toc).toBeVisible();
    await toc.locator('summary').click();
    const links = toc.locator('a');
    await expect(links).toHaveCount(3); // Title, Section A, Section B

    const scroller = page.locator('.note-live .cm-scroller');
    const before = await scroller.evaluate((el) => el.scrollTop);
    await links.nth(2).click(); // Section B — far down the document
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  });

  test('a rapid second heading-tick click wins outright — the first jump cannot pull the view back afterward', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC);
    await setEditorMode(page, 'preview');
    await page.locator('.note-live .cm-content').click();

    const scroller = page.locator('.note-live .cm-scroller');
    const ticks = page.locator('.scroll-rail-live .scroll-rail-tick');
    await expect(ticks).toHaveCount(3); // Intro, Middle, End

    // Baseline: settle on "Middle" alone, from the very top.
    await page.keyboard.press('Control+Home');
    await ticks.nth(1).click();
    await page.waitForTimeout(900); // outlast runSmoothScroll's animation + settle poll
    const baseline = await scroller.evaluate((el) => el.scrollTop);

    // Reset, then fire "End" (far off-screen — engages the estimate/correct
    // dance) immediately followed by "Middle", before End's jump settles.
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await ticks.nth(2).click();
    await ticks.nth(1).click();
    await page.waitForTimeout(900);
    const finalTop = await scroller.evaluate((el) => el.scrollTop);

    expect(Math.abs(finalTop - baseline)).toBeLessThan(30);
  });
});

test.describe('Split-mode scroll sync', () => {
  test('a deliberate smooth jump reaches its target, the other pane follows, and normal sync still works afterward', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC);
    await setEditorMode(page, 'split');
    await page.locator('.note-live .cm-content').click();

    const editor = page.locator('#note-editor');
    const scroller = page.locator('.note-live .cm-scroller');
    await editor.evaluate((el) => { el.scrollTop = 0; });
    await scroller.evaluate((el) => { el.scrollTop = 0; });

    const ticks = page.locator('.scroll-rail-live .scroll-rail-tick');
    await expect(ticks).toHaveCount(3);
    await ticks.nth(2).click(); // End — far off-screen

    const readPositions = () => page.evaluate(async () => {
      const { getTextareaOffsetAtTop } = await import('/JotRelay/src/scroll-rail.js');
      const { getOffsetAtTop } = await import('/JotRelay/src/live-editor.js');
      const e = document.getElementById('note-editor');
      const s = document.querySelector('.note-live .cm-scroller');
      return {
        scrollerRatio: (s.scrollHeight - s.clientHeight) > 0 ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0,
        editorOffset: getTextareaOffsetAtTop(e, e.scrollTop),
        liveOffset: getOffsetAtTop(),
        docLength: e.value.length,
      };
    });

    // Reaches the destination rather than stopping halfway (a cancelled
    // native smooth scroll would freeze partway through) — polled, not a
    // fixed sleep, since this document is long enough that the native
    // smooth-scroll animation's real duration isn't guaranteed to fit any
    // one fixed wait. "End" sits roughly 2/3 through the document (it's
    // followed by its own trailing filler block), not at the very bottom.
    await expect.poll(async () => (await readPositions()).scrollerRatio, { timeout: 8000 }).toBeGreaterThan(0.6);
    // The opposite (Write) pane kept following the animated pane's live
    // position throughout, landing at the *same source position* — the
    // actual guarantee wireOffsetScrollSync() makes (see its own comment),
    // not a matching scroll percentage: Write's line-wrapping density and
    // CM6's rendered line heights don't produce identical ratios for the
    // same offset, so asserting ratio-closeness here would be checking a
    // property this mechanism never promised.
    const final = await readPositions();
    expect(Math.abs(final.editorOffset - final.liveOffset)).toBeLessThan(final.docLength * 0.02);

    // Sync isn't left disabled after that animation — an ordinary scroll on
    // the *other* pane still propagates normally. Re-asserted with a
    // generous timeout for the same reason as above: isProgrammaticSmoothScroll()
    // on the CM6 pane must have actually cleared before a write into it will
    // take effect at all, and that's gated on the same real animation
    // finishing, not on this test's own clock. wireOffsetScrollSync()'s own
    // rAF-throttle (scroll-rail.js) adds a "wait for the next animation
    // frame" indirection on top of that — under heavy system load (e.g. the
    // full suite running many browser processes at once) rAF callbacks can
    // be delayed well past what's noticeable running this file alone, so
    // this needs real margin rather than a tight bound tuned for isolation.
    await editor.evaluate((el) => { el.scrollTop = 0; });
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 20000 }).toBeLessThan(10);
  });
});
