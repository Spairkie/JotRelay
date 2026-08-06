// SyncPad – markdown.js
// Markdown → HTML renderer, built over the shared Lezer parse tree (the same
// `@lezer/markdown` grammar CodeMirror's live editor already parses with —
// see markdown-highlight-extension.js for the one grammar extension shared
// by both). No hand-rolled block/inline regex passes; the tree does the
// parsing, this module just walks it into safe HTML.
//
// Supports (targets GFM — GitHub Flavored Markdown — as the reference
// flavor; see the feature-audit note at the bottom of this comment):
//   - headings (# .. ######), with auto-generated anchor ids
//   - bold (**x** or __x__) and italic (*x* or _x_)
//   - strikethrough (~~x~~) and ==highlight==
//   - inline code `x`
//   - fenced code blocks ```lang\n…\n```
//   - links [text](https://… "title")   (http(s)/mailto only; optional title)
//   - images ![alt](https://… "title")  (http(s) only; optional title)
//   - reference-style links  [text][id] / [text][]  +  [id]: url "title"
//     (single-line definitions only; an unreferenced definition renders
//     nothing, which doubles as the "[comment]: <> (text)" hack)
//   - bare URL autolinking (https://example.com)
//   - angle-bracket autolinks  <https://example.com>  <mailto:x@y.com>  <x@y.com>
//   - unordered lists (- / * / +), including nested sub-lists by indentation
//   - ordered lists  (1. 2. …), including nested sub-lists by indentation
//   - GFM-style checklists  - [ ] item   - [x] item
//   - blockquotes  > text
//   - GitHub-style alerts  > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
//   - horizontal rules  --- / *** / ___
//   - GFM tables  | Col | Col |  with | --- | --- | separator, incl. column
//     alignment (:---, ---:, :---:)
//   - footnotes  text[^id]  ...  [^id]: note text
//   - backslash-escaped punctuation  \*  \_  \[  \]  etc.
//   - [TOC] marker → inline table of contents
//   - paragraphs separated by blank lines
//   - hard line breaks (two trailing spaces)
//   - emoji shortcodes  :smile: :tada: :rocket:  → Unicode emoji, from a
//     curated ~150-entry table of commonly-typed names (not the full
//     several-thousand-entry set — see _EMOJI_MAP); an unrecognized
//     shortcode renders as literal text, same as any other unresolved
//     construct this renderer encounters
//
// XSS strategy: every raw string segment is HTML-escaped FIRST, then a small
// set of safe markup is reintroduced. No raw HTML pass-through — the
// grammar's own HTMLBlock/HTMLTag/CommentBlock/ProcessingInstructionBlock
// nodes are always rendered as literal escaped text, never interpreted. Link
// and image URLs are validated against a scheme allowlist (http/https/mailto
// for links, http/https only for images — never data:/javascript:).
//
// Deliberately NOT supported (see docs/markdown-feature-audit.md for the
// full flavor comparison and rationale): raw HTML, definition lists,
// subscript/superscript, underline, centered/colored text, comments,
// videos, custom heading-id syntax, and 4-space-indented code blocks
// (rendered as plain paragraph text — ambiguous against this renderer's
// indent-based list nesting, matches this renderer's original hand-rolled
// behavior byte-for-byte).
//
// Implementation notes for future maintainers: Lezer's parse tree only
// creates nodes for *marked-up* spans — plain text between/around them has
// no node of its own ("gap text"). Rendering inline content correctly means
// walking children AND filling those gaps with escaped literal text, not
// just recursing into children (see _renderInlineChildren). A handful of
// constructs the grammar doesn't model at all — footnotes, [TOC], GitHub
// alerts — are recovered via small pre/post passes around the tree walk
// rather than grammar extensions, keeping the parser itself standard.

import { markdown, markdownLanguage } from '../vendor/codemirror.js';
import { highlightExtension } from './markdown-highlight-extension.js';
import { parseTableAlignments } from './markdown-table-utils.js';
import { escapeHtml } from './utils.js';

const _parser = markdown({ base: markdownLanguage, extensions: [highlightExtension] }).language.parser;

const _ALERT_ICONS = {
  note: 'ℹ️ ', tip: '💡 ', important: '❗ ', warning: '⚠️ ', caution: '🛑 ',
};
const _ALERT_LABEL = {
  note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution',
};
const _FOOTNOTE_DEF_RE = /^\[\^([A-Za-z0-9_-]+)\]:[ \t]?(.*)$/;

// GitHub-style :shortcode: → Unicode emoji. Covers the shortcodes people
// actually type from muscle memory (GitHub/Slack-style names); not the full
// several-thousand-entry Unicode CLDR set, which would be a large data
// table for a long tail of shortcodes nobody uses in a notepad. An
// unrecognized shortcode (or one this table simply doesn't carry) is left
// as literal `:text:` — never dropped, never guessed at — matching every
// other "recognized syntax, unknown value" case in this renderer (e.g. an
// unresolved reference link).
const _EMOJI_MAP = {
  smile: '😄', smiley: '😃', grin: '😁', grinning: '😀', laughing: '😆',
  satisfied: '😆', sweat_smile: '😅', joy: '😂', rofl: '🤣', relaxed: '☺️',
  blush: '😊', innocent: '😇', slight_smile: '🙂', upside_down: '🙃',
  wink: '😉', relieved: '😌', heart_eyes: '😍', star_struck: '🤩',
  kissing_heart: '😘', kissing: '😗', yum: '😋', stuck_out_tongue: '😛',
  stuck_out_tongue_winking_eye: '😜', zany_face: '🤪', thinking: '🤔',
  face_with_raised_eyebrow: '🤨', neutral_face: '😐', expressionless: '😑',
  no_mouth: '😶', smirk: '😏', unamused: '😒', roll_eyes: '🙄', grimacing: '😬',
  lying_face: '🤥', shushing_face: '🤫', hand_over_mouth: '🤭',
  flushed: '😳', pleading_face: '🥺', frowning: '☹️', slight_frown: '🙁',
  open_mouth: '😮', hushed: '😯', astonished: '😲', worried: '😟',
  confused: '😕', slightly_frowning_face: '🙁', disappointed: '😞',
  cold_sweat: '😰', sweat: '😓', tired_face: '😫', weary: '😩', triumph: '😤',
  cry: '😢', sob: '😭', angry: '😠', rage: '😡', exploding_head: '🤯',
  scream: '😱', fearful: '😨', cold_face: '🥶', hot_face: '🥵',
  nauseated_face: '🤢', vomiting: '🤮', sneezing_face: '🤧', dizzy_face: '😵',
  sleepy: '😪', sleeping: '😴', zzz: '💤', mask: '😷', sunglasses: '😎',
  nerd_face: '🤓', monocle_face: '🧐', partying_face: '🥳', clown_face: '🤡',
  ghost: '👻', skull: '💀', alien: '👽', robot: '🤖', poop: '💩',
  smiling_imp: '😈', imp: '👿', japanese_ogre: '👹',
  wave: '👋', raised_hand: '✋', ok_hand: '👌', v: '✌️', crossed_fingers: '🤞',
  point_up: '☝️', point_down: '👇', point_left: '👈', point_right: '👉',
  thumbsup: '👍', thumbsdown: '👎', fist: '✊',
  facepunch: '👊', punch: '👊', clap: '👏', raised_hands: '🙌', pray: '🙏',
  handshake: '🤝', muscle: '💪', writing_hand: '✍️', nail_care: '💅',
  eyes: '👀', eye: '👁️', brain: '🧠', tongue: '👅', ear: '👂', nose: '👃',
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚',
  blue_heart: '💙', purple_heart: '💜', black_heart: '🖤', white_heart: '🤍',
  broken_heart: '💔', heartbeat: '💓', sparkling_heart: '💖', two_hearts: '💕',
  fire: '🔥', star: '⭐', star2: '🌟', sparkles: '✨', zap: '⚡', boom: '💥',
  collision: '💥', dizzy: '💫', tada: '🎉', confetti_ball: '🎊',
  balloon: '🎈', gift: '🎁', trophy: '🏆', medal: '🏅', crown: '👑',
  rocket: '🚀', airplane: '✈️', car: '🚗', bike: '🚲', anchor: '⚓',
  sun: '☀️', moon: '🌙', earth_americas: '🌎', cloud: '☁️', rainbow: '🌈',
  snowflake: '❄️', droplet: '💧', ocean: '🌊', umbrella: '☂️',
  coffee: '☕', tea: '🍵', beer: '🍺', beers: '🍻', wine_glass: '🍷',
  cocktail: '🍸', pizza: '🍕', hamburger: '🍔', fries: '🍟', ramen: '🍜',
  cake: '🍰', birthday: '🎂', cookie: '🍪', apple: '🍎', banana: '🍌',
  100: '💯', warning: '⚠️', white_check_mark: '✅', heavy_check_mark: '✔️',
  x: '❌', o: '⭕', question: '❓', grey_question: '❔', exclamation: '❗',
  bangbang: '‼️', bulb: '💡', lock: '🔒', unlock: '🔓', key: '🔑',
  mag: '🔍', mag_right: '🔎', pushpin: '📌', round_pushpin: '📍',
  bookmark: '🔖', link: '🔗', paperclip: '📎', memo: '📝', pencil2: '✏️',
  book: '📖', books: '📚', clipboard: '📋', calendar: '📅', chart_with_upwards_trend: '📈',
  chart_with_downwards_trend: '📉', bar_chart: '📊', email: '📧',
  envelope: '✉️', inbox_tray: '📥', outbox_tray: '📤', package: '📦',
  bell: '🔔', mute: '🔇', speaker: '🔊', loudspeaker: '📢', mega: '📣',
  hourglass: '⌛', hourglass_flowing_sand: '⏳', alarm_clock: '⏰',
  stopwatch: '⏱️', computer: '💻', keyboard: '⌨️', desktop_computer: '🖥️',
  phone: '📱', iphone: '📱', battery: '🔋', bug: '🐛', gear: '⚙️',
  wrench: '🔧', hammer: '🔨', hammer_and_wrench: '🛠️', nut_and_bolt: '🔩',
  test_tube: '🧪', dna: '🧬', microscope: '🔬', telescope: '🔭',
  recycle: '♻️', new: '🆕', up: '🔼', down: '🔽', arrow_up: '⬆️',
  arrow_down: '⬇️', arrow_left: '⬅️', arrow_right: '➡️', repeat: '🔁',
  arrows_counterclockwise: '🔄', shrug: '🤷', facepalm: '🤦',
  raised_hand_with_fingers_splayed: '🖐️', dog: '🐶', cat: '🐱',
  panda_face: '🐼', unicorn: '🦄', bird: '🐦', turtle: '🐢', octopus: '🐙',
  see_no_evil: '🙈', hear_no_evil: '🙉', speak_no_evil: '🙊',
};
const _TOC_MARKER_RE = /^\[toc\]$/i;

/**
 * Render Markdown to safe HTML.
 * @param {string} src
 * @param {object} [_parentCtx] internal — lets renderMarkdownWithToc pass a
 *   ctx with a pre-initialized `headings` array to collect every rendered
 *   heading into. Not part of the public API; callers should never pass it.
 * @returns {string} sanitized HTML
 */
export function renderMarkdown(src, _parentCtx) {
  if (!src) return '';
  const text = String(src).replace(/\r\n?/g, '\n');
  const tree = _parser.parse(text);
  const ctx = _parentCtx || {
    cbCounter: 0, headingIds: new Set(),
    footnoteDefs: new Map(), footnoteOrder: [],
    linkRefs: new Map(),
  };
  _collectFootnoteDefs(text, ctx);
  _collectLinkRefs(tree, text, ctx);

  const topBlocks = _children(tree.topNode);
  // Footnote-definition lines ([^id]: text) parse as ordinary Paragraphs to
  // the grammar — pulled out of the block stream since they're rendered
  // once, together, in the references section instead.
  const filtered = topBlocks.filter((node) => !_isFootnoteDefNode(node, text) && node.type.name !== 'LinkReference');

  // A [TOC] marker anywhere among the top-level blocks renders the *whole*
  // document's headings, including ones after it — so every heading's id
  // must be pre-computed before the main render pass reaches any of them.
  if (filtered.some((node) => _isTocMarkerNode(node, text))) {
    ctx._tocIdQueue = [];
    ctx._tocEntries = _collectHeadingsInOrder(filtered, text).map((h) => {
      const id = _slugifyHeading(h.rawText, ctx.headingIds);
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

/**
 * Like renderMarkdown(), but also returns the flat list of headings
 * encountered (including inside blockquotes), with the exact same ids the
 * rendered HTML's <h1>-<h6> elements carry — for building a table of
 * contents outside the live preview (e.g. exported/printed HTML), where
 * ui.js's DOM-scanning _injectTocNav() has no live preview element to scan.
 * @param {string} src
 * @returns {{ html: string, headings: Array<{level:number,id:string,text:string}> }}
 */
export function renderMarkdownWithToc(src) {
  const ctx = {
    cbCounter: 0, headingIds: new Set(), headings: [],
    footnoteDefs: new Map(), footnoteOrder: [],
    linkRefs: new Map(),
  };
  const html = renderMarkdown(src, ctx);
  return { html, headings: ctx.headings };
}

/**
 * Build a standalone "Contents" nav from a headings list (as returned by
 * renderMarkdownWithToc). Returns '' for fewer than two headings, matching
 * the live preview's own threshold for showing a TOC at all.
 * @param {Array<{level:number,id:string,text:string}>} headings
 * @returns {string} sanitized HTML
 */
export function renderTocHtml(headings) {
  if (!headings || headings.length < 2) return '';
  const items = headings.map((h) =>
    `<li style="margin:0.3em 0;padding-left:${(Math.max(1, h.level) - 1) * 0.9}em"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`
  ).join('');
  return `<nav aria-label="Table of contents" style="border:1px solid #ddd;border-radius:8px;background:#f7f7f7;padding:0.8em 1em;margin:0 0 1.4em;font-size:0.9em">
<strong>Contents</strong>
<ul style="list-style:none;margin:0.6em 0 0;padding:0">${items}</ul>
</nav>`;
}

/**
 * Render Markdown down to plain reading text — strip syntax markers (**,
 * #, etc.) rather than showing them literally. Used by the editor's "Copy
 * as plain text" context-menu action, for pasting into places that don't
 * understand Markdown (chat apps, plain-text fields) without the raw `**`/
 * `_`/`#`/`[]()`/etc. syntax cluttering the pasted text.
 *
 * Reuses the real renderer + tag-stripper rather than a separate regex
 * pass, so this always matches what the note actually renders to — a
 * second, independent "plain-text" parser would drift from the real one's
 * edge cases (nested emphasis, escaped punctuation, reference links, …).
 * @param {string} src
 * @returns {string}
 */
export function markdownToPlainText(src) {
  if (!src) return '';
  const html = renderMarkdown(src);
  // <img> is a void element — _stripTags would otherwise discard it (and
  // its alt text, the only thing it has going for it as plain text) along
  // with every other tag. Swap it for its alt text (bracketed, so it still
  // reads as "an image was here" rather than floating unmarked prose)
  // before the generic strip runs; an empty alt (decorative image) drops
  // to nothing, matching how alt="" is meant to be treated everywhere else.
  const withImgAlt = html.replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/g, (_m, alt) => (alt ? `[${alt}]` : ''));
  return _stripTags(withImgAlt)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Toggle a GFM-style checkbox at a 0-based index inside the source text.
 * Returns the updated source string. The index matches the order in which
 * checkboxes appear top-to-bottom in the rendered preview (the same value
 * used as the data-cb-index attribute).
 *
 * @param {string} src
 * @param {number} index
 * @param {boolean} checked
 * @returns {string}
 */
export function toggleChecklistItem(src, index, checked) {
  if (!src) return src;
  let count = 0;
  const re = /^([ \t]*(?:[-*+]|\d+\.)[ \t]+)\[( |x|X)\](?=[ \t]+)/gm;
  return src.replace(re, (full, prefix) => {
    const thisIndex = count++;
    if (thisIndex !== index) return full;
    return `${prefix}[${checked ? 'x' : ' '}]`;
  });
}

// ── Node helpers ───────────────────────────────────────────────────────────────

function _children(node) {
  const out = [];
  let child = node.firstChild;
  while (child) { out.push(child); child = child.nextSibling; }
  return out;
}

// ── Footnotes / TOC / reference-links (grammar has no concept of these) ──────

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
 *  into blockquotes so [TOC] picks up blockquoted headings too. Used only to
 *  pre-compute the full heading list for the [TOC] block, ahead of the main
 *  per-block render pass. */
function _collectHeadingsInOrder(blocks, text) {
  const out = [];
  for (const node of blocks) {
    const name = node.type.name;
    const level = _headingLevel(name);
    if (level) {
      const rawText = _headingRawInner(node, text);
      // Two different strings for two different purposes: the *raw* markdown
      // source slugifies into the id (so e.g. a heading containing a link
      // keeps the URL's letters in its id — a quirk, but one that must stay
      // stable since it's what every real anchor link out there was
      // generated against), while the *rendered, tag-stripped* text is what's
      // shown in the TOC's own link label.
      out.push({ level, rawText, plainText: _stripTags(_renderInlineFallbackRaw(rawText)) });
    } else if (name === 'Blockquote') {
      out.push(..._collectHeadingsInOrder(_children(_dequoteTree(node, text).topNode), _dequoteText(node, text)));
    }
  }
  return out;
}

// Re-parses just to extract plain text for the TOC entry list — a minimal,
// context-free inline render (no ctx needed: TOC entry text never contains
// footnote refs/reference links in practice, and even then only the
// already-rendered HTML gets tag-stripped here).
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
 *  a lowercase/trimmed key. */
function _linkLabelKey(labelNodeText) {
  return labelNodeText.replace(/^\[|\]$/g, '').trim().toLowerCase();
}

/** Re-parse an isolated text fragment (table cell, footnote definition,
 *  heading content, task-item content, …) and render its inline content —
 *  used wherever a field's exact bounds are extracted as a raw substring
 *  rather than walked as tree children, so it never picks up sibling gap
 *  text. Reuses the *same* ctx (footnote/link-ref maps, heading-id set,
 *  checkbox counter) so state stays consistent with the surrounding
 *  document. */
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

// ── Heading anchors ──────────────────────────────────────────────────────────

/**
 * Derive a stable, URL-safe id for a heading so it can be jumped to (e.g. by
 * a table-of-contents link). Strips inline markup markers first so
 * "**Setup**" and "Setup" produce the same slug. Duplicate headings within
 * the same document get -1, -2, … suffixes; `usedIds` tracks every id
 * actually emitted so far (not just base-text counts) so a heading whose own
 * text collides with an already-generated suffix — e.g. "foo", "foo-1",
 * "foo" — still gets a unique id instead of colliding with the real "foo-1".
 */
function _slugifyHeading(rawText, usedIds) {
  const base = String(rawText)
    // A heading's HTML comment renders as invisible (see the Comment/
    // CommentBlock cases in _renderInlineNode/_renderNode) — its words must
    // not leak into the anchor id/URL either, or the "hidden" text is still
    // exposed via the address bar after a TOC/anchor navigation.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[*_`~=]/g, '')
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
 *  optional closing "##" sequence — can't be gap-filled generically since
 *  that would include the closing hashes and surrounding whitespace. */
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
 *  line" shape a plain regex expects. */
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
      // A top-level fence gets one contiguous CodeText child, but @lezer/
      // markdown emits one CodeText *per line* when the fence is nested
      // inside a list item — getChild() alone silently dropped every line
      // after the first in that case. Collect and join all of them.
      const textNodes = _children(node).filter((c) => c.type.name === 'CodeText');
      const body = textNodes.map((n) => text.slice(n.from, n.to)).join('');
      // A sibling gutter, not part of <code> itself — Prism.highlightAllUnder()
      // (ui/editor.js's _prismHighlight) reads <code>'s plain text and
      // replaces its *entire* innerHTML with its own tokenized markup, so
      // any per-line wrapper spans living inside <code> would just get
      // silently destroyed for every language it recognizes. A separate,
      // empty-span-per-line overlay (same technique Prism's own official
      // line-numbers plugin uses) sidesteps that entirely; only shown when
      // the opt-in "Code line numbers" setting is on (styles/editor.css).
      const lineCount = body.replace(/\n$/, '').split('\n').length;
      const gutter = `<span class="code-line-numbers-gutter" aria-hidden="true">${'<span></span>'.repeat(lineCount)}</span>`;
      return `<pre class="code-block">${gutter}<code${lang ? ` class="language-${escapeHtml(lang)}" data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(body)}</code></pre>`;
    }

    // Deliberately NOT rendered as code — this renderer doesn't support
    // 4-space-indented code blocks (ambiguous against indent-based list
    // nesting). The node's own span excludes the first line's leading
    // indentation (that's what triggered CodeBlock in the first place) even
    // though it keeps every subsequent line's — reconstruct the true
    // original text from the start of the line so indentation is preserved
    // exactly as plain paragraph text.
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

    // Raw HTML — never interpreted, always its literal escaped source text.
    case 'HTMLBlock':
      return `<p>${escapeHtml(text.slice(node.from, node.to))}</p>`;

    // A block-level HTML comment (<!-- ... -->) parses as its own top-level
    // CommentBlock, not wrapped in HTMLBlock — unlike stray HTML tags, a
    // comment is meant to be invisible in the rendered output (its content
    // is still never parsed/interpreted, just discarded entirely instead of
    // shown as escaped visible text).
    case 'CommentBlock':
      return '';

    case 'LinkReference':
      // Reference-link *definitions* never render at their own source
      // position — consumed by _collectLinkRefs().
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
  const id = ctx._tocIdQueue ? ctx._tocIdQueue.shift() : _slugifyHeading(rawInner, ctx.headingIds);
  ctx.headingIds.add(id);
  // Populated only when the caller (renderMarkdownWithToc) pre-seeds
  // ctx.headings.
  ctx.headings?.push({ level, id, text: plain });
  return `<h${level} id="${id}">${inner}</h${level}>`;
}

function _renderTocNav(ctx) {
  const entries = ctx._tocEntries || [];
  if (entries.length < 2) return '';
  const items = entries.map((h) =>
    `<li class="note-toc-item note-toc-h${h.level}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`
  ).join('');
  // <details>/<summary> gives native collapse/expand (keyboard- and
  // touch-accessible, no JS needed) — collapsed by default so a long note's
  // outline doesn't dominate the preview until asked for. Exported HTML/PDF
  // (src/app/export.js) override this with a CSS rule forcing the list
  // visible regardless of [open], since a collapsed <details> renders empty
  // in print/PDF output.
  return `<details class="md-inline-toc" aria-label="Table of contents"><summary>Contents</summary><ul>${items}</ul></details>`;
}

function _renderBlockquote(node, text, ctx) {
  const dequoted = _dequoteText(node, text);
  // GitHub-style alerts: a blockquote whose first line is exactly "[!NOTE]"
  // (or TIP/IMPORTANT/WARNING/CAUTION) renders as a labeled callout instead
  // of a plain blockquote — GFM's own admonition syntax, needs no raw HTML.
  const alertMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i.exec(dequoted);
  if (alertMatch) {
    const kind = alertMatch[1].toLowerCase();
    const rest = dequoted.slice(alertMatch[0].length);
    return `<div class="md-alert md-alert-${kind}"><p class="md-alert-title">${_ALERT_ICONS[kind]}${_ALERT_LABEL[kind]}</p>${_renderFragmentBlocks(rest, ctx)}</div>`;
  }
  return `<blockquote>${_renderFragmentBlocks(dequoted, ctx)}</blockquote>`;
}

function _renderFragmentBlocks(fragmentText, ctx) {
  // A *fresh* cbCounter, not the parent's. toggleChecklistItem()'s
  // source-line scan only recognizes a checklist marker at the very start of
  // the line, so it never counts a blockquoted item; sharing the counter
  // here would silently misalign the index of every checkbox rendered after
  // the first blockquoted checklist in the document.
  const childCtx = { ...ctx, cbCounter: 0 };
  const tree = _parser.parse(fragmentText);
  const blocks = _children(tree.topNode).filter((n) => !_isFootnoteDefNode(n, fragmentText) && n.type.name !== 'LinkReference');
  return blocks.map((n) => _renderNode(n, fragmentText, childCtx)).join('\n');
}

// ── Lists ──────────────────────────────────────────────────────────────────────
// Rendered tight (no <p> wrapper around a single-paragraph item's content) —
// this renderer has no concept of "loose" lists at all, so a nested
// sub-paragraph is always unwrapped. The checklist progress count is
// computed once over the *whole* subtree (nested items included) and shown
// only above the outermost list — _renderListLevel itself never emits a
// progress div, only its _renderNode('BulletList'/'OrderedList') caller
// does, so a nested sub-list doesn't get its own.

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
 *  "|:---|:---:|---:|---|" line — sliced out and handed to the shared
 *  parser (also used by live-editor.js's own table widget) rather than
 *  relying on any particular internal child structure. */
function _tableAligns(delimNode, text) {
  return parseTableAlignments(text.slice(delimNode.from, delimNode.to));
}

/** Reduce already-rendered, self-controlled inline HTML to plain text —
 *  strips tags AND unescapes entities (&amp; -> &, etc.) so heading/TOC/
 *  plain-text output containing "&" etc. doesn't double-encode. Only ever
 *  called on this renderer's own output, so a plain tag-strip + unescape is
 *  safe (no untrusted HTML reaches this function). */
function _stripTags(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ── Inline-level rendering ────────────────────────────────────────────────────

/**
 * Render a node's inline content: Lezer's markdown grammar only creates
 * child nodes for *marked-up* spans — plain text between/around them has no
 * node of its own at all. Any newline within the gap text is a CommonMark
 * soft break — rendered as a space.
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
      // Ends with a space after <br>, not a literal newline — matches the
      // final "every remaining newline becomes a space" inline-render step.
      return '<br> ';
    case 'Escape':
      return escapeHtml(text.slice(node.from + 1, node.to));
    case 'Emoji': {
      const raw = text.slice(node.from, node.to);
      const code = raw.slice(1, -1).toLowerCase();
      return Object.prototype.hasOwnProperty.call(_EMOJI_MAP, code) ? _EMOJI_MAP[code] : escapeHtml(raw);
    }
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
    // Raw HTML — never interpreted.
    case 'HTMLTag': case 'ProcessingInstructionBlock':
      return escapeHtml(text.slice(node.from, node.to));
    // Inline HTML comment (a distinct 'Comment' node — not the same node
    // name as the block-level 'CommentBlock' case above, confirmed by
    // tracing the actual parse tree). Content still never parsed/
    // interpreted, just rendered as nothing rather than visible escaped text.
    case 'Comment':
      return '';

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
    // _collectLinkRefs()). Extract the visible "text" as the bounded span
    // between the opening "[" and the LinkLabel's own "[label]" (this can't
    // be gap-filled over the whole node — the gap between the marks IS the
    // visible text but LinkLabel itself must be excluded from it).
    const marks = _children(node).filter((c) => c.type.name === 'LinkMark');
    const textStart = marks[0]?.to ?? node.from;
    const textEnd = marks.length > 1 ? marks[1].from : labelNode.from;
    const rawLabel = text.slice(textStart, textEnd);
    const visibleLabel = _unwrapRedundantAnchor(_renderInlineFallback(rawLabel, text, ctx));
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
  const marks = _children(node).filter((c) => c.type.name === 'LinkMark');
  const labelStart = marks[0]?.to ?? node.from;
  const labelEnd = marks.length > 1 ? marks[1].from : (urlNode.from);
  const rawLabel = text.slice(labelStart, labelEnd);
  const label = _unwrapRedundantAnchor(_renderInlineFallback(rawLabel, text, ctx));
  // A link to an uploaded file (private Storage bucket, no baked-in URL —
  // same syncpad-file: pseudo-scheme _renderImage already handles). Resolved
  // client-side to a real signed URL by ui/editor.js's _resolveFileImages()
  // after this HTML is inserted, mirroring the img[data-syncpad-file] path.
  const fileMatch = /^syncpad-file:(.+)$/i.exec(url);
  if (fileMatch) {
    return `<a href="#" data-syncpad-file="${escapeHtml(fileMatch[1])}" class="syncpad-file-link">${label}</a>`;
  }
  if (!/^(?:https?:|mailto:)/i.test(url)) return escapeHtml(text.slice(node.from, node.to));
  const titleNode = node.getChild('LinkTitle');
  const titleAttr = titleNode ? ` title="${escapeHtml(_stripQuotes(text.slice(titleNode.from, titleNode.to)))}"` : '';
  return `<a href="${escapeHtml(url)}"${titleAttr} target="_blank" rel="noopener noreferrer">${label}</a>`;
}

/**
 * A link's label is re-parsed from scratch as its own fragment
 * (_renderInlineFallback), which means a label that happens to look like a
 * bare URL — e.g. `[https://example.com](https://example.com)` — gets
 * caught by the same autolink detection that applies to genuinely bare URL
 * text, producing a redundant nested `<a>` inside the real one. CommonMark
 * link text is normal inline content and should never itself become a
 * second clickable link. Unwrap it when (and only when) the *entire*
 * rendered label is a single anchor with no other anchor tags inside it —
 * mixed content like "Click **here**" never matches this and is left
 * untouched, and neither does an unusual label containing more than one
 * bare-URL autolink (e.g. two space-separated URLs), where naively matching
 * only the outermost `<a…>`/`</a>` would strip tags that don't actually
 * wrap the whole label and leave the rest mismatched.
 */
function _unwrapRedundantAnchor(html) {
  const m = /^<a\b[^>]*>((?:(?!<\/?a\b)[\s\S])*)<\/a>$/.exec(html.trim());
  return m ? m[1] : html;
}

/**
 * A Link node the grammar couldn't resolve at all (no URL, no matching
 * LinkLabel definition) — covers [TOC]/footnote-reference/"any other
 * unmatched [text]" cases, all handled here as a single fallthrough (render
 * as literal text, except footnote refs which get a real reference if their
 * id has a matching definition).
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
    // href="#fn-<id>" is a real, working no-JS fallback (jumps to the
    // references section); data-footnote-ref is what _wireFootnotePopovers()
    // (src/ui/editor.js) intercepts to show the text inline instead, without
    // leaving the reading position — see src/footnote-popover.js.
    return `<sup${anchor}><a href="#fn-${escapeHtml(id)}" data-footnote-ref="${escapeHtml(id)}" aria-expanded="false">${n + 1}</a></sup>`;
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
