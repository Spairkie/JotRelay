// tests/remote-caret-label-clip.spec.js
// A remote collaborator's name label floats above its caret's line
// (.cm-remote-caret-label, editor.css) — deliberate, Google-Docs-style. But
// .note-live clips overflow (its own overflow:hidden, wrapping CM6's
// .cm-scroller), so a caret on the very first visible line pokes its label
// above that clipped edge — invisible exactly when a collaborator's cursor
// is most likely to have just been scrolled into view. live-editor.js's
// _RemoteCaretLabelPlugin flips the label below the caret instead whenever
// that would happen.
//
// LiveEditor.mount() is called directly on the real #note-live element
// (after un-hiding #app-screen) rather than through createRoom() — no
// Supabase/network dependency, the same technique remote-selection.spec.js
// uses for LiveEditor.setRemoteCursors() itself, just without needing a
// real room around it.

import { test, expect } from '@playwright/test';
import { goToLanding } from './helpers.js';

async function mountLiveEditorDirect(page, doc) {
  await page.evaluate(async (doc) => {
    document.getElementById('app-screen').classList.remove('hidden');
    const host = document.getElementById('note-live');
    host.classList.remove('hidden');
    const LiveEditor = await import('/JotRelay/src/live-editor.js');
    LiveEditor.mount(host, doc, {});
  }, doc);
  await page.waitForTimeout(300);
}

async function setRemoteCursorAndReadLabel(page, pos) {
  return page.evaluate(async (pos) => {
    const LiveEditor = await import('/JotRelay/src/live-editor.js');
    LiveEditor.setRemoteCursors([{ id: 'dev1', name: 'Alice', pos }]);
    await new Promise((r) => setTimeout(r, 300));
    const label = document.querySelector('.cm-remote-caret-label');
    const scroller = document.querySelector('.note-live .cm-scroller');
    return {
      hasLabel: !!label,
      belowClass: label?.classList.contains('cm-remote-caret-label-below') ?? null,
      labelTop: label?.getBoundingClientRect().top ?? null,
      scrollerTop: scroller?.getBoundingClientRect().top ?? null,
    };
  }, pos);
}

test.describe('Remote caret label clipping at the scroller edge', () => {
  test('a caret on the very first line (nothing above it) flips its label below, staying unclipped', async ({ page }) => {
    await goToLanding(page);
    const lines = Array.from({ length: 20 }, (_, i) => `Line number ${i}`);
    await mountLiveEditorDirect(page, lines.join('\n'));

    const result = await setRemoteCursorAndReadLabel(page, 0);
    expect(result.hasLabel).toBe(true);
    expect(result.belowClass).toBe(true);
    // The whole point of flipping: the label must render AT OR BELOW the
    // scroller's own clipped top edge, not poking above it.
    expect(result.labelTop).toBeGreaterThanOrEqual(result.scrollerTop);
  });

  test('a caret with comfortable headroom above it renders normally (no flip)', async ({ page }) => {
    await goToLanding(page);
    const lines = Array.from({ length: 20 }, (_, i) => `Line number ${i}`);
    const doc = lines.join('\n');
    await mountLiveEditorDirect(page, doc);

    const targetPos = lines.slice(0, 5).reduce((sum, l) => sum + l.length + 1, 0);
    const result = await setRemoteCursorAndReadLabel(page, targetPos);
    expect(result.hasLabel).toBe(true);
    expect(result.belowClass).toBe(false);
  });

  test('moving the caret back to the first line re-flips the label (not a one-shot fluke)', async ({ page }) => {
    await goToLanding(page);
    const lines = Array.from({ length: 20 }, (_, i) => `Line number ${i}`);
    const doc = lines.join('\n');
    await mountLiveEditorDirect(page, doc);

    const targetPos = lines.slice(0, 5).reduce((sum, l) => sum + l.length + 1, 0);
    await setRemoteCursorAndReadLabel(page, targetPos); // away from the edge first
    const result = await setRemoteCursorAndReadLabel(page, 0); // back to the edge
    expect(result.belowClass).toBe(true);
  });
});
