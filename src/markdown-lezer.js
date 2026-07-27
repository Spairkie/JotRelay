// SyncPad – markdown-lezer.js
// EXPERIMENTAL / not yet wired up anywhere. A static Markdown → HTML
// renderer built over the *same* Lezer parse tree — same `markdown({ base:
// markdownLanguage, extensions: [highlightExtension] })` parser instance
// shape — that live-editor.js's CM6 surface already parses with. This is
// the "shared source of truth" half of unifying the app's two independent
// Markdown implementations (see markdown.js's own header comment for the
// hand-rolled regex renderer this is meant to eventually replace).
//
// Status: staged rewrite, not swapped in. Being built and proven for
// byte-for-byte output parity against markdown.js's renderMarkdown() across
// its full documented feature set before anything imports this instead of
// markdown.js.
//
// Divergences from a naive "just walk the tree" render, and why each is
// necessary:
//   1. `@lezer/markdown`'s base grammar parses 4-space-indented text as a
//      CodeBlock node — markdown.js deliberately does NOT support that
//      (ambiguous against its own indent-based list nesting, see its header
//      comment). CodeBlock is NOT rendered as code here; its raw text is
//      rendered unchanged (no leading-whitespace stripping), matching
//      markdown.js's lack of indented-code-block support exactly.
//   2. The base grammar also natively parses raw HTML (HTMLBlock, HTMLTag,
//      CommentBlock) as distinct node types. markdown.js's #1 rule is no
//      raw HTML pass-through, ever — CLAUDE.md's checklist repeats this.
//      Every HTML-shaped node here renders its literal escaped source text,
//      never its parsed/interpreted form.
//   3. Several GFM-adjacent features markdown.js supports aren't part of
//      the base Lezer grammar at all — footnotes ([^id]/[^id]: text),
//      GitHub-style alerts (blockquotes starting with [!NOTE] etc.), and
//      the [TOC] marker. All three parse as ordinary (unresolved) nodes to
//      the grammar and are detected here the same way live-editor.js's CM6
//      decorations already detect them: a regex/text check layered on top
//      of the tree, not a grammar extension. This mirrors the *existing*
//      hybrid design of the CM6 renderer, not a new pattern.
//   4. Lezer only creates child nodes for *marked-up* spans — plain text
//      between/around them has no node of its own. Rendering a node's
//      inline content therefore means walking its children AND filling the
//      text gaps between/around them, not just rendering each child (see
//      _renderInlineChildren). For composite nodes with multiple distinct
//      fields separated by syntax characters that aren't content (Link's
//      label vs URL vs title; a list item's marker vs its text), a bounded
//      sub-string extraction + isolated re-parse is used instead of gap-
//      filling the whole node, so a stray separator space/newline never
//      leaks into the rendered field.

import { markdown, markdownLanguage } from '../vendor/codemirror.js';
import { highlightExtension } from './markdown-highlight-extension.js';
import { escapeHtml } from './utils.js';

const _parser = markdown({ base: markdownLanguage, extensions: [highlightExtension] }).language.parser;

const _ALERT_ICONS = {
  note: 'ℹ️ ', tip: '💡 ', important: '❗ ', warning: '⚠️ ', caution: '🛑 ',
};
const _ALERT_LABEL = {
  note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution',
};
const _FOOTNOTE_DEF_RE = /^\[\^([A-Za-z0-9_-]+)\]:[ \t]?(.*)$/;
const _TOC_MARKER_RE = /^\[toc\]$/i;

/**
 * Render Markdown to safe HTML via the shared Lezer parse tree.
 * @param {string} src
 * @returns {string} sanitized HTML
 */
export function renderMarkdownLezer(src) {
  if (!src) return '';
  const text = String(src).replace(/\r\n?/g, '\n');
  const tree = _parser.parse(text);
  const ctx = {
    cbCounter: 0, headingIds: new Set(),
    footnoteDefs: new Map(), footnoteOrder: [],
    linkRefs: new Map(),
  };
  _collectFootnoteDefs(text, ctx);
  _collectLinkRefs(tree, text, ctx);

  const topBlocks = _children(tree.topNode);
  // Footnote-definition lines ([^id]: text) parse as ordinary Paragraphs to
  // the grammar (see module header point 3) — pulled out of the block
  // stream the same way markdown.js excludes them from its own, since
  // they're rendered once, together, in the references section instead.
  const filtered = topBlocks.filter((node) => !_isFootnoteDefNode(node, text) && node.type.name !== 'LinkReference');

  // A [TOC] marker anywhere among the top-level blocks renders the *whole*
  // document's headings, including ones after it — so every heading's id
  // must be pre-computed before the main render pass reaches any of them
  // (mirrors markdown.js's own two-phase approach exactly, including
  // sharing one ctx.headingIds Set so both passes agree on ids).
  if (filtered.some((node) => _isTocMarkerNode(node, text))) {
    ctx._tocIdQueue = [];
    ctx._tocEntries = _collectHeadingsInOrder(filtered, text).map((h) => {
      const id = _slugifyHeading(h.plainText, ctx.headingIds);
      ctx._tocIdQueue.push(id);
      return { level: h.level, id, text: h.plainText };
    });
  }

  const bodyHtml = filtered.map((node) => _renderNode(node, text, ctx)).join('\n');
  if (!ctx.footnoteOrder.length) return bodyHtml;
  const items = ctx.footnoteOrder.map((id) => {
    const defText = ctx.footnoteDefs.get(id) || '';
    return `<li id="fn-${id}">${_renderInlineFallback(defText, text, ctx)} <a href="#fnref-${id}" class="footnote-backref" aria-label="Back to content">↩</a></li>`;
  }).join('');
  return `${bodyHtml}\n<section class="footnotes"><hr><ol>${items}</ol></section>`;
}

// ── Node helpers ───────────────────────────────────────────────────────────────

function _children(node) {
  const out = [];
  let child = node.firstChild;
  while (child) { out.push(child); child = child.nextSibling; }
  return out;
}

// ── Footnotes / TOC / reference-links (grammar has no concept of these —
//    see module header point 3) ─────────────────────────────────────────────

function _isFootnoteDefNode(node, text) {
  return node.type.name === 'Paragraph' && _FOOTNOTE_DEF_RE.test(text.slice(node.from, node.to));
}

function _isTocMarkerNode(node, text) {
  return node.type.name === 'Paragraph' && _TOC_MARKER_RE.test(text.slice(node.from, node.to).trim());
}

function _collectFootnoteDefs(text, ctx) {
  for (const line of text.split('\n')) {
    const m = _FOOTNOTE_DEF_RE.exec(line);
    if (m && !ctx.footnoteDefs.has(m[1])) ctx.footnoteDefs.set(m[1], m[2]);
  }
}

/** Flatten heading text (in document order) out of a block list, recursing
 *  into blockquotes so [TOC] picks up blockquoted headings too — mirrors
 *  markdown.js's _collectHeadingTexts(). */
function _collectHeadingsInOrder(blocks, text) {
  const out = [];
  for (const node of blocks) {
    const name = node.type.name;
    const level = _headingLevel(name);
    if (level) {
      out.push({ level, plainText: _stripTags(_renderInlineFallbackRaw(_headingRawInner(node, text))) });
    } else if (name === 'Blockquote') {
      out.push(..._collectHeadingsInOrder(_children(_dequoteTree(node, text).topNode), _dequoteText(node, text)));
    }
  }
  return out;
}

// Re-parses just to extract plain text for the TOC entry list — a minimal,
// context-free inline render (no ctx needed: TOC entry text never contains
// footnote refs/reference links in practice, and even if it did, markdown.js
// itself only strips tags from the *already-rendered* HTML here too).
function _renderInlineFallbackRaw(fragmentText) {
  return _renderInlineFallback(fragmentText, fragmentText, { footnoteDefs: new Map(), footnoteOrder: [], linkRefs: new Map(), headingIds: new Set(), cbCounter: 0 });
}

function _headingLevel(nodeName) {
  const m = /^ATXHeading([1-6])$/.exec(nodeName);
  return m ? Number(m[1]) : 0;
}

// ── Reference-link definitions ────────────────────────────────────────────────

function _collectLinkRefs(tree, text, ctx) {
  for (const node of _children(tree.topNode)) {
    if (node.type.name !== 'LinkReference') continue;
    const labelNode = node.getChild('LinkLabel');
    const urlNode = node.getChild('URL');
    const titleNode = node.getChild('LinkTitle');
    if (!labelNode || !urlNode) continue;
    const key = _linkLabelKey(text.slice(labelNode.from, labelNode.to));
    if (!ctx.linkRefs.has(key)) {
      ctx.linkRefs.set(key, {
        url: text.slice(urlNode.from, urlNode.to),
        title: titleNode ? _stripQuotes(text.slice(titleNode.from, titleNode.to)) : null,
      });
    }
  }
}

/** LinkLabel node text includes its own brackets ("[label]") — normalize to
 *  the same lowercase/trimmed key markdown.js's own linkRefs map uses. */
function _linkLabelKey(labelNodeText) {
  return labelNodeText.replace(/^\[|\]$/g, '').trim().toLowerCase();
}

/** Re-parse an isolated text fragment (table cell, footnote definition,
 *  heading content, task-item content, …) and render its inline content —
 *  used wherever a field's exact bounds are extracted as a raw substring
 *  rather than walked as tree children, so it never picks up sibling gap
 *  text (see module header point 4). Reuses the *same* ctx (footnote/link-
 *  ref maps, heading-id set, checkbox counter) so state stays consistent
 *  with the surrounding document. */
function _renderInlineFallback(fragmentText, _unusedOuterText, ctx) {
  const tree = _parser.parse(fragmentText);
  const blocks = _children(tree.topNode);
  let out = '';
  for (const node of blocks) {
    if (node.type.name === 'Paragraph') {
      out += _renderInlineChildren(node, fragmentText, ctx);
    } else {
      out += _renderNode(node, fragmentText, ctx).replace(/^<p>|<\/p>$/g, '');
    }
  }
  return out;
}

// ── Slugify (identical algorithm to markdown.js's, for id parity) ────────────

function _slugifyHeading(plainText, usedIds) {
  const base = String(plainText)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'section';
  let id = base;
  let n = 1;
  while (usedIds.has(id)) { id = `${base}-${n}`; n++; }
  usedIds.add(id);
  return id;
}

/** The trimmed raw span between an ATX heading's opening "#"s and its
 *  optional closing "##" sequence — see the ATXHeading case for why this
 *  can't be gap-filled generically. */
function _headingRawInner(node, text) {
  const marks = _children(node).filter((c) => c.type.name === 'HeaderMark');
  const start = marks[0]?.to ?? node.from;
  const closingMark = marks.length > 1 ? marks[marks.length - 1] : null;
  const end = closingMark && closingMark.from > start ? closingMark.from : node.to;
  return text.slice(start, end).trim();
}

// ── Blockquote dequoting ──────────────────────────────────────────────────────

/** Strip one leading "> " (or ">") from each line of a Blockquote node's raw
 *  source, then re-parse the result as fresh top-level blocks — simpler and
 *  more robust than trying to skip specific already-parsed child nodes, and
 *  lets GitHub-alert detection work against the exact same "first content
 *  line" shape markdown.js's own regex expects. */
function _dequoteText(node, text) {
  return text.slice(node.from, node.to).split('\n').map((l) => l.replace(/^>[ \t]?/, '')).join('\n');
}
function _dequoteTree(node, text) {
  return _parser.parse(_dequoteText(node, text));
}

// ── Block-level rendering ─────────────────────────────────────────────────────

function _renderNode(node, text, ctx) {
  const name = node.type.name;
  const level = _headingLevel(name);
  if (level) return _renderHeading(node, level, text, ctx);

  switch (name) {
    case 'Paragraph': {
      if (_isTocMarkerNode(node, text)) return _renderTocNav(ctx);
      return `<p>${_renderInlineChildren(node, text, ctx)}</p>`;
    }

    case 'FencedCode': {
      const infoNode = node.getChild('CodeInfo');
      const lang = infoNode ? text.slice(infoNode.from, infoNode.to).trim() : '';
      const textNode = node.getChild('CodeText');
      const body = textNode ? text.slice(textNode.from, textNode.to) : '';
      return `<pre><code${lang ? ` class="language-${escapeHtml(lang)}" data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(body)}</code></pre>`;
    }

    // Deliberately NOT rendered as code — see module header point 1. The
    // node's own span excludes the first line's leading indentation (that's
    // what triggered CodeBlock in the first place) even though it keeps
    // every subsequent line's — reconstruct the true original text from the
    // start of the line, so markdown.js's "no special handling at all,
    // indentation included" behavior is matched exactly.
    case 'CodeBlock': {
      const lineStart = text.lastIndexOf('\n', node.from - 1) + 1;
      return `<p>${escapeHtml(text.slice(lineStart, node.to))}</p>`;
    }

    case 'BulletList': case 'OrderedList': {
      const { total, checked } = _countTasks(node, text);
      const listHtml = _renderListLevel(node, text, ctx);
      return total > 0 ? `<div class="md-checklist-progress">${checked}/${total} done</div>\n${listHtml}` : listHtml;
    }

    case 'Blockquote':
      return _renderBlockquote(node, text, ctx);

    case 'HorizontalRule':
      return '<hr>';

    case 'Table':
      return _renderTable(node, text, ctx);

    // Raw HTML — see module header point 2. Never interpreted, always its
    // literal escaped source text.
    case 'HTMLBlock':
      return `<p>${escapeHtml(text.slice(node.from, node.to))}</p>`;

    case 'LinkReference':
      // Reference-link *definitions* never render at their own source
      // position, same as markdown.js — consumed by _collectLinkRefs().
      return '';

    default:
      // Unhandled block type (shouldn't normally be reached for the
      // supported feature set) — render its literal text, escaped, rather
      // than silently dropping content.
      return `<p>${escapeHtml(text.slice(node.from, node.to))}</p>`;
  }
}

function _renderHeading(node, level, text, ctx) {
  const rawInner = _headingRawInner(node, text);
  const inner = _renderInlineFallback(rawInner, text, ctx);
  const plain = _stripTags(inner);
  const id = ctx._tocIdQueue ? ctx._tocIdQueue.shift() : _slugifyHeading(plain, ctx.headingIds);
  ctx.headingIds.add(id);
  return `<h${level} id="${id}">${inner}</h${level}>`;
}

function _renderTocNav(ctx) {
  const entries = ctx._tocEntries || [];
  if (entries.length < 2) return '';
  const items = entries.map((h) =>
    `<li class="note-toc-item note-toc-h${h.level}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`
  ).join('');
  return `<nav class="md-inline-toc" aria-label="Table of contents"><strong>Contents</strong><ul>${items}</ul></nav>`;
}

function _renderBlockquote(node, text, ctx) {
  const dequoted = _dequoteText(node, text);
  const alertMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i.exec(dequoted);
  if (alertMatch) {
    const kind = alertMatch[1].toLowerCase();
    const rest = dequoted.slice(alertMatch[0].length);
    return `<div class="md-alert md-alert-${kind}"><p class="md-alert-title">${_ALERT_ICONS[kind]}${_ALERT_LABEL[kind]}</p>${_renderFragmentBlocks(rest, ctx)}</div>`;
  }
  return `<blockquote>${_renderFragmentBlocks(dequoted, ctx)}</blockquote>`;
}

function _renderFragmentBlocks(fragmentText, ctx) {
  // A *fresh* cbCounter, not the parent's — matches markdown.js's own
  // blockquote recursion exactly. toggleChecklistItem()'s source-line scan
  // only recognizes a checklist marker at the very start of the line, so it
  // never counts a blockquoted item; sharing the counter here would
  // silently misalign the index of every checkbox rendered after the first
  // blockquoted checklist in the document (see tests/utils.spec.js's
  // regression test for this exact bug shape).
  const childCtx = { ...ctx, cbCounter: 0 };
  const tree = _parser.parse(fragmentText);
  const blocks = _children(tree.topNode).filter((n) => !_isFootnoteDefNode(n, fragmentText) && n.type.name !== 'LinkReference');
  return blocks.map((n) => _renderNode(n, fragmentText, childCtx)).join('\n');
}

// ── Lists ──────────────────────────────────────────────────────────────────────
// Rendered tight (no <p> wrapper around a single-paragraph item's content) —
// markdown.js's own line-based list algorithm has no concept of "loose"
// lists at all, so matching that means always unwrapping. The checklist
// progress count is computed once over the *whole* subtree (nested items
// included) and shown only above the outermost list — _renderListLevel
// itself never emits a progress div, only its _renderNode('BulletList'/
// 'OrderedList') caller does, so a nested sub-list doesn't get its own.

function _countTasks(node, text) {
  let total = 0, checked = 0;
  const walk = (n) => {
    let child = n.firstChild;
    while (child) {
      if (child.type.name === 'Task') {
        total++;
        const marker = child.getChild('TaskMarker');
        if (marker && /\[[xX]\]/.test(text.slice(marker.from, marker.to))) checked++;
      }
      walk(child);
      child = child.nextSibling;
    }
  };
  walk(node);
  return { total, checked };
}

function _renderListLevel(node, text, ctx) {
  const ordered = node.type.name === 'OrderedList';
  let html = '';
  for (const item of _children(node)) {
    if (item.type.name !== 'ListItem') continue;
    html += _renderListItem(item, text, ctx);
  }
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>\n${html}</${tag}>`;
}

function _renderListItem(item, text, ctx) {
  let itemHtml = '';
  let isTask = false;
  for (const sub of _children(item)) {
    const name = sub.type.name;
    if (name === 'ListMark') continue;
    if (name === 'Task') {
      isTask = true;
      const marker = sub.getChild('TaskMarker');
      const isChecked = !!marker && /\[[xX]\]/.test(text.slice(marker.from, marker.to));
      const idx = ctx.cbCounter++;
      const contentStart = marker ? marker.to : sub.from;
      const rawContent = text.slice(contentStart, sub.to).replace(/^[ \t]+/, '');
      const taskInline = _renderInlineFallback(rawContent, text, ctx);
      itemHtml += `<label><input type="checkbox" data-cb-index="${idx}"${isChecked ? ' checked' : ''} />${taskInline}</label>`;
    } else if (name === 'Paragraph') {
      // Tight list — unwrap: inline content directly, no <p>.
      itemHtml += _renderInlineChildren(sub, text, ctx);
    } else if (name === 'BulletList' || name === 'OrderedList') {
      itemHtml += `\n${_renderListLevel(sub, text, ctx)}`;
    } else {
      itemHtml += _renderNode(sub, text, ctx);
    }
  }
  return `<li${isTask ? ' class="md-task"' : ''}>${itemHtml}</li>\n`;
}

// ── Tables ─────────────────────────────────────────────────────────────────────

function _renderTable(node, text, ctx) {
  let headers = [], aligns = [], rows = [];
  for (const child of _children(node)) {
    const name = child.type.name;
    if (name === 'TableHeader') headers = _tableCellTexts(child, text);
    else if (name === 'TableDelimiter') aligns = _tableAligns(child, text);
    else if (name === 'TableRow') rows.push(_tableCellTexts(child, text));
  }
  const alignAttr = (i) => aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
  const thead = `<thead><tr>${headers.map((h, i) => `<th${alignAttr(i)}>${_renderInlineFallback(h, text, ctx)}</th>`).join('')}</tr></thead>`;
  const tbody = rows.length
    ? `<tbody>${rows.map((row) => `<tr>${row.map((c, i) => `<td${alignAttr(i)}>${_renderInlineFallback(c, text, ctx)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';
  return `<table>${thead}${tbody}</table>`;
}

function _tableCellTexts(rowNode, text) {
  return _children(rowNode)
    .filter((c) => c.type.name === 'TableCell')
    .map((c) => text.slice(c.from, c.to).trim());
}

/** The alignment-row TableDelimiter is a single node spanning the whole
 *  "|:---|:---:|---:|---|" line — parsed the same way markdown.js's own
 *  parseRow()/alignment check parses that line, rather than relying on any
 *  particular internal child structure. */
function _tableAligns(delimNode, text) {
  const raw = text.slice(delimNode.from, delimNode.to);
  return raw.split('|').slice(1, -1).map((cell) => {
    cell = cell.trim();
    const left = cell.startsWith(':'), right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

function _stripTags(html) {
  return String(html).replace(/<[^>]*>/g, '');
}

// ── Inline-level rendering ────────────────────────────────────────────────────

/**
 * Render a node's inline content: Lezer's markdown grammar only creates
 * child nodes for *marked-up* spans — plain text between/around them has no
 * node of its own at all (see module header point 4). Any newline within
 * the gap text is a CommonMark soft break — rendered as a space, matching
 * markdown.js's own final inline-render step.
 */
function _renderInlineChildren(node, text, ctx, skipTypes = []) {
  const children = _children(node);
  if (!children.length) return _escapeInline(text.slice(node.from, node.to));
  let html = '';
  let pos = node.from;
  for (const child of children) {
    if (child.from > pos) html += _escapeInline(text.slice(pos, child.from));
    if (!skipTypes.includes(child.type.name)) html += _renderInlineNode(child, text, ctx);
    pos = child.to;
  }
  if (pos < node.to) html += _escapeInline(text.slice(pos, node.to));
  return html;
}

function _escapeInline(raw) {
  return escapeHtml(raw).replace(/\n/g, ' ');
}

const _MARK_TYPES = new Set([
  'EmphasisMark', 'CodeMark', 'StrikethroughMark', 'HighlightMark',
  'LinkMark', 'HeaderMark', 'QuoteMark', 'ListMark',
]);

function _renderInlineNode(node, text, ctx) {
  const name = node.type.name;
  if (_MARK_TYPES.has(name)) return '';

  switch (name) {
    case 'Emphasis':
      return `<em>${_renderInlineChildren(node, text, ctx, ['EmphasisMark'])}</em>`;
    case 'StrongEmphasis':
      return `<strong>${_renderInlineChildren(node, text, ctx, ['EmphasisMark'])}</strong>`;
    case 'Strikethrough':
      return `<del>${_renderInlineChildren(node, text, ctx, ['StrikethroughMark'])}</del>`;
    case 'Highlight':
      return `<mark>${_renderInlineChildren(node, text, ctx, ['HighlightMark'])}</mark>`;
    case 'InlineCode': {
      const codeText = text.slice(node.from + 1, node.to - 1);
      return `<code>${escapeHtml(codeText)}</code>`;
    }
    case 'HardBreak':
      // markdown.js's own two-step inline render (" {2,}\n" -> "<br>\n",
      // then EVERY remaining "\n" -> " ") ends with a space after <br>, not
      // a literal newline — the second step also catches the one the first
      // step just inserted.
      return '<br> ';
    case 'Escape':
      return escapeHtml(text.slice(node.from + 1, node.to));
    case 'URL':
      return `<a href="${escapeHtml(text.slice(node.from, node.to))}" target="_blank" rel="noopener noreferrer">${escapeHtml(text.slice(node.from, node.to))}</a>`;
    case 'Autolink': {
      const urlNode = node.getChild('URL');
      const url = urlNode ? text.slice(urlNode.from, urlNode.to) : '';
      const isEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(url) && !/^[a-z]+:/i.test(url);
      const href = isEmail ? `mailto:${url}` : url;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    }
    case 'Link':
      return _renderLink(node, text, ctx);
    case 'Image':
      return _renderImage(node, text, ctx);
    // Raw HTML — never interpreted, see module header point 2.
    case 'HTMLTag': case 'CommentBlock': case 'ProcessingInstructionBlock':
      return escapeHtml(text.slice(node.from, node.to));

    default: {
      const children = _children(node);
      if (children.length) return _renderInlineChildren(node, text, ctx);
      return escapeHtml(text.slice(node.from, node.to));
    }
  }
}

function _renderLink(node, text, ctx) {
  const labelNode = node.getChild('LinkLabel');
  if (labelNode) {
    // Reference-style [text][label] / [text][] — the grammar gives us only
    // the raw label text; resolve it against ctx.linkRefs (built by
    // _collectLinkRefs()), same lookup shape markdown.js's own reference-
    // link handling uses. Extract the visible "text" as the bounded span
    // between the opening "[" and the LinkLabel's own "[label]" (see module
    // header point 4 — this can't be gap-filled over the whole node, the
    // gap between the marks IS the visible text but LinkLabel itself must
    // be excluded from it).
    const marks = _children(node).filter((c) => c.type.name === 'LinkMark');
    const textStart = marks[0]?.to ?? node.from;
    const textEnd = marks.length > 1 ? marks[1].from : labelNode.from;
    const rawLabel = text.slice(textStart, textEnd);
    const visibleLabel = _renderInlineFallback(rawLabel, text, ctx);
    const rawLabelKey = _linkLabelKey(text.slice(labelNode.from, labelNode.to));
    // A collapsed reference "[text][]" has an empty LinkLabel — the implied
    // label is the visible text itself, per CommonMark.
    const key = rawLabelKey || rawLabel.trim().toLowerCase();
    const ref = ctx.linkRefs.get(key);
    if (ref) {
      const titleAttr = ref.title != null ? ` title="${escapeHtml(ref.title)}"` : '';
      return `<a href="${escapeHtml(ref.url)}"${titleAttr} target="_blank" rel="noopener noreferrer">${visibleLabel}</a>`;
    }
    return _renderUnresolvedShortcut(node, text, ctx);
  }
  const urlNode = node.getChild('URL');
  if (!urlNode) return _renderUnresolvedShortcut(node, text, ctx);
  const url = text.slice(urlNode.from, urlNode.to);
  if (!/^(?:https?:|mailto:)/i.test(url)) return escapeHtml(text.slice(node.from, node.to));
  const titleNode = node.getChild('LinkTitle');
  const titleAttr = titleNode ? ` title="${escapeHtml(_stripQuotes(text.slice(titleNode.from, titleNode.to)))}"` : '';
  const marks = _children(node).filter((c) => c.type.name === 'LinkMark');
  const labelStart = marks[0]?.to ?? node.from;
  const labelEnd = marks.length > 1 ? marks[1].from : (urlNode.from);
  const rawLabel = text.slice(labelStart, labelEnd);
  const label = _renderInlineFallback(rawLabel, text, ctx);
  return `<a href="${escapeHtml(url)}"${titleAttr} target="_blank" rel="noopener noreferrer">${label}</a>`;
}

/**
 * A Link node the grammar couldn't resolve at all (no URL, no matching
 * LinkLabel definition) — covers markdown.js's [TOC]/footnote-reference/
 * "any other unmatched [text]" cases, all handled by that renderer as a
 * single fallthrough (render as literal text, except footnote refs which
 * get a real reference if their id has a matching definition).
 */
function _renderUnresolvedShortcut(node, text, ctx) {
  const raw = text.slice(node.from, node.to);
  const fnMatch = /^\[\^([A-Za-z0-9_-]+)\]$/.exec(raw);
  if (fnMatch && ctx.footnoteDefs.has(fnMatch[1])) {
    const id = fnMatch[1];
    let n = ctx.footnoteOrder.indexOf(id);
    const isFirstRef = n === -1;
    if (isFirstRef) { ctx.footnoteOrder.push(id); n = ctx.footnoteOrder.length - 1; }
    const anchor = isFirstRef ? ` id="fnref-${id}"` : '';
    return `<sup${anchor}><a href="#fn-${id}">${n + 1}</a></sup>`;
  }
  return escapeHtml(raw);
}

function _renderImage(node, text, ctx) {
  const urlNode = node.getChild('URL');
  const url = urlNode ? text.slice(urlNode.from, urlNode.to) : '';
  const marks = _children(node).filter((c) => c.type.name === 'LinkMark');
  const altStart = marks[0]?.to ?? node.from;
  const altEnd = marks.length > 1 ? marks[1].from : (urlNode ? urlNode.from : node.to);
  const altPlain = text.slice(altStart, altEnd);
  const titleNode = node.getChild('LinkTitle');
  const titleAttr = titleNode ? ` title="${escapeHtml(_stripQuotes(text.slice(titleNode.from, titleNode.to)))}"` : '';
  if (/^https?:/i.test(url)) {
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(altPlain)}"${titleAttr} loading="lazy">`;
  }
  const fileMatch = /^syncpad-file:(.+)$/i.exec(url);
  if (fileMatch) {
    return `<img data-syncpad-file="${escapeHtml(fileMatch[1])}" alt="${escapeHtml(altPlain)}"${titleAttr} loading="lazy">`;
  }
  return escapeHtml(text.slice(node.from, node.to));
}

function _stripQuotes(s) {
  return s.replace(/^["']|["']$/g, '');
}
