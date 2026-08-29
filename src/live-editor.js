// JotRelay – live-editor.js
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
import { escapeHtml, colorForDevice } from './utils.js';
import { highlightExtension } from './markdown-highlight-extension.js';
import { parseTableAlignments, escapeTableCellText } from './markdown-table-utils.js';
import { EMOJI_MAP } from './markdown-emoji-map.js';
import { renderMarkdown } from './markdown.js';
import { toggleFootnotePopover } from './footnote-popover.js';
import { ScrollRail, runSmoothScroll, wireOffsetScrollSync, createTextareaOffsetAdapter } from './scroll-rail.js';

let _view                = null;
let _onChange            = null;
let _onCursorActivity    = null;
let _onImageFiles        = null;
let _onCommentAnchorTap  = null;
let _scrollSync          = null; // unwire() fn returned by wireOffsetScrollSync, or null
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

// Recognized :shortcode: → the actual Unicode emoji character, matching
// markdown.js's classic renderer (see EMOJI_MAP in markdown-emoji-map.js).
// Parity fix for the gap noted in docs/markdown-feature-audit.md's "Areas
// for further work" — this surface previously only neutralized the
// shortcode's syntax-highlight color (see _mdHighlight's tags.character
// rule above) and left the raw `:smile:` text on screen everywhere, not
// just while actively editing it.
class _EmojiWidget extends WidgetType {
  constructor(emoji, raw) { super(); this.emoji = emoji; this.raw = raw; }
  eq(other) { return other.emoji === this.emoji; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-md-emoji';
    span.textContent = this.emoji;
    span.title = this.raw;
    return span;
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
// same grammar that gives us TaskList/Strikethrough for free. Rendered as a
// whole-block replace widget, but — unlike Image/HorizontalRule's "reveal
// raw source while the selection touches it" pattern — each cell is itself
// a real contenteditable island wired straight back into the document via
// view.dispatch(), the same bridge _CheckboxWidget uses for its `change`
// event. Cell edits therefore never touch CM6's own selection at all (the
// contenteditable DOM lives outside CM6's document model while focused),
// so the table stays rendered as the pretty widget throughout editing —
// clicking a cell no longer flips the whole table to raw pipe syntax the
// way it used to. Row/column structure is still edited via raw syntax
// (click the table's non-cell chrome, if any, or the surrounding text) —
// only cell *text* is directly editable in this pass.
//
// A committed cell edit replaces that one cell's source range, which
// CM6 re-renders through the normal StateField recompute below — that
// destroys and rebuilds the *entire* table's DOM (CM6 has no cheaper path
// for a block-replace widget), so a cell mid-edit cannot simply keep its
// DOM node across a commit. _pendingTableFocus is how focus survives that:
// set immediately before the commit's dispatch (keyed by tableFrom, stable
// across the one dispatch since nothing before the table shifts) and
// consumed by the freshly-built widget's toDOM() right after.
let _pendingTableFocus = null; // { tableFrom, cellIndex } | null

class _TableWidget extends WidgetType {
  constructor(html, tableFrom) { super(); this.html = html; this.tableFrom = tableFrom; }
  eq(other) { return other.html === this.html && other.tableFrom === this.tableFrom; }
  toDOM(view) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table-wrap';
    wrap.innerHTML = this.html;
    const tableFrom = this.tableFrom;
    const cells = [...wrap.querySelectorAll('[data-cell-index]')];
    const cellCount = cells.length;

    if (view.state.readOnly) {
      cells.forEach((cell) => { cell.contentEditable = 'false'; cell.removeAttribute('tabindex'); });
    } else {
      cells.forEach((cell) => {
        cell.dataset.original = cell.textContent;
        // A committed edit synchronously tears down and rebuilds this whole
        // widget's DOM (see the class-level comment above). That removal can
        // itself force a native 'blur' on the still-focused cell being
        // committed — the Escape handler below already works around exactly
        // this by resetting textContent before calling blur() so the reset
        // reads as "no change". Tab's direct commit(focusNext) call has no
        // such reset, so without this guard a forced blur firing during its
        // own dispatch() would re-enter commit() with the same, by-then-
        // stale from/to and re-dispatch a second change at coordinates the
        // first dispatch already invalidated. One commit per cell, ever.
        let _committed = false;
        const commit = (focusNext) => {
          if (_committed) return;
          const from  = Number(cell.dataset.from);
          const to    = Number(cell.dataset.to);
          const text  = cell.textContent;
          if (text !== cell.dataset.original) {
            _committed = true;
            if (typeof focusNext === 'number') _pendingTableFocus = { tableFrom, cellIndex: focusNext };
            // cell.dataset.from/to span the cell's full source range, which
            // includes the cosmetic single-space padding GFM tables
            // conventionally have around each `|` — re-adding it here (the
            // displayed/edited text itself is always the trimmed form) keeps
            // a hand-edited cell looking like the rest of the table instead
            // of collapsing to `|text|` with no padding at all.
            view.dispatch({ changes: { from, to, insert: ` ${escapeTableCellText(text)} ` } });
          } else if (typeof focusNext === 'number') {
            // Nothing changed, so no re-render is coming to consume a
            // pending-focus request — the target cell already exists in
            // this same DOM, so just focus it directly instead.
            const target = wrap.querySelector(`[data-cell-index="${focusNext}"]`);
            if (target) { target.focus(); document.getSelection()?.selectAllChildren(target); }
          }
        };

        // CM6 attaches its own editor-wide mousedown handling that, even
        // with ignoreEvent() telling it not to reposition CM6's selection,
        // still wins the browser's native "click gives focus" behavior for
        // a target nested this deep inside its content DOM — confirmed live
        // (a plain click alone left document.activeElement on .cm-content,
        // never the cell). Forcing focus explicitly here, and keeping the
        // mousedown from bubbling up to that handler at all, is what
        // actually makes a click land the caret in the cell.
        cell.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          cell.focus();
        });
        cell.addEventListener('blur', () => commit());
        cell.addEventListener('keydown', (e) => {
          // Same reasoning as the mousedown listener above: CM6's own
          // keymap (defaultKeymap/markdownKeymap — Mod-a select-all, Mod-b
          // bold, arrow-key handling, etc.) still receives a bubbled
          // keydown regardless of ignoreEvent(), and confirmed live to
          // actively corrupt an in-progress cell edit — Mod-a moved CM6's
          // *own* selection to cover the whole document, which made the
          // table's decoration recompute as "selection touches it" and
          // revert to raw pipe syntax out from under the cell being typed
          // into. A table cell must be a fully isolated plain-text editing
          // island: nothing typed here should ever reach CM6's keymap.
          e.stopPropagation();
          if (e.isComposing) return;
          // Nested contenteditable regions don't reliably scope a native
          // Ctrl/Cmd+A to just the nested element in every browser —
          // confirmed live to sometimes select outside the cell into CM6's
          // own rendered content, which then corrupts in unpredictable ways
          // once typed over (CM6 doesn't know its DOM was touched outside
          // its own transaction system). Select only this cell's own text
          // explicitly rather than trusting the browser's default action.
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            document.getSelection()?.selectAllChildren(cell);
            return;
          }
          if (e.key === 'Enter') { e.preventDefault(); cell.blur(); return; }
          if (e.key === 'Escape') { e.preventDefault(); cell.textContent = cell.dataset.original; cell.blur(); return; }
          if (e.key === 'Tab') {
            e.preventDefault();
            const index = Number(cell.dataset.cellIndex);
            const next  = e.shiftKey ? index - 1 : index + 1;
            if (next < 0 || next >= cellCount) { cell.blur(); return; }
            commit(next);
          }
        });
      });
    }

    if (_pendingTableFocus && _pendingTableFocus.tableFrom === tableFrom) {
      const { cellIndex } = _pendingTableFocus;
      _pendingTableFocus = null;
      const target = wrap.querySelector(`[data-cell-index="${cellIndex}"]`);
      if (target) requestAnimationFrame(() => { target.focus(); document.getSelection()?.selectAllChildren(target); });
    }

    return wrap;
  }
  // Only let CM6's own click-to-position handling run for clicks outside an
  // editable cell (e.g. table padding/borders) — that's what reveals raw
  // pipe syntax, still the only way to add/remove rows or columns in this
  // pass. A click inside a cell must NOT be treated as a CM6 selection
  // change, or every keystroke would immediately re-trigger that reveal.
  ignoreEvent(event) {
    return !!event.target?.closest?.('[contenteditable="true"]');
  }
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
        if (cell.name === 'TableCell') {
          cells.push({ text: state.doc.sliceString(cell.from, cell.to).trim(), from: cell.from, to: cell.to });
        }
      }
      rows.push({ header: child.name === 'TableHeader', cells });
    }
  }
  const alignAttr = (i) => (alignments[i] ? ` style="text-align:${alignments[i]}"` : '');
  const headRow   = rows.find((r) => r.header);
  const bodyRows  = rows.filter((r) => !r.header);
  let cellIndex = 0;
  const cellAttrs = (cell) => {
    const attrs = ` contenteditable="true" spellcheck="false" tabindex="0" data-cell-index="${cellIndex}" data-from="${cell.from}" data-to="${cell.to}"`;
    cellIndex += 1;
    return attrs;
  };
  let html = '<table class="cm-md-table">';
  if (headRow) {
    html += '<thead><tr>' + headRow.cells.map((c, i) => `<th${alignAttr(i)}${cellAttrs(c)}>${escapeHtml(c.text)}</th>`).join('') + '</tr></thead>';
  }
  if (bodyRows.length) {
    html += '<tbody>' + bodyRows.map((r) =>
      '<tr>' + r.cells.map((c, i) => `<td${alignAttr(i)}${cellAttrs(c)}>${escapeHtml(c.text)}</td>`).join('') + '</tr>',
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

// A remote collaborator's name label floats above its caret's line
// (.cm-remote-caret-label, editor.css) — deliberate, Google-Docs-style. But
// .note-live clips overflow (its own overflow:hidden, wrapping CM6's
// .cm-scroller), so whenever that caret sits on the very first visible
// line, the label's upward offset pokes it above the clipped top edge —
// invisible exactly when a collaborator's cursor is most likely to have
// just been scrolled into view. Flip it to render below the caret instead
// whenever that would happen, the same "clamp against the real viewport"
// idea _openEditorContextMenu already uses for its own position.
class _RemoteCaretLabelPlugin {
  constructor(view) {
    this.view = view;
    this._onScroll = () => this.reposition();
    view.scrollDOM.addEventListener('scroll', this._onScroll, { passive: true });
    this.reposition();
  }
  update(update) {
    if (update.docChanged || update.viewportChanged
      || update.transactions.some((tr) => tr.effects.some((e) => e.is(_setRemoteCursorsEffect)))) {
      this.reposition();
    }
  }
  reposition() {
    // requestMeasure(), not a direct read/write here — for two reasons.
    // First, CM6 doesn't necessarily sync a widget decoration's actual DOM
    // (creating/moving the .cm-remote-caret-label element itself) until
    // after this update() call returns — querying for labels right now, at
    // update() time, can find none at all yet, even on the very update that
    // introduced or moved one, silently skipping the flip check entirely.
    // Second, even once the DOM exists, its layout may not have settled
    // synchronously either — reading getBoundingClientRect() immediately
    // can measure a transient mid-update position. requestMeasure()'s read
    // phase runs once CM6's own DOM sync and layout for this update have
    // actually finished, the same guarantee the rest of this file's
    // geometry reads rely on elsewhere (e.g. ScrollRail's own measurement
    // pass) — so the label lookup itself has to happen inside read(), not
    // before scheduling it.
    this.view.requestMeasure({
      read: (view) => {
        const labels = view.dom.querySelectorAll('.cm-remote-caret-label');
        if (!labels.length) return null;
        const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
        // Reset before measuring each — otherwise a label already flipped
        // below (from a previous scroll position) would measure its own
        // flipped rect instead of where the default "above" position would
        // put it, and could never flip back once the caret scrolls away
        // from the edge.
        const shouldFlip = Array.from(labels).map((label) => {
          label.classList.remove('cm-remote-caret-label-below');
          return label.getBoundingClientRect().top < scrollerTop;
        });
        return { labels, shouldFlip };
      },
      write: (result) => {
        if (!result) return;
        result.labels.forEach((label, i) => label.classList.toggle('cm-remote-caret-label-below', result.shouldFlip[i]));
      },
    });
  }
  destroy() { this.view.scrollDOM.removeEventListener('scroll', this._onScroll); }
}
const _remoteCaretLabelPlugin = ViewPlugin.fromClass(_RemoteCaretLabelPlugin);

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
// `smooth` defaults to false: an animated scroll is fine for a one-off
// user-initiated jump, but callers that want it (heading ticks, [TOC]) must
// ask for it explicitly rather than it being a blanket default.
//
// CM6 only has an *estimated* height for a position outside the currently-
// drawn viewport (view.viewport) — real measurement happens when that
// region actually renders, which (per CM6's own virtualization) happens
// progressively as a scroll toward it proceeds. _navToken/_pendingCorrection
// below guard the smooth, off-screen path's correction against landing after
// a newer jump (e.g. a rapid second heading click) has already taken over.
let _scrollNavToken = 0;
let _pendingCorrection = null; // { scroller, onScroll } for the in-flight off-screen smooth jump, if any

// Invalidates any in-flight off-screen-jump correction and bumps the token
// that guards it — shared by every place something supersedes it: a newer
// _scrollPosIntoView() call, the view being torn down, and (see the rail
// adapter's setScrollTop() below) the user taking over navigation manually.
function _cancelPendingCorrection() {
  _scrollNavToken++;
  if (_pendingCorrection) {
    _pendingCorrection.scroller.removeEventListener('scroll', _pendingCorrection.onScroll);
    _pendingCorrection = null;
  }
}

function _scrollPosIntoView(view, pos, { center = true, smooth = false, flush = false } = {}) {
  const scroller = view.scrollDOM;
  const clampedPos = Math.min(pos, view.state.doc.length);
  const computeTop = () => {
    // lineBlockAt() only knows about *logical* (unwrapped source) lines —
    // for a long line that wraps into several visual rows, block.top is
    // the top of the row the line *starts* on, not the row clampedPos
    // itself falls on, however far into the wrap that is. coordsAtPos()
    // resolves the actual rendered row (correctly wrap-aware) but only for
    // a position that's currently drawn, so it's used when available and
    // lineBlockAt() stays as the off-screen estimate — corrected once the
    // estimate-then-correct dance below actually renders the destination,
    // same as it always was for the "estimate is wrong at all" case.
    const coords = view.coordsAtPos(clampedPos);
    const rawTop = coords ? coords.top - scroller.getBoundingClientRect().top + scroller.scrollTop
      : view.lineBlockAt(clampedPos).top;
    // flush: exactly rawTop, no margin — used by scrollOffsetToTop(), which
    // needs round-trip consistency with getOffsetAtTop() (posAtCoords at
    // the scroller's literal top edge) for mode-switch transfer and
    // Split-sync to agree on what "at the top" means. center/the -40
    // fallback are for a jump whose point is being *revealed*, not being
    // used as a scroll-position anchor in their own right.
    const target = flush ? rawTop : center ? rawTop - scroller.clientHeight / 2 : rawTop - 40;
    return Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
  };
  const reduceMotion = smooth && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const useSmooth = smooth && !reduceMotion;

  // Every navigation call supersedes whatever came before it, regardless of
  // which branch below it ends up taking — an earlier off-screen jump's
  // still-listening correction (see the bottom of this function) must never
  // survive to fire later and drag the view back toward its own, now-stale,
  // target. Bumping the token here (not just inside the off-screen branch)
  // is what closes that gap: without it, a second click landing in the
  // *in-viewport* branch below returned early without invalidating the
  // first click's pending correction, so if the scroller's own scroll
  // events (driven by this second jump) happened to bring the first
  // click's target into view.viewport, its stale listener would fire and
  // override the second jump's destination.
  _cancelPendingCorrection();
  const myToken = _scrollNavToken;

  // A target already inside the drawn viewport is already accurately
  // measured — one clean scroll, no pre-jump or correction needed either way.
  if (clampedPos >= view.viewport.from && clampedPos <= view.viewport.to) {
    if (useSmooth) runSmoothScroll(scroller, computeTop());
    else scroller.scrollTop = computeTop();
    return;
  }

  if (!useSmooth) {
    // No animation in flight to protect against a visible "jump, pause,
    // slide" here — snap to the current estimate, then snap again once
    // CM6 has rendered/measured the destination. Used by non-interactive
    // callers (Follow mode's scrollToPos(), Find & Replace's setSelection()).
    scroller.scrollTop = computeTop();
    requestAnimationFrame(() => { scroller.scrollTop = computeTop(); });
    return;
  }

  // Smooth + off-screen: teleporting to the estimate first (the old
  // approach) forced CM6 to measure the destination, but a *second*,
  // separately-animated correction scroll then visibly restarted the
  // motion — "jump, pause, slide". Instead, begin the smooth movement
  // toward the current best estimate immediately, and once CM6's viewport
  // has grown to include `pos` (which happens progressively as this
  // animation approaches it), retarget with one more runSmoothScroll() call
  // — the browser blends a same-element retarget into the animation
  // already in flight rather than restarting it, so this reads as one
  // coherent movement rather than two. (myToken/_pendingCorrection's own
  // prior entry were already invalidated above, before the branch split.)
  runSmoothScroll(scroller, computeTop());
  const onScroll = () => {
    if (myToken !== _scrollNavToken) { scroller.removeEventListener('scroll', onScroll); _pendingCorrection = null; return; }
    if (clampedPos < view.viewport.from || clampedPos > view.viewport.to) return;
    scroller.removeEventListener('scroll', onScroll);
    _pendingCorrection = null;
    runSmoothScroll(scroller, computeTop());
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  _pendingCorrection = { scroller, onScroll };
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

// Same collapsed-by-default convention as the static renderer's
// .md-inline-toc (export/non-live preview) and the floating .note-toc
// auto-nav — a [TOC] block is a navigation aid, not primary content, so it
// shouldn't dominate the screen with a full link list the moment a document
// loads. _liveTocOpen remembers a manual expand/collapse across re-renders
// (new transactions re-create the widget only when the heading list itself
// changes — eq() above reuses the existing DOM otherwise — so without this,
// editing an unrelated heading after the user had deliberately expanded the
// nav would silently collapse it again).
let _liveTocOpen = false;

// Tracks whether the *current* selection was established by a real,
// explicit selection-setting transaction that wasn't itself a programmatic
// External sync (a genuine click, keyboard caret move, or the TOC widget's
// own click-to-navigate) — as opposed to merely being wherever CM6 mapped
// some earlier selection forward through an unrelated change. See
// _tocField's update() for why this, not "is the current transaction
// External," is the right signal to gate the touch-check bypass on: an
// External sync should never manufacture a fake "touch" out of a stale
// mapped-forward cursor, but it also must never erase a *real* one a user
// is actively sitting on when that sync happens to arrive. Reset on mount()
// alongside _liveTocOpen for the same reason — this is module-global so it
// survives this file's own re-renders, but a fresh document has no
// meaningful prior selection to inherit "user-driven"-ness from.
let _tocSelectionIsUserDriven = false;

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

function _computeTocBadges(state, bypassTouchReveal) {
  const headings = _collectHeadings(state);
  if (headings.length < 2) return Decoration.none;

  const ranges = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!/^\[toc\]$/i.test(line.text.trim())) continue;
    // Reveal the raw "[TOC]" marker while the cursor is actually on it (same
    // pattern as every other hideable construct in this file) — otherwise
    // there's no way to select/delete the line without leaving Live mode.
    // Skipped whenever bypassTouchReveal is set: mount() never gives
    // EditorState.create() an explicit selection, so CM6 defaults to a bare
    // cursor at position 0 — an arbitrary artifact of state construction,
    // not a real "the user is editing this" signal. The same is true of any
    // *programmatic* doc replacement after mount (syncFromText — a remote
    // content update, or a room-load race that mounts before real content
    // arrives and syncs it in right after): CM6 maps the old selection
    // through the change, which can just as easily leave it sitting at/near
    // position 0. If [TOC] happens to sit on line 1 (a natural place to put
    // one) in either case, that non-user-driven cursor "touches" it and the
    // widget would render as raw text until an unrelated real interaction
    // moved the cursor away, which reads as "the TOC doesn't render until
    // the editor is focused."
    if (!bypassTouchReveal && _selectionTouches(state, line.from, line.to)) continue;
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
  create: (state) => _computeTocBadges(state, true),
  // Recomputed when the doc changed or this transaction set an explicit
  // new selection — not unconditionally on every transaction. Whether the
  // marker line renders as the widget or reveals its raw "[TOC]" text
  // depends on the *selection* too (reveal-while-touched, same as
  // Image/HorizontalRule/_tableField below), and the touch-check is
  // bypassed whenever the current selection *isn't* one a real user
  // interaction established (_tocSelectionIsUserDriven — see its own
  // comment). Gating the bypass on "was this transaction External,"
  // rather than that, has two distinct failure modes, both since fixed:
  // a bare effects-only reconfigure with no doc/selection change of its
  // own (e.g. setReadOnly() switching back into Live/Split from Source)
  // isn't External, but re-checking a stale mapped-forward selection
  // against it could still wrongly revert an already-correct widget —
  // handled by reusing the previous value outright when a transaction
  // changes neither. And an External sync (a remote edit arriving over
  // Broadcast) unconditionally bypassing the check regardless of *why*
  // the selection is sitting on the marker line would erase a real user's
  // deliberately-touched raw view out from under them the instant a
  // remote edit happened to land — this is what _tocSelectionIsUserDriven
  // actually distinguishes: a real prior click/selection stays "touching"
  // (raw text preserved) across a later External sync, while a merely
  // inherited/default position does not (bypassed, widget shown).
  update(value, tr) {
    // Track *before* the early-return below: even a transaction this field
    // has nothing else to do for (no doc change, no new selection) must
    // still update this flag correctly for the following one to read —
    // though in practice only tr.selection ever changes it, so the order
    // only matters for readability, not correctness.
    //
    // tr.selection alone isn't enough to mean "the user moved the caret" —
    // CM6's own drawSelection() extension needs to force its blink
    // animation to restart on window focus/tab-visibility (see
    // _restartCursorBlink()'s own comment), which it does by dispatching a
    // same-position no-op reselect: tr.selection is set, but nothing about
    // where the caret actually *is* changed. Comparing the selection value
    // itself, not just whether a spec asked for one, excludes that (and
    // any future synthetic reselect that works the same way) without
    // needing to know about it specifically here.
    if (tr.selection && !tr.startState.selection.eq(tr.state.selection)) {
      _tocSelectionIsUserDriven = !tr.annotation(External);
    }
    if (!tr.docChanged && !tr.selection) return value;
    return _computeTocBadges(tr.state, !_tocSelectionIsUserDriven);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Scroll rail (unified scrollbar + heading overview) ──────────────────────
// Replaces the native scrollbar's visual chrome with a shared component
// (src/scroll-rail.js) that also owns this surface's minimap: a draggable
// thumb tracking real scroll position, plus one tick per heading positioned
// proportionally to where it falls in the full scrollable document. Hidden
// until hovered — see .scroll-rail's CSS — so it reads as "considered" chrome
// rather than a permanent sidebar. The Write-mode textarea gets its own
// independent instance of the same component (ui/editor.js's
// mountWriteScrollRail) — see scroll-rail.js's header comment for why they
// can't share one, and for the shared mounting/positioning model both use.
class _RailPlugin {
  constructor(view) {
    this.view = view;
    this._positioned = null;
    const adapter = {
      getMetrics: () => {
        const el = view.scrollDOM;
        return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      },
      setScrollTop: (top, { smooth } = {}) => {
        if (smooth) runSmoothScroll(view.scrollDOM, top);
        else {
          // A direct (non-smooth) scrollTop write only ever comes from the
          // user manually dragging the rail thumb or clicking its bare
          // track — real, explicit takeover of navigation. It cancels any
          // native smooth animation already in flight (assigning scrollTop
          // does that on its own), but an off-screen heading jump's own
          // 'scroll' listener (_pendingCorrection, from _scrollPosIntoView)
          // doesn't care what caused the scroll event — left armed, it can
          // fire once this drag happens to pass through the *old* jump's
          // target and yank the view back there, fighting the drag the user
          // is actively mid-way through. Cancelling here is what a manual
          // scroll-into-viewport branch inside _scrollPosIntoView itself
          // can't be, since this scrollTop write never goes through that
          // function at all.
          _cancelPendingCorrection();
          view.scrollDOM.scrollTop = top;
        }
      },
      jumpToHeading: (h) => {
        const pos = Math.min(h.pos, view.state.doc.length);
        view.dispatch({ selection: { anchor: pos } });
        _scrollPosIntoView(view, pos, { smooth: true });
        view.focus();
      },
    };
    // Mounted as a sibling of #note-live (view.dom's parent) inside the
    // shared `.editor-wrap` card — NOT inside view.dom (.cm-editor), which
    // is CodeMirror-owned internal DOM. Positioned from #note-live's own
    // live rect (the represented *outer* surface), not view.dom/.cm-editor's
    // — #note-live has responsive padding that wraps the CM6 DOM, so sizing
    // off .cm-editor instead would put the rail at the wrong horizontal
    // position on wide screens where that padding is largest. See
    // ScrollRail's own _reposition()-equivalent (reposition()) for the
    // shared geometry this and the Write rail both use.
    const surfaceEl = view.dom.parentElement;
    const wrapEl = surfaceEl?.closest('.editor-wrap') || surfaceEl;
    this.rail = new ScrollRail(wrapEl, adapter, surfaceEl);
    this.rail.dom.classList.add('scroll-rail-live');
    _railInstance = this;
    // A native 'scroll' event, not CM6's own update()/viewportChanged: pure
    // scrolling (no doc change) doesn't reliably dispatch a CM6 transaction,
    // but the rail's thumb has to track scrollTop on every scroll regardless
    // — unlike the old fixed-position minimap dots, the thumb's position
    // *is* the scroll position.
    this._onScroll = () => this.rail.updateMetrics();
    view.scrollDOM.addEventListener('scroll', this._onScroll, { passive: true });
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
    const positioned = headings.map((h) => ({ ...h, top: view.lineBlockAt(h.pos).top }));
    // A tolerance comparison, not an exact-match fingerprint — CM6 estimates
    // unmeasured lines' heights and keeps refining the estimate as more of a
    // long document is scrolled into view, which nudges every later
    // heading's cumulative pixel `top` by a fraction of a pixel even when
    // nothing about its actual position changed in any way a user could
    // perceive. pos is still compared exactly, never with tolerance — each
    // tick's jump() closure captures the h.pos current when it was built, so
    // skipping a rebuild while pos actually moved (an edit shifted this
    // heading's offset while its level/text/pixel-top all stayed within
    // tolerance) would leave that tick jumping to stale content.
    const TOP_TOLERANCE_PX = 2;
    const prev = this._positioned;
    const unchanged = prev && prev.length === positioned.length && positioned.every((h, i) =>
      h.level === prev[i].level && h.text === prev[i].text && h.pos === prev[i].pos
      && Math.abs(h.top - prev[i].top) <= TOP_TOLERANCE_PX);
    if (!unchanged) {
      this._positioned = positioned;
      this.rail.updateHeadings(positioned);
    }
    // Explicit, not left to ScrollRail's own ResizeObserver alone — see
    // reposition()'s own comment for why a mode switch's hidden→visible
    // flip needs this called directly rather than trusting the observer to
    // fire in time for the very first paint. rebuild() already runs on
    // every doc/geometry/viewport change (this update()'s own condition
    // above) and from refreshLayout() right after a mode switch reveals
    // #note-live, so this covers both without extra wiring.
    this.rail.reposition();
    this.rail.updateMetrics();
  }
  destroy() {
    this.view.scrollDOM.removeEventListener('scroll', this._onScroll);
    this.rail.destroy();
    if (_railInstance === this) _railInstance = null;
  }
}
const _railPlugin = ViewPlugin.fromClass(_RailPlugin);
// Set by _RailPlugin's own constructor/destroy — refreshLayout() below is
// the only outside caller that needs a handle to the live instance, so this
// stays a plain module-level reference rather than a getter/exported class.
let _railInstance = null;

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
      ranges.push(Decoration.replace({ widget: new _TableWidget(html, nodeRef.from), block: true }).range(nodeRef.from, nodeRef.to));
    },
  });
  return Decoration.set(ranges, true);
}

const _tableField = StateField.define({
  create: (state) => _computeTableDecorations(state),
  update(value, tr) { return _computeTableDecorations(tr.state); },
  provide: (f) => EditorView.decorations.from(f),
});

// colorForDevice() moved to utils.js — shared with the Devices panel's
// presence dot (ui/panels.js), so a collaborator's colour matches between
// their in-editor caret and their row in that list.
export { colorForDevice };

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

// True on touch/coarse-pointer devices — same test the CSS scroll-rail rule
// uses (inverted) to decide it should hide itself there. Used only as a
// fallback below, when no real pointerdown has told us what kind of
// pointer is actually being used.
function _isCoarsePointer() {
  return !!window.matchMedia?.('(hover: none), (pointer: coarse)').matches;
}

// Set from the pointerdown handler below, just ahead of mousedown for the
// same physical interaction. A device-level media query can't tell touch
// from mouse on a hybrid touchscreen laptop (primary pointer stays "fine"
// even while a specific tap came from the touchscreen) — the event's own
// pointerType is the actual source of truth for that one interaction.
let _lastPointerType = null;

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

          // Recognized emoji shortcode (:smile:) → the real Unicode
          // character, while the selection isn't touching it (raw text
          // shows while editing, same reveal-on-touch pattern as
          // everything else here). An unrecognized shortcode is left as
          // literal text — matches the classic renderer exactly.
          if (name === 'Emoji') {
            if (_selectionTouches(state, nodeRef.from, nodeRef.to)) return;
            const raw = state.doc.sliceString(nodeRef.from, nodeRef.to);
            const code = raw.slice(1, -1).toLowerCase();
            if (!Object.prototype.hasOwnProperty.call(EMOJI_MAP, code)) return;
            ranges.push(Decoration.replace({ widget: new _EmojiWidget(EMOJI_MAP[code], raw) }).range(nodeRef.from, nodeRef.to));
            return;
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

// app/comments-preview.js's _applyMarkdownMode() calls LiveEditor.mount()
// *before* UI.setMarkdownMode() removes .hidden from #note-live's container
// (mount() needs to exist first so setMarkdownMode can decide whether "live"
// mode actually succeeded) — so a first-ever mount always constructs this
// view while its container is still display:none. CM6 measures scrollDOM's
// real geometry lazily and doesn't know on its own that a later, unrelated
// class change just made a hidden container visible, so scrollDOM.scrollHeight
// / clientHeight (and therefore the scroll rail's thumb — see _RailPlugin)
// silently stay wrong until *something* forces CM6 to look again. Call this
// right after the container is actually shown (see setMarkdownMode's own
// trailing call into ui/editor.js's write-mode equivalent, _positionWriteRail/
// _refreshWriteScrollRail, for the same fix on the other surface).
/**
 * @param {number} [scrollOffsetToTop] - if given, scroll (instantly, no
 *   animation) so this source char-offset ends up at the exact top of the
 *   viewport once layout has settled — the mode-switch/Split-sync transfer
 *   case, which needs this to happen *after* the same re-measure this
 *   function already forces for a freshly-revealed container, not before.
 */
export function refreshLayout(scrollOffsetToTop) {
  if (!_view) return;
  // Captured now, not re-read from the module-global _view inside the
  // delayed callback below — a fast room switch (destroy() then a fresh
  // mount()) within this 50ms window would otherwise apply this offset to
  // the *new* room's CM6 instance instead of the one this call was
  // actually about, since _view would have moved on by the time the
  // callback runs.
  const view = _view;
  view.requestMeasure();
  // requestMeasure() alone isn't enough: confirmed live that immediately
  // after a hidden-container mount is unhidden, .cm-scroller's real
  // scrollHeight (27000+ for a long test doc) still read back as just its
  // own clientHeight for at least one frame — CM6 hadn't yet finished
  // populating the virtualized spacer elements that represent unmeasured
  // off-screen content while it was invisible, so _RailPlugin's rebuild()
  // saw an apparently-unscrollable document and never got a second chance
  // to re-check (nothing else about the view's geometry changes on its own
  // after that). A short setTimeout gives requestMeasure()'s queued work a
  // moment to actually land before re-reading, confirmed reliable live —
  // NOT requestAnimationFrame, which is throttled/fully suspended for a
  // backgrounded tab (confirmed live — it never fired at all while testing
  // through a non-foreground automation surface), and a real user
  // backgrounding the tab right after opening a room in Split/Preview mode
  // is a completely ordinary thing to do, not an edge case worth leaving
  // broken. setTimeout still runs in the background (Chrome only clamps its
  // minimum delay there, it doesn't suspend it outright).
  setTimeout(() => {
    if (_view !== view) return; // this view was torn down/replaced before the delay elapsed
    if (Number.isFinite(scrollOffsetToTop)) _scrollPosIntoView(view, scrollOffsetToTop, { flush: true });
    _railInstance?.rebuild(view);
  }, 50);
}

/**
 * The source char-offset currently at the exact top of the viewport — the
 * CM6-side half of the shared "top-visible-offset" anchor used for mode-
 * switch scroll transfer, Split-sync, and persisted last-position (see
 * scroll-rail.js's textarea equivalents). posAtCoords() resolves the actual
 * rendered position at that pixel, which CM6 always has for whatever's
 * currently drawn — unlike lineBlockAt(), it doesn't need an offset to
 * start from. Returns 0 when unmounted or nothing is resolvable (an empty
 * document, or scrolled to a boundary posAtCoords can't place).
 */
export function getOffsetAtTop() {
  if (!_view) return 0;
  const rect = _view.scrollDOM.getBoundingClientRect();
  const pos = _view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 });
  return pos ?? 0;
}

/** The inverse of getOffsetAtTop(): scroll so `offset` ends up at the exact
 *  top of the viewport. `smooth` is only for a deliberate, user-visible
 *  jump (there is currently no such caller — mode-switch transfer and
 *  Split-sync both want this instant, so the view is already correct the
 *  moment it's revealed/the other pane moves, not visibly catching up). */
export function scrollOffsetToTop(offset, { smooth = false } = {}) {
  if (!_view) return;
  _scrollPosIntoView(_view, offset, { flush: true, smooth });
}

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
export function mount(container, initialValue, { onChange, onCursorActivity, onImageFiles, onCommentAnchorTap, readOnly = false } = {}) {
  destroy();
  // _liveTocOpen is module-global so a manual expand survives this file's
  // own re-renders (widget reuse via eq() — see its declaration above), but
  // that means it would otherwise leak across an unrelated destroy()/mount()
  // pair too — expanding the TOC in one room would leave a freshly opened
  // room's TOC starting expanded as well. Reset it per mounted document.
  _liveTocOpen = false;
  // Same leak risk for the same reason: a room closed while its user was
  // genuinely touching a [TOC] line shouldn't leave the next mounted
  // document's very first (default, non-user) cursor position treated as
  // user-driven too.
  _tocSelectionIsUserDriven = false;
  _onChange = onChange || null;
  _onCursorActivity = onCursorActivity || null;
  _onImageFiles = onImageFiles || null;
  _onCommentAnchorTap = onCommentAnchorTap || null;
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
          pointerdown: (e) => { _lastPointerType = e.pointerType || null; return false; },
          mousedown: (e, view) => {
            if (!(e.ctrlKey || e.metaKey)) {
              // Tap-to-view a comment's anchored text on touch devices — the
              // margin dot/bubble system is hidden there (no room for it),
              // so the dotted-underline span itself is the only affordance.
              // Desktop leaves plain clicks alone (still just places the
              // cursor) since the hover-sized margin dots already cover it.
              // Prefer the actual pointerdown's pointerType (correct even
              // on a hybrid touchscreen laptop); fall back to the device-
              // level media query only if no pointerdown was observed.
              const isTouchLike = _lastPointerType === 'touch' || _lastPointerType === 'pen'
                || (_lastPointerType == null && _isCoarsePointer());
              if (_onCommentAnchorTap && isTouchLike && e.target.closest?.('.cm-comment-anchor')) {
                const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
                if (pos != null) {
                  e.preventDefault();
                  _onCommentAnchorTap(pos);
                  return true;
                }
              }
              return false;
            }
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
        _remoteCaretLabelPlugin,
        _checklistProgressField,
        _tocField,
        _railPlugin,
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
  // Cancels any in-flight off-screen heading-jump correction the moment the
  // user takes over navigation directly on this surface — the rail
  // adapter's own setScrollTop() already does this for a thumb drag/track
  // click (see its own comment), but a mouse wheel, touchpad, or touch
  // scroll goes straight to the browser's native scrolling and never calls
  // that adapter method at all, so without this the correction's 'scroll'
  // listener stayed armed through the *most common* way of scrolling and
  // could still fire later and yank the view back to the abandoned target.
  // 'wheel'/'touchstart' rather than 'scroll' because both are
  // unambiguously user-initiated — our own programmatic scrolls (smooth or
  // instant) never dispatch synthetic wheel/touch events, so this can't
  // misfire on an echo the way a generic scroll listener could.
  _view.scrollDOM.addEventListener('wheel', _cancelPendingCorrection, { passive: true });
  _view.scrollDOM.addEventListener('touchstart', _cancelPendingCorrection, { passive: true });
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
  // A pending off-screen heading-jump correction (_scrollPosIntoView) holds
  // a 'scroll' listener on the about-to-be-destroyed view's own scrollDOM —
  // harmless once unreachable, but bumping the token here (rather than
  // leaving it to whatever the next mount's first jump happens to do) means
  // a stale listener from a closed room can never fire against a next
  // room's freshly mounted scroller by coincidentally sharing a scrollTop.
  _cancelPendingCorrection();
  _view?.destroy();
  _view = null;
  _onChange = null;
  _onCursorActivity = null;
  _onImageFiles = null;
  _onCommentAnchorTap = null;
  // Same class of bug as the scroll-correction token bumped above: a table
  // cell's commit() sets this right before its dispatch, to be consumed by
  // that same table's next toDOM() call (see _TableWidget's own comment). If
  // this room is torn down before that render happens, a stale {tableFrom,
  // cellIndex} would otherwise survive into the next room's mount and — if
  // that room happens to render a table at the same source position (e.g.
  // tableFrom 0, a table as the very first block) — silently steal focus
  // into a cell nobody clicked.
  _pendingTableFocus = null;
}

/**
 * Re-run CM6's own "keep the selection visible" scroll against the
 * scroller's *current* size. Called by keyboard-viewport.js after the
 * on-screen keyboard opens/closes/resizes — CSS already shrinks this
 * surface's box to stay above the keyboard (the --kb-inset chain in
 * modals.css/keyboard-viewport.js), but that's a passive ancestor resize,
 * and CM6 (like a plain textarea) only re-scrolls to keep the caret
 * visible on an actual selection/content change, not just because its
 * container got shorter out from under it. Without this, the line the
 * user was on when the keyboard opened can end up hidden below the new,
 * smaller box until the next keystroke's normal caret-follow catches up —
 * a visible "typing blind for a moment" gap. y:'nearest' is a no-op if the
 * caret is already visible, so this is safe to call unconditionally.
 * No-ops if the live surface isn't mounted or doesn't currently have focus.
 */
export function scrollCaretIntoView() {
  if (!_view || !_view.hasFocus) return;
  _view.dispatch({ effects: EditorView.scrollIntoView(_view.state.selection.main.head, { y: 'nearest' }) });
}

// ── Split-mode scroll sync ───────────────────────────────────────────────────
//
// Source-position-anchored sync between the Write textarea and this
// surface's own scroller: "whatever's at the top of one pane's viewport
// should also be at the top of the other's," matched by character offset
// rather than scroll percentage — the same anchor mode-switch transfer uses
// (see comments-preview.js's _applyMarkdownMode), so Split's continuous
// sync and a one-shot mode switch agree on what "the same place" means
// instead of using two different mechanisms. Rewired on every mount() since
// CM6's scrollDOM is a fresh element each time the view is (re)created,
// unlike the old #note-preview div.
//
// wireOffsetScrollSync() (src/scroll-rail.js) does the actual work,
// including the "don't fight a deliberate smooth scroll" fix (skipping a
// write into whichever pane is currently mid runSmoothScroll() — see that
// function's own comment) and an rAF throttle (this offset mapping is a
// real per-call cost on the Write side — a mirror-div binary search — unlike
// the older percentage math's free arithmetic). ui/editor.js's own
// textarea<->rendered-preview Split *fallback* sync stays on the older
// wireProportionalScrollSync() — the static rendered-HTML pane has no
// offset-mapping of its own to anchor to (that would need markdown.js to
// tag every rendered block with its source position, which it doesn't).
export function wireScrollSync(editorEl) {
  unwireScrollSync();
  if (!_view || !editorEl) return;
  _scrollSync = wireOffsetScrollSync(
    createTextareaOffsetAdapter(editorEl),
    { el: _view.scrollDOM, getOffsetAtTop, scrollToOffset: scrollOffsetToTop },
  );
}

export function unwireScrollSync() {
  if (!_scrollSync) return;
  _scrollSync();
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
