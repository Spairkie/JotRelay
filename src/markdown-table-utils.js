// SyncPad – markdown-table-utils.js
// The one piece of Lezer-tree-interpretation logic genuinely shared between
// the static HTML renderer (markdown.js) and the live CM6 editor's table
// widget (live-editor.js): parsing a GFM table's alignment-delimiter row
// (e.g. "|:---|:---:|---:|---|") into a per-column alignment. Pure text in,
// plain data out — no Lezer node, DOM, or CM6 dependency, which is what
// makes it safe to share as-is between a one-shot static parse and CM6's
// incremental one (see live-editor.js's header comment for why the two
// parsers themselves can't be unified, only small pure pieces like this).

/**
 * @param {string} delimiterRowText raw source text of the TableDelimiter node
 *   (e.g. "|:---|:---:|---:|---|"), NOT including surrounding newlines.
 * @returns {(('left'|'right'|'center')|null)[]} one entry per column
 */
export function parseTableAlignments(delimiterRowText) {
  return delimiterRowText.split('|').slice(1, -1).map((cell) => {
    cell = cell.trim();
    const left = cell.startsWith(':'), right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}
