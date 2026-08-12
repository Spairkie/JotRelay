// tests/scroll-continuity.spec.js
// Scroll position should feel continuous across mode switches (Write <->
// Live <-> Split) and across visits to the same room — see
// src/scroll-rail.js's getTextareaOffsetAtTop/measureTextareaOffsetTop,
// live-editor.js's getOffsetAtTop/scrollOffsetToTop, and src/scroll-memory.js
// for the shared "top-visible source offset" anchor these tests exercise
// from the outside, via comments-preview.js's _applyMarkdownMode (mode
// switches) and room-lifecycle.js's startApp (persisted position).

import { test, expect } from '@playwright/test';
import { createRoom, typeInEditor, setEditorMode, ensureWriteMode } from './helpers.js';

const FILLER = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n'.repeat(60);
const DOC = `# Intro\n\n${FILLER}## Middle\n\n${FILLER}## End\n\n${FILLER}`;

async function ratioOf(locator) {
  return locator.evaluate((el) => el.scrollTop / (el.scrollHeight - el.clientHeight));
}

test.describe('Mode-switch scroll transfer', () => {
  test('Write -> Preview keeps roughly the same reading position', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC);
    const editor = page.locator('#note-editor');
    await editor.evaluate((el) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.45; });
    await page.waitForTimeout(100);
    const writeRatio = await ratioOf(editor);

    await setEditorMode(page, 'preview');
    await page.waitForTimeout(500); // LiveEditor.refreshLayout()'s own settle delay

    const liveRatio = await ratioOf(page.locator('.note-live .cm-scroller'));
    expect(Math.abs(liveRatio - writeRatio)).toBeLessThan(0.05);
  });

  test('Preview -> Write keeps roughly the same reading position', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC);
    await setEditorMode(page, 'preview');
    const scroller = page.locator('.note-live .cm-scroller');
    await scroller.evaluate((el) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.7; });
    await page.waitForTimeout(100);
    const liveRatio = await ratioOf(scroller);

    await setEditorMode(page, 'write');
    await page.waitForTimeout(100);
    const writeRatio = await ratioOf(page.locator('#note-editor'));
    expect(Math.abs(writeRatio - liveRatio)).toBeLessThan(0.05);
  });

  test('entering Split transfers position onto the newly-visible pane', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC);
    const editor = page.locator('#note-editor');
    await editor.evaluate((el) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.6; });
    await page.waitForTimeout(100);
    const writeRatio = await ratioOf(editor);

    await setEditorMode(page, 'split');
    await page.waitForTimeout(300);
    const liveRatio = await ratioOf(page.locator('.note-live .cm-scroller'));
    expect(Math.abs(liveRatio - writeRatio)).toBeLessThan(0.05);
  });

  test('mode switching never leaves scroll position at a stale spot from an earlier visit to that surface', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC);

    // Visit Preview once, scroll it far down, then leave.
    await setEditorMode(page, 'preview');
    await page.locator('.note-live .cm-scroller').evaluate((el) => { el.scrollTop = el.scrollHeight - el.clientHeight; });
    await page.waitForTimeout(100);
    await setEditorMode(page, 'write');

    // Scroll Write to somewhere else entirely, then go back to Preview —
    // it should reflect *this* position, not the stale one from before.
    const editor = page.locator('#note-editor');
    await editor.evaluate((el) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.2; });
    await page.waitForTimeout(100);
    const writeRatio = await ratioOf(editor);

    await setEditorMode(page, 'preview');
    await page.waitForTimeout(300);
    const liveRatio = await ratioOf(page.locator('.note-live .cm-scroller'));
    expect(Math.abs(liveRatio - writeRatio)).toBeLessThan(0.05);
  });
});

test.describe('Split-mode continuous sync (offset-anchored)', () => {
  test('scrolling one pane keeps the other at the matching source position', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, DOC);
    await setEditorMode(page, 'split');
    await page.locator('.note-live .cm-content').click();

    const editor = page.locator('#note-editor');
    const scroller = page.locator('.note-live .cm-scroller');
    await editor.evaluate((el) => { el.scrollTop = 0; });
    await scroller.evaluate((el) => { el.scrollTop = 0; });

    await editor.evaluate((el) => { el.scrollTop = 3000; });
    await page.waitForTimeout(400);

    const editorRatio = await ratioOf(editor);
    const scrollerRatio = await ratioOf(scroller);
    expect(Math.abs(editorRatio - scrollerRatio)).toBeLessThan(0.02);
  });
});

test.describe('Persisted last-scroll-position', () => {
  test('a fresh (never-visited) room starts at the top', async ({ page }) => {
    const roomId = await createRoom(page);
    await typeInEditor(page, DOC);
    await expect(page.locator('#status-text')).toHaveText('Saved', { timeout: 5000 });
    // Navigated away rather than reloaded in place: leaving the room fires
    // its own teardown flush (see room-lifecycle.js's teardownRealtimeSession
    // -> flushScrollPosition, and editor-behavior.js's beforeunload/pagehide
    // handlers for the reload case) which re-saves whatever the *real*
    // current position is — near the end here, since typing this much text
    // leaves the caret (and view) scrolled there. Clearing localStorage
    // and then reloading in place would just race that flush: the handler
    // fires during the reload's own unload phase and rewrites the entry
    // right back, after this test's removeItem() but before the fresh load
    // reads it. Going through a real navigation away first lets that flush
    // land normally (matching, harmless) while nothing else is running, so
    // clearing afterward — from outside the room — actually sticks.
    await page.goto('/JotRelay/app/');
    await page.evaluate((id) => localStorage.removeItem('syncpad_scroll_' + id), roomId);

    await page.goto(`/JotRelay/${roomId}`);
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15000 });
    await ensureWriteMode(page);
    await page.waitForTimeout(500);
    const scrollTop = await page.locator('#note-editor').evaluate((el) => el.scrollTop);
    // Functionally "at the top" — not necessarily pixel-0: the fallback
    // path re-asserts whatever position the load already had *before*
    // startup's auto-focus (see room-lifecycle.js's _preFocusOffset), which
    // can land a handful of pixels into the first line depending on exactly
    // where that measurement rounds to, not literally 0.
    expect(scrollTop).toBeLessThan(60);
  });

  test('a returning visit with unchanged content restores the remembered position', async ({ page }) => {
    const roomId = await createRoom(page);
    await typeInEditor(page, DOC);
    await expect(page.locator('#status-text')).toHaveText('Saved', { timeout: 5000 });
    const text = await page.locator('#note-editor').inputValue();

    // Seed a remembered position directly rather than waiting on the
    // periodic save's own interval — that mechanism gets its own dedicated
    // test below; this one is purely about the restore side.
    await page.evaluate(async ({ roomId, text }) => {
      const mod = await import('/JotRelay/src/scroll-memory.js');
      mod.saveScrollOffset(roomId, text, Math.floor(text.length * 0.5));
    }, { roomId, text });

    await page.reload();
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15000 });
    await ensureWriteMode(page);
    await page.waitForTimeout(500);
    const scrollTop = await page.locator('#note-editor').evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(100);
  });

  test('a returning visit where the content changed does not restore — starts at the top instead', async ({ page }) => {
    const roomId = await createRoom(page);
    await typeInEditor(page, DOC);
    await expect(page.locator('#status-text')).toHaveText('Saved', { timeout: 5000 });

    // Navigated away first, same reasoning as the "fresh room" test above:
    // this device's own teardown flush would otherwise immediately re-save
    // a *matching* offset over the deliberately-stale fixture seeded below,
    // since as far as this live session is concerned the content never
    // actually changed. Leaving the room lets that flush land normally
    // first; the fixture is then seeded from outside, with nothing left
    // running to clobber it.
    await page.goto('/JotRelay/app/');

    // Seeded against content that does NOT match what's actually in the
    // room — simulates a remote edit landing between visits, which must
    // invalidate the saved position (fingerprint mismatch).
    await page.evaluate(async (roomId) => {
      const mod = await import('/JotRelay/src/scroll-memory.js');
      mod.saveScrollOffset(roomId, 'completely different stale content', 500);
    }, roomId);

    await page.goto(`/JotRelay/${roomId}`);
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15000 });
    await ensureWriteMode(page);
    await page.waitForTimeout(500);
    const scrollTop = await page.locator('#note-editor').evaluate((el) => el.scrollTop);
    // Functionally "at the top" — see the first test's own comment on why
    // this isn't asserted as exactly 0.
    expect(scrollTop).toBeLessThan(60);
  });

  test('scroll position is periodically saved while the room stays open', async ({ page }) => {
    const roomId = await createRoom(page);
    await page.evaluate((id) => localStorage.removeItem('syncpad_scroll_' + id), roomId);
    await typeInEditor(page, DOC);
    await page.locator('#note-editor').evaluate((el) => { el.scrollTop = 4000; });

    await expect.poll(
      () => page.evaluate((id) => localStorage.getItem('syncpad_scroll_' + id), roomId),
      { timeout: 4000 },
    ).not.toBeNull();
    const saved = JSON.parse(await page.evaluate((id) => localStorage.getItem('syncpad_scroll_' + id), roomId));
    expect(saved.offset).toBeGreaterThan(0);
  });

  test('clearing the room (remote or local) clears the remembered position', async ({ page }) => {
    const roomId = await createRoom(page);
    await typeInEditor(page, DOC);
    await expect(page.locator('#status-text')).toHaveText('Saved', { timeout: 5000 });

    await page.evaluate(async (roomId) => {
      const mod = await import('/JotRelay/src/scroll-memory.js');
      mod.saveScrollOffset(roomId, 'x', 5);
    }, roomId);
    expect(await page.evaluate((id) => localStorage.getItem('syncpad_scroll_' + id), roomId)).not.toBeNull();

    await page.evaluate(async (roomId) => {
      const mod = await import('/JotRelay/src/scroll-memory.js');
      mod.clearScrollOffset(roomId);
    }, roomId);
    expect(await page.evaluate((id) => localStorage.getItem('syncpad_scroll_' + id), roomId)).toBeNull();
  });
});
