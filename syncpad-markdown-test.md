[TOC]

# Markdown Feature Test — SyncPad

Paste this whole note into SyncPad's editor (Source/Write mode), then switch to **Live** or **Split** to check every feature below renders correctly. Each section is self-contained and labeled with what you should see. This document is the source of truth for `docs/markdown-feature-audit.md`'s verification claims — if you change what `src/markdown.js` or `src/live-editor.js` support, update both together, in the same commit, so they can't drift apart again (see the note on emoji shortcodes in §19 for exactly what silent drift looks like).

---

## 1. Headings (ATX style, `#` through `######`)

# H1 Heading
## H2 Heading
### H3 Heading
#### H4 Heading
##### H5 Heading
###### H6 Heading

Expect: 6 distinct heading sizes, each with an auto-generated id (hover/inspect for `#h1-heading` etc.) — used by the Table of Contents above and by anchor links like [jump to Tables](#14-tables).

---

## 2. Paragraphs & Line Breaks

This is one paragraph.

This is a second paragraph, separated by a blank line.

This line ends with two trailing spaces (invisible below), forcing a line break within the same paragraph.  
See — this text should start on a new line, but still be part of the paragraph above it.

---

## 3. Emphasis

*italic with asterisks* and _italic with underscores_

**bold with asterisks** and __bold with underscores__

***bold and italic*** and **_also bold and italic_**

~~strikethrough~~

==highlighted text==

---

## 4. Blockquotes

> A single-line blockquote.

> A multi-line blockquote
> that continues here
> and here.

> Blockquotes can nest:
> > like this
> > > and this

> Blockquotes can contain other block elements:
> - a list item
> - another item
>
> ```
> and a fenced code block
> ```

Expect (Live/Split): the code fence's background box sits fully *inside* the blockquote's left border/indent — the quote's colored border should run continuously past the code block, not get cut off or overridden by the code block's own styling.

### GFM Alerts (blockquote-based)

> [!NOTE]
> Useful information the reader should know, even when skimming.

> [!TIP]
> Helpful advice for doing things better.

> [!IMPORTANT]
> Key information the reader needs to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate attention.

> [!CAUTION]
> Advises about risks or negative outcomes.

### An alert nested inside a plain blockquote

> Some surrounding context first.
>
> > [!TIP]
> > A nested alert should still get its own icon/color treatment, not just render as a second level of plain quote.

---

## 5. Lists

### Unordered
- Item one
- Item two
  - Nested item 2a
  - Nested item 2b
    - Double-nested 2b-i
- Item three

### Ordered
1. First
2. Second
3. Third
   1. Nested first
   2. Nested second

### Mixed nesting (ordered inside unordered, and back again)
- Fruit
  1. Apple
  2. Banana
- Vegetables
  1. Carrot
  2. Pea
     - green
     - split

Expect: indentation and marker style (bullet vs number) both switch correctly at each nesting level, in both directions.

### Task lists (with live progress badge)
- [x] Completed task
- [x] Another completed task
- [ ] Incomplete task
- [ ] Another incomplete task
  - [x] Nested completed subtask
  - [ ] Nested incomplete subtask

Expect: a "2/4 done" (or similar) progress badge above the top-level task list; clicking a checkbox in Live/Split toggles it.

### A fenced code block nested inside a list item

- Item with an explanatory note
  ```js
  const first = 1;
  const second = 2;
  ```
- A sibling item after the code block

Expect (Live/Split): the code fence's indentation lines up with the list item's own content (not flush with the bullet), and both list items still render as a normal list around it.

---

## 6. Code

Inline code: use `const x = 1;` in a sentence.

Fenced code block, no language:

```
plain text code block
no syntax highlighting expected
```

Fenced code block, with language (syntax highlighting expected):

```js
function greet(name) {
  return `Hello, ${name}!`;
}
console.log(greet("SyncPad"));
```

A longer fenced code block, for testing the optional "Code line numbers" setting (Settings → Editor):

```js
function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b;
}

for (let i = 0; i < 10; i++) {
  console.log(fibonacci(i));
}
```

Expect: with the setting off (default), no gutter. With it on, each real code line gets a number starting at 1 — the fence's own opening/closing lines (and the language tag) should NOT be numbered.

```python
def greet(name):
    return f"Hello, {name}!"
```

An unrecognized language tag should still render as a plain monospace block, just without color:

```brainfuck
++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.
```

---

## 7. Horizontal Rules

Three different valid syntaxes, each should render as a horizontal line:

---

***

___

---

## 8. Links

[Inline link](https://example.com)

[Inline link with title](https://example.com "Example Domain")

[Reference-style link][ref1]

[Reference-style link, collapsed][]

Bare autolink (should become clickable automatically): https://example.com/some/path

Angle-bracket autolink: <https://example.com>

Angle-bracket email autolink: <someone@example.com>

Bare email inside backticks should NOT become a link: `someone@example.com`

A `javascript:` URL should NOT become a clickable link at all — expect the literal bracketed text below, not a link the browser would ever navigate:

[Should not be clickable](javascript:alert('xss'))

[ref1]: https://example.com "Reference-style title"
[Reference-style link, collapsed]: https://example.com

Expect: every real link above opens in a **new tab** — this is a site-wide policy, not per-link syntax (see §30).

---

## 9. Images

![Placeholder image](https://via.placeholder.com/150 "A 150x150 placeholder")

Expect: an inline image (network permitting) with the given alt text and title tooltip. `syncpad-file:` scheme images (pasted/uploaded attachments) render the same way but aren't testable by pasting this file — try dragging an image into the editor, or uploading one via the Files panel and inserting it, to confirm that path too. If the room is encrypted, an uploaded image's *content* is encrypted at rest and decrypted locally before display — see `docs/security.md`.

---

## 10. Escaping Characters

\*not italic\*, \_not italic\_, \`not code\`, \# not a heading, \[not a link\](nope)

Literal backslash: \\

Escaping inside a table cell: \| should not split the column.

| Column |
|---|
| a \| b |

---

## 11. HTML (should NOT render — safety feature)

<div>This raw HTML tag should show up as literal escaped text below, not an actual rendered div.</div>

<script>alert('should never execute')</script>

<img src=x onerror="alert('xss')">

Expect: all three lines above appear as plain visible text (with `<`/`>` shown, e.g. `&lt;div&gt;`), never as real HTML elements — and neither the `<script>` nor the `onerror` handler ever executes.

---

## 12. Comments (non-HTML convention)

This hack hides text using an unreferenced link definition — the line below should be **completely invisible**:

[comment]: <> (This text should never appear in the rendered output.)
[//]: <> (Neither should this alternate form.)

Expect: nothing renders between this line and the next heading.

---

## 13. Emoji

Genuine Unicode emoji render as plain text with no special handling needed: 😀 🚀 ✅ 🎉 💡

**Shortcode form IS supported** — a curated ~150-entry table of the shortcodes people actually type from muscle memory (`markdown-emoji-map.js`, shared by both renderers):

:smile: :rocket: :tada: :thumbsup: :heart: :fire: :eyes: :100:

An *unrecognized* shortcode falls back to literal text, same as any other unresolved construct — this should NOT turn into an emoji:

:this_is_not_a_real_shortcode:

Symbol-only codes (`:+1:`, `:-1:`) are a known gap — the underlying grammar only recognizes `[a-zA-Z_0-9]+` between the colons, so these never reach the emoji table at all and stay literal text on purpose. Use the letter form instead:

:+1: (stays literal) vs :thumbsup: (converts)

---

## 14. Tables

| Left aligned | Center aligned | Right aligned |
|:---|:---:|---:|
| a | b | c |
| longer cell | x | 123 |

Plain table, no alignment:

| Name | Role |
|---|---|
| Ada | Engineer |
| Grace | Admiral |

A wide table, to check horizontal scroll doesn't break the surrounding layout:

| Col A | Col B | Col C | Col D | Col E | Col F | Col G | Col H |
|---|---|---|---|---|---|---|---|
| aaaaaaaaaa | bbbbbbbbbb | cccccccccc | dddddddddd | eeeeeeeeee | ffffffffff | gggggggggg | hhhhhhhhhh |

Expect: the wide table scrolls horizontally within its own container — the page itself should never gain a horizontal scrollbar.

---

## 15. Fenced Code Blocks (language variety)

```html
<p>Sample HTML inside a code fence — should render as visible text, not real HTML.</p>
```

```json
{ "key": "value", "nested": { "n": 1 } }
```

```bash
echo "hello world"
```

---

## 16. Footnotes

Here's a sentence with a footnote.[^1] Here's another with a named one.[^note]

A footnote referenced more than once: first here[^shared], and again right here[^shared].

[^1]: This is the first footnote's text.
[^note]: This is a named footnote — footnote labels don't have to be numbers.
[^shared]: The same footnote text, reachable from either reference above.

Expect: superscript numbered markers in the text, linking down to a footnotes section at the bottom of the rendered note. **Click (or tap/Enter) a marker** — in both the static preview and the Live/Split surface — to open an inline popover with the footnote's text, instead of jumping all the way to the bottom; Escape (or clicking outside) closes it and returns focus to the marker you clicked.

---

## 17. Heading IDs (auto-generated)

Every heading in this document already has an auto-generated id — confirmed by the [TOC] block at the very top linking to each one. Click a few of those TOC links to verify they jump to the right heading — in the Live/Split surface, the "Contents" box's own entries should be real clickable links (not inert text), and the raw `[TOC]` marker line itself should stay hidden behind the box rather than showing underneath it.

---

## 18. Definition Lists — NOT supported (by design)

Not part of GFM; SyncPad doesn't render this Markdown Extra syntax. The lines below should just appear as plain paragraph text, not a styled definition list:

Term
: Definition of the term

---

## 19. A note on this file's own accuracy

This section exists because it was necessary: an earlier version of this document claimed emoji shortcodes (§13) were **not** supported, months after `markdown-emoji-map.js` shipped and made that claim false — nobody updated this file when the feature landed, so it silently drifted from the actual renderer behavior it exists to describe. If you add or change a Markdown feature, update `src/markdown.js`'s own header-comment feature list, `docs/markdown-feature-audit.md`, and the relevant section of *this* file in the same change — a passing test suite doesn't catch a stale doc, only a person re-reading it against real output does.

---

## 20. Subscript / Superscript — NOT supported (by design)

Pandoc/kramdown syntax, not GFM. Expect literal text below, not raised/lowered characters:

H~2~O and X^2^

---

## 21. Automatic URL Linking

Bare URL: https://www.markdownguide.org should become a clickable link automatically.

---

## 22. Disabling Automatic URL Linking

Wrapped in a code span, this URL should stay plain text, NOT become a link: `https://www.markdownguide.org`

---

## 23. Underline — NOT supported (by design)

No clean non-HTML syntax exists (`__x__` is already bold in GFM). Expect literal underscores below:

__this stays bold, not underlined__

---

## 24. Indent (Tab) — NOT supported as a code-block trigger

CommonMark's 4-space-indent-equals-code-block rule is intentionally not implemented (conflicts with this renderer's list-nesting logic). Use a fenced code block instead (see §6). A 4-space-indented line below should NOT turn into a code block:

    this line is indented 4 spaces and should stay a normal paragraph

---

## 25. Center — NOT supported (by design, needs raw HTML)

<center>This should show as literal escaped text, not centered content.</center>

---

## 26. Color — NOT supported (by design, needs raw HTML/CSS)

<span style="color:red">This should show as literal escaped text, not red text.</span>

---

## 27. Admonitions

See §4 above (GFM Alerts) — `> [!NOTE]` etc. are SyncPad's supported admonition syntax.

---

## 28. Image Size — NOT supported (needs raw HTML or a non-GFM extension)

`![alt](url){width=100px}`-style sizing isn't implemented. Expect the image below to render at its natural size, ignoring any sizing hint:

![Placeholder](https://via.placeholder.com/150){width=50px}

---

## 29. Image Captions — NOT supported (needs raw HTML `<figure>`)

<figure>
  <img src="https://via.placeholder.com/150" alt="Placeholder">
  <figcaption>This caption should NOT render — the whole figure block shows as literal text.</figcaption>
</figure>

---

## 30. Link Targets

SyncPad doesn't use per-link target syntax — instead, every external link opens in a new tab automatically as a site-wide policy. Click the link in §8 above and confirm it opens in a new tab.

---

## 31. Symbols (typographic replacement) — handled at typing time, not render time

If you have Smart Punctuation enabled in Settings, typing `(c)`, `--`, `"quotes"` etc. converts them as you type. This renderer does NOT re-process already-typed text, so the raw symbols below should render exactly as typed:

(c) (r) (tm) -- ---

---

## 32. Table Formatting (column alignment)

Already covered in §14 — confirm the "Left aligned" / "Center aligned" / "Right aligned" columns above actually align differently.

---

## 33. Table of Contents

The `[TOC]` marker at the very top of this document should have rendered as a clickable, nested contents list linking to every heading below it. This holds in every mode: the static preview (real `<a href="#id">`s), and the Live/Split surface (its own "Contents" box, keyboard-operable too — Tab to an entry, Enter/Space to jump).

---

## 34. Videos — NOT supported (needs raw HTML `<video>`)

<video src="/assets/video.mp4" controls></video>

Expect: literal escaped text, not a video player.

---

## 35. Live vs. Split vs. Preview parity

SyncPad has two rendering surfaces (see `docs/markdown-feature-audit.md`'s "Both renderers" section for the full breakdown): the classic `markdown.js` renderer (read-only preview fallback, HTML/PDF export, copy-as-HTML) and the CodeMirror 6 Live surface (what Preview/Split actually show almost all the time). Switch this whole document between **Write**, **Preview**, **Live**, and **Split** now and confirm every section above looks the same across all of them — tables, alerts, footnotes, checklists, and the `[TOC]` box all have matching decorations in both surfaces as of this writing, but a future change to only one of them is exactly the kind of drift this section exists to catch.

---

## 36. Combined stress test

A paragraph mixing **bold**, *italic*, ~~strikethrough~~, ==highlight==, `inline code`, a [link](https://example.com), an emoji shortcode :tada:, and a footnote.[^stress]

> A blockquote containing a list:
> - one
> - two
>
> and a [link](https://example.com) too.

- [ ] A task list item with **bold**, `code`, and a [link](https://example.com)

[^stress]: Footnote text can also contain **bold** and `code`.

---

*End of test document. If every section above matches its "Expect" note, SyncPad's Markdown rendering is working correctly.*
