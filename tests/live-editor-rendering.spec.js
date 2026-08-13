// tests/live-editor-rendering.spec.js
// The CM6-backed Live/Split surface (live-editor.js) is a separate rendering
// path from markdown.js's static renderMarkdown() — it decorates the same
// plain-markdown source directly rather than producing HTML, so features the
// static renderer supports aren't automatically covered here. GFM tables,
// GitHub-style alerts, and footnotes previously had no decoration at all in
// this surface (rendered as literal, unstyled markdown syntax); this file
// covers the fix.

import { test, expect } from '@playwright/test';
import { createRoom, typeInEditor, setEditorMode } from './helpers.js';

test.describe('Live/Split surface rendering', () => {
  test('GFM table renders as a real <table>, not literal pipe text', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, '| Left | Center | Right |\n|:---|:---:|---:|\n| a | b | c |\n');
    await setEditorMode(page, 'preview');
    // Cursor stays at the top of the doc (position 0) after mount; move it
    // away so the table isn't in its "being edited, show raw source" state.
    // Switching modes leaves DOM focus on the mode-toggle button, not the
    // CM6 surface, so Control+End must be preceded by a real click into it
    // — this table's own markdown starts at position 0, so an unfocused
    // Control+End (a no-op) leaves the cursor exactly touching the table.
    await page.locator('.note-live .cm-content').click();
    await page.keyboard.press('Control+End');

    const table = page.locator('.note-live table.cm-md-table');
    await expect(table).toBeVisible();
    await expect(table.locator('th').nth(0)).toHaveText('Left');
    await expect(table.locator('td').nth(0)).toHaveText('a');
  });

  test('GFM alert renders as a coloured box with an icon+label, not raw "[!NOTE]"', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, '> [!NOTE]\n> Useful information.\n');
    await setEditorMode(page, 'preview');
    await page.keyboard.press('Control+End');

    const alertLine = page.locator('.note-live .cm-md-alert-note');
    await expect(alertLine.first()).toBeVisible();
    await expect(page.locator('.note-live .cm-md-alert-title-note')).toHaveText('ℹ️ Note');
    await expect(page.locator('.note-live')).not.toContainText('[!NOTE]');
  });

  test('all five GFM alert kinds get their own class', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page,
      '> [!NOTE]\n> a\n\n> [!TIP]\n> b\n\n> [!IMPORTANT]\n> c\n\n> [!WARNING]\n> d\n\n> [!CAUTION]\n> e\n',
    );
    await setEditorMode(page, 'preview');
    await page.keyboard.press('Control+End');

    for (const kind of ['note', 'tip', 'important', 'warning', 'caution']) {
      await expect(page.locator(`.note-live .cm-md-alert-${kind}`).first()).toBeVisible();
    }
  });

  test('footnote reference renders as a superscript marker, not literal "[^1]"', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, 'A sentence with a footnote.[^1]\n\n[^1]: The footnote text.\n');
    await setEditorMode(page, 'preview');
    await page.keyboard.press('Control+Home');

    await expect(page.locator('.note-live sup.cm-md-footnote-ref')).toHaveText('1');
    await expect(page.locator('.note-live')).not.toContainText('[^1]');
  });

  test('clicking into a rendered table reveals its raw markdown for editing', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, '| A | B |\n|---|---|\n| 1 | 2 |\n');
    await setEditorMode(page, 'preview');
    // See the previous test's comment: a real click is required before
    // Control+End actually moves the CM6 cursor away from position 0.
    await page.locator('.note-live .cm-content').click();
    await page.keyboard.press('Control+End');
    await expect(page.locator('.note-live table.cm-md-table')).toBeVisible();

    await page.keyboard.press('Control+Home');
    await expect(page.locator('.note-live table.cm-md-table')).toHaveCount(0);
    await expect(page.locator('.note-live')).toContainText('| A | B |');
  });

  test('reference-style link labels fold away like inline links do, but a definition keeps its label visible', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page,
      'Text.\n\n[Reference link][ref1]\n\n[Reference link, collapsed][]\n\n' +
      '[ref1]: https://example.com "Title"\n[Reference link, collapsed]: https://example.com\n',
    );
    await setEditorMode(page, 'preview');
    await page.keyboard.press('Control+Home');

    const live = page.locator('.note-live');
    // The usage "[Reference link][ref1]" folds to just its visible text —
    // no raw "[Reference link][ref1]" or bracketed "[ref1]" survives next
    // to it (unlike the definition line below, which legitimately keeps
    // its own "[id]" label — a LinkReference node, not a Link usage — so a
    // blanket "no '[ref1]' anywhere" assertion would be self-contradictory).
    await expect(live).not.toContainText('[Reference link][ref1]');
    await expect(live).toContainText('Reference link');
    await expect(live).toContainText('[ref1]: https://example.com "Title"');
    await expect(live).toContainText('[Reference link, collapsed]: https://example.com');
  });

  test('a fenced code block with a language tag gets real syntax highlighting, not plain text', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, '```js\nfunction greet(name) {\n  return name;\n}\n```\n');
    await setEditorMode(page, 'preview');
    await page.keyboard.press('Control+End');

    // The code block gets its own background box (cm-md-codeblock), and its
    // content is broken into per-token highlighted spans rather than one
    // plain-text run — a keyword like "function" is not styled the same as
    // plain body text.
    await expect(page.locator('.note-live .cm-md-codeblock').first()).toBeVisible();
    const editor = page.locator('.note-live');
    await expect(editor).toContainText('function greet(name)');
    // At least one syntax-highlighted span should exist inside the code
    // block's line — distinct from a plain, unstyled text node.
    const highlightedTokens = page.locator('.note-live .cm-md-codeblock span[class]');
    expect(await highlightedTokens.count()).toBeGreaterThan(0);
  });

  test('a fenced code block with no language tag stays plain (no highlighting)', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, '```\nplain text code block\n```\n');
    await setEditorMode(page, 'preview');
    await page.keyboard.press('Control+End');

    await expect(page.locator('.note-live .cm-md-codeblock').first()).toBeVisible();
    await expect(page.locator('.note-live')).toContainText('plain text code block');
  });

  test('an unconverted emoji shortcode does not pick up string-literal coloring', async ({ page }) => {
    // markdownLanguage's own built-in Emoji extension tags any :word:-shaped
    // text with tags.character, which @lezer/highlight defines as a
    // sub-tag of tags.string — without an explicit override, the shared
    // HighlightStyle added for fenced-code string literals would visibly
    // (mis)color this literal, unconverted shortcode text as if it were a
    // real string. Uses the same "definitely not a real shortcode" fixture
    // as editor.spec.js — ":smile:" (an earlier version of this test) is
    // actually in markdown-emoji-map.js and gets converted to a real 😄
    // character, so it's never left as literal text to test the override
    // against in the first place.
    await createRoom(page);
    await typeInEditor(page, 'Shortcode: :not_a_real_shortcode: :rocket:\n');
    await setEditorMode(page, 'preview');
    await page.keyboard.press('Control+End');

    const shortcode = page.locator('.note-live').getByText(':not_a_real_shortcode:', { exact: true });
    await expect(shortcode).toBeVisible();
    const color = await shortcode.evaluate((el) => getComputedStyle(el).color);
    const bodyColor = await page.locator('.note-live').first().evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe(bodyColor);
  });

  test('[TOC] renders as a collapsed <details>, expanding its links on click', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, '# Title\n\n[TOC]\n\n## Section A\n\n## Section B\n');
    await setEditorMode(page, 'preview');
    await page.keyboard.press('Control+End');

    const toc = page.locator('.note-live .cm-md-inline-toc');
    await expect(toc).toBeVisible();
    // Same collapsed-by-default convention as the static renderer's
    // .md-inline-toc — a [TOC] block is a navigation aid, not primary
    // content, so it shouldn't dominate the screen with a full link list
    // the moment a document loads.
    await expect(toc).toHaveJSProperty('open', false);
    const links = toc.locator('a');
    await expect(links.first()).toBeHidden();
    expect(await links.count()).toBe(3);

    await toc.locator('summary').click();
    await expect(toc).toHaveJSProperty('open', true);
    await expect(links.first()).toBeVisible();
  });

  test('[TOC] as the very first line renders immediately (collapsed), before any click or keypress', async ({ page }) => {
    // Regression test: mount() never gives EditorState.create() an explicit
    // selection, so CM6 defaults to a bare cursor at position 0 — landing
    // exactly on this line since [TOC] is the first thing in the document.
    // That default cursor used to be indistinguishable from "the user is
    // editing this line", so the marker rendered its raw "[TOC]" text
    // instead of the widget until some other interaction moved the cursor
    // away. Deliberately no click/keypress/Control+End here, unlike the
    // test above — that's the whole point of this one.
    await createRoom(page);
    await typeInEditor(page, '[TOC]\n\n## Section A\n\n## Section B\n');
    await setEditorMode(page, 'preview');

    const toc = page.locator('.note-live .cm-md-inline-toc');
    await expect(toc).toBeVisible();
    await expect(toc).toHaveJSProperty('open', false);
    await expect(toc.locator('a')).toHaveCount(2);
  });

  test('[TOC] on line 1 renders immediately even when content arrives via a programmatic sync after mount', async ({ page }) => {
    // Regression test for a variant of the bug above that the "no click or
    // keypress" test doesn't cover: mount() can be called before real room
    // content is available (a room-load race) or the surface can already be
    // mounted and simply receive a full-document replacement afterward (a
    // remote edit arriving over Broadcast) — both go through syncFromText()
    // rather than EditorState.create(), so they never took the fix above's
    // isInitial path. CM6 maps the old selection through a syncFromText
    // change rather than resetting it, so a selection that was sitting at
    // position 0 (the default right after an empty mount) stayed touching a
    // [TOC] on line 1, and the marker was stuck rendering raw text forever
    // — "forever" because nothing else ever moves that cursor for a device
    // that hasn't interacted with the editor. Exercised directly against the
    // real module (no Supabase needed) per this repo's convention for
    // browser-only module logic.
    await page.goto('/JotRelay/');
    await page.evaluate(async () => {
      const { mount, syncFromText } = await import('/JotRelay/src/live-editor.js');
      const container = document.createElement('div');
      container.id = 'note-live-harness';
      document.body.appendChild(container);
      mount(container, '', {});
      syncFromText('[TOC]\n\n## Section A\n\n## Section B\n');
    });

    const toc = page.locator('#note-live-harness .cm-md-inline-toc');
    await expect(toc).toBeVisible();
    await expect(toc).toHaveJSProperty('open', false);
    await expect(toc.locator('a')).toHaveCount(2);
  });

  test('CM6 scroll rail: thumb stays ambiently visible, ticks stay hidden until hover', async ({ page }) => {
    await createRoom(page);
    const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n'.repeat(20);
    await typeInEditor(
      page,
      `# Intro\n\n${filler}## Middle\n\n${filler}## End\n\n${filler}`,
    );
    await setEditorMode(page, 'preview');

    // The thumb is a real scrollbar — ambiently visible at rest (never a
    // hard 0), same "there's obviously something to scroll" affordance a
    // native scrollbar gives for free.
    const thumb = page.locator('.scroll-rail-live .scroll-rail-thumb');
    await expect(thumb).toHaveCSS('opacity', '0.32');

    // The ticks (the heading "minimap") stay fully invisible until hovered —
    // unlike the thumb, nothing here is worth showing until the user is
    // actually looking for a section to jump to.
    const ticksLayer = page.locator('.scroll-rail-live .scroll-rail-ticks');
    await expect(ticksLayer).toHaveCSS('opacity', '0');

    const rail = page.locator('.scroll-rail-live');
    const railBox = await rail.boundingBox();
    await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + 10);
    await expect(ticksLayer).toHaveCSS('opacity', '1');

    // Moving away from the editor entirely hides the ticks again; the thumb
    // stays at its ambient opacity regardless.
    await page.mouse.move(railBox.x - 200, railBox.y - 40);
    await expect(ticksLayer).toHaveCSS('opacity', '0');
    await expect(thumb).toHaveCSS('opacity', '0.32');
  });

  test('CM6 scroll rail ticks only stand out near the pointer, per --proximity', async ({ page }) => {
    await createRoom(page);
    const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n'.repeat(20);
    await typeInEditor(
      page,
      `# Intro\n\n${filler}## Middle\n\n${filler}## End\n\n${filler}`,
    );
    await setEditorMode(page, 'preview');

    const rail = page.locator('.scroll-rail-live');
    const ticks = rail.locator('.scroll-rail-tick');
    await expect(ticks).toHaveCount(3);
    const firstTick = ticks.first();
    const lastTick = ticks.last();
    // CM6 keeps refining its height-map estimate for a few update cycles
    // right after a long document first mounts, which can re-trigger a real
    // tick-DOM rebuild (updateHeadings()'s own exact-match check, not just
    // this test) within the first moment or two. toBeVisible() alone
    // retries until *a* tick is visible, but a rebuild landing in the gap
    // between that check resolving and the boundingBox() call actually
    // running can still hand back null (confirmed live, more so under
    // heavier system load) — polling boundingBox() itself is what actually
    // waits out a rebuild happening at that exact moment, not just the one
    // before it.
    const pollBox = async (locator) => {
      let box = null;
      await expect.poll(async () => { box = await locator.boundingBox(); return box; }, { timeout: 5000 }).not.toBeNull();
      return box;
    };
    const firstBox = await pollBox(firstTick);
    const lastBox = await pollBox(lastTick);
    // Hover directly over the first tick — it should read as fully
    // prominent while a tick far down the rail stays dim.
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await expect.poll(() => firstTick.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const lastOpacityNearFirst = await lastTick.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(lastOpacityNearFirst)).toBeLessThan(0.3);

    // Move to the far tick instead — prominence should follow the pointer,
    // not stay pinned to whichever tick was first revealed.
    await page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2);
    await expect.poll(() => lastTick.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  });

  test('CM6 scroll rail shows one tick per heading and jumps on click', async ({ page }) => {
    await createRoom(page);
    const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n'.repeat(20);
    await typeInEditor(
      page,
      `# Intro\n\n${filler}## Middle\n\n${filler}## End\n\n${filler}`,
    );
    await setEditorMode(page, 'preview');

    const rail = page.locator('.scroll-rail-live');
    const ticks = rail.locator('.scroll-rail-tick');
    expect(await ticks.count()).toBe(3);
    await expect(ticks.nth(2)).toHaveAttribute('title', 'End');

    const scroller = page.locator('.note-live .cm-scroller');
    // Asserted as an absolute "landed near the bottom", not "moved forward
    // from wherever it happened to start" — mode-switch scroll-position
    // transfer now carries over wherever Write was left (after
    // typeInEditor(), near the very end, since typing follows the caret),
    // and CM6's own selection/viewport bookkeeping can nudge scrollTop by a
    // few px on its own right after a reset, so comparing against a
    // "before" snapshot here chases a moving target. Landing near the
    // bottom is the actual thing this test cares about regardless of where
    // it started.
    await ticks.nth(2).click();
    // "End" starts around 2/3 through this three-equal-filler-block
    // document — comfortably past halfway once centered in the viewport.
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop / (el.scrollHeight - el.clientHeight))).toBeGreaterThan(0.5);
  });

  test('CM6 scroll rail renders no ticks with fewer than two headings', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, '# Only heading\n\nJust some text.\n');
    await setEditorMode(page, 'preview');
    await expect(page.locator('.scroll-rail-live .scroll-rail-tick')).toHaveCount(0);
  });

  test('CM6 scroll rail thumb drag scrolls the surface', async ({ page }) => {
    await createRoom(page);
    const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n'.repeat(40);
    await typeInEditor(page, `# Intro\n\n${filler}## End\n\n${filler}`);
    await setEditorMode(page, 'preview');

    const scroller = page.locator('.note-live .cm-scroller');
    const thumb = page.locator('.scroll-rail-live .scroll-rail-thumb');
    // ScrollRail.updateMetrics() sets the thumb's height once its own
    // ResizeObserver/CM6-geometry callbacks have run — racy right after a
    // fresh mount, so wait for a real (non-empty) height before trusting its
    // boundingBox() rather than reading one mid-layout.
    await expect(thumb).not.toHaveCSS('height', '0px');
    const before = await scroller.evaluate((el) => el.scrollTop);
    const thumbBox = await thumb.boundingBox();
    await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + 400, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  });

  test('Write-mode scroll rail shows one tick per heading and jumps on click', async ({ page }) => {
    await createRoom(page);
    const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n'.repeat(20);
    await typeInEditor(
      page,
      `# Intro\n\n${filler}## Middle\n\n${filler}## End\n\n${filler}`,
    );

    const rail = page.locator('.scroll-rail-write');
    const ticks = rail.locator('.scroll-rail-tick');
    // The mirror-div measurement (src/scroll-rail.js's measureTextareaHeadingTops)
    // is debounced 150ms after the last 'input' — see ui/editor.js's
    // refreshWriteScrollRailDebounced().
    await expect(ticks).toHaveCount(3);
    await expect(ticks.nth(2)).toHaveAttribute('title', 'End');

    const editor = page.locator('#note-editor');
    // Typing leaves the textarea scrolled to follow the caret at the very
    // end of the document (past "End"'s own heading line, into its trailing
    // filler) — unlike the CM6 tests above, whose surface mounts fresh at
    // scrollTop 0 on the switch into Preview. Reset explicitly so "jumps on
    // click" has an unambiguous starting point instead of only sometimes
    // moving downward depending on where typing happened to leave the caret.
    await editor.evaluate((el) => { el.scrollTop = 0; });
    const before = await editor.evaluate((el) => el.scrollTop);
    await ticks.nth(2).click();
    await expect.poll(() => editor.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  });
});
