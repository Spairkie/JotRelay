// SyncPad – live-editor.js
// The Typora-style editable live-preview surface: a CodeMirror 6 instance
// over the same plain-markdown string the Write textarea holds. Mounted in
// Preview mode (and the right pane of Split); the textarea remains the
// durable source every other module reads — this surface mirrors it both
// ways but never becomes its own store of truth.
//
// Loop safety: user edits here → onChange(text) → app.js writes the
// textarea + dispatches 'input' → the input pipeline calls syncFromText()
// with identical text → no-op. Programmatic doc replacement (syncFromText)
// is annotated so the CM6 update listener never echoes it back out.

import {
  EditorState, EditorView, Compartment, Annotation,
  keymap, drawSelection, placeholder,
  defaultKeymap, history, historyKeymap, indentWithTab,
  markdown, markdownLanguage, markdownKeymap,
  closeBrackets, closeBracketsKeymap,
  syntaxHighlighting, HighlightStyle, StreamLanguage, tags,
  ViewPlugin, Decoration, WidgetType, syntaxTree,
  StateField, StateEffect,
  javascript, python, json, html, css, shell,
} from '../vendor/codemirror.js';
import { escapeHtml } from './utils.js';
import { highlightExtension } from './markdown-highlight-extension.js';
import { parseTableAlignments } from './markdown-table-utils.js';
import { renderMarkdown } from './markdown.js';
import { toggleFootnotePopover } from './footnote-popover.js';

let _view             = null;
let _onChange         = null;
let _onCursorActivity = null;
let _onImageFiles     = null;
let _scrollSync       = null; // { editorEl, scrollEl, onEditorScroll, onSelfScroll }
const _readOnly = new Compartment();

// Marks transactions applied from outside (textarea → CM6) so the update
// listener can tell them apart from real typing in this surface.
const External = Annotation.define();

// Markdown syntax colouring that follows the app's theme variables, so every
// theme works without per-theme CM6 config. Also covers the embedded-
// language tags fenced code blocks parse into (see codeLanguages/mount()
// below) — the same shared HighlightStyle applies everywhere in this view,
// and @lezer/highlight's tag vocabulary (keyword, string, number, …) is
// consistent across JS/Python/JSON/HTML/CSS grammars, so one rule set
// covers all of them. Mirrors the --syntax-* palette panels.css already
// uses for the static Preview pane's Prism highlighting, so a code block
// looks the same whether you're looking at it in Preview or Live/Split.
const _mdHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em',  fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.3em',  fontWeight: '700' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: '650' },
  { tag: tags.heading4, fontWeight: '650' },
  { tag: tags.heading5, fontWeight: '650' },
  { tag: tags.heading6, fontWeight: '650' },
  { tag: tags.strong,   fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link,     color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.url,      color: 'var(--accent)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)' },
  { tag: tags.quote,    color: 'var(--text-secondary)', fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: 'var(--text-muted)' }, // #, *, `, > markers
  { tag: tags.contentSeparator, color: 'var(--text-muted)' },      // --- rules
  // Embedded fenced-code-block languages.
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.modifier, tags.self, tags.tagName, tags.attributeName], color: 'var(--accent)' },
  { tag: [tags.string, tags.special(tags.string), tags.attributeValue], color: 'var(--syntax-string)' },
  // @lezer/highlight defines tags.character as a sub-tag of tags.string
  // (`character: t(string)`), so it would otherwise inherit the string
  // color above — explicitly neutralized because markdownLanguage's own
  // built-in Emoji shortcode extension (":smile:") tags its match with
  // exactly this tag, and none of the 5 target code languages need a
  // distinct "character" color (all use plain tags.string). Without this,
  // literal, unconverted shortcode text — which markdown.js's static
  // renderer deliberately leaves unstyled; see "Emoji" in
  // docs/markdown-feature-audit.md — would visibly (mis)color as if it
  // were a real string.
  { tag: tags.character, color: 'inherit' },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom], color: 'var(--syntax-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.className, tags.typeName], color: 'var(--syntax-fn)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket, tags.paren, tags.squareBracket, tags.brace, tags.separator], color: 'var(--text-secondary)' },
  { tag: tags.regexp, color: 'var(--syntax-regex)' },
]);

const _CODE_LANG_MAP = {
  js: javascript().language, javascript: javascript().language, mjs: javascript().language, cjs: javascript().language,
  jsx: javascript().language, ts: javascript().language, typescript: javascript().language, tsx: javascript().language,
  py: python().language, python: python().language,
  json: json().language, jsonc: json().language,
  html: html().language, htm: html().language, xml: html().language,
  css: css().language,
  sh: StreamLanguage.define(shell), bash: StreamLanguage.define(shell), shell: StreamLanguage.define(shell), zsh: StreamLanguage.define(shell),
};

/** markdown()'s codeLanguages callback — maps a fenced code block's info string (```js etc.) to a Language for real syntax highlighting instead of plain text. */
function _codeLanguageFor(info) {
  const lang = (info || '').trim().split(/\s+/)[0].toLowerCase();
  return _CODE_LANG_MAP[lang] || null;
}

// ── ==highlight== extension ──────────────────────────────────────────────────
// Shared with markdown.js (the static renderer's shared-parse-tree
// counterpart) — see markdown-highlight-extension.js's own header comment
// for why this must be the exact same extension object shape in both places.
const _highlightExtension = highlightExtension;

// ── Seamless-preview decorations ─────────────────────────────────────────────
//
// The Typora behaviour: syntax markers (#, **, *, ~~, `) are hidden wherever
// the cursor isn't, so the document reads as formatted text — and the moment
// the selection touches a formatted element, its raw markers reappear for
// editing. The document itself never changes; these are visual-only
// Decoration.replace ranges recomputed per viewport/selection/doc update.

// Marker node → the enclosing element whose selection-touch reveals it.
const _MARK_NODES = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'StrikethroughMark', 'HighlightMark']);
const _hideDeco      = Decoration.replace({});
const _codeDeco      = Decoration.mark({ class: 'cm-md-inlinecode' });
const _highlightDeco = Decoration.mark({ class: 'cm-md-highlight' });
const _QUOTE_MAX_DEPTH = 4; // beyond this, cap the class rather than emit unbounded CSS/decorations
const _quoteLineByDepth = new Map();
function _quoteLineForDepth(depth) {
  const d = Math.max(1, Math.min(depth, _QUOTE_MAX_DEPTH));
  let deco = _quoteLineByDepth.get(d);
  if (!deco) {
    deco = Decoration.line({ class: `cm-md-blockquote cm-md-blockquote-${d}` });
    _quoteLineByDepth.set(d, deco);
  }
  return deco;
}
// cm-md-codeblock-content marks only the lines strictly between the opening
// and closing fence — i.e. the actual code, not the ``` delimiter lines
// themselves (which also carry the plain cm-md-codeblock box-styling class,
// via -first/-last below, but shouldn't count as "line 1"/get a trailing
// blank numbered row when line numbers are on).
const _codeLine      = Decoration.line({ class: 'cm-md-codeblock cm-md-codeblock-content' });
const _codeFirstLine = Decoration.line({ class: 'cm-md-codeblock cm-md-codeblock-first' });
const _codeLastLine  = Decoration.line({ class: 'cm-md-codeblock cm-md-codeblock-last' });

function _selectionTouches(state, from, to) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

// Clickable checkbox replacing a task marker ([ ] / [x]). Toggling rewrites
// the marker text through a normal user transaction, so the edit flows out
// through onChange → textarea → the whole save/broadcast pipeline.
class _CheckboxWidget extends WidgetType {
  constructor(checked, from, to) { super(); this.checked = checked; this.from = from; this.to = to; }
  eq(other) { return other.checked === this.checked && other.from === this.from && other.to === this.to; }
  toDOM(view) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-md-checkbox';
    box.checked = this.checked;
    box.addEventListener('change', () => {
      if (view.state.readOnly) { box.checked = this.checked; return; }
      view.dispatch({ changes: { from: this.from, to: this.to, insert: box.checked ? '[x]' : '[ ]' } });
    });
    return box;
  }
}

class _BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-md-bullet';
    s.textContent = '•';
    return s;
  }
}

class _HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const hr = document.createElement('span');
    hr.className = 'cm-md-hr';
    return hr;
  }
}

const _bulletWidget = new _BulletWidget();
const _hrWidget     = new _HrWidget();

// ── GFM alerts (> [!NOTE] etc.) ──────────────────────────────────────────────
//
// lezer-markdown's base grammar has no concept of these — a "[!NOTE]" on its
// own line inside a blockquote just parses as an ordinary (unresolved)
// shortcut-reference Link node. Detected here by matching the blockquote's
// first line against GitHub's five alert kinds, mirroring markdown.js's own
// static renderer (_ALERT_ICONS) so Live/Split/Preview shows the same
// coloured box + icon+label the exported HTML already did.
const _ALERT_LABEL = {
  note: 'ℹ️ Note', tip: '💡 Tip', important: '❗ Important', warning: '⚠️ Warning', caution: '🛑 Caution',
};
const _ALERT_LINE_RE = /^>\s*\[!(note|tip|important|warning|caution)\]\s*$/i;

function _blockquoteAlertKind(state, from) {
  const m = _ALERT_LINE_RE.exec(state.doc.lineAt(from).text);
  return m ? m[1].toLowerCase() : null;
}

const _alertLineDeco = Object.fromEntries(
  Object.keys(_ALERT_LABEL).map((kind) => [kind, Decoration.line({ class: `cm-md-alert cm-md-alert-${kind}` })]),
);

class _AlertLabelWidget extends WidgetType {
  constructor(kind) { super(); this.kind = kind; }
  eq(other) { return other.kind === this.kind; }
  toDOM() {
    const span = document.createElement('span');
    span.className = `cm-md-alert-title cm-md-alert-title-${this.kind}`;
    span.textContent = _ALERT_LABEL[this.kind];
    return span;
  }
}

// ── Footnotes ─────────────────────────────────────────────────────────────────
//
// "[^label]" parses the same way "[!NOTE]" does — an unresolved shortcut
// Link node — since footnotes aren't part of lezer-markdown's base grammar
// either. No attempt to relocate definitions into a rendered "Footnotes"
// section the way the static renderer does (this is an editable surface;
// moving text out of document order would fight the user editing it) — just
// enough visual distinction that neither form reads as stray bracket noise.
const _FOOTNOTE_RE = /^\[\^([^\]]+)\]$/;

/** Find "[^label]: text" anywhere in the document — the reference widget
 *  needs the definition's text to show in its popover, but the two can be
 *  arbitrarily far apart (definitions are conventionally kept at the bottom
 *  while references are inline), so this can't just look at nearby lines. */
function _findFootnoteDefText(doc, label) {
  const re = new RegExp(`^\\[\\^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]:[ \\t]?(.*)$`);
  for (let n = 1; n <= doc.lines; n++) {
    const m = re.exec(doc.line(n).text);
    if (m) return m[1];
  }
  return null;
}

class _FootnoteRefWidget extends WidgetType {
  // defText is null for a reference with no matching definition anywhere in
  // the document — rendered inert (no popover) rather than crashing or
  // showing an empty box, same "gracefully do nothing" shape as a broken
  // image thumbnail elsewhere in this app.
  constructor(label, defText) { super(); this.label = label; this.defText = defText; }
  eq(other) { return other.label === this.label && other.defText === this.defText; }
  toDOM() {
    const sup = document.createElement('sup');
    sup.className = 'cm-md-footnote-ref';
    sup.textContent = this.label;
    if (this.defText != null) {
      sup.classList.add('cm-md-footnote-ref-interactive');
      sup.tabIndex = 0;
      sup.setAttribute('role', 'button');
      sup.setAttribute('aria-expanded', 'false');
      sup.setAttribute('aria-label', `Footnote ${this.label}`);
      const open = (evt) => {
        evt.preventDefault();
        toggleFootnotePopover(sup, renderMarkdown(this.defText));
      };
      sup.addEventListener('mousedown', open);
      sup.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); open(evt); }
      });
    }
    return sup;
  }
  ignoreEvent() { return true; }
}

class _FootnoteDefMarkerWidget extends WidgetType {
  constructor(label) { super(); this.label = label; }
  eq(other) { return other.label === this.label; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-md-footnote-def-marker';
    span.textContent = `${this.label}.`;
    return span;
  }
}

// ── GFM tables ────────────────────────────────────────────────────────────────
//
// The base markdown() config (via markdownLanguage) already parses GFM
// tables into Table/TableHeader/TableRow/TableCell/TableDelimiter nodes —
// same grammar that gives us TaskList/Strikethrough for free — but nothing
// previously turned that tree into an actual <table>, so it just sat there
// as literal pipe-delimited text. Rendered as a whole-block replace widget,
// same "reveal raw source while the selection touches it" pattern as Image.
class _TableWidget extends WidgetType {
  constructor(html) { super(); this.html = html; }
  eq(other) { return other.html === this.html; }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table-wrap';
    wrap.innerHTML = this.html;
    return wrap;
  }
  ignoreEvent() { return true; }
}

function _buildTableHtml(state, tableNode) {
  const rows = [];
  let alignments = [];
  for (let child = tableNode.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableDelimiter') {
      alignments = parseTableAlignments(state.doc.sliceString(child.from, child.to));
    } else if (child.name === 'TableHeader' || child.name === 'TableRow') {
      const cells = [];
      for (let cell = child.firstChild; cell; cell = cell.nextSibling) {
        if (cell.name === 'TableCell') cells.push(state.doc.sliceString(cell.from, cell.to).trim());
      }
      rows.push({ header: child.name === 'TableHeader', cells });
    }
  }
  const alignAttr = (i) => (alignments[i] ? ` style="text-align:${alignments[i]}"` : '');
  const headRow   = rows.find((r) => r.header);
  const bodyRows  = rows.filter((r) => !r.header);
  let html = '<table class="cm-md-table">';
  if (headRow) {
    html += '<thead><tr>' + headRow.cells.map((c, i) => `<th${alignAttr(i)}>${escapeHtml(c)}</th>`).join('') + '</tr></thead>';
  }
  if (bodyRows.length) {
    html += '<tbody>' + bodyRows.map((r) =>
      '<tr>' + r.cells.map((c, i) => `<td${alignAttr(i)}>${escapeHtml(c)}</td>`).join('') + '</tr>',
    ).join('') + '</tbody>';
  }
  return html + '</table>';
}

// "3/5 done" badge above a top-level checklist block, counting every
// checkbox in the block including nested sub-items — mirrors the badge the
// rendered-HTML preview shows via markdown.js's own list renderer.
class _ChecklistProgressWidget extends WidgetType {
  constructor(checked, total) { super(); this.checked = checked; this.total = total; }
  eq(other) { return other.checked === this.checked && other.total === this.total; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-md-checklist-progress';
    el.textContent = `${this.checked}/${this.total} done`;
    return el;
  }
}

// Images pasted straight into the editor use the syncpad-file: pseudo-scheme
// (see markdown.js) since the Storage bucket is private and a real signed
// URL can't be baked into persisted content. Set once via
// setFileImageResolver() — same pattern as ui.js's rendered-preview path —
// so this module doesn't need its own import of files.js.
let _fileImageResolver = null;

/** @param {(filePath: string) => Promise<string>} resolver */
export function setFileImageResolver(resolver) { _fileImageResolver = resolver; }

class _ImageWidget extends WidgetType {
  constructor(alt, url) { super(); this.alt = alt || ''; this.url = url || ''; }
  eq(other) { return other.alt === this.alt && other.url === this.url; }
  toDOM() {
    const img = document.createElement('img');
    img.alt = this.alt;
    img.className = 'cm-md-image';
    img.addEventListener('error', () => img.classList.add('cm-md-image-broken'));

    const fileMatch = /^syncpad-file:(.+)$/i.exec(this.url);
    if (fileMatch && _fileImageResolver) {
      _fileImageResolver(fileMatch[1])
        .then((resolvedUrl) => { img.src = resolvedUrl; })
        .catch(() => img.classList.add('cm-md-image-broken'));
    } else if (/^https?:\/\//i.test(this.url)) {
      img.src = this.url;
    } else {
      img.classList.add('cm-md-image-broken');
    }
    return img;
  }
}

// ── Live remote cursors ──────────────────────────────────────────────────────
//
// Colored in-text carets with name labels for each remote collaborator,
// Google-Docs style. Positions arrive from the presence channel (app.js
// calls setRemoteCursors) and live in a StateField whose decorations are
// mapped through local doc changes, so carets stay visually anchored while
// this device types between presence updates.

class _RemoteCaretWidget extends WidgetType {
  constructor(name, color) { super(); this.name = name; this.color = color; }
  eq(other) { return other.name === this.name && other.color === this.color; }
  toDOM() {
    const caret = document.createElement('span');
    caret.className = 'cm-remote-caret';
    caret.style.borderLeftColor = this.color;
    const label = document.createElement('span');
    label.className = 'cm-remote-caret-label';
    label.style.background = this.color;
    label.textContent = this.name;
    caret.appendChild(label);
    return caret;
  }
  ignoreEvent() { return true; }
}

const _setRemoteCursorsEffect = StateEffect.define();

const _remoteCursorField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) if (e.is(_setRemoteCursorsEffect)) value = e.value;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// "3/5 done" badges above top-level checklists. CM6 requires block-level
// widgets to come from a StateField, not a ViewPlugin (the seamless-folding
// plugin above only ever produces inline/replace decorations) — recomputed
// on every doc change by re-walking the syntax tree, which is cheap at
// BODY_MAX's ~50k-character ceiling.
function _computeChecklistBadges(state) {
  const ranges = [];
  syntaxTree(state).iterate({
    enter: (nodeRef) => {
      const name = nodeRef.name;
      if (name !== 'BulletList' && name !== 'OrderedList') return;
      // Nested sub-lists don't get their own badge — only the outermost
      // list of a block, matching the rendered-preview renderer.
      if (nodeRef.node.parent?.name === 'ListItem') return;
      let total = 0, checkedCount = 0;
      syntaxTree(state).iterate({
        from: nodeRef.from, to: nodeRef.to,
        enter: (inner) => {
          if (inner.name !== 'TaskMarker') return;
          total++;
          if (/x/i.test(state.doc.sliceString(inner.from, inner.to))) checkedCount++;
        },
      });
      if (total > 0) {
        ranges.push(Decoration.widget({
          widget: new _ChecklistProgressWidget(checkedCount, total), side: -1, block: true,
        }).range(nodeRef.from));
      }
    },
  });
  return Decoration.set(ranges, true);
}

const _checklistProgressField = StateField.define({
  create: (state) => _computeChecklistBadges(state),
  update(value, tr) { return tr.docChanged ? _computeChecklistBadges(tr.state) : value.map(tr.changes); },
  provide: (f) => EditorView.decorations.from(f),
});

// EditorView.scrollIntoView() (the built-in CM6 scroll-effect API) doesn't
// produce a visible scroll anywhere in this app's actual runtime — confirmed
// by dispatching it directly: the selection moves to the right offset, but
// .cm-scroller's scrollTop never changes. Ruled out a stale vendor bundle
// (rebuilt fresh with esbuild, same result), the wrong scrollable ancestor
// (only .cm-scroller in the chain has real overflow), and a duplicate
// @codemirror/view copy (only one is installed). Root cause not fully
// pinned down beyond that; this computes and applies the scroll manually
// instead. view.coordsAtPos() alone isn't enough here — it returns null for
// any position that isn't currently drawn (i.e. exactly the case that needs
// scrolling in the first place), so this uses view.lineBlockAt(pos).top,
// which is based on CM6's own height map/oracle and works for undrawn
// positions too — confirmed reliable via direct testing.
// `smooth` defaults to false: this is also the mechanism the Split-mode
// proportional sync handlers rely on indirectly (they set scrollTop
// directly, not through here, but share the same scroller) — an animated
// scroll here is fine since it's a one-off user-initiated jump, but callers
// that want it (currently only the [TOC] widget's own click) must ask for
// it explicitly rather than it being a blanket default.
function _scrollPosIntoView(view, pos, { center = true, smooth = false } = {}) {
  const scroller = view.scrollDOM;
  const block = view.lineBlockAt(Math.min(pos, view.state.doc.length));
  const target = center ? block.top - scroller.clientHeight / 2 : block.top - 40;
  const top = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
  const reduceMotion = smooth && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (smooth && !reduceMotion) scroller.scrollTo({ top, behavior: 'smooth' });
  else scroller.scrollTop = top;
}

// Typora-style [TOC] marker: a line containing only "[TOC]" gets a rendered
// contents nav placed above it (the literal "[TOC]" text stays visible/
// editable below, same badge-above-content pattern as the checklist
// progress indicator). Clicking an entry jumps the caret to (and scrolls to)
// that heading — the same "Contents" list the static/export renderer's
// nav offers, just navigating within this surface instead of via real
// document.location anchors.
function _stripHeadingMarkup(raw) {
  return raw
    .replace(/^#{1,6}\s+/, '')
    .replace(/\s*#*\s*$/, '')
    .replace(/[*_`~=]/g, '')
    .trim();
}

// Live mode is the seamless, Typora-style surface — the whole point is that
// rendered constructs show their result immediately, not behind an extra
// click. Unlike the static renderer's .md-inline-toc (export/non-live
// preview, where a reader opting into a plain HTML document reasonably
// expects a collapsed-by-default nav) and the floating .note-toc auto-nav
// (a persistent chrome element, not part of the document being edited),
// the [TOC] widget here stands in for real document content while you're
// actively writing it, so it starts open. _liveTocOpen remembers a manual
// collapse across re-renders (new transactions re-create the widget only
// when the heading list itself changes — eq() above reuses the existing DOM
// otherwise — so without this, editing an unrelated heading while the user
// had deliberately collapsed the nav would silently pop it open again).
let _liveTocOpen = true;

class _TocWidget extends WidgetType {
  constructor(entries) { super(); this.entries = entries; }
  eq(other) {
    return other.entries.length === this.entries.length &&
      other.entries.every((e, i) => e.level === this.entries[i].level && e.text === this.entries[i].text && e.pos === this.entries[i].pos);
  }
  toDOM(view) {
    // <details>/<summary> gives free keyboard toggling and native semantics;
    // ignoreEvent() returning true below keeps CM6 from intercepting the
    // <summary> click before the browser's native toggle runs.
    const nav = document.createElement('details');
    nav.className = 'cm-md-inline-toc';
    if (_liveTocOpen) nav.open = true;
    nav.addEventListener('toggle', () => { _liveTocOpen = nav.open; });
    const label = document.createElement('summary');
    label.textContent = 'Contents';
    nav.appendChild(label);
    const ul = document.createElement('ul');
    for (const e of this.entries) {
      const li = document.createElement('li');
      li.style.paddingLeft = `${(Math.max(1, e.level) - 1) * 0.9}em`;
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = e.text || 'section';
      const navigate = () => {
        const pos = Math.min(e.pos, view.state.doc.length);
        view.dispatch({ selection: { anchor: pos } });
        _scrollPosIntoView(view, pos, { smooth: true });
        view.focus();
      };
      a.addEventListener('mousedown', (evt) => {
        // mousedown (not click) so this fires before the editor would
        // otherwise steal focus/selection on the way to a click.
        evt.preventDefault();
        navigate();
      });
      // A real <a href> is natively Tab-focusable, and a keyboard Enter/Space
      // on a focused link only ever fires 'click' — never 'mousedown' — so
      // without this, keyboard users could Tab to an entry but activating it
      // would do nothing (the preventDefault below would still block the
      // native "#" navigation, but never actually jump anywhere either). A
      // real mouse click also fires 'click' right after 'mousedown', which
      // already navigated — evt.detail is 0 only for a keyboard-synthesized
      // click, never a real pointer one, so this only re-runs it once, not
      // twice, for a mouse user.
      a.addEventListener('click', (evt) => {
        evt.preventDefault();
        if (evt.detail === 0) navigate();
      });
      // preventDefault() on mousedown stops CM6's own click-to-position
      // handling, but a real browser still fires the subsequent click event
      // and follows this <a>'s own href="#" afterward unless that's also
      // suppressed — left unhandled, it appends a bare "#" to the URL and
      // fights the scroll dispatched above.
      a.addEventListener('click', (evt) => evt.preventDefault());
      li.appendChild(a);
      ul.appendChild(li);
    }
    nav.appendChild(ul);
    return nav;
  }
  ignoreEvent() { return true; }
}

// Shared by the [TOC] widget above and the minimap track below — both need
// the same "every ATX heading, in document order" list.
function _collectHeadings(state) {
  const headings = [];
  syntaxTree(state).iterate({
    enter: (nodeRef) => {
      const m = /^ATXHeading([1-6])$/.exec(nodeRef.name);
      if (!m) return;
      headings.push({
        level: Number(m[1]),
        text: _stripHeadingMarkup(state.doc.sliceString(nodeRef.from, nodeRef.to)),
        pos: nodeRef.from,
      });
    },
  });
  return headings;
}

function _computeTocBadges(state) {
  const headings = _collectHeadings(state);
  if (headings.length < 2) return Decoration.none;

  const ranges = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!/^\[toc\]$/i.test(line.text.trim())) continue;
    // Reveal the raw "[TOC]" marker while the cursor is actually on it (same
    // pattern as every other hideable construct in this file) — otherwise
    // there's no way to select/delete the line without leaving Live mode.
    if (_selectionTouches(state, line.from, line.to)) continue;
    // A *replace*, not an insertion: this was previously Decoration.widget()
    // (additive), which left the literal "[TOC]" text sitting right below
    // the rendered Contents box instead of being hidden by it — the one
    // seamless-editing construct in this file that didn't actually replace
    // its own source text.
    ranges.push(Decoration.replace({
      widget: new _TocWidget(headings), side: -1, block: true,
    }).range(line.from, line.to));
  }
  return Decoration.set(ranges, true);
}

const _tocField = StateField.define({
  create: (state) => _computeTocBadges(state),
  // Recomputed on every transaction, not just docChanged — whether the
  // marker line renders as the widget or reveals its raw "[TOC]" text now
  // depends on the *selection* too (reveal-while-touched, same as
  // Image/HorizontalRule/_tableField below).
  update(value, tr) { return _computeTocBadges(tr.state); },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Document mini-map (heading overview strip) ──────────────────────────────
// A very thin rail along the scroller's right edge, near-invisible until
// hovered, with one tick per heading positioned proportionally to where it
// falls in the full scrollable document — a subtle "you are here, and here's
// what's ahead" overview built from the same heading list [TOC] uses,
// without the fully-fledged always-visible sidebar a real minimap would be.
// Ticks are fixed relative to the viewport (not the scrolled content), same
// as a native scrollbar, so they only need recomputing when the document or
// the editor's own size changes — never on scroll.
class _MinimapTrack {
  constructor(view) {
    this.dom = document.createElement('div');
    this.dom.className = 'cm-minimap';
    view.dom.appendChild(this.dom);
    this._positioned = null;
    this.rebuild(view);
  }
  update(update) {
    // Neither viewportChanged nor geometryChanged is a reliable "only fires
    // on a real content/size change" signal here: CM6's virtualized scroller
    // destroys/recreates off-screen line DOM nodes as you scroll, and that
    // churn alone can raise geometryChanged even when nothing about the
    // document's headings or their positions actually moved (confirmed by
    // testing — plain back-and-forth scrolling over an already-fully-
    // measured document kept re-triggering it). But dropping both outright
    // would also drop the legitimate case: CM6 only parses/measures a long
    // document up to roughly the current viewport, so scrolling into an
    // unvisited region can genuinely reveal headings that plain docChanged
    // would never catch. So: check on all three, but let rebuild() itself
    // decide whether anything actually changed before touching the DOM —
    // recomputing the heading list is cheap; tearing down and recreating
    // every tick (and any focus that was on one) is not.
    if (update.docChanged || update.geometryChanged || update.viewportChanged) this.rebuild(update.view);
  }
  rebuild(view) {
    const headings = _collectHeadings(view.state);
    const totalHeight = view.contentHeight || 1;
    const positioned = headings.map((h) => ({
      ...h,
      top: Math.min(100, (view.lineBlockAt(h.pos).top / totalHeight) * 100),
    }));
    // A tolerance comparison, not an exact-match fingerprint — CM6 estimates
    // unmeasured lines' heights and keeps refining the estimate as more of a
    // long document is scrolled into view, which nudges every later
    // heading's cumulative "top" by a fraction of a percent even when
    // nothing about its actual position changed in any way a user could
    // perceive (confirmed by measurement: a full round-trip through an
    // already-settled document, position deltas topped out under 0.4
    // percentage points — a fraction of a CSS pixel on the minimap rail).
    // Rounding to a fixed precision before an exact-match comparison still
    // misfires for values that happen to straddle a rounding boundary
    // between two reads, so this compares the actual delta against a
    // tolerance instead — immune to boundary-crossing by construction.
    const TOP_TOLERANCE_PCT = 0.75;
    const prev = this._positioned;
    const unchanged = prev && prev.length === positioned.length && positioned.every((h, i) =>
      h.level === prev[i].level && h.text === prev[i].text && Math.abs(h.top - prev[i].top) <= TOP_TOLERANCE_PCT);
    if (unchanged) return; // nothing actually changed — skip the DOM churn
    this._positioned = positioned;

    this.dom.innerHTML = '';
    this.dom.classList.toggle('hidden', positioned.length < 2);
    if (positioned.length < 2) return;
    for (const h of positioned) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `cm-minimap-dot cm-minimap-dot-h${h.level}`;
      dot.style.top = `${h.top}%`;
      dot.title = h.text || 'section';
      dot.setAttribute('aria-label', `Jump to ${h.text || 'section'}`);
      const jump = () => {
        const pos = Math.min(h.pos, view.state.doc.length);
        view.dispatch({ selection: { anchor: pos } });
        _scrollPosIntoView(view, pos, { smooth: true });
        view.focus();
      };
      dot.addEventListener('mousedown', (evt) => {
        // mousedown, same as the [TOC] widget above, so this fires before
        // the editor would otherwise steal focus/selection on the way to a click.
        evt.preventDefault();
        jump();
      });
      // Same reasoning as the [TOC] widget's <a> above: a native <button> is
      // Tab-focusable, but keyboard Enter/Space activation only ever fires
      // 'click' (never 'mousedown'), so without this a keyboard user could
      // Tab to a tick and have Enter/Space do nothing. evt.detail is 0 only
      // for a keyboard-synthesized click, never a real pointer one, so a
      // mouse click (already handled by mousedown above) doesn't re-jump.
      dot.addEventListener('click', (evt) => {
        if (evt.detail === 0) jump();
      });
      this.dom.appendChild(dot);
    }
  }
  destroy() { this.dom.remove(); }
}
const _minimapPlugin = ViewPlugin.fromClass(_MinimapTrack);

// GFM tables → real <table>s. A block-replace decoration (unlike the
// additive widgets above) must come from a StateField — CM6 rejects block
// decorations from a ViewPlugin outright ("Block decorations may not be
// specified via plugins"), which is also why this couldn't just be one more
// case in the _seamless plugin above. Recomputed on every transaction, not
// just docChanged, because whether a given table renders as a widget or its
// raw pipe syntax depends on the *selection* (reveal-while-touched, same as
// Image/HorizontalRule) — cheap enough at BODY_MAX's ~50k-char ceiling.
function _computeTableDecorations(state) {
  const ranges = [];
  syntaxTree(state).iterate({
    enter: (nodeRef) => {
      if (nodeRef.name !== 'Table') return;
      if (_selectionTouches(state, nodeRef.from, nodeRef.to)) return;
      const html = _buildTableHtml(state, nodeRef.node);
      ranges.push(Decoration.replace({ widget: new _TableWidget(html), block: true }).range(nodeRef.from, nodeRef.to));
    },
  });
  return Decoration.set(ranges, true);
}

const _tableField = StateField.define({
  create: (state) => _computeTableDecorations(state),
  update(value, tr) { return _computeTableDecorations(tr.state); },
  provide: (f) => EditorView.decorations.from(f),
});

/** Stable per-device caret colour derived from its id. */
export function colorForDevice(deviceId) {
  let hash = 0;
  const s = String(deviceId || '');
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  return `hsl(${((hash % 360) + 360) % 360}, 65%, 48%)`;
}

/**
 * Render carets (and selection ranges, when a collaborator has one) for
 * remote collaborators.
 * @param {{ id: string, name: string, pos: number, anchor?: number }[]} cursors
 */
export function setRemoteCursors(cursors) {
  if (!_view) return;
  const docLen = _view.state.doc.length;
  const ranges = [];
  for (const c of (cursors || [])) {
    if (typeof c.pos !== 'number' || c.pos < 0) continue;
    const pos = Math.min(c.pos, docLen);
    const anchor = typeof c.anchor === 'number' && c.anchor >= 0 ? Math.min(c.anchor, docLen) : pos;
    if (anchor !== pos) {
      const from = Math.min(anchor, pos);
      const to   = Math.max(anchor, pos);
      ranges.push(Decoration.mark({
        class: 'cm-remote-selection',
        attributes: { style: `background: color-mix(in srgb, ${colorForDevice(c.id)} 28%, transparent)` },
      }).range(from, to));
    }
    ranges.push(Decoration.widget({
      widget: new _RemoteCaretWidget(c.name || 'Someone', colorForDevice(c.id)),
      side: -1,
    }).range(pos));
  }
  _view.dispatch({
    effects: _setRemoteCursorsEffect.of(Decoration.set(ranges, true)),
    annotations: External.of(true),
  });
}

/**
 * Scroll the local view so `pos` is visible — used by "Follow" mode to
 * jump to where a followed collaborator's cursor/selection currently is.
 * No-op when unmounted or pos is out of range.
 */
export function scrollToPos(pos) {
  if (!_view || typeof pos !== 'number' || pos < 0 || pos > _view.state.doc.length) return;
  _scrollPosIntoView(_view, pos);
}

/**
 * Select [from, to] and scroll it into view without touching the document —
 * the Live/Split-surface counterpart of setting selectionStart/selectionEnd
 * + scrollTop on a plain textarea. Used by Find & Replace to highlight the
 * current match on this surface instead of forcing a switch back to Write
 * mode just to move the caret.
 */
export function setSelection(from, to) {
  if (!_view) return;
  const docLen = _view.state.doc.length;
  const a = Math.max(0, Math.min(from ?? 0, docLen));
  const b = Math.max(0, Math.min(to ?? a, docLen));
  _view.dispatch({ selection: { anchor: a, head: b } });
  _scrollPosIntoView(_view, b);
}

// ── Comment anchors ───────────────────────────────────────────────────────────
// A dotted underline marking the text range a comment is attached to —
// display only, no popover; clicking one is handled by the Comments panel's
// own list rather than in-editor, keeping this to the same "decoration
// pushed in from outside" pattern setRemoteCursors() already uses.

const _setCommentAnchorsEffect = StateEffect.define();

const _commentAnchorsField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) if (e.is(_setCommentAnchorsEffect)) value = e.value;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * @param {{ id: string, from: number, to: number }[]} comments
 */
export function setCommentAnchors(comments) {
  if (!_view) return;
  const docLen = _view.state.doc.length;
  const ranges = [];
  for (const c of (comments || [])) {
    if (typeof c.from !== 'number' || typeof c.to !== 'number') continue;
    const from = Math.max(0, Math.min(c.from, docLen));
    const to   = Math.max(from, Math.min(c.to, docLen));
    if (to <= from) continue; // point comments (no selected range) have nothing to underline
    ranges.push(Decoration.mark({ class: 'cm-comment-anchor' }).range(from, to));
  }
  _view.dispatch({
    effects: _setCommentAnchorsEffect.of(Decoration.set(ranges, true)),
    annotations: External.of(true),
  });
}

// Extract a Link node's destination for ctrl/cmd+click opening — either a
// real http(s) URL to open directly, or an uploaded file's storage path
// (syncpad-file: scheme, same as _renderLink/_renderImage in markdown.js)
// that needs an async signed-URL resolve first. Anything else (unresolved
// schemes) doesn't open, same policy as the static markdown renderer.
function _linkUrlAt(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (node && node.name !== 'Link') node = node.parent;
  if (!node) return null;
  const urlNode = node.getChild('URL');
  if (!urlNode) return null;
  const url = state.doc.sliceString(urlNode.from, urlNode.to);
  if (/^https?:\/\//i.test(url)) return { type: 'http', url };
  const fileMatch = /^syncpad-file:(.+)$/i.exec(url);
  if (fileMatch) return { type: 'file', path: fileMatch[1] };
  return null;
}

const _seamless = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = this.build(update.view);
    }
  }
  build(view) {
    const { state } = view;
    const ranges = [];
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(state).iterate({
        from, to,
        enter: (nodeRef) => {
          const name = nodeRef.name;

          // Inline-code chip styling rides along with the same tree walk.
          if (name === 'InlineCode') {
            ranges.push(_codeDeco.range(nodeRef.from, nodeRef.to));
            return;
          }

          // Highlight background spans the whole ==text==; its HighlightMark
          // children still fold/reveal via the generic _MARK_NODES handling
          // below, so this doesn't return — the walk continues into them.
          if (name === 'Highlight') {
            ranges.push(_highlightDeco.range(nodeRef.from, nodeRef.to));
          }


          // Blockquote: styled left border on each line (a GFM-alert kind's
          // coloured variant when the first line is "> [!NOTE]" etc.), scaled
          // by nesting depth so "> > text" reads as visibly more indented
          // than "> text" instead of both getting the same flat border. The
          // walk visits every ancestor Blockquote too, so a nested line ends
          // up with more than one cm-md-blockquote-N class — harmless, since
          // increasing-depth rules are declared in increasing order in CSS,
          // so the deepest one simply wins the cascade for that line. The >
          // marks are hidden below via QuoteMark when not being edited.
          if (name === 'Blockquote') {
            const alertKind = _blockquoteAlertKind(state, nodeRef.from);
            let depth = 0;
            for (let n = nodeRef.node; n; n = n.parent) if (n.name === 'Blockquote') depth++;
            const lineDeco = alertKind ? _alertLineDeco[alertKind] : _quoteLineForDepth(depth);
            for (let line = state.doc.lineAt(nodeRef.from); line.from <= nodeRef.to;) {
              ranges.push(lineDeco.range(line.from));
              if (line.to + 1 > state.doc.length) break;
              line = state.doc.lineAt(line.to + 1);
            }
            return;
          }

          // Fenced code block → a background box across all its lines,
          // matching the static Preview pane's <pre> styling (background,
          // rounded corners top/bottom). The ``` marks and info string
          // still fold/reveal via the generic mark-hiding logic below —
          // this only adds the box, it doesn't return early.
          if (name === 'FencedCode') {
            const first = state.doc.lineAt(nodeRef.from);
            const last  = state.doc.lineAt(nodeRef.to);
            for (let line = first; line.from <= last.from;) {
              const deco = line.number === first.number ? _codeFirstLine
                : line.number === last.number ? _codeLastLine
                : _codeLine;
              ranges.push(deco.range(line.from));
              if (line.to + 1 > state.doc.length) break;
              line = state.doc.lineAt(line.to + 1);
            }
          }

          // "[!NOTE]" etc. parses as an ordinary (unresolved) shortcut Link
          // node — relabel it to an icon+title when it's alone on the first
          // line of its enclosing blockquote (matches _blockquoteAlertKind's
          // own check, so the two agree on which blockquotes are alerts).
          // Falls through to normal Link handling (below) for anything else.
          if (name === 'Link') {
            const text = state.doc.sliceString(nodeRef.from, nodeRef.to);
            const parent = nodeRef.node.parent;
            const grandparent = parent?.parent;

            const alertMatch = /^\[!(note|tip|important|warning|caution)\]$/i.exec(text);
            if (alertMatch && parent?.name === 'Paragraph' && grandparent?.name === 'Blockquote' &&
                _blockquoteAlertKind(state, grandparent.from) === alertMatch[1].toLowerCase()) {
              if (!_selectionTouches(state, nodeRef.from, nodeRef.to)) {
                ranges.push(Decoration.replace({ widget: new _AlertLabelWidget(alertMatch[1].toLowerCase()) }).range(nodeRef.from, nodeRef.to));
              }
              return false; // skip its LinkMark children — already fully replaced
            }

            const fnMatch = _FOOTNOTE_RE.exec(text);
            if (fnMatch) {
              const isDefinition = parent?.name === 'Paragraph' && nodeRef.from === parent.from &&
                state.doc.sliceString(nodeRef.to, nodeRef.to + 1) === ':';
              if (!_selectionTouches(state, nodeRef.from, nodeRef.to)) {
                const widget = isDefinition
                  ? new _FootnoteDefMarkerWidget(fnMatch[1])
                  : new _FootnoteRefWidget(fnMatch[1], _findFootnoteDefText(state.doc, fnMatch[1]));
                // A definition's own marker widget already renders "1." —
                // the raw ":" right after [^1] is still literal source text,
                // not part of the matched node, so it must be folded in here
                // too or it's left dangling right after the widget ("1.:
                // text" instead of "1. text"). The space after the colon is
                // deliberately left alone — it's the widget's only separator
                // from the following text, unlike HeaderMark's swallowed
                // space (which has no widget standing in for it).
                const to = isDefinition ? nodeRef.to + 1 : nodeRef.to;
                ranges.push(Decoration.replace({ widget }).range(nodeRef.from, to));
              }
              return false;
            }

            return;
          }

          // GFM tables are handled by _tableField below — block-replace
          // decorations can only come from a StateField, not this plugin
          // ("Block decorations may not be specified via plugins").

          // HTML comments (<!-- ... -->) are fully hidden — not just dimmed
          // like a syntax-highlighted code comment — while the selection
          // isn't touching them, same reveal-on-touch pattern as every other
          // hideable element here. 'Comment' is the inline node name; a
          // comment that's a whole block on its own line parses as the
          // distinct 'CommentBlock' node instead (confirmed via a direct
          // parser trace) — both need the same treatment.
          if (name === 'Comment' || name === 'CommentBlock') {
            if (!_selectionTouches(state, nodeRef.from, nodeRef.to)) {
              ranges.push(_hideDeco.range(nodeRef.from, nodeRef.to));
            }
            return;
          }

          // Horizontal rule → rendered line (revealed while touched).
          if (name === 'HorizontalRule') {
            if (!_selectionTouches(state, nodeRef.from, nodeRef.to)) {
              ranges.push(Decoration.replace({ widget: _hrWidget }).range(nodeRef.from, nodeRef.to));
            }
            return;
          }

          // Task marker ([ ] / [x]) → real clickable checkbox.
          if (name === 'TaskMarker') {
            const parent = nodeRef.node.parent; // Task (the list item content)
            if (parent && _selectionTouches(state, parent.from, parent.to)) return;
            const checked = state.doc.sliceString(nodeRef.from, nodeRef.to).toLowerCase().includes('x');
            let to = nodeRef.to;
            if (state.doc.sliceString(to, to + 1) === ' ') to += 1;
            ranges.push(Decoration.replace({ widget: new _CheckboxWidget(checked, nodeRef.from, nodeRef.to) }).range(nodeRef.from, to));
            return;
          }

          // Bullet list marks → •  (ordered-list numbers read fine as-is;
          // task items get their mark hidden since the checkbox stands in).
          if (name === 'ListMark') {
            const mark = state.doc.sliceString(nodeRef.from, nodeRef.to);
            if (!/^[-*+]$/.test(mark)) return;
            const item = nodeRef.node.parent; // ListItem
            if (item && _selectionTouches(state, item.from, item.to)) return;
            const isTask = !!item?.getChild?.('Task');
            let to = nodeRef.to;
            if (isTask) {
              if (state.doc.sliceString(to, to + 1) === ' ') to += 1;
              ranges.push(_hideDeco.range(nodeRef.from, to));
            } else {
              ranges.push(Decoration.replace({ widget: _bulletWidget }).range(nodeRef.from, nodeRef.to));
            }
            return;
          }

          // Inline images render as an actual <img>, replacing the whole
          // ![alt](url) span, while the selection isn't touching it. Read
          // alt/url from the node's own children (not a raw-text regex) so
          // a URL containing parentheses — e.g. a query string — still
          // parses correctly; the syntax tree already found its boundary.
          if (name === 'Image') {
            if (_selectionTouches(state, nodeRef.from, nodeRef.to)) return; // fall through to raw-text editing
            const marks = nodeRef.node.getChildren('LinkMark');
            const urlNode = nodeRef.node.getChild('URL');
            if (marks.length < 2 || !urlNode) return; // malformed — leave as plain text
            const alt = state.doc.sliceString(marks[0].to, marks[1].from);
            const url = state.doc.sliceString(urlNode.from, urlNode.to);
            ranges.push(Decoration.replace({ widget: new _ImageWidget(alt, url) }).range(nodeRef.from, nodeRef.to));
            return false; // skip descending into the marks this widget already replaces
          }

          // Quote marks and link syntax fold like wave-1 markers do.
          if (name === 'QuoteMark') {
            const parent = nodeRef.node.parent;
            if (parent && _selectionTouches(state, parent.from, parent.to)) return;
            let to = nodeRef.to;
            if (state.doc.sliceString(to, to + 1) === ' ') to += 1;
            ranges.push(_hideDeco.range(nodeRef.from, to));
            return;
          }
          if (name === 'LinkMark' || name === 'URL' || name === 'LinkLabel') {
            // LinkLabel is also how a reference *definition* line's own
            // "[id]:" starts — walking up from there never reaches a Link/
            // Image (its parent is LinkReference, not Link), so the walk
            // below naturally leaves that instance alone and only folds a
            // LinkLabel that's actually a reference *usage*, e.g. the
            // "[ref1]" in "[text][ref1]".
            let link = nodeRef.node.parent;
            while (link && link.name !== 'Link' && link.name !== 'Image') link = link.parent;
            if (!link) return;
            if (_selectionTouches(state, link.from, link.to)) return;
            // Hide [ ] ( ) marks, the URL, and a reference usage's own
            // "[id]" label — leaving just the link text.
            ranges.push(_hideDeco.range(nodeRef.from, nodeRef.to));
            return;
          }

          if (!_MARK_NODES.has(name)) return;

          // Reveal raw syntax while the selection touches the enclosing
          // element (the whole heading / bold span / code span), not just
          // the marker itself — that's what makes entering an element with
          // the caret "open it up" the way Typora does.
          const parent = nodeRef.node.parent;
          const revealFrom = parent ? parent.from : nodeRef.from;
          const revealTo   = parent ? parent.to   : nodeRef.to;
          if (_selectionTouches(state, revealFrom, revealTo)) return;

          // Heading marks also swallow the single space that follows the
          // #s, so "# Title" renders as just "Title".
          let hideTo = nodeRef.to;
          if (name === 'HeaderMark' && state.doc.sliceString(hideTo, hideTo + 1) === ' ') hideTo += 1;
          ranges.push(_hideDeco.range(nodeRef.from, hideTo));
        },
      });
    }
    return Decoration.set(ranges, true); // sort — mark/replace ranges interleave
  }
}, { decorations: (v) => v.decorations });

const _theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'inherit', color: 'var(--text-primary)', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--text-primary)', padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--text-primary)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    background: 'color-mix(in srgb, var(--accent) 25%, transparent)',
  },
  '.cm-line': { padding: '0' },
});

export function isMounted() { return !!_view; }

/**
 * Viewport pixel coordinates for a document offset (floating comment
 * composer/bubble placement). Returns null when unmounted or the position can't be resolved
 * (e.g. a remote peer's offset from a doc that has since changed length).
 */
export function coordsAtPos(pos) {
  if (!_view || !Number.isFinite(pos) || pos < 0 || pos > _view.state.doc.length) return null;
  try {
    const c = _view.coordsAtPos(pos);
    return c ? { x: c.left, y: c.top } : null;
  } catch { return null; }
}

/**
 * Viewport Y for a document offset, same as coordsAtPos()'s .y but works
 * even when the position isn't currently drawn (coordsAtPos returns null
 * for those — the same CM6 behavior _scrollPosIntoView above works around).
 * No X — callers needing a precise caret X (e.g. the floating comment
 * composer, which only ever opens at the current, necessarily-visible
 * selection) should keep using coordsAtPos(); this is for comment margin
 * dots, which only need a Y and can tolerate lineBlockAt's height-map
 * estimate for anchors outside the current viewport instead of silently
 * losing their dot entirely.
 */
export function estimateViewportY(pos) {
  if (!_view || !Number.isFinite(pos) || pos < 0 || pos > _view.state.doc.length) return null;
  const scroller = _view.scrollDOM;
  const block = _view.lineBlockAt(pos);
  return scroller.getBoundingClientRect().top + (block.top - scroller.scrollTop);
}

/**
 * Mount the surface into `container` (idempotent — remounts if called while
 * already mounted). `onChange(text)` fires only for edits made in this
 * surface, never for syncFromText() applications.
 */
export function mount(container, initialValue, { onChange, onCursorActivity, onImageFiles, readOnly = false } = {}) {
  destroy();
  // _liveTocOpen is module-global so a manual collapse survives this file's
  // own re-renders (widget reuse via eq() — see its declaration above), but
  // that means it would otherwise leak across an unrelated destroy()/mount()
  // pair too — collapsing the TOC in one room would leave a freshly opened
  // room's TOC starting collapsed as well. Reset it per mounted document.
  _liveTocOpen = true;
  _onChange = onChange || null;
  _onCursorActivity = onCursorActivity || null;
  _onImageFiles = onImageFiles || null;
  _view = new EditorView({
    state: EditorState.create({
      doc: initialValue || '',
      extensions: [
        history(),
        drawSelection(),
        // Editing parity with the Write textarea's smart behaviours:
        // markdownKeymap continues lists on Enter and deletes markup on
        // Backspace; closeBrackets auto-pairs brackets/quotes.
        closeBrackets(),
        keymap.of([...closeBracketsKeymap, ...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, extensions: [_highlightExtension], codeLanguages: _codeLanguageFor }),
        syntaxHighlighting(_mdHighlight),
        _seamless,
        // Ctrl/Cmd+click a folded link to open it (http(s) only — same
        // destination policy as the markdown renderer), and image
        // paste/drop — the Write textarea's own paste/dragover/drop
        // listeners (app.js) are bound to #note-editor specifically, so
        // they never fire when this surface owns the event (true whenever
        // this surface is focused, including whenever Preview is the
        // active mode, since the textarea is hidden then). Handled here
        // rather than left to CM6's own paste handling, which has nothing
        // meaningful to do with an image-only clipboard item (no text
        // representation to insert) and would otherwise silently no-op.
        EditorView.domEventHandlers({
          mousedown: (e, view) => {
            if (!(e.ctrlKey || e.metaKey)) return false;
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            const target = _linkUrlAt(view.state, pos);
            if (!target) return false;
            e.preventDefault();
            if (target.type === 'http') {
              window.open(target.url, '_blank', 'noopener');
            } else if (target.type === 'file' && _fileImageResolver) {
              _fileImageResolver(target.path).then((url) => window.open(url, '_blank', 'noopener')).catch(() => {});
            }
            return true;
          },
          paste: (e) => {
            if (!_onImageFiles) return false;
            const files = Array.from(e.clipboardData?.items || [])
              .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
              .map((it) => it.getAsFile())
              .filter(Boolean);
            if (!files.length) return false;
            e.preventDefault();
            _onImageFiles(files);
            return true;
          },
          dragover: (e) => {
            if (!_onImageFiles) return false;
            if (Array.from(e.dataTransfer?.items || []).some((it) => it.kind === 'file')) e.preventDefault();
            return false;
          },
          drop: (e) => {
            if (!_onImageFiles) return false;
            const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
            if (!files.length) return false;
            e.preventDefault();
            _onImageFiles(files);
            return true;
          },
        }),
        _theme,
        EditorView.lineWrapping,
        placeholder('Start writing… Your note syncs live across devices.'),
        _readOnly.of(EditorState.readOnly.of(!!readOnly)),
        _remoteCursorField,
        _checklistProgressField,
        _tocField,
        _minimapPlugin,
        _tableField,
        _commentAnchorsField,
        EditorView.updateListener.of((update) => {
          const external = update.transactions.some((tr) => tr.annotation(External));
          if (update.selectionSet && !external) {
            const sel = update.state.selection.main;
            _onCursorActivity?.(sel.head, sel.anchor);
          }
          if (!update.docChanged || external) return;
          _onChange?.(update.state.doc.toString());
        }),
      ],
    }),
    parent: container,
  });
}

// CM6's drawSelection() extension hides the native caret and draws its own
// via an infinite `cm-blink` CSS animation, which only restarts (from its
// visible phase) when a transaction carries an explicit `selection` — see
// @codemirror/view's own dom-drawing plugin: `update.transactions.some(tr =>
// tr.selection)` toggles the animation name to force a restart. That only
// ever happens on a real selection *change* today, so if the tab is
// backgrounded and refocused while the animation happens to be mid-way
// through its invisible half, it can resume there and the caret stays
// invisible until the next keystroke that moves the selection. Forcing a
// no-op reselect (same position, but still a `selection` spec) on window
// focus/tab-visible restarts the animation fresh, without moving anything.
function _restartCursorBlink() {
  if (_view && _view.hasFocus) _view.dispatch({ selection: _view.state.selection.main });
}
if (typeof window !== 'undefined') {
  window.addEventListener('focus', _restartCursorBlink);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _restartCursorBlink();
  });
}

export function destroy() {
  unwireScrollSync();
  _view?.destroy();
  _view = null;
  _onChange = null;
  _onCursorActivity = null;
  _onImageFiles = null;
}

// ── Split-mode scroll sync ───────────────────────────────────────────────────
//
// Proportional (percent-of-scrollable-range) sync between the Write textarea
// and this surface's own scroller, mirroring the sync the old rendered pane
// had. Rewired on every mount() since CM6's scrollDOM is a fresh element
// each time the view is (re)created, unlike the old #note-preview div.

// Guarding re-entrancy with a boolean "lock" cleared on the next animation
// frame (the original approach here) is a timing race, not a real guard:
// a scrollTop assignment's resulting 'scroll' event is dispatched
// asynchronously by the browser, on a schedule this code doesn't control —
// if that echo arrives even one tick after the lock already cleared, it's
// treated as a fresh user scroll and bounced back to the other pane. That
// round trip is the "phantom scroll": two panes visibly correcting each
// other by a few pixels after every real scroll (and, since the same
// listeners fire on any 'scroll' event regardless of cause, after every
// content reflow while typing too). Fixed by comparing actual positions
// instead of guessing about timing: skip the write entirely when the
// target pane is already within a hair of where the math says it should
// be. A real user scroll still produces a real cross-pane update; an echo
// from that update computes back to (approximately) where the source pane
// already sits and becomes a no-op, so the loop has nothing left to chase.
export function wireScrollSync(editorEl) {
  unwireScrollSync();
  if (!_view || !editorEl) return;
  const scrollEl = _view.scrollDOM;
  const onEditorScroll = () => {
    const maxScroll = editorEl.scrollHeight - editorEl.clientHeight;
    const ratio = maxScroll > 0 ? editorEl.scrollTop / maxScroll : 0;
    const target = ratio * (scrollEl.scrollHeight - scrollEl.clientHeight);
    if (Math.abs(scrollEl.scrollTop - target) < 1) return;
    scrollEl.scrollTop = target;
  };
  const onSelfScroll = () => {
    const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
    const ratio = maxScroll > 0 ? scrollEl.scrollTop / maxScroll : 0;
    const target = ratio * (editorEl.scrollHeight - editorEl.clientHeight);
    if (Math.abs(editorEl.scrollTop - target) < 1) return;
    editorEl.scrollTop = target;
  };
  editorEl.addEventListener('scroll', onEditorScroll);
  scrollEl.addEventListener('scroll', onSelfScroll);
  _scrollSync = { editorEl, scrollEl, onEditorScroll, onSelfScroll };
}

export function unwireScrollSync() {
  if (!_scrollSync) return;
  const { editorEl, scrollEl, onEditorScroll, onSelfScroll } = _scrollSync;
  editorEl.removeEventListener('scroll', onEditorScroll);
  scrollEl.removeEventListener('scroll', onSelfScroll);
  _scrollSync = null;
}

/** Replace the doc from the textarea's value. No-op when already identical. */
export function syncFromText(text) {
  if (!_view) return;
  const current = _view.state.doc.toString();
  const next = text ?? '';
  if (current === next) return;
  // Apply the smallest single-range change (common prefix/suffix trim)
  // rather than replacing the whole doc — this keeps the surface's own
  // cursor, scroll position, and undo granularity intact when the change
  // came from typing in the split-mode textarea.
  let start = 0;
  const minLen = Math.min(current.length, next.length);
  while (start < minLen && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endCur = current.length, endNext = next.length;
  while (endCur > start && endNext > start && current.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) { endCur--; endNext--; }
  _view.dispatch({
    changes: { from: start, to: endCur, insert: next.slice(start, endNext) },
    annotations: External.of(true),
  });
}

export function getValue() {
  return _view ? _view.state.doc.toString() : null;
}

export function setReadOnly(on) {
  _view?.dispatch({ effects: _readOnly.reconfigure(EditorState.readOnly.of(!!on)) });
}

export function focus() { _view?.focus(); }
export function hasFocus() { return !!_view?.hasFocus; }

export function getSelection() {
  if (!_view) return { from: 0, to: 0 };
  const sel = _view.state.selection.main;
  return { from: sel.from, to: sel.to };
}

/** Replace the whole doc and set a new selection — a deliberate user action
 *  (toolbar formatting), not a per-keystroke sync, so a full replace is fine. */
export function applyEdit(text, from, to) {
  if (!_view) return;
  const current = _view.state.doc.toString();
  _view.dispatch({
    changes: { from: 0, to: current.length, insert: text ?? '' },
    selection: { anchor: from ?? 0, head: to ?? from ?? 0 },
  });
  _view.focus();
}

/**
 * A minimal textarea-shaped adapter so callers written against a real
 * <textarea> (e.g. app.js's toolbar formatting logic) can operate on this
 * surface unmodified: they read .value/.selectionStart/.selectionEnd, set
 * new ones, then call dispatchEvent() to commit — mirroring the exact
 * property-then-dispatch sequence those callers already use.
 */
export function asEditorProxy() {
  const sel = getSelection();
  return {
    value: getValue() ?? '',
    selectionStart: sel.from,
    selectionEnd: sel.to,
    dispatchEvent() { applyEdit(this.value, this.selectionStart, this.selectionEnd); },
  };
}
