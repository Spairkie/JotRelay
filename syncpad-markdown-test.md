[TOC]

# Markdown Feature Test — SyncPad

Paste this whole note into SyncPad's editor (Source mode), then switch to **Live** or **Split** to check every feature below renders correctly. Each section is self-contained and labeled with what you should see.

---

## 1. Headings (ATX style, `#` through `######`)

# H1 Heading
## H2 Heading
### H3 Heading
#### H4 Heading
##### H5 Heading
###### H6 Heading

Expect: 6 distinct heading sizes, each with an auto-generated id (hover/inspect for `#h1-heading` etc.) — used by the Table of Contents above and by anchor links like [jump to Tables](#13-tables).

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

A longer fenced code block, for testing the optional "Code line numbers" setting (Settings > Editor):

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

[ref1]: https://example.com "Reference-style title"
[Reference-style link, collapsed]: https://example.com

---

## 9. Images

![Placeholder image](https://via.placeholder.com/150 "A 150x150 placeholder")

Expect: an inline image (network permitting) with the given alt text and title tooltip. `syncpad-file:` scheme images (pasted attachments) render the same way but aren't testable by pasting this file — try dragging an image into the editor separately to confirm those too.

---

## 10. Escaping Characters

\*not italic\*, \_not italic\_, \`not code\`, \# not a heading, \[not a link\](nope)

Literal backslash: \\

---

## 11. HTML (should NOT render — safety feature)

<div>This raw HTML tag should show up as literal escaped text below, not an actual rendered div.</div>

<script>alert('should never execute')</script>

Expect: both lines above appear as plain visible text (with `<`/`>` shown, e.g. `&lt;div&gt;`), never as real HTML elements, and the script must never execute.

---

## 12. Comments (non-HTML convention)

This hack hides text using an unreferenced link definition — the line below should be **completely invisible**:

[comment]: <> (This text should never appear in the rendered output.)
[//]: <> (Neither should this alternate form.)

Expect: nothing renders between this line and the next heading.

---

## 13. Tables

| Left aligned | Center aligned | Right aligned |
|:---|:---:|---:|
| a | b | c |
| longer cell | x | 123 |

Plain table, no alignment:

| Name | Role |
|---|---|
| Ada | Engineer |
| Grace | Admiral |

---

## 14. Fenced Code Blocks (language variety)

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

## 15. Footnotes

Here's a sentence with a footnote.[^1] Here's another with a named one.[^note]

A footnote referenced more than once: first here[^shared], and again right here[^shared].

[^1]: This is the first footnote's text.
[^note]: This is a named footnote — footnote labels don't have to be numbers.
[^shared]: The same footnote text, reachable from either reference above.

Expect: superscript numbered markers in the text, linking down to a footnotes section at the bottom of the rendered note. **Click (or tap/Enter) a marker** — in both the static preview and the Live/Split surface — to open an inline popover with the footnote's text, instead of jumping all the way to the bottom; Escape (or clicking outside) closes it and returns focus to the marker you clicked.

---

## 16. Heading IDs (auto-generated)

Every heading in this document already has an auto-generated id — confirmed by the [TOC] block at the very top linking to each one. Click a few of those TOC links to verify they jump to the right heading — in the Live/Split surface, the "Contents" box's own entries should be real clickable links (not inert text), and the raw `[TOC]` marker line itself should stay hidden behind the box rather than showing underneath it.

---

## 17. Definition Lists — NOT supported (by design)

Not part of GFM; SyncPad doesn't render this Markdown Extra syntax. The lines below should just appear as plain paragraph text, not a styled definition list:

Term
: Definition of the term

---

## 18. Emoji

Genuine Unicode emoji render as plain text with no special handling needed: 😀 🚀 ✅ 🎉 💡

Shortcode form (`:smile:`) is **not** supported — expect the literal text `:smile:` below, not a converted emoji:

:smile: :rocket:

---

## 19. Subscript / Superscript — NOT supported (by design)

Pandoc/kramdown syntax, not GFM. Expect literal text below, not raised/lowered characters:

H~2~O and X^2^

---

## 20. Automatic URL Linking

Bare URL: https://www.markdownguide.org should become a clickable link automatically.

---

## 21. Disabling Automatic URL Linking

Wrapped in a code span, this URL should stay plain text, NOT become a link: `https://www.markdownguide.org`

---

## 22. Underline — NOT supported (by design)

No clean non-HTML syntax exists (`__x__` is already bold in GFM). Expect literal underscores below:

__this stays bold, not underlined__

---

## 23. Indent (Tab) — NOT supported as a code-block trigger

CommonMark's 4-space-indent-equals-code-block rule is intentionally not implemented (conflicts with this renderer's list-nesting logic). Use a fenced code block instead (see section 6). A 4-space-indented line below should NOT turn into a code block:

    this line is indented 4 spaces and should stay a normal paragraph

---

## 24. Center — NOT supported (by design, needs raw HTML)

<center>This should show as literal escaped text, not centered content.</center>

---

## 25. Color — NOT supported (by design, needs raw HTML/CSS)

<span style="color:red">This should show as literal escaped text, not red text.</span>

---

## 26. Admonitions

See section 4 above (GFM Alerts) — `> [!NOTE]` etc. are SyncPad's supported admonition syntax.

---

## 27. Image Size — NOT supported (needs raw HTML or a non-GFM extension)

`![alt](url){width=100px}`-style sizing isn't implemented. Expect the image below to render at its natural size, ignoring any sizing hint:

![Placeholder](https://via.placeholder.com/150){width=50px}

---

## 28. Image Captions — NOT supported (needs raw HTML `<figure>`)

<figure>
  <img src="https://via.placeholder.com/150" alt="Placeholder">
  <figcaption>This caption should NOT render — the whole figure block shows as literal text.</figcaption>
</figure>

---

## 29. Link Targets

SyncPad doesn't use per-link target syntax — instead, every external link opens in a new tab automatically as a site-wide policy. Click the link in section 8 above and confirm it opens in a new tab.

---

## 30. Symbols (typographic replacement) — handled at typing time, not render time

If you have Smart Punctuation enabled in Settings, typing `(c)`, `--`, `"quotes"` etc. converts them as you type. This renderer does NOT re-process already-typed text, so the raw symbols below should render exactly as typed:

(c) (r) (tm) -- ---

---

## 31. Table Formatting (column alignment)

Already covered in section 13 — confirm the "Left aligned" / "Center aligned" / "Right aligned" columns above actually align differently.

---

## 32. Table of Contents

The `[TOC]` marker at the very top of this document should have rendered as a clickable, nested contents list linking to every heading below it. This holds in every mode: the static preview (real `<a href="#id">`s), and the Live/Split surface (its own "Contents" box, keyboard-operable too — Tab to an entry, Enter/Space to jump).

---

## 33. Symbols / Videos — NOT supported (needs raw HTML `<video>`)

<video src="/assets/video.mp4" controls></video>

Expect: literal escaped text, not a video player.

---

## 34. Combined stress test

A paragraph mixing **bold**, *italic*, ~~strikethrough~~, ==highlight==, `inline code`, a [link](https://example.com), and a footnote.[^stress]

> A blockquote containing a list:
> - one
> - two
>
> and a [link](https://example.com) too.

- [ ] A task list item with **bold**, `code`, and a [link](https://example.com)

[^stress]: Footnote text can also contain **bold** and `code`.

---

*End of test document. If every section above matches its "Expect" note, SyncPad's Markdown rendering is working correctly.*
