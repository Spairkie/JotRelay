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
    // markdownLanguage's own built-in Emoji extension tags ":smile:" with
    // tags.character, which @lezer/highlight defines as a sub-tag of
    // tags.string — without an explicit override, the shared HighlightStyle
    // added for fenced-code string literals would visibly (mis)color this
    // literal, unconverted shortcode text as if it were a real string.
    await createRoom(page);
    await typeInEditor(page, 'Shortcode: :smile: :rocket:\n');
    await setEditorMode(page, 'preview');
    await page.keyboard.press('Control+End');

    const shortcode = page.locator('.note-live').getByText(':smile:', { exact: true });
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

  test('document mini-map dots stay invisible until the pointer nears the scroller edge', async ({ page }) => {
    await createRoom(page);
    const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n'.repeat(20);
    await typeInEditor(
      page,
      `# Intro\n\n${filler}## Middle\n\n${filler}## End\n\n${filler}`,
    );
    await setEditorMode(page, 'preview');

    const firstDot = page.locator('.note-live .cm-minimap-dot').first();
    await expect(firstDot).toHaveCSS('opacity', '0');

    const scrollerBox = await page.locator('.note-live .cm-scroller').boundingBox();
    // Near the right edge, deliberately not on a specific dot — proximity
    // alone (not a precise 5px hit) should reveal the whole group at a
    // subtle opacity.
    await page.mouse.move(scrollerBox.x + scrollerBox.width - 10, scrollerBox.y + 10);
    await expect(firstDot).toHaveCSS('opacity', '0.45');

    // Hovering the dot itself brings it to full prominence, not just the
    // group's dim reveal opacity — .cm-minimap.is-near-edge .cm-minimap-dot
    // and .cm-minimap .cm-minimap-dot:hover both have 3-class specificity,
    // so this also guards the fix that made the :hover rule actually win.
    const firstDotBox = await firstDot.boundingBox();
    await page.mouse.move(firstDotBox.x + firstDotBox.width / 2, firstDotBox.y + firstDotBox.height / 2);
    await expect(firstDot).toHaveCSS('opacity', '1');

    // Moving away from the editor entirely hides them again.
    await page.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y - 40);
    await expect(firstDot).toHaveCSS('opacity', '0');
  });

  test('document mini-map shows one tick per heading and jumps on click', async ({ page }) => {
    await createRoom(page);
    const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n'.repeat(20);
    await typeInEditor(
      page,
      `# Intro\n\n${filler}## Middle\n\n${filler}## End\n\n${filler}`,
    );
    await setEditorMode(page, 'preview');

    const minimap = page.locator('.note-live .cm-minimap');
    await expect(minimap).toBeVisible();
    const dots = minimap.locator('.cm-minimap-dot');
    expect(await dots.count()).toBe(3);
    await expect(dots.nth(2)).toHaveAttribute('title', 'End');

    const scroller = page.locator('.note-live .cm-scroller');
    const before = await scroller.evaluate((el) => el.scrollTop);
    await dots.nth(2).click();
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  });

  test('document mini-map stays hidden with fewer than two headings', async ({ page }) => {
    await createRoom(page);
    await typeInEditor(page, '# Only heading\n\nJust some text.\n');
    await setEditorMode(page, 'preview');
    await expect(page.locator('.note-live .cm-minimap')).toBeHidden();
  });
});
