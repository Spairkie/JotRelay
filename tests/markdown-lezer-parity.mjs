// tests/markdown-lezer-parity.mjs
// Proves src/markdown-lezer.js (the staged, not-yet-wired-up Lezer-tree-
// based renderer) produces the same output as src/markdown.js (the
// hand-rolled regex renderer actually in use) across the full documented
// feature set, plus every relevant assertion from tests/utils.spec.js's own
// "Markdown renderer" suite. Plain Node — no browser needed, since both
// renderers are pure functions over a string (the Lezer parser vendored in
// vendor/codemirror.js runs identically outside a DOM).
//
// Run manually: node tests/markdown-lezer-parity.mjs
// Not part of `npm test` (Playwright) — markdown-lezer.js isn't imported by
// the app yet, so there's nothing user-facing for Playwright to exercise.
//
// One known, deliberate non-match: markdown.js's own emphasis regex mis-
// parses "**bold *and italic* still bold**" (a real bug in its non-greedy
// ** pattern) — markdown-lezer.js produces the semantically correct
// CommonMark result instead of replicating that bug. Listed as an expected
// divergence below, not a failure.

import assert from 'node:assert/strict';
import { renderMarkdown, toggleChecklistItem } from '../src/markdown.js';
import { renderMarkdownLezer } from '../src/markdown-lezer.js';

const KNOWN_DIVERGENCES = new Set(['nested emphasis (markdown.js regex bug, not replicated)']);

const cases = [
  ['heading', '# Hello World'],
  ['heading levels', '# H1\n## H2\n### H3'],
  ['heading with closing hashes', '##   Heading with trailing   ##  '],
  ['heading with inline', '## **Bold** heading with `code`'],
  ['bold', '**bold text**'],
  ['bold underscore', '__bold text__'],
  ['italic', '*italic text*'],
  ['italic underscore', '_italic text_'],
  ['strike', '~~struck~~'],
  ['highlight', '==marked=='],
  ['inline code', 'some `code span` here'],
  ['nested emphasis (markdown.js regex bug, not replicated)', '**bold *and italic* still bold**'],
  ['snake_case not italic', 'a snake_case_var here'],
  ['fenced code', '```js\nconst x = 1;\n```'],
  ['fenced code no lang', '```\nplain\n```'],
  ['link', '[text](https://example.com "title")'],
  ['link no title', '[text](https://example.com)'],
  ['mailto link', '[email](mailto:a@b.com)'],
  ['bad scheme link', '[bad](javascript:alert(1))'],
  ['image http', '![alt](https://example.com/img.png "title")'],
  ['image syncpad-file', '![a photo](syncpad-file:room1/167_photo.png)'],
  ['image bad scheme', '![bad](javascript:alert(1))'],
  ['bare autolink', 'Visit https://example.com/path?a=1 today.'],
  ['bare autolink trailing punct', 'See https://x.com/Function_(mathematics).'],
  ['angle autolink', '<https://angle.example.com>'],
  ['angle email autolink', '<user@example.com>'],
  ['hard break', 'line1  \nline2'],
  ['hr dashes', '---'],
  ['hr stars', '***'],
  ['unordered list', '- item1\n- item2'],
  ['ordered list', '1. one\n2. two'],
  ['nested list', '- item1\n  - nested1\n  - nested2\n- item2'],
  ['checklist', '- [ ] todo\n- [x] done'],
  ['checklist nested', '- [ ] parent\n  - [x] child'],
  ['blockquote', '> quoted text'],
  ['blockquote multiline', '> line1\n> line2'],
  ['gfm alert', '> [!WARNING]\n> Be careful.'],
  ['gfm alert note', '> [!NOTE]\n> Just a note.'],
  ['table', '| L | C | R | N |\n|:---|:---:|---:|---|\n| a | b | c | d |'],
  ['table no align', '| A | B |\n|---|---|\n| 1 | 2 |'],
  ['escaped punctuation', 'This is \\*\\*not bold\\*\\* and \\[not a link\\](nope).'],
  ['reference link', '[label]: https://example.com "a title"\n\n[text][label]'],
  ['reference link collapsed', '[label2]: https://example.com\n\n[label2][]'],
  ['unresolved reference', '[nowhere][missing]'],
  ['footnote', 'text[^1] more\n\n[^1]: footnote text'],
  ['footnote missing', 'This has no matching def.[^missing]'],
  ['toc marker', '# H1\n\n[TOC]\n\n## H2'],
  ['xss script tag', '**bold** and <script>xss</script>'],
  ['xss raw html', '<div onclick="alert(1)">click</div>'],
  ['indented text (not code)', '    this is indented but not a code block per markdown.js'],
  ['multi paragraph', 'para one\n\npara two'],
  ['duplicate headings', '# Setup\n\n# Setup\n\n# Setup'],
];

let pass = 0, fail = 0, divergences = 0;
for (const [name, src] of cases) {
  let a, b, err = null;
  try { a = renderMarkdown(src); } catch (e) { err = `renderMarkdown threw: ${e.message}`; }
  try { b = renderMarkdownLezer(src); } catch (e) { err = (err ? err + ' | ' : '') + `renderMarkdownLezer threw: ${e.message}`; }
  if (err) { fail++; console.log(`FAIL - ${name}\n  ${err}`); continue; }
  if (a === b) { pass++; continue; }
  if (KNOWN_DIVERGENCES.has(name)) { divergences++; continue; }
  fail++;
  console.log(`FAIL - ${name}`);
  console.log(`  SRC:      ${JSON.stringify(src)}`);
  console.log(`  EXPECTED: ${a}`);
  console.log(`  ACTUAL:   ${b}`);
}
console.log(`\nParity battery: ${pass} matched, ${divergences} known divergence(s), ${fail} unexpected failure(s), ${cases.length} total.`);

// The subset of tests/utils.spec.js's "Markdown renderer" suite that
// exercises renderMarkdown() directly (excluding one that needs page-level
// DOM helpers, unrelated to the renderer itself).
let n = 0, sfail = 0;
function check(name, fn) {
  n++;
  try { fn(); } catch (e) { sfail++; console.log(`FAIL - ${name}\n  ${e.message}`); }
}

check('renderMarkdown returns safe HTML', () => {
  const html = renderMarkdownLezer('**bold** and <script>xss</script>');
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

check('a checkbox after a blockquoted checklist toggles the right source line', () => {
  const src = '> - [ ] quoted\n\n- [ ] normal';
  const html = renderMarkdownLezer(src);
  const indices = [...html.matchAll(/data-cb-index="(\d+)"/g)].map((m) => Number(m[1]));
  const normalIndex = indices[1];
  const result = toggleChecklistItem(src, normalIndex, true);
  assert.ok(result.includes('- [x] normal'));
  assert.ok(result.includes('> - [ ] quoted'));
});

check('heading text derives from rendered text, not raw markdown syntax', () => {
  const src = '# Intro\n\n## [API guide](https://example.com)\n\n### **Bold** and `code`';
  const html = renderMarkdownLezer(src);
  const texts = [...html.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/g)].map((m) => m[1].replace(/<[^>]*>/g, ''));
  assert.deepEqual(texts, ['Intro', 'API guide', 'Bold and code']);
});

check('syncpad-file: image references render with no src', () => {
  const html = renderMarkdownLezer('![a photo](syncpad-file:room1/167_photo.png)');
  assert.ok(html.includes('data-syncpad-file="room1/167_photo.png"'));
  assert.ok(html.includes('alt="a photo"'));
  assert.ok(!/<img[^>]*\bsrc=/.test(html));
});

check('unrecognized image schemes are rejected', () => {
  const html = renderMarkdownLezer('![bad](javascript:alert(1))![bad2](data:text/html,x)');
  assert.ok(!html.includes('<img'));
});

check('table columns honor GFM alignment markers', () => {
  const html = renderMarkdownLezer('| L | C | R | N |\n|:---|:---:|---:|---|\n| a | b | c | d |');
  assert.ok(html.includes('<th style="text-align:left">L</th>'));
  assert.ok(html.includes('<th style="text-align:center">C</th>'));
  assert.ok(html.includes('<th style="text-align:right">R</th>'));
  assert.ok(html.includes('<th>N</th>'));
  assert.ok(html.includes('<td style="text-align:right">c</td>'));
});

check('backslash-escaped punctuation suppresses markdown interpretation', () => {
  const html = renderMarkdownLezer('This is \\*\\*not bold\\*\\* and \\[not a link\\](nope).');
  assert.ok(html.includes('**not bold**'));
  assert.ok(html.includes('[not a link](nope)'));
  assert.ok(!html.includes('<strong>'));
  assert.ok(!html.includes('<a '));
});

check('footnotes render a numbered reference and a references section', () => {
  const src = 'A claim.[^1] A repeat.[^1]\n\n[^1]: The *footnote* text.';
  const html = renderMarkdownLezer(src);
  assert.ok(html.includes('<sup id="fnref-1"><a href="#fn-1">1</a></sup>'));
  assert.ok(html.includes('<sup><a href="#fn-1">1</a></sup>'));
  assert.ok(html.includes('<li id="fn-1">'));
  assert.ok(html.includes('<em>footnote</em>'));
  assert.ok(html.includes('class="footnote-backref"'));
});

check('an undefined footnote reference is left as literal text', () => {
  const html = renderMarkdownLezer('This has no matching def.[^missing]');
  assert.ok(html.includes('[^missing]'));
  assert.ok(!html.includes('<sup>'));
  assert.ok(!html.includes('class="footnotes"'));
});

check('GitHub-style alerts render as labeled callouts, not plain blockquotes', () => {
  const html = renderMarkdownLezer('> [!WARNING]\n> Be careful.');
  assert.ok(html.includes('class="md-alert md-alert-warning"'));
  assert.ok(html.includes('Warning'));
  assert.ok(html.includes('Be careful.'));
  assert.ok(!html.includes('<blockquote>'));
});

check('a plain blockquote (no alert marker) still renders as <blockquote>', () => {
  const html = renderMarkdownLezer('> Just a quote.');
  assert.ok(html.includes('<blockquote>'));
});

console.log(`Suite-derived assertions: ${n - sfail}/${n} passed.`);

const totalFail = fail + sfail;
if (totalFail > 0) {
  console.log(`\n${totalFail} unexpected failure(s) — markdown-lezer.js is not yet a safe swap-in for markdown.js.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
