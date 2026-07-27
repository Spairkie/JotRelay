// SyncPad – ui/editor.js
// Split from the former monolithic ui.js — see src/ui.js for the barrel.
import { escapeHtml } from '../utils.js';

// ── Editor helpers ────────────────────────────────────────────────────────────

export function setEditorValue(text) {
  const editor = document.getElementById('note-editor');
  if (!editor) return;
  const start = editor.selectionStart;
  const end   = editor.selectionEnd;
  const prev  = editor.value;
  editor.value = text;
  // Cursor-preserve: only nudge if lengths are close
  if (typeof start === 'number' && Math.abs(text.length - prev.length) < 200) {
    const offset = text.length - prev.length;
    editor.selectionStart = Math.max(0, start + offset);
    editor.selectionEnd   = Math.max(0, end   + offset);
  }
}

export function getEditorValue() {
  return document.getElementById('note-editor')?.value ?? '';
}

export function focusEditor() {
  document.getElementById('note-editor')?.focus();
}

export function insertAtCursor(text) {
  const editor = document.getElementById('note-editor');
  if (!editor) return;
  if (editor.readOnly) return; // honor the readonly attribute
  const start = editor.selectionStart ?? editor.value.length;
  const end   = editor.selectionEnd   ?? start;
  editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
  editor.selectionStart = editor.selectionEnd = start + text.length;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Replace editor.value[start:end] with `insert`, set the resulting
 * selection, and dispatch 'input' — the general-purpose sibling of
 * insertAtCursor() for callers that replace an arbitrary range and/or need
 * an explicit resulting selection rather than a collapsed caret right after
 * the inserted text.
 *
 * This is the one primitive every cursor-precise editing operation in app.js
 * (auto-pair, smart punctuation, indent/dedent, list-continue, search
 * replace, paste sanitization, toolbar formatting) goes through. app.js
 * decides WHAT edit to make and WHERE; this is the only place that actually
 * writes editor.value/selectionStart/selectionEnd for it, keeping ui.js the
 * single DOM touchpoint the module boundary calls for.
 *
 * @param {number} start
 * @param {number} end
 * @param {string} insert
 * @param {number} [selStart] - defaults to start + insert.length (caret right after the inserted text)
 * @param {number} [selEnd]   - defaults to selStart
 */
export function replaceEditorRange(start, end, insert, selStart, selEnd) {
  const editor = document.getElementById('note-editor');
  if (!editor) return;
  if (editor.readOnly) return;
  const val = editor.value;
  editor.value = val.slice(0, start) + insert + val.slice(end);
  const s = selStart ?? (start + insert.length);
  editor.selectionStart = s;
  editor.selectionEnd   = selEnd ?? s;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Move the editor's selection without touching its value or firing 'input'. */
export function setEditorSelection(start, end) {
  const editor = document.getElementById('note-editor');
  if (!editor) return;
  editor.selectionStart = start;
  editor.selectionEnd   = end ?? start;
}

/**
 * Truncate the editor's value to `max` characters if it currently exceeds
 * it, keeping the selection in bounds. Does not fire 'input' — callers use
 * this from inside their own input pipeline, where dispatching again would
 * recurse. Returns true if truncation occurred.
 */
export function clampEditorValue(max) {
  const editor = document.getElementById('note-editor');
  if (!editor || editor.value.length <= max) return false;
  const selStart = editor.selectionStart;
  const selEnd   = editor.selectionEnd;
  editor.value = editor.value.slice(0, max);
  editor.selectionStart = Math.min(selStart, max);
  editor.selectionEnd   = Math.min(selEnd, max);
  return true;
}

export function setMonospace(on) {
  document.getElementById('note-editor')?.classList.toggle('monospace', on);
  document.getElementById('note-preview')?.classList.toggle('monospace', on);
  document.getElementById('note-live')?.classList.toggle('monospace', on);
}

// ── Focus mode ───────────────────────────────────────────────────────────────
//
// A plain <textarea> has no per-paragraph DOM nodes to dim individually, so
// "dim everything but the current paragraph" is done with a CSS mask
// gradient on the textarea itself, anchored to the caret's actual pixel
// position (a fixed vertical band around it stays fully opaque, everything
// above/below fades). The caret's Y offset is measured with the standard
// "mirror div" technique — an offscreen div cloning the textarea's exact
// font/padding/wrapping, holding the text up to the caret, whose trailing
// marker's offsetTop gives the same line-wrapped position the browser
// itself would use, then adjusted by the textarea's own scroll position.

let _focusModeOn = false;

export function setFocusMode(on) {
  _focusModeOn = on;
  const editor = document.getElementById('note-editor');
  editor?.classList.toggle('focus-mode', on);
  if (on) refreshFocusMode();
}

/** Recompute the dimmed band's position — call on cursor move, scroll, input, or resize. */
export function refreshFocusMode() {
  if (!_focusModeOn) return;
  const editor = document.getElementById('note-editor');
  if (!editor) return;
  const caretY    = _measureCaretPixelY(editor);
  const visibleY  = caretY - editor.scrollTop;
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
  editor.style.setProperty('--focus-y', `${visibleY + lineHeight / 2}px`);
  editor.style.setProperty('--focus-band', `${lineHeight}px`);
}

const _CARET_MIRROR_PROPS = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'textIndent', 'wordSpacing', 'tabSize',
];

/** {x, y} of `pos` within `editor`'s own box, via the mirror-div technique. */
function _measureCaretOffset(editor, pos) {
  const mirror = document.createElement('div');
  const cs = getComputedStyle(editor);
  _CARET_MIRROR_PROPS.forEach((prop) => { mirror.style[prop] = cs[prop]; });
  mirror.style.position   = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap   = 'break-word';
  mirror.style.top  = '0';
  mirror.style.left = '-9999px';
  mirror.textContent = editor.value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const coords = { x: marker.offsetLeft, y: marker.offsetTop };
  document.body.removeChild(mirror);
  return coords;
}

function _measureCaretPixelY(editor) {
  return _measureCaretOffset(editor, editor.selectionStart).y;
}

/**
 * Viewport pixel coordinates for a character offset into the Write-mode
 * textarea's value (cursor-chat composer/bubble placement — the Write-mode
 * counterpart to LiveEditor.coordsAtPos()). Reuses the same mirror-div
 * measurement as focus/typewriter mode, converted from editor-box-relative
 * to viewport-relative by adding the editor's own on-screen position and
 * subtracting its scroll offset (scrollLeft is always 0 in practice — the
 * textarea soft-wraps rather than scrolling horizontally — but it's
 * subtracted anyway for correctness if that ever changes).
 */
export function getCaretViewportCoords(pos) {
  const editor = document.getElementById('note-editor');
  if (!editor || !Number.isFinite(pos) || pos < 0 || pos > editor.value.length) return null;
  const { x, y } = _measureCaretOffset(editor, pos);
  const rect = editor.getBoundingClientRect();
  return { x: rect.left + x - editor.scrollLeft, y: rect.top + y - editor.scrollTop };
}

// ── Typewriter mode ──────────────────────────────────────────────────────────
//
// Keeps the caret's line vertically centered in the editor's viewport, like
// Typora's typewriter mode. The textarea is given top/bottom padding equal
// to half its own viewport height — via the --typewriter-pad custom property,
// consumed by the .typewriter-mode rule in style.css — so that even the
// first/last line of the document can still be scrolled to center. The
// caret's pixel position reuses the same mirror-div measurement as focus
// mode (which already accounts for that padding, since the mirror clones
// the textarea's live computed style).

let _typewriterModeOn = false;

export function setTypewriterMode(on) {
  _typewriterModeOn = on;
  const editor = document.getElementById('note-editor');
  if (!editor) return;
  if (on) {
    // Measure — and set --typewriter-pad — before the class (and its
    // padding) is applied, so this first measurement reflects the editor's
    // normal un-padded box rather than being skewed by the CSS rule's own
    // fallback padding (var(--typewriter-pad, 40vh)), which briefly applies
    // once the class lands but before this property has a real value.
    editor.style.setProperty('--typewriter-pad', `${editor.clientHeight / 2}px`);
  }
  editor.classList.toggle('typewriter-mode', on);
  if (on) refreshTypewriterMode();
}

/** Recompute the centering scroll position — call on cursor move, input, or resize. */
export function refreshTypewriterMode() {
  if (!_typewriterModeOn) return;
  const editor = document.getElementById('note-editor');
  if (!editor) return;
  editor.style.setProperty('--typewriter-pad', `${editor.clientHeight / 2}px`);
  const caretY     = _measureCaretPixelY(editor);
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
  const target     = caretY + lineHeight / 2 - editor.clientHeight / 2;
  editor.scrollTop = Math.max(0, target);
}

/**
 * Toggle the textarea between editable and readonly. Keeps the textarea
 * selectable (so the user can copy text in read-only mode), but blocks
 * keystrokes and input events.
 */
export function setEditorEditable(editable) {
  const editor = document.getElementById('note-editor');
  if (!editor) return;
  editor.readOnly = !editable;
  editor.classList.toggle('readonly', !editable);
}

/**
 * Sets the human-readable banner explaining why editing is blocked
 * (null hides it).
 */
export function setEditBlockedReason(reason) {
  const bar = document.getElementById('edit-blocked-bar');
  const txt = document.getElementById('edit-blocked-text');
  if (!bar || !txt) return;
  if (!reason) {
    bar.classList.add('hidden');
    txt.textContent = '';
    return;
  }
  bar.classList.remove('hidden');
  txt.textContent = reason;
}

// ── File upload zone ──────────────────────────────────────────────────────────

/**
 * Wire all file-upload entry points (picker, upload zone drop, panel-wide
 * drop, editor-area drop). Every entry point can yield more than one file
 * (multi-select picker, multi-file drag-and-drop); onFilesSelected always
 * receives a non-empty array of File objects.
 * @param {(files: File[]) => void} onFilesSelected
 */
export function setFileHandlers(onFilesSelected) {
  const input       = document.getElementById('file-input');
  const zone        = document.getElementById('files-upload-zone');
  const panel       = document.getElementById('files-panel');
  const editorArea  = document.querySelector('.editor-area');

  if (input) {
    input.onchange = () => {
      if (input.files.length) onFilesSelected(Array.from(input.files));
      input.value = '';
    };
  }

  // Click on the upload zone opens the file picker
  if (zone) zone.onclick = () => input?.click();

  // ── Per-zone drag style (upload zone) ─────────────────────────────────────
  if (zone) {
    zone.ondragover  = (e) => { e.preventDefault(); zone.classList.add('drag-over'); };
    zone.ondragleave = ()  => zone.classList.remove('drag-over');
    zone.ondrop      = (e) => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) onFilesSelected(files);
    };
  }

  // ── Panel-wide drop (full files panel body) ────────────────────────────────
  // Shows an overlay across the entire panel so users can drop anywhere.
  if (panel) {
    let _dragDepth = 0;  // track enter/leave depth for nested elements
    const overlay  = _ensureDropOverlay(panel, 'Drop files here to upload');

    panel.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      _dragDepth++;
      overlay?.classList.add('visible');
    });
    panel.addEventListener('dragleave', () => {
      _dragDepth = Math.max(0, _dragDepth - 1);
      if (_dragDepth === 0) overlay?.classList.remove('visible');
    });
    panel.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      _dragDepth = 0;
      overlay?.classList.remove('visible');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) onFilesSelected(files);
    });
  }

  // ── Editor-area drop ───────────────────────────────────────────────────────
  // Allows dropping files onto the note editor area to trigger an upload.
  if (editorArea) {
    let _edDragDepth = 0;
    const edOverlay = _ensureDropOverlay(editorArea, 'Drop files to upload to this room');

    editorArea.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      _edDragDepth++;
      edOverlay?.classList.add('visible');
    });
    editorArea.addEventListener('dragleave', () => {
      _edDragDepth = Math.max(0, _edDragDepth - 1);
      if (_edDragDepth === 0) edOverlay?.classList.remove('visible');
    });
    editorArea.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    editorArea.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      _edDragDepth = 0;
      edOverlay?.classList.remove('visible');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) onFilesSelected(files);
    });
  }
}

/** Create (or reuse) a drop overlay element inside a container. */
function _ensureDropOverlay(container, label) {
  let overlay = container.querySelector('.drop-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'drop-overlay';
    overlay.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <span>${label}</span>`;
    // Make the container a positioning parent if it isn't already
    const pos = getComputedStyle(container).position;
    if (pos === 'static') container.style.position = 'relative';
    container.appendChild(overlay);
  }
  return overlay;
}

// ── Markdown mode (Write / Preview / Split) ───────────────────────────────────

/**
 * Switch the editor to one of three modes.
 * @param {'write'|'preview'|'split'} mode
 * @param {Function|null} [renderFn]  – called to produce preview HTML
 */
export function setMarkdownMode(mode, renderFn, { live = false } = {}) {
  const editor   = document.getElementById('note-editor');
  const preview  = document.getElementById('note-preview');
  const livePane = document.getElementById('note-live');
  const wrap     = document.querySelector('.editor-wrap');
  if (!editor || !preview) return;

  // Clear all stale mode classes so no previous mode leaks into the next.
  // split-mode is the legacy alias — keep removing it for backward compat.
  wrap?.classList.remove('mode-write', 'mode-preview', 'mode-split', 'split-mode');
  wrap?.classList.toggle('live-preview', !!(live && livePane));

  // Update segmented control
  document.querySelectorAll('.md-seg-btn').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  // In live mode the Typora-style editable surface (#note-live) takes the
  // place #note-preview held; the rendered-HTML pane stays for the non-live
  // fallback (live editor failed to load) and for export paths.
  const showPane = (pane) => {
    preview.classList.toggle('hidden',  pane !== 'preview');
    livePane?.classList.toggle('hidden', pane !== 'live');
  };

  if (mode === 'write') {
    editor.classList.remove('hidden');
    showPane(null);
    wrap?.classList.add('mode-write');
  } else if (mode === 'preview') {
    editor.classList.add('hidden');
    showPane(live && livePane ? 'live' : 'preview');
    wrap?.classList.add('mode-preview');
    if (!(live && livePane) && renderFn) { preview.innerHTML = renderFn(); _prismHighlight(preview); _injectTocNav(preview); _resolveFileImages(preview); }
  } else if (mode === 'split') {
    editor.classList.remove('hidden');
    showPane(live && livePane ? 'live' : 'preview');
    wrap?.classList.add('mode-split');
    if (!(live && livePane) && renderFn) {
      preview.innerHTML = renderFn(); _prismHighlight(preview); _injectTocNav(preview); _resolveFileImages(preview);
      _wireScrollSync(editor, preview);
    }
  }
}


// ── Pasted/dropped image resolution (preview mode) ─────────────────────────────

// Images pasted straight into the editor reference a private-bucket file path
// (see markdown.js's syncpad-file: scheme) rather than a baked-in URL, since a
// real signed URL expires in ~1h and can't just be stored in the note. Set
// once via setFileImageResolver() so every render path (preview/split modes,
// which re-render on nearly every keystroke) doesn't need its own plumbing.
let _fileImageResolver = null;

/** @param {(filePath: string) => Promise<string>} resolver */
export function setFileImageResolver(resolver) { _fileImageResolver = resolver; }

function _resolveFileImages(container) {
  if (!_fileImageResolver) return;
  container.querySelectorAll('img[data-syncpad-file]').forEach((img) => {
    const filePath = img.dataset.syncpadFile;
    if (!filePath) return;
    _fileImageResolver(filePath).then((url) => {
      img.src = url;
      img.removeAttribute('data-syncpad-file');
    }).catch(() => {
      img.classList.add('img-broken');
      img.alt = img.alt ? `${img.alt} (image unavailable)` : 'Image unavailable';
    });
  });
}

// ── Table of contents (preview mode) ──────────────────────────────────────────

// Preview re-renders on every debounced keystroke (split mode) and would
// otherwise reset an open <details> back to closed each time; remember the
// user's choice across renders instead.
let _tocOpen = false;

function _injectTocNav(preview) {
  const headings = Array.from(preview.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'));
  if (headings.length < 2) return;

  const items = headings.map((h) => {
    const level = Number(h.tagName[1]);
    return `<li class="note-toc-item note-toc-h${level}"><a href="#${h.id}">${escapeHtml(h.textContent)}</a></li>`;
  }).join('');

  const nav = document.createElement('nav');
  nav.className = 'note-toc';
  nav.setAttribute('aria-label', 'Table of contents');
  nav.innerHTML = `
    <details${_tocOpen ? ' open' : ''}>
      <summary>Contents</summary>
      <ul>${items}</ul>
    </details>`;
  nav.querySelector('details').addEventListener('toggle', (e) => { _tocOpen = e.target.open; });
  preview.insertBefore(nav, preview.firstChild);
}

// ── Scroll synchronisation (split mode) ──────────────────────────────────────
let _scrollSyncWired = false;
/** Reset the scroll-sync guard so _wireScrollSync can re-attach on the next split-mode entry.
 *  Must be called from teardownRealtimeSession so the guard doesn't persist across rooms. */
export function resetScrollSync() { _scrollSyncWired = false; }
function _wireScrollSync(editor, preview) {
  if (_scrollSyncWired) return;
  _scrollSyncWired = true;
  let _lock = false;
  editor.addEventListener('scroll', () => {
    if (_lock || preview.classList.contains('hidden')) return;
    _lock = true;
    const maxScroll = editor.scrollHeight - editor.clientHeight;
    const ratio = maxScroll > 0 ? editor.scrollTop / maxScroll : 0;
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
    requestAnimationFrame(() => { _lock = false; });
  });
  preview.addEventListener('scroll', () => {
    if (_lock || editor.classList.contains('hidden')) return;
    _lock = true;
    const maxScroll = preview.scrollHeight - preview.clientHeight;
    const ratio = maxScroll > 0 ? preview.scrollTop / maxScroll : 0;
    editor.scrollTop = ratio * (editor.scrollHeight - editor.clientHeight);
    requestAnimationFrame(() => { _lock = false; });
  });
}



export function refreshPreview(renderFn) {
  const preview = document.getElementById('note-preview');
  if (!preview || preview.classList.contains('hidden')) return;
  preview.innerHTML = renderFn ? renderFn() : '';
  if (renderFn) { _prismHighlight(preview); _injectTocNav(preview); _resolveFileImages(preview); }
}

/** Call Prism.js syntax highlighting if it is loaded. */
function _prismHighlight(container) {
  try {
    if (typeof Prism !== 'undefined') Prism.highlightAllUnder(container);
  } catch {}
}

// ── Slash-command quick-insert menu ────────────────────────────────────────────
//
// Popup list anchored at the caret's viewport coordinates when '/' is typed
// at the start of a line — app.js owns trigger detection, filtering, and
// keyboard navigation; this module only renders the current item list and
// positions the popup, matching the same DOM-boundary split used for the
// editor context menu and comment margin dots.

/**
 * @param {{x: number, y: number}} coords - viewport coordinates of the triggering '/'
 * @param {{id: string, label: string, hint: string}[]} items - already filtered
 * @param {number} activeIndex
 * @param {(item: object) => void} onSelect
 */
export function showSlashMenu(coords, items, activeIndex, onSelect) {
  const menu = document.getElementById('slash-menu');
  const list = document.getElementById('slash-menu-list');
  if (!menu || !list || !coords) return;

  list.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'slash-menu-empty';
    empty.textContent = 'No matches';
    list.appendChild(empty);
  } else {
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slash-menu-item' + (i === activeIndex ? ' active' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(i === activeIndex));
      btn.innerHTML = `<span class="slash-menu-item-label">${escapeHtml(item.label)}</span>` +
        (item.hint ? `<span class="slash-menu-item-hint">${escapeHtml(item.hint)}</span>` : '');
      // mousedown (not click) fires before the textarea's blur, so the
      // selection this action needs is still intact when onSelect runs.
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); onSelect?.(item); });
      list.appendChild(btn);
    });
  }

  menu.classList.add('visible');
  const rect = menu.getBoundingClientRect();
  const left = Math.min(coords.x, window.innerWidth  - rect.width  - 8);
  const top  = Math.min(coords.y + 20, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top  = `${Math.max(8, top)}px`;
}

export function hideSlashMenu() {
  document.getElementById('slash-menu')?.classList.remove('visible');
}

