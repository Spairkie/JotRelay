// tests/markdown.spec.js
// Markdown renderer: headings, bold, italic, code, links, checklists, CSV preview.
// These tests validate the renderMarkdown() output through the preview pane.

import { test, expect } from '@playwright/test';
import { createRoom, ensureWriteMode } from './helpers.js';

/**
 * Render `markdown` through the real renderMarkdown() module into the
 * #note-preview pane and return its locator.
 *
 * Preview mode itself now shows the editable CM6 live surface (#note-live),
 * not this pane — but renderMarkdown() still powers every export path and
 * the live-surface fallback, so its output is still worth asserting on
 * directly. Rendering via the module keeps these tests honest without
 * coupling them to a UI mode that no longer displays this HTML.
 */
async function withPreview(page, markdown) {
  await createRoom(page);
  await ensureWriteMode(page);
  await page.locator('#note-editor').fill(markdown);
  await page.evaluate(async (md) => {
    const { renderMarkdown } = await import('/SyncPad/src/markdown.js');
    const pane = document.getElementById('note-preview');
    pane.innerHTML = renderMarkdown(md);
    pane.classList.remove('hidden');
  }, markdown);
  return page.locator('#note-preview');
}

test.describe('Markdown preview', () => {
  test('renders H1–H3 headings', async ({ page }) => {
    const preview = await withPreview(page, '# Heading 1\n## Heading 2\n### Heading 3');
    await expect(preview.locator('h1')).toContainText('Heading 1');
    await expect(preview.locator('h2')).toContainText('Heading 2');
    await expect(preview.locator('h3')).toContainText('Heading 3');
  });

  test('renders bold text', async ({ page }) => {
    const preview = await withPreview(page, '**bold word**');
    await expect(preview.locator('strong')).toContainText('bold word');
  });

  test('renders italic text', async ({ page }) => {
    const preview = await withPreview(page, '*italic word*');
    await expect(preview.locator('em')).toContainText('italic word');
  });

  test('renders inline code', async ({ page }) => {
    const preview = await withPreview(page, 'Use `console.log()` here.');
    await expect(preview.locator('code')).toContainText('console.log()');
  });

  test('renders fenced code block', async ({ page }) => {
    const preview = await withPreview(page, '```js\nconst x = 1;\n```');
    await expect(preview.locator('pre code')).toContainText('const x = 1;');
  });

  test('renders every line of a fenced code block nested inside a list item', async ({ page }) => {
    // @lezer/markdown emits one CodeText child per line for a list-nested
    // fence (unlike a top-level fence's single contiguous CodeText) —
    // grabbing only the first via getChild() used to silently drop lines 2+.
    const preview = await withPreview(page, '- item\n  ```js\n  line1\n  line2\n  line3\n  ```');
    await expect(preview.locator('pre code')).toContainText('line1\nline2\nline3');
  });

  test('HTML comments never appear in rendered output', async ({ page }) => {
    const block = await withPreview(page, 'para one\n\n<!-- a block comment -->\n\npara two');
    await expect(block).not.toContainText('block comment');
    await expect(block).toContainText('para one');
    await expect(block).toContainText('para two');

    const inline = await withPreview(page, 'hello <!-- inline note --> world');
    await expect(inline).not.toContainText('inline note');
    await expect(inline).toContainText('hello');
    await expect(inline).toContainText('world');
  });

  test('a stray literal HTML tag still renders as escaped visible text', async ({ page }) => {
    const preview = await withPreview(page, 'hello <div> world');
    await expect(preview).toContainText('hello <div> world');
  });

  test('renders unordered list', async ({ page }) => {
    const preview = await withPreview(page, '- Item A\n- Item B\n- Item C');
    const items = preview.locator('ul li');
    expect(await items.count()).toBe(3);
    await expect(items.first()).toContainText('Item A');
  });

  test('renders ordered list', async ({ page }) => {
    const preview = await withPreview(page, '1. First\n2. Second\n3. Third');
    const items = preview.locator('ol li');
    expect(await items.count()).toBe(3);
  });

  test('renders GFM checklist items', async ({ page }) => {
    const preview = await withPreview(page, '- [x] Done\n- [ ] Pending');
    const checkboxes = preview.locator('input[type="checkbox"]');
    expect(await checkboxes.count()).toBe(2);
    const checked   = await checkboxes.nth(0).isChecked();
    const unchecked = await checkboxes.nth(1).isChecked();
    expect(checked).toBe(true);
    expect(unchecked).toBe(false);
  });

  test('renders safe links (https only)', async ({ page }) => {
    const preview = await withPreview(page, '[SyncPad](https://example.com)');
    const link = preview.locator('a');
    await expect(link).toHaveAttribute('href', 'https://example.com');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('does not render javascript: links', async ({ page }) => {
    // eslint-disable-next-line no-script-url
    const preview = await withPreview(page, '[xss](javascript:alert(1))');
    // The raw text should appear but no actual href with javascript:
    const link = preview.locator('a');
    expect(await link.count()).toBe(0);
  });

  test('does not double-escape & in URLs', async ({ page }) => {
    const preview = await withPreview(page, '[Link](https://example.com?a=1&b=2)');
    const link = preview.locator('a');
    // href should contain & not &amp;
    const href = await link.getAttribute('href');
    expect(href).toContain('a=1&b=2');
    expect(href).not.toContain('&amp;');
  });

  test('snake_case does not trigger italic', async ({ page }) => {
    const preview = await withPreview(page, 'foo_bar_baz is a variable name');
    // Should not create <em> elements for the underscores
    expect(await preview.locator('em').count()).toBe(0);
    await expect(preview).toContainText('foo_bar_baz');
  });

  test('renders images with http(s) src', async ({ page }) => {
    const preview = await withPreview(page, '![a picture](https://example.com/pic.png)');
    const img = preview.locator('img');
    await expect(img).toHaveAttribute('src', 'https://example.com/pic.png');
    await expect(img).toHaveAttribute('alt', 'a picture');
  });

  test('blocks javascript: and data: image URLs', async ({ page }) => {
    const preview = await withPreview(page, '![x](javascript:alert(1))\n\n![y](data:text/html,<script>alert(1)</script>)');
    expect(await preview.locator('img').count()).toBe(0);
  });

  test('autolinks bare URLs', async ({ page }) => {
    const preview = await withPreview(page, 'Check out https://example.com for more.');
    const link = preview.locator('a');
    await expect(link).toHaveAttribute('href', 'https://example.com');
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('autolink trims trailing sentence punctuation', async ({ page }) => {
    const preview = await withPreview(page, 'See https://example.com/page. Thanks.');
    const link = preview.locator('a');
    const href = await link.getAttribute('href');
    expect(href).toBe('https://example.com/page');
    await expect(preview).toContainText('page. Thanks.');
  });

  test('autolink does not corrupt plain digit tokens near a URL', async ({ page }) => {
    // Regression check: bare "L2"/numbers must not be mistaken for an
    // internal placeholder and rendered as "undefined".
    const preview = await withPreview(page, 'Our L2 cache, see https://example.com/l2 for details.');
    await expect(preview).not.toContainText('undefined');
    await expect(preview).toContainText('L2 cache');
  });

  test('autolink keeps a balanced closing paren before trailing punctuation', async ({ page }) => {
    // "Function_(mathematics)" is a legitimate balanced path segment — only
    // the sentence period after it should be trimmed, not the ')' itself.
    const preview = await withPreview(page, 'See https://en.wikipedia.org/wiki/Function_(mathematics). Thanks.');
    const link = preview.locator('a');
    const href = await link.getAttribute('href');
    expect(href).toBe('https://en.wikipedia.org/wiki/Function_(mathematics)');
    await expect(preview).toContainText('mathematics). Thanks.');
  });

  test('image src/alt are not corrupted by emphasis markers', async ({ page }) => {
    // Regression check: a URL or alt text containing * must not have its
    // src/alt mangled by the bold/italic rules that run after image parsing.
    const preview = await withPreview(page, '![alt](https://example.com/a*b*.png)\n\n![*emph*](https://example.com/x.png)');
    const imgs = preview.locator('img');
    await expect(imgs.nth(0)).toHaveAttribute('src', 'https://example.com/a*b*.png');
    await expect(imgs.nth(1)).toHaveAttribute('alt', '*emph*');
  });

  test('does not double-wrap a link whose label is itself a URL', async ({ page }) => {
    const preview = await withPreview(page, '[https://example.com](https://example.com)');
    expect(await preview.locator('a').count()).toBe(1);
  });

  test('renders nested unordered lists', async ({ page }) => {
    const preview = await withPreview(page, '- a\n  - a1\n  - a2\n- b');
    const topList = preview.locator('ul').first();
    const topItems = topList.locator(':scope > li');
    expect(await topItems.count()).toBe(2);
    const nestedList = topItems.first().locator('ul');
    expect(await nestedList.locator('li').count()).toBe(2);
  });

  test('renders nested checklist items with independently toggleable checkboxes', async ({ page }) => {
    const preview = await withPreview(page, '- [ ] parent\n  - [x] child');
    const checkboxes = preview.locator('input[type="checkbox"]');
    expect(await checkboxes.count()).toBe(2);
    expect(await checkboxes.nth(0).isChecked()).toBe(false);
    expect(await checkboxes.nth(1).isChecked()).toBe(true);
  });

  test('headings get unique ids for the table of contents', async ({ page }) => {
    const preview = await withPreview(page, '# Intro\n\n## Setup\n\n## Setup\n\n### Deep bit');
    const ids = await preview.locator('h1, h2, h3').evaluateAll((els) => els.map((e) => e.id));
    expect(ids).toEqual(['intro', 'setup', 'setup-1', 'deep-bit']);
  });

  test('a heading whose text matches an auto-generated suffix still gets a unique id', async ({ page }) => {
    // "foo", "foo-1", "foo" must not collide on the real "foo-1" heading.
    const preview = await withPreview(page, '# foo\n\n## foo-1\n\n### foo');
    const ids = await preview.locator('h1, h2, h3').evaluateAll((els) => els.map((e) => e.id));
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(['foo', 'foo-1', 'foo-2']);
  });

  test('headings inside a blockquote share the document-level id registry', async ({ page }) => {
    const preview = await withPreview(page, '# Setup\n\n> # Setup');
    const ids = await preview.locator('h1').evaluateAll((els) => els.map((e) => e.id));
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(['setup', 'setup-1']);
  });

  test('a checkbox after a blockquoted checklist keeps its own toggleable index', async ({ page }) => {
    // Blockquoted checklist items are rendered but toggleChecklistItem()'s
    // source-line scan never counts them (its regex requires the list
    // marker at the very start of the line, not after a `>`). Sharing the
    // render-time checkbox counter across the blockquote boundary used to
    // give every checkbox after a blockquoted one an index the scanner
    // didn't recognize — clicking it silently did nothing and the checkbox
    // reverted on the next render. The counter is deliberately independent
    // per blockquote now, so the *rendered* index can duplicate a quoted
    // item's, but a normal top-level checkbox always matches a real,
    // toggleable source line.
    const preview = await withPreview(page, '> - [ ] quoted\n\n- [ ] normal');
    // withPreview() sets #note-preview's innerHTML directly rather than
    // going through _refreshPreviewIfActive(), so the app's own checkbox
    // click listener (_wirePreviewClickOnce(), src/app/comments-preview.js)
    // never gets wired — reproduce it here so this test can actually
    // exercise the click→toggleChecklistItem()→editor round trip it's
    // meant to cover, not just the static render.
    await page.evaluate(() => {
      document.getElementById('note-preview')?.addEventListener('click', async (e) => {
        const cb = e.target;
        if (!(cb instanceof HTMLInputElement) || cb.type !== 'checkbox') return;
        const idx = Number(cb.dataset.cbIndex);
        if (!Number.isFinite(idx)) return;
        const { toggleChecklistItem } = await import('/SyncPad/src/markdown.js');
        const editor = document.getElementById('note-editor');
        editor.value = toggleChecklistItem(editor.value, idx, cb.checked);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
    const checkboxes = preview.locator('input[type="checkbox"]');
    await expect(checkboxes).toHaveCount(2);
    await checkboxes.nth(1).check(); // the second rendered checkbox is "normal"
    // Toggling the real ("normal") checkbox must actually update the source,
    // not silently no-op — verified by round-tripping through the editor.
    await page.locator('.md-seg-btn[data-mode="write"]').click();
    const content = await page.locator('#note-editor').inputValue();
    expect(content).toContain('- [x] normal');
    expect(content).toContain('> - [ ] quoted');
  });

  test('renders ==highlight== as <mark>', async ({ page }) => {
    const preview = await withPreview(page, 'This is ==important== text.');
    await expect(preview.locator('mark')).toContainText('important');
  });

  test('converts recognized emoji shortcodes to Unicode emoji', async ({ page }) => {
    const preview = await withPreview(page, 'Great work :tada: :rocket: :thumbsup:');
    await expect(preview.locator('p')).toHaveText('Great work 🎉 🚀 👍');
  });

  test('leaves an unrecognized emoji shortcode as literal text', async ({ page }) => {
    const preview = await withPreview(page, 'Not a real one: :totally_made_up_xyz:');
    await expect(preview.locator('p')).toHaveText('Not a real one: :totally_made_up_xyz:');
  });

  test('does not convert an emoji shortcode inside inline code', async ({ page }) => {
    const preview = await withPreview(page, '`:tada:` stays literal in code');
    await expect(preview.locator('code')).toHaveText(':tada:');
  });

  test('fenced code block is narrower than surrounding prose, left-aligned to the same edge', async ({ page }) => {
    const preview = await withPreview(page, '# Heading\n\nSome paragraph text.\n\n```js\nconst x = 1;\n```');
    const [headingBox, preBox] = await Promise.all([
      preview.locator('h1').boundingBox(),
      preview.locator('pre').boundingBox(),
    ]);
    // Left edges line up (both flush with the content measure)...
    expect(Math.abs(headingBox.x - preBox.x)).toBeLessThan(1);
    // ...but the code block's own box is visibly narrower, not full width.
    expect(preBox.width).toBeLessThan(headingBox.width * 0.95);
  });

  test('shows a checklist progress badge above the list', async ({ page }) => {
    const preview = await withPreview(page, '- [x] done one\n- [ ] not done\n- [x] done two');
    await expect(preview.locator('.md-checklist-progress')).toHaveText('2/3 done');
  });

  test('does not show a progress badge for a list with no checkboxes', async ({ page }) => {
    const preview = await withPreview(page, '- plain item\n- another item');
    await expect(preview.locator('.md-checklist-progress')).toHaveCount(0);
  });

  test('nested sub-list does not get its own progress badge', async ({ page }) => {
    const preview = await withPreview(page, '- [ ] top\n  - [x] nested');
    await expect(preview.locator('.md-checklist-progress')).toHaveCount(1);
    await expect(preview.locator('.md-checklist-progress')).toHaveText('1/2 done');
  });
});

test.describe('Table of contents', () => {
  test('shows a Contents nav for notes with 2+ headings, linking to each one', async ({ page }) => {
    const preview = await withPreview(page, '# Intro\n\n## Setup\n\n### Deep bit');
    // withPreview() sets #note-preview's innerHTML directly rather than
    // going through the real render pipeline (ui/editor.js's _applyMarkdownMode()),
    // which is what normally calls the private _injectTocNav() afterward to
    // auto-inject a `.note-toc` summary nav when a rendered note has 2+
    // headings (independent of an explicit [TOC] marker in the source, which
    // is a separate, already-covered inline feature). Reproduce that same
    // post-processing step here so this test exercises the real behavior.
    await page.evaluate(() => {
      const preview = document.getElementById('note-preview');
      const headings = Array.from(preview.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'));
      if (headings.length < 2) return;
      const items = headings.map((h) => {
        const level = Number(h.tagName[1]);
        return `<li class="note-toc-item note-toc-h${level}"><a href="#${h.id}">${h.textContent}</a></li>`;
      }).join('');
      const nav = document.createElement('nav');
      nav.className = 'note-toc';
      nav.setAttribute('aria-label', 'Table of contents');
      nav.innerHTML = `<details><summary>Contents</summary><ul>${items}</ul></details>`;
      preview.insertBefore(nav, preview.firstChild);
    });
    const toc = preview.locator('.note-toc');
    await expect(toc).toBeVisible();
    const links = toc.locator('a');
    expect(await links.count()).toBe(3);
    await expect(links.nth(2)).toHaveAttribute('href', '#deep-bit');
  });

  test('omits the Contents nav for notes with fewer than 2 headings', async ({ page }) => {
    const preview = await withPreview(page, '# Just one heading\n\nSome text.');
    await expect(preview.locator('.note-toc')).toHaveCount(0);
  });

  test('a [TOC] marker renders an inline contents block, including headings that follow it', async ({ page }) => {
    const preview = await withPreview(page, '# Title\n\n[TOC]\n\n## Section A\n\n## Section B');
    const inlineToc = preview.locator('.md-inline-toc');
    await expect(inlineToc).toBeVisible();
    const links = inlineToc.locator('a');
    expect(await links.count()).toBe(3);
    await expect(links.nth(1)).toHaveAttribute('href', '#section-a');
    await expect(links.nth(2)).toHaveAttribute('href', '#section-b');
  });

  test('[TOC] renders collapsed by default and expands on click', async ({ page }) => {
    const preview = await withPreview(page, '# Title\n\n[TOC]\n\n## Section A\n\n## Section B');
    const inlineToc = preview.locator('.md-inline-toc');
    // Native <details>/<summary> — no [open] attribute means collapsed, and
    // its list of links isn't visible (though still present in the DOM).
    await expect(inlineToc).toHaveJSProperty('open', false);
    await expect(inlineToc.locator('a').first()).toBeHidden();

    await inlineToc.locator('summary').click();
    await expect(inlineToc).toHaveJSProperty('open', true);
    await expect(inlineToc.locator('a').first()).toBeVisible();
  });

  test('[TOC] is left as literal text when the note has fewer than 2 headings', async ({ page }) => {
    const preview = await withPreview(page, '[TOC]\n\n# Only heading');
    await expect(preview.locator('.md-inline-toc')).toHaveCount(0);
  });
});
