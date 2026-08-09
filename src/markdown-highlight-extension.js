// JotRelay – markdown-highlight-extension.js
// The ==highlight== Lezer grammar extension, shared between live-editor.js
// (CM6 decorations) and markdown.js (static HTML renderer) — both
// need the exact same parse tree, so both must feed the exact same
// extension into `markdown({ base: markdownLanguage, extensions: [...] })`.
//
// Not part of CommonMark/GFM, so the base markdown language doesn't parse
// it on its own. Modeled directly on @lezer/markdown's own built-in
// Strikethrough extension (same "==" delimiter shape as "~~") — this plain-
// object shape (defineNodes + parseInline) is the documented public
// extension mechanism, not an internal API.
import { tags } from '../vendor/codemirror.js';

const _highlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };

export const highlightExtension = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': tags.special(tags.content) } },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [{
    name: 'Highlight',
    parse(cx, next, pos) {
      if (next !== 61 /* '=' */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
      const before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
      const sBefore = /\s|^$/.test(before), sAfter = /\s|^$/.test(after);
      return cx.addDelimiter(_highlightDelim, pos, pos + 2, !sAfter, !sBefore);
    },
    after: 'Emphasis',
  }],
};
