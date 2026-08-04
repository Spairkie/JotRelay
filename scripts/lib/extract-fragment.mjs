// Shared helper for scripts/mockups/*.html generation: pulls a single
// element (and its balanced children) out of the real index.html by id,
// so presskit screenshot mockups reuse the app's actual markup instead of
// a hand-copied (and driftable) duplicate.
export function extractElementById(html, id) {
  const idAttr = `id="${id}"`;
  const idIdx = html.indexOf(idAttr);
  if (idIdx === -1) throw new Error(`extractElementById: no element with id="${id}"`);

  const openStart = html.lastIndexOf('<', idIdx);
  const tagMatch = /^<([a-zA-Z0-9-]+)/.exec(html.slice(openStart));
  if (!tagMatch) throw new Error(`extractElementById: could not read tag name for id="${id}"`);
  const tag = tagMatch[1];

  const openRe = new RegExp(`<${tag}(?=[\\s>/])`, 'g');
  const closeRe = new RegExp(`</${tag}>`, 'g');

  let depth = 0;
  let cursor = openStart;
  while (true) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) throw new Error(`extractElementById: unbalanced <${tag}> for id="${id}"`);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + 1;
    } else {
      depth -= 1;
      cursor = nextClose.index + 1;
      if (depth === 0) {
        return html.slice(openStart, nextClose.index + `</${tag}>`.length);
      }
    }
  }
}
