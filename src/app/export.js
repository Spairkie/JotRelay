// SyncPad – app/export.js
// The Export modal: .txt/.md download, copy as text/HTML, HTML export, and
// print-to-PDF.

import { escapeHtml, copyToClipboard } from '../utils.js';
import { renderMarkdown, renderMarkdownWithToc, renderTocHtml, markdownToPlainText } from '../markdown.js';
import { resolveFileRef } from '../files.js';
import * as UI from '../ui.js';
import { state } from './state.js';
import { closeMoreDropdown } from './header.js';

export const _downloadBlob = (content, filename, mime) => {
  const blob = new Blob([content], { type: mime });
  const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
};

// Shared guard: all export actions are meaningless on an empty note.
export const _requireContent = () => {
  if (UI.getEditorValue().trim()) return true;
  UI.showToast('Nothing to export — the note is empty.', 'warning');
  return false;
};

// Exported HTML/PDF are standalone documents with no live JS to resolve
// syncpad-file: image references (see markdown.js/ui.js) the way the
// preview pane does — resolve each to an actual URL once, up front, and
// bake it in. Each ref is the raw syncpad-file: value (a short file_no or,
// for pre-0011 notes, a full legacy storage path) — resolveFileRef() (same
// resolver the live preview pane uses) is what turns either shape into a
// real URL, decrypting first for an encrypted file's blob if the room's key
// is available. An image whose file was since deleted, or that can't be
// decrypted (key unavailable), is left as-is: no `src`, alt text still shows.
export const _resolveFileImageRefsForExport = async (html) => {
  const refs = [...new Set(Array.from(html.matchAll(/data-syncpad-file="([^"]+)"/g), (m) => m[1]))];
  if (!refs.length) return html;
  const urlByRef = new Map();
  await Promise.all(refs.map(async (ref) => {
    try { urlByRef.set(ref, await resolveFileRef(state.roomId, ref, state.encKey)); } catch { /* left unresolved */ }
  }));
  return html.replace(/<img data-syncpad-file="([^"]+)"([^>]*)>/g, (full, ref, rest) => {
    const url = urlByRef.get(ref);
    return url ? `<img src="${escapeHtml(url)}"${rest}>` : full;
  });
};

export function _wireExportModal() {
  document.getElementById('btn-export')?.addEventListener('click', () => {
    closeMoreDropdown();
    UI.openModal('export-modal');
  });
  document.getElementById('export-modal-close')?.addEventListener('click', () => UI.closeModal('export-modal'));

  document.getElementById('export-txt')?.addEventListener('click', () => {
    if (!_requireContent()) return;
    _downloadBlob(UI.getEditorValue(), `${state.roomId}.txt`, 'text/plain');
    UI.showToast('Downloaded .txt', 'success');
  });
  document.getElementById('export-md')?.addEventListener('click', () => {
    if (!_requireContent()) return;
    _downloadBlob(UI.getEditorValue(), `${state.roomId}.md`, 'text/markdown');
    UI.showToast('Downloaded .md', 'success');
  });
  document.getElementById('export-html')?.addEventListener('click', async () => {
    if (!_requireContent()) return;
    const { html: bodyHtml, headings } = renderMarkdownWithToc(UI.getEditorValue());
    const resolvedBody = await _resolveFileImageRefsForExport(bodyHtml);
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SyncPad – ${escapeHtml(state.roomId)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.7}
pre{background:#f5f5f5;padding:1em;border-radius:4px;overflow:auto}code{background:#f5f5f5;padding:2px 4px;border-radius:2px}
blockquote{border-left:3px solid #ccc;margin:0;padding-left:1em;color:#666}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}
/* An inline [TOC] marker in the note renders as a collapsed <details> in
   the live app (src/markdown.js's _renderTocNav) — force it open here so a
   downloaded/exported .html file shows the full outline, not just "Contents". */
details.md-inline-toc{border:1px solid #ddd;border-radius:6px;padding:0.6em 0.9em;margin:0 0 1.4em}
details.md-inline-toc>summary{cursor:default;font-weight:600}
details.md-inline-toc>ul{display:block!important;list-style:none;margin:0.6em 0 0;padding:0}</style>
</head><body>${renderTocHtml(headings)}${resolvedBody}</body></html>`;
    _downloadBlob(html, `${state.roomId}.html`, 'text/html');
    UI.showToast('Downloaded .html', 'success');
  });
  document.getElementById('export-copy-text')?.addEventListener('click', async () => {
    if (!_requireContent()) return;
    // Actual reading text, not raw source — strips **/#/[]()/etc. markup
    // rather than copying it literally, matching the "plain text" label
    // (raw markdown source is already covered by "Export as Markdown").
    const ok = await copyToClipboard(markdownToPlainText(UI.getEditorValue()));
    if (ok) UI.showToast('Copied plain text.', 'success');
    else    UI.showToast('Could not copy.', 'error');
  });
  document.getElementById('export-copy-html')?.addEventListener('click', async () => {
    if (!_requireContent()) return;
    // Copy rendered HTML so users can paste into rich-text editors, email, docs, etc.
    const resolvedHtml = await _resolveFileImageRefsForExport(renderMarkdown(UI.getEditorValue()));
    const ok = await copyToClipboard(resolvedHtml);
    if (ok) UI.showToast('Copied as HTML.', 'success');
    else    UI.showToast('Could not copy.', 'error');
  });
  document.getElementById('export-pdf')?.addEventListener('click', async () => {
    if (!_requireContent()) return;
    // window.open() must happen synchronously within the click handler, before
    // any await — browsers only allow it without a popup-blocker prompt when
    // it's the direct, unbroken result of a user gesture.
    const win = window.open('', '_blank');
    if (!win) { UI.showToast('Pop-up blocked — allow pop-ups and try again.', 'warning'); return; }
    const content = UI.getEditorValue();
    const { html: renderedHtml, headings } = renderMarkdownWithToc(content);
    const resolvedHtml = await _resolveFileImageRefsForExport(renderedHtml);
    const title = escapeHtml(state.room?.room_name?.trim() || state.roomId);
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  @media print { body { margin: 0; } }
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px;
         color: #1a1a1a; line-height: 1.75; font-size: 15px; }
  h1,h2,h3,h4,h5,h6 { line-height: 1.3; margin: 1.5em 0 0.5em; }
  pre { background: #f5f5f5; padding: 1em; border-radius: 4px; overflow: auto; font-size: 13px; }
  code { background: #f5f5f5; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 1em; color: #666; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #ddd; padding: 6px 10px; }
  img { max-width: 100%; }
  a { color: #0066cc; }
  /* An inline [TOC] marker in the note renders as a collapsed <details> in
     the live app (src/markdown.js's _renderTocNav) — force it open here so
     the printed/PDF page shows the full outline, not just "Contents". */
  details.md-inline-toc { border: 1px solid #ddd; border-radius: 6px; padding: 0.6em 0.9em; margin: 0 0 1.4em; }
  details.md-inline-toc > summary { cursor: default; font-weight: 600; }
  details.md-inline-toc > ul { display: block !important; list-style: none; margin: 0.6em 0 0; padding: 0; }
</style>
</head><body>${renderTocHtml(headings)}${resolvedHtml}</body></html>`);
    win.document.close();
    win.print();
  });

}
