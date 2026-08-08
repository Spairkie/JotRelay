// SyncPad – app/editor-behavior.js
// Everything about typing/formatting/keyboard behavior in the editor
// surfaces: the plain-textarea input pipeline, toolbar formatting, the
// selection right-click context menu, the slash quick-insert menu, paste
// sanitization, and the editor-preference toggles (monospace, strip-paste,
// smart punctuation, focus/typewriter mode, hide-presence).

import { insertTimestamp } from '../utils.js';
import { onLocalInput, onEditorBlur, flushSave } from '../sync.js';
import { setTyping, setCursorLine, destroyPresence, setPresenceHidden } from '../presence.js';
import { canEdit, canPaste, editBlockedReason } from '../permissions.js';
import { BODY_MAX } from '../templates.js';
import * as LiveEditor from '../live-editor.js';
import * as UI from '../ui.js';
import { copyToClipboard } from '../utils.js';
import { state, SLASH_MENU_ITEMS, _STRIP_PASTE_KEY, _SMART_PUNCT_KEY, _FOCUS_MODE_KEY, _TYPEWRITER_MODE_KEY, _HIDE_PRESENCE_KEY, _SYNC_SCROLL_KEY, _CODE_LINE_NUMBERS_KEY } from './state.js';
import { _currentSelectionRange, _openFloatingCommentComposer, _refreshFloatingComments, _updateScrollSyncWiring } from './comments-preview.js';
import { _refreshPreviewIfActive, _debouncedRefreshPreview, _debouncedRefreshFloatingComments } from './comments-preview.js';
import { _uploadAndInsertImages } from './files-panel.js';
import { _openTemplatesModalFresh } from './panels.js';

// Custom templates are already capped at BODY_MAX (templates.js), but nothing
// stopped the editor itself from exceeding it — via typing past it, a native
// paste, a large text-file import, or a template insert/append onto already-
// substantial content. Enforced here, at the single 'input' listener every
// one of those paths dispatches through (typing, paste, and every
// programmatic edit in this file all end with `editor.dispatchEvent(new
// Event('input'))`), rather than at each write site — one choke point that
// can't be missed by a future write path, instead of a growing list of call
// sites that each have to remember to opt in.
export function _enforceBodyMax() {
  if (!UI.clampEditorValue(BODY_MAX)) return false;
  UI.showToast(`Content trimmed to the ${BODY_MAX.toLocaleString()}-character limit.`, 'warning', 5000);
  return true;
}

export function _wireEditorCore() {
  const editor = document.getElementById('note-editor');

  editor?.addEventListener('input', () => {
    if (!canEdit()) return;
    _enforceBodyMax();
    onLocalInput(); // returns a Promise — intentional fire-and-forget
    setTyping(true);
    UI.updateWordCount(UI.getEditorValue());
    UI.refreshFocusMode(); // no-op unless focus mode is on
    UI.refreshTypewriterMode(); // no-op unless typewriter mode is on
    // Mirror into the live-preview surface (no-op when unmounted, and when
    // the change originated there the text is identical so nothing happens).
    LiveEditor.syncFromText(UI.getEditorValue());
    // Debounced so large documents don't re-render markdown on every keystroke.
    _debouncedRefreshPreview();
    _debouncedRefreshFloatingComments();
    _updateSlashMenu();
  });
  editor?.addEventListener('blur', () => { onEditorBlur(); _closeSlashMenu(); });

  // ── Smart editor keyboard behaviour ────────────────────────────────────────
  editor?.addEventListener('keydown', (e) => {
    if (_handleSlashMenuKeydown(e)) return;
    if (!canEdit() || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;

    // Tab / Shift+Tab — indent/dedent only when there is a multi-character selection
    // OR the cursor is at the start of a line with content (i.e. indenting makes sense).
    // For a plain Tab on an empty/cursor-only position outside a list, fall through so
    // the browser can move focus to the next element (keyboard accessibility).
    if (e.key === 'Tab') {
      const val   = editor.value;
      const start = editor.selectionStart;
      const end   = editor.selectionEnd;
      const hasSelection = start !== end;
      // Determine if the cursor line has non-whitespace content or is part of a list
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const lineText  = val.slice(lineStart, start + (end - start));
      const inList    = /^\s*[-*+]|\s*\d+\./.test(lineText);

      // Only intercept Tab if: there's a multi-char selection to indent, OR cursor is in a list.
      // Otherwise let Tab propagate so keyboard focus moves naturally.
      if (!hasSelection && !inList) return;

      e.preventDefault();
      if (hasSelection) {
        // Multi-line selection: indent or dedent each line
        const lStart = val.lastIndexOf('\n', start - 1) + 1;
        const lEnd   = (() => { const n = val.indexOf('\n', end - 1); return n === -1 ? val.length : n; })();
        const block  = val.slice(lStart, lEnd);
        const newBlock = e.shiftKey
          ? block.split('\n').map((l) => l.startsWith('  ') ? l.slice(2) : l.startsWith(' ') ? l.slice(1) : l).join('\n')
          : block.split('\n').map((l) => '  ' + l).join('\n');
        UI.replaceEditorRange(lStart, lEnd, newBlock, lStart, lStart + newBlock.length);
      } else {
        // In a list: insert 2 spaces at caret
        UI.replaceEditorRange(start, end, '  ');
      }
      return;
    }

    // Enter — auto-continue list items
    if (e.key === 'Enter') {
      const val = editor.value;
      const pos = editor.selectionStart;
      if (editor.selectionStart !== editor.selectionEnd) return; // has selection
      const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
      const lineText  = val.slice(lineStart, pos);

      const ulMatch = lineText.match(/^([ \t]*)([-*+]) /);
      const olMatch = lineText.match(/^([ \t]*)(\d+)\. /);
      const match   = ulMatch || olMatch;
      if (!match) return;

      const content = lineText.slice(match[0].length);
      e.preventDefault();
      if (!content.trim()) {
        // Empty item — break out of the list
        UI.replaceEditorRange(lineStart, pos, '\n', lineStart + 1);
      } else {
        // Continue the list with the next item
        const nextPrefix = olMatch
          ? `${olMatch[1]}${parseInt(olMatch[2], 10) + 1}. `
          : `${match[1]}${match[2]} `;
        UI.replaceEditorRange(pos, editor.selectionEnd, '\n' + nextPrefix);
      }
      return;
    }

    // Smart punctuation (opt-in, off by default) — curly quotes, en/em
    // dashes, and an ellipsis character, converted as you type. Checked
    // before plain auto-pair below so a "smart" double quote wins over the
    // straight-quote pairing when the preference is on.
    if (state.smartPunct) {
      const start = editor.selectionStart;
      const end   = editor.selectionEnd;
      const OPENING_CONTEXT = /[\s([{‘“]/; // whitespace, start of doc, or another opening bracket/quote

      if (e.key === '"' && start === end) {
        e.preventDefault();
        // Close/skip over a quote (either style) already sitting at the cursor.
        if (editor.value[start] === '”' || editor.value[start] === '"') {
          UI.setEditorSelection(start + 1);
          return;
        }
        const before = editor.value[start - 1];
        const opening = before === undefined || OPENING_CONTEXT.test(before);
        const insert = opening ? '“”' : '”';
        UI.replaceEditorRange(start, start, insert, start + 1); // right after the opening quote either way
        return;
      }

      if (e.key === "'" && start === end) {
        // No pairing for the single quote — it's an apostrophe far more
        // often than it's a quotation mark (don't, it's, '90s), so only its
        // direction (opening ' vs. closing/apostrophe ') is decided here.
        e.preventDefault();
        const before = editor.value[start - 1];
        const opening = before === undefined || OPENING_CONTEXT.test(before);
        UI.replaceEditorRange(start, start, opening ? '‘' : '’');
        return;
      }

      if (e.key === '-' && start === end) {
        const prev = editor.value[start - 1];
        if (prev === '–' || prev === '-') {
          e.preventDefault();
          UI.replaceEditorRange(start - 1, start, prev === '-' ? '–' : '—');
          return;
        }
        // A single hyphen with nothing to combine with — let it type normally.
      }

      if (e.key === '.' && start === end && editor.value.slice(start - 2, start) === '..') {
        e.preventDefault();
        UI.replaceEditorRange(start - 2, start, '…');
        return;
      }
    }

    // Auto-pair ( [ ` " — the unambiguous set only. Markdown's *, _ are
    // deliberately excluded: they're used both singly (italic) and doubled
    // (bold), so "does typing * open or close a pair" has no single correct
    // answer the way it does for parens/brackets/backtick/quote.
    const AUTOPAIR_OPEN_TO_CLOSE = { '(': ')', '[': ']', '`': '`', '"': '"' };
    if (Object.prototype.hasOwnProperty.call(AUTOPAIR_OPEN_TO_CLOSE, e.key)) {
      const start = editor.selectionStart;
      const end   = editor.selectionEnd;
      const closeChar = AUTOPAIR_OPEN_TO_CLOSE[e.key];

      if (start !== end) {
        // Wrap the selection instead of replacing it, and keep the original
        // text selected — matches the toolbar's bold/italic/link wrapping.
        e.preventDefault();
        const selected = editor.value.slice(start, end);
        UI.replaceEditorRange(start, end, e.key + selected + closeChar, start + 1, start + 1 + selected.length);
        return;
      }

      // ` and " are symmetric — the same character both opens and closes a
      // pair. Typing one immediately before its own kind already sitting at
      // the cursor means "close/skip over", not "open a new nested pair".
      if ((e.key === '`' || e.key === '"') && editor.value[start] === e.key) {
        e.preventDefault();
        UI.setEditorSelection(start + 1);
        return;
      }

      e.preventDefault();
      UI.replaceEditorRange(start, start, e.key + closeChar, start + 1);
      return;
    }

    // ) and ] are only ever closers — skip over one already at the cursor
    // rather than typing a second, redundant one right next to it.
    if ((e.key === ')' || e.key === ']') && editor.selectionStart === editor.selectionEnd && editor.value[editor.selectionStart] === e.key) {
      e.preventDefault();
      UI.setEditorSelection(editor.selectionStart + 1);
      return;
    }

    // Backspace right in the middle of an empty auto-inserted pair (e.g. the
    // cursor sitting between "(" and ")" with nothing typed in between yet)
    // removes both characters, not just the opener — otherwise every
    // auto-paired closer left behind has to be deleted separately by hand.
    if (e.key === 'Backspace' && editor.selectionStart === editor.selectionEnd && editor.selectionStart > 0) {
      const pos  = editor.selectionStart;
      const prev = editor.value[pos - 1];
      const next = editor.value[pos];
      if (AUTOPAIR_OPEN_TO_CLOSE[prev] === next) {
        e.preventDefault();
        UI.replaceEditorRange(pos - 1, pos + 1, '', pos - 1);
        return;
      }
    }
  });

}

export function _wireEditorToolbarAndLifecycle() {
  const editor = document.getElementById('note-editor');

  // ── Markdown toolbar ────────────────────────────────────────────────────────
  document.getElementById('md-toolbar')?.addEventListener('mousedown', (e) => {
    // mousedown (not click) so we can preventDefault before the editor loses focus
    const btn = e.target.closest('[data-md-action]');
    if (!btn) return;
    e.preventDefault(); // keep editor focus
    _applyFormatToActiveSurface(btn.dataset.mdAction);
  });

  // Broadcast cursor line on selection/click (throttled in presence.js at 800ms).
  // selectionEnd is reported as the "head" (matches CM6's convention, and is
  // where the caret itself renders for a forward selection) with
  // selectionStart as the anchor — so a Write-mode user's selected range
  // shows up as a highlighted span for collaborators viewing in Preview/Split,
  // not just a caret.
  const _broadcastCursor = () => {
    if (!editor) return;
    const pos    = editor.selectionEnd;
    const before = editor.value.substring(0, pos);
    const line   = (before.match(/\n/g) || []).length + 1;
    setCursorLine(line, pos, editor.selectionStart);
    UI.refreshFocusMode(); // no-op unless focus mode is on
    UI.refreshTypewriterMode(); // no-op unless typewriter mode is on
  };
  editor?.addEventListener('keyup',    _broadcastCursor);
  editor?.addEventListener('mouseup',  _broadcastCursor);
  editor?.addEventListener('touchend', _broadcastCursor);

  // Focus mode's dimmed band tracks the caret's pixel position, which shifts
  // under scrolling (same line, different viewport offset) and under
  // resizing (text re-wraps at a different width, changing the caret's line).
  // Typewriter mode only re-centers on resize, not on scroll — re-centering
  // on every scroll event would fight the user's own manual scrolling.
  editor?.addEventListener('scroll', () => { UI.refreshFocusMode(); _refreshFloatingComments(); });
  window.addEventListener('resize', () => {
    UI.refreshFocusMode();
    UI.refreshTypewriterMode();
    _refreshFloatingComments();
  });

  // Block paste keystrokes when the editor is locked. The textarea readonly
  // attribute does the heavy lifting; this is belt-and-suspenders.
  editor?.addEventListener('paste', (e) => {
    if (!canPaste()) { e.preventDefault(); return; }
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (!imageFiles.length) return;
    e.preventDefault();
    // Stop the paste-sanitization listener below from also handling this
    // event — clipboard image paste carries no meaningful text/plain to strip.
    e.stopImmediatePropagation();
    _uploadAndInsertImages(imageFiles);
  });
  editor?.addEventListener('dragover', (e) => {
    if (!canEdit()) return;
    if (Array.from(e.dataTransfer?.items || []).some((it) => it.kind === 'file')) e.preventDefault();
  });
  editor?.addEventListener('drop', (e) => {
    if (!canEdit()) { e.preventDefault(); return; }
    const imageFiles = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
    if (!imageFiles.length) return;
    e.preventDefault();
    // #note-editor is a descendant of .editor-area, so this drop also
    // bubbles up to .editor-area's own generic drop handler (ui/editor.js's
    // setFileHandlers) — mark which files this handler already claimed so
    // that one can skip them (avoiding the double-upload this used to cause)
    // while still uploading any *other*, non-image files from the same
    // mixed drop (e.g. an image dropped together with a PDF) — deliberately
    // not stopPropagation()'d, which would've silently discarded those too.
    e._syncpadHandledFiles = new Set(imageFiles);
    _uploadAndInsertImages(imageFiles);
  });

  // beforeunload does NOT reliably fire for every real tab-close — mobile
  // Safari/iOS (including this app's own installed-PWA path, see
  // _isStandalonePwa()) is well documented to skip or delay it when a tab is
  // closed/backgrounded rather than navigated. When that happens, this
  // device's presence row is only cleared server-side once its WebSocket
  // eventually times out — until then it keeps counting as "connected",
  // which is the most direct way the device count drifts from reality.
  // pagehide is the modern, more-reliably-fired sibling event (also covers
  // the bfcache-navigation case beforeunload can miss); registering the same
  // cleanup on both costs nothing extra since destroyPresence() is a no-op
  // once _ch is already null; whichever fires first wins.
  const _cleanupOnLeave = () => {
    // setTyping(false) clears the isTyping flag in Supabase Presence so other
    // devices don't see a ghost "typing" indicator after this tab closes.
    // visibilitychange handles tab-hide; these handle close/navigate.
    setTyping(false);
    flushSave();
    destroyPresence();
  };
  window.addEventListener('beforeunload', _cleanupOnLeave);
  window.addEventListener('pagehide', _cleanupOnLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushSave();
      setTyping(false);
      setCursorLine(null);
    }
  });

}

// ── Editor selection context menu ───────────────────────────────────────────
// Right-click anywhere in either editor surface (Source textarea or
// Live/Split's CM6 pane) for clipboard, selection, and comment actions —
// modeled on the right-click menu in Typora/Obsidian: always available (not
// just with an active selection), with items that don't apply to the
// current state or permission level hidden rather than shown disabled.
// Shift+right-click bypasses this entirely for the browser's native menu
// (spell-check suggestions, "Inspect", etc.) — the same escape hatch
// Gmail/Docs/Notion use. Formatting actions (bold/italic/etc.) are
// deliberately not duplicated here — they're already one click away on the
// always-visible toolbar (see _applyFormatToActiveSurface).
//
// Touch long-press does NOT open this menu (see the pointerType check in
// _wireEditorContextMenu below) — it defers entirely to the OS's own
// text-selection UI (selection handles, the native Copy/Select All/Share
// callout), which is a strictly better "native" experience on a touchscreen
// than reproducing a desktop menu's small hit targets would be.

export function _closeEditorContextMenu() {
  document.getElementById('editor-context-menu')?.classList.remove('visible');
}

function _openEditorContextMenu(x, y) {
  const menu = document.getElementById('editor-context-menu');
  if (!menu) return;
  menu.classList.add('visible');
  // Clamp so a right-click near the viewport edge doesn't render off-screen.
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth  - rect.width  - 8);
  const top  = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top  = `${Math.max(8, top)}px`;
}

/**
 * Show/hide each menu item for the current permission level and whether a
 * selection is active, then collapse any separator left with nothing
 * visible on one side of it (e.g. every mutating item hidden for a
 * read-only viewer shouldn't leave a dangling divider line).
 */
function _updateContextMenuAvailability(hasSelection) {
  const menu = document.getElementById('editor-context-menu');
  if (!menu) return;
  const editable = canEdit();
  // The plain rendered #note-preview fallback (live editor not mounted) is a
  // read-only rendered view with no real cursor/source-offset concept — Cut/
  // Paste/Delete/Add comment all assume one, so they only make sense on the
  // Write textarea or the CM6 Live/Split surface.
  const usingRenderedFallback = state.markdownMode !== 'write' && !LiveEditor.isMounted();
  const setVisible = (action, visible) => {
    menu.querySelector(`[data-ctx-action="${action}"]`)?.classList.toggle('hidden', !visible);
  };

  setVisible('cut',        editable && hasSelection && !usingRenderedFallback);
  setVisible('copy',       hasSelection);
  setVisible('paste',      editable && !usingRenderedFallback);
  setVisible('select-all', true);
  setVisible('delete',     editable && hasSelection && !usingRenderedFallback);
  setVisible('comment',    editable && hasSelection && !usingRenderedFallback);

  const isVisibleItem = (el) => el.classList.contains('editor-context-item') && !el.classList.contains('hidden');
  const children = Array.from(menu.children);
  children.forEach((el, i) => {
    if (!el.classList.contains('editor-context-sep')) return;
    const hasBefore = children.slice(0, i).some(isVisibleItem);
    const hasAfter  = children.slice(i + 1).some(isVisibleItem);
    el.classList.toggle('hidden', !(hasBefore && hasAfter));
  });
}

// Which pointer type most recently went down inside the editor — a
// `contextmenu` event is a plain MouseEvent with no pointerType of its own,
// so this is the only way to tell "long-press on a touchscreen" apart from
// "actual mouse right-click" when the handler below fires. Tracked at
// module scope (not per-listener state) since pointerdown and contextmenu
// are two separate listeners that need to agree on the same value.
let _lastPointerType = 'mouse';

export function _wireEditorContextMenu() {
  const menu = document.getElementById('editor-context-menu');
  const wrap = document.querySelector('.editor-wrap');
  if (!menu || !wrap) return;

  wrap.addEventListener('pointerdown', (e) => { _lastPointerType = e.pointerType || 'mouse'; }, { capture: true });

  wrap.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return; // Shift+right-click → native browser menu
    // A touchscreen long-press must not hijack the OS's own text-selection
    // UI (selection handles, the native Copy/Select All/Share callout) —
    // that's the actual "native copy/paste" experience on mobile, and it's
    // a strictly better one than this menu's small, mouse-sized hit targets
    // reproduce. Every action this menu offers already has a touch-friendly
    // equivalent elsewhere: Cut/Copy/Paste/Select All are the native gesture
    // itself, formatting lives on the always-visible toolbar, and Comment
    // has its own floating button (#btn-add-comment-fab) — so deferring to
    // the browser here on touch loses nothing.
    if (_lastPointerType === 'touch' || _lastPointerType === 'pen') return;
    e.preventDefault();
    _updateContextMenuAvailability(_ctxHasSelection());
    _openEditorContextMenu(e.clientX, e.clientY);
  });

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ctx-action]');
    if (!btn || btn.classList.contains('hidden')) return;
    const action = btn.dataset.ctxAction;
    _closeEditorContextMenu();
    _runContextMenuAction(action);
  });

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) _closeEditorContextMenu();
  });
  document.addEventListener('scroll', _closeEditorContextMenu, true);
  window.addEventListener('resize', _closeEditorContextMenu);
}

function _runContextMenuAction(action) {
  switch (action) {
    case 'comment':    _openFloatingCommentComposer(); return;
    case 'cut':        _ctxCut(); return;
    case 'copy':       _ctxCopy(); return;
    case 'paste':      _ctxPaste(); return;
    case 'delete':     _ctxDelete(); return;
    case 'select-all': _ctxSelectAll(); return;
  }
}

/**
 * Whether there's an active selection worth acting on, reading from whichever
 * surface is actually visible — the rendered #note-preview fallback has its
 * own independent window.getSelection(), which _currentSelectionRange()
 * (source-offset-based, for Write/CM6) doesn't know about at all.
 */
function _ctxHasSelection() {
  if (state.markdownMode !== 'write' && !LiveEditor.isMounted()) {
    return !!window.getSelection()?.toString();
  }
  const range = _currentSelectionRange();
  return !!range && range.to > range.from;
}

/** The current selection range, or a collapsed range at the end of the note if none. */
function _ctxRangeOrEnd() {
  const range = _currentSelectionRange();
  if (range && Number.isFinite(range.from) && Number.isFinite(range.to)) return range;
  const len = UI.getEditorValue().length;
  return { from: len, to: len };
}

// A single Copy that adapts to whichever surface the selection actually
// lives in, rather than a second "Copy as plain text" action: Write mode
// and the CM6 Live/Split surface both mirror the same underlying markdown
// source, so copying a slice of UI.getEditorValue() is correct there — but
// the plain rendered #note-preview fallback (shown when the live editor
// isn't mounted) is real rendered HTML with its own independent selection,
// and reading raw source offsets for it would copy the wrong text entirely.
// window.getSelection().toString() there is already plain reading text by
// construction, which is exactly what a separate "plain text" action used
// to provide.
async function _ctxCopy() {
  const usingRenderedFallback = state.markdownMode !== 'write' && !LiveEditor.isMounted();
  let text;
  if (usingRenderedFallback) {
    text = window.getSelection()?.toString() || '';
  } else {
    const { from, to } = _ctxRangeOrEnd();
    text = UI.getEditorValue().slice(from, to);
  }
  if (!text) return;
  const ok = await copyToClipboard(text);
  UI.showToast(ok ? 'Copied.' : 'Could not copy — your browser may be blocking clipboard access.', ok ? 'success' : 'error');
}

async function _ctxCut() {
  if (!canEdit()) return;
  const { from, to } = _ctxRangeOrEnd();
  if (to <= from) return;
  const text = UI.getEditorValue().slice(from, to);
  const ok = await copyToClipboard(text);
  UI.replaceEditorRange(from, to, '', from, from);
  if (!ok) UI.showToast('Removed, but could not copy to clipboard.', 'warning');
}

function _ctxDelete() {
  if (!canEdit()) return;
  const { from, to } = _ctxRangeOrEnd();
  if (to <= from) return;
  UI.replaceEditorRange(from, to, '', from, from);
}

async function _ctxPaste() {
  if (!canEdit()) return;
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    UI.showToast('Could not read clipboard — use Ctrl/Cmd+V instead.', 'error');
    return;
  }
  if (!text) return;
  const { from, to } = _ctxRangeOrEnd();
  const caret = from + text.length;
  UI.replaceEditorRange(from, to, text, caret, caret);
}

function _ctxSelectAll() {
  const len = UI.getEditorValue().length;
  const useLive = LiveEditor.isMounted() && (state.markdownMode === 'preview' || LiveEditor.hasFocus());
  if (useLive) {
    LiveEditor.focus();
    LiveEditor.setSelection(0, len);
  } else {
    UI.focusEditor();
    UI.setEditorSelection(0, len);
  }
}

// Dismiss the slash menu on an outside click (e.g. clicking elsewhere in the
// editor to move the caret away from the trigger) or window resize.
// Deliberately NOT closed on scroll like the context menu above — the
// textarea auto-scrolling to keep the caret visible while its query is
// typed would otherwise close the menu mid-use.
export function _wireSlashMenuDismissal() {
  const menu = document.getElementById('slash-menu');
  if (!menu) return;
  document.addEventListener('click', (e) => {
    if (state.slashOpen && !menu.contains(e.target)) _closeSlashMenu();
  });
  window.addEventListener('resize', _closeSlashMenu);
}

export function _wirePasteSanitization() {
  const editor = document.getElementById('note-editor');

  // ── Paste sanitization ─────────────────────────────────────────────────────
  // Strip HTML/RTF formatting on paste when the user preference is enabled.
  // We intercept the paste event on the editor and substitute plain-text only.
  editor?.addEventListener('paste', (e) => {
    if (!state.stripPaste) return;
    // Must not mutate the editor when editing is blocked (read-only, locked,
    // encrypted without a key) — the other paste listener above only calls
    // preventDefault() for the native paste, which does not stop this
    // separate listener on the same event from still running.
    if (!canPaste()) return;
    const plain = e.clipboardData?.getData('text/plain');
    if (plain === undefined) return;
    e.preventDefault();
    UI.replaceEditorRange(editor.selectionStart, editor.selectionEnd, plain);
  });

}

// Shared implementation for the Settings panel's simple boolean
// editor-preference toggles (strip-paste, smart-punct, focus/typewriter
// mode, hide-presence, sync-scroll, code-line-numbers): flip state[stateKey],
// persist it to localStorage, run any side effect, reflect the button's
// text/aria-pressed, and toast. Previously each toggle duplicated this same
// ~12-line read/click/persist/reflect/toast pattern with only the state key,
// storage key, toast copy, and optional side effect actually differing.
// Monospace keeps its own _toggleMonospace()/_syncMonospaceSettingUI() pair
// below since it's also triggered by the Ctrl/Cmd+Shift+M shortcut, not
// just this button, and needs its update function callable from there too.
function _wireBoolToggle({ btnId, stateKey, storageKey, onLabel, offLabel, onToggle }) {
  const btn = document.getElementById(btnId);
  const update = () => {
    if (!btn) return;
    btn.textContent = state[stateKey] ? 'On' : 'Off';
    btn.setAttribute('aria-pressed', String(state[stateKey]));
  };
  update();
  btn?.addEventListener('click', () => {
    state[stateKey] = !state[stateKey];
    try { localStorage.setItem(storageKey, String(state[stateKey])); } catch {}
    onToggle?.(state[stateKey]);
    update();
    UI.showToast(state[stateKey] ? onLabel : offLabel, 'info', 2000);
  });
}

export function _wireEditorPreferenceToggles() {
  // ── Monospace setting button (Settings panel) ──────────────────────────────
  _syncMonospaceSettingUI();

  document.getElementById('setting-monospace-btn')?.addEventListener('click', () => {
    _toggleMonospace();
  });

  _wireBoolToggle({
    btnId: 'setting-strip-paste-btn', stateKey: 'stripPaste', storageKey: _STRIP_PASTE_KEY,
    onLabel: 'Paste formatting strip: On', offLabel: 'Paste formatting strip: Off',
  });

  _wireBoolToggle({
    btnId: 'setting-smart-punct-btn', stateKey: 'smartPunct', storageKey: _SMART_PUNCT_KEY,
    onLabel: 'Smart punctuation: On', offLabel: 'Smart punctuation: Off',
  });

  _wireBoolToggle({
    btnId: 'setting-focus-mode-btn', stateKey: 'focusMode', storageKey: _FOCUS_MODE_KEY,
    onLabel: 'Focus mode: On', offLabel: 'Focus mode: Off',
    onToggle: (v) => UI.setFocusMode(v),
  });

  _wireBoolToggle({
    btnId: 'setting-typewriter-mode-btn', stateKey: 'typewriterMode', storageKey: _TYPEWRITER_MODE_KEY,
    onLabel: 'Typewriter mode: On', offLabel: 'Typewriter mode: Off',
    onToggle: (v) => UI.setTypewriterMode(v),
  });

  _wireBoolToggle({
    btnId: 'setting-hide-presence-btn', stateKey: 'hidePresence', storageKey: _HIDE_PRESENCE_KEY,
    onLabel: 'Cursor & typing hidden from others', offLabel: 'Cursor & typing visible to others',
    onToggle: (v) => setPresenceHidden(v),
  });

  _wireBoolToggle({
    btnId: 'setting-sync-scroll-btn', stateKey: 'syncScroll', storageKey: _SYNC_SCROLL_KEY,
    onLabel: 'Sync scroll: On', offLabel: 'Sync scroll: Off',
    onToggle: (v) => { _updateScrollSyncWiring(); UI.setSplitScrollSync(v); },
  });

  _wireBoolToggle({
    btnId: 'setting-code-line-numbers-btn', stateKey: 'codeLineNumbers', storageKey: _CODE_LINE_NUMBERS_KEY,
    onLabel: 'Code line numbers: On', offLabel: 'Code line numbers: Off',
    onToggle: (v) => UI.setCodeLineNumbers(v),
  });

  // These are simple on/off flips, not navigations — clicking one shouldn't
  // steal focus (and with it the caret position/selection) from the editor.
  // preventDefault on mousedown stops the browser's default click-to-focus
  // behavior for pointer users while leaving keyboard activation (Tab +
  // Enter/Space, which never fires mousedown) untouched.
  ['setting-monospace-btn', 'setting-strip-paste-btn', 'setting-smart-punct-btn',
   'setting-focus-mode-btn', 'setting-typewriter-mode-btn', 'setting-hide-presence-btn', 'setting-sync-scroll-btn',
   'setting-code-line-numbers-btn']
    .forEach((id) => document.getElementById(id)?.addEventListener('mousedown', (e) => e.preventDefault()));
}

// ── Editor preference helpers ─────────────────────────────────────────────────
// The single toggle implementation for both the Settings panel button and the
// Ctrl/Cmd+Shift+M keyboard shortcut — previously duplicated between the two,
// which meant the settings button never reflected a shortcut-triggered toggle
// (visibly stale until the panel was closed and reopened) and the two paths
// could silently drift (e.g. a different toast type/duration each).
export function _toggleMonospace() {
  state.monospace = !state.monospace;
  UI.setMonospace(state.monospace);
  try { localStorage.setItem('syncpad_monospace', state.monospace ? '1' : '0'); } catch {}
  UI.showToast(state.monospace ? 'Monospace on.' : 'Monospace off.', 'info', 1800);
  _syncMonospaceSettingUI();
}

function _syncMonospaceSettingUI() {
  const btn = document.getElementById('setting-monospace-btn');
  if (!btn) return;
  btn.textContent = state.monospace ? 'On' : 'Off';
  btn.setAttribute('aria-pressed', String(state.monospace));
}

// ── Markdown format helpers ───────────────────────────────────────────────────

/**
 * Insert `text` at the caret of whichever surface is actually active —
 * the CM6 live proxy in Preview mode (or Split, when the live pane has
 * focus), the plain textarea otherwise. Mirrors UI.insertAtCursor()'s
 * behaviour, which only ever touches the (possibly hidden) textarea and
 * silently no-ops visually when Preview mode has it hidden. Shared by
 * every "insert this at my cursor" action: timestamp insert, template
 * insert, and pasted/dropped-image insert.
 */
export function _insertTextAtActiveCursor(text) {
  const useLive = LiveEditor.isMounted() && (state.markdownMode === 'preview' || LiveEditor.hasFocus());
  if (useLive) {
    const proxy = LiveEditor.asEditorProxy();
    if (proxy == null) return;
    const start = proxy.selectionStart ?? proxy.value.length;
    const end   = proxy.selectionEnd   ?? start;
    proxy.value = proxy.value.slice(0, start) + text + proxy.value.slice(end);
    proxy.selectionStart = proxy.selectionEnd = start + text.length;
    proxy.dispatchEvent();
  } else {
    UI.insertAtCursor(text);
  }
}

/**
 * Focus whichever editing surface is actually visible/relevant right now —
 * the CM6 live surface in Preview mode (the plain textarea is hidden there
 * and focusing it is a no-op the user can't see), the plain textarea
 * otherwise. Shared by any call site that used to blindly call
 * `editor.focus()` regardless of markdown mode.
 */
export function _focusActiveEditorSurface() {
  if (state.markdownMode === 'preview' && LiveEditor.isMounted()) {
    LiveEditor.focus();
  } else {
    document.getElementById('note-editor')?.focus();
  }
}

/**
 * Resolve which surface (plain textarea or CM6 live proxy) a formatting
 * action should target, then apply it — shared by the toolbar and the
 * selection context menu so both act on "whichever pane you're actually
 * looking at/selected text in" identically.
 */
export function _applyFormatToActiveSurface(action) {
  if (!canEdit()) return;
  const editor = document.getElementById('note-editor');
  // Preview mode: the textarea is hidden, so the live surface is the only
  // real target. Split mode: act on whichever pane currently has focus,
  // textarea by default (matches the toolbar's pre-live-surface behaviour).
  const useLive = LiveEditor.isMounted() && (state.markdownMode === 'preview' || LiveEditor.hasFocus());
  if (useLive) {
    _applyMarkdownFormat(action, LiveEditor.asEditorProxy());
  } else if (editor) {
    _applyMarkdownFormat(action, editor);
  }
}

/**
 * Apply a formatting action to the editor textarea.
 * Called by the toolbar (mousedown) and can be reused by other code.
 * @param {string} action  – matches data-md-action attribute
 * @param {HTMLTextAreaElement} editor
 */
export function _applyMarkdownFormat(action, editor) {
  if (!editor) return;
  const val   = editor.value;
  const start = editor.selectionStart;
  const end   = editor.selectionEnd;
  const sel   = val.slice(start, end);

  // Wrap selection (or "text" placeholder) with prefix/suffix markers.
  // Toggles off if already wrapped.
  const wrapSel = (prefix, suffix = prefix) => {
    // Unwrap only when there is at least one inner character (length strictly greater
    // than prefix+suffix combined) so selecting exactly '``' or '**' doesn't delete content.
    if (sel.startsWith(prefix) && sel.endsWith(suffix) && sel.length > prefix.length + suffix.length) {
      const inner = sel.slice(prefix.length, sel.length - suffix.length);
      UI.replaceEditorRange(start, end, inner, start, start + inner.length);
    } else {
      const inner = sel || 'text';
      UI.replaceEditorRange(start, end, prefix + inner + suffix, start + prefix.length, start + prefix.length + inner.length);
    }
  };

  // Toggle a line-level prefix on every line touched by the selection.
  const toggleLinePrefix = (prefix) => {
    const lStart = val.lastIndexOf('\n', start - 1) + 1;
    const eolPos = end > start ? end - 1 : end;
    const lEnd   = (() => { const n = val.indexOf('\n', eolPos); return n === -1 ? val.length : n; })();
    const block  = val.slice(lStart, lEnd);
    const lines2 = block.split('\n');
    const allHave = lines2.every((l) => l.startsWith(prefix));
    const newBlock = allHave
      ? lines2.map((l) => l.slice(prefix.length)).join('\n')
      : lines2.map((l) => prefix + l).join('\n');
    UI.replaceEditorRange(lStart, lEnd, newBlock, lStart, lStart + newBlock.length);
  };

  // Toggle an ATX heading on the current line (strips any existing # prefix first).
  const toggleHeading = (level) => {
    const prefix = '#'.repeat(level) + ' ';
    const lStart = val.lastIndexOf('\n', start - 1) + 1;
    const lEnd   = (() => { const n = val.indexOf('\n', start); return n === -1 ? val.length : n; })();
    const line   = val.slice(lStart, lEnd);
    const stripped = line.replace(/^#{1,6} /, '');
    const newLine  = line.startsWith(prefix) ? stripped : prefix + stripped;
    UI.replaceEditorRange(lStart, lEnd, newLine, lStart, lStart + newLine.length);
  };

  switch (action) {
    case 'bold':          wrapSel('**', '**'); break;
    case 'italic':        wrapSel('_',  '_');  break;
    case 'strikethrough': wrapSel('~~', '~~'); break;
    case 'highlight':     wrapSel('==', '=='); break;
    case 'code':          wrapSel('`',  '`');  break;
    case 'h1':            toggleHeading(1);    break;
    case 'h2':            toggleHeading(2);    break;
    case 'h3':            toggleHeading(3);    break;
    case 'quote':         toggleLinePrefix('> '); break;
    case 'ul':            toggleLinePrefix('- '); break;
    case 'ol':            toggleLinePrefix('1. '); break;
    case 'checklist':     toggleLinePrefix('- [ ] '); break;
    case 'link': {
      const insert = sel ? `[${sel}](url)` : '[link text](url)';
      const urlStart = start + insert.indexOf('url');
      UI.replaceEditorRange(start, end, insert, urlStart, urlStart + 3);
      break;
    }
    case 'codeblock': {
      const before = start > 0 && val[start - 1] !== '\n' ? '\n' : '';
      const after  = end < val.length && val[end] !== '\n' ? '\n' : '';
      const inner  = sel || 'code here';
      const insert = `${before}\`\`\`\n${inner}\n\`\`\`${after}`;
      UI.replaceEditorRange(start, end, insert, start + before.length + 4, start + before.length + 4 + inner.length);
      break;
    }
    case 'hr': {
      const before = start > 0 && val[start - 1] !== '\n' ? '\n' : '';
      UI.replaceEditorRange(start, end, `${before}---\n`);
      break;
    }
    case 'toc': {
      const before = start > 0 && val[start - 1] !== '\n' ? '\n' : '';
      const after  = end < val.length && val[end] !== '\n' ? '\n' : '';
      UI.replaceEditorRange(start, end, `${before}[TOC]\n${after}`);
      break;
    }
  }
}

/**
 * Slash-command quick-insert menu (Write mode only — a plain <textarea>
 * gives us caret pixel coordinates via UI.getCaretViewportCoords(), the same
 * measurement the floating comment composer and margin dots already rely on;
 * Live/Split would need the CM6 equivalent wired up separately, left for later).
 */
function _filterSlashItems(query) {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_MENU_ITEMS;
  return SLASH_MENU_ITEMS.filter((it) => it.keywords.includes(q) || it.label.toLowerCase().includes(q));
}

export function _closeSlashMenu() {
  if (!state.slashOpen) return;
  state.slashOpen = false;
  state.slashStart = null;
  state.slashCoords = null;
  state.slashFiltered = [];
  state.slashActiveIndex = 0;
  UI.hideSlashMenu();
}

function _renderSlashMenu() {
  UI.showSlashMenu(state.slashCoords, state.slashFiltered, state.slashActiveIndex, _selectSlashItem);
}

function _openSlashMenuAt(pos) {
  const coords = UI.getCaretViewportCoords(pos);
  if (!coords) return;
  state.slashOpen = true;
  state.slashStart = pos;
  state.slashCoords = coords;
  state.slashFiltered = SLASH_MENU_ITEMS;
  state.slashActiveIndex = 0;
  _renderSlashMenu();
}

function _selectSlashItem(item) {
  const editor = document.getElementById('note-editor');
  if (!editor || state.slashStart == null || !item) return;
  const from = state.slashStart;
  const to = editor.selectionStart;
  _closeSlashMenu();
  UI.replaceEditorRange(from, to, '');
  editor.focus();
  if (item.id === 'timestamp') UI.insertAtCursor(insertTimestamp());
  else if (item.id === 'template') _openTemplatesModalFresh();
  else _applyMarkdownFormat(item.id, editor);
}

/** Called on every editor input event; only active in Write mode. */
export function _updateSlashMenu() {
  if (state.markdownMode !== 'write') { _closeSlashMenu(); return; }
  const editor = document.getElementById('note-editor');
  if (!editor) { _closeSlashMenu(); return; }
  const pos = editor.selectionStart;
  if (pos !== editor.selectionEnd) { _closeSlashMenu(); return; }
  const val = editor.value;

  if (state.slashOpen) {
    if (pos <= state.slashStart || val[state.slashStart] !== '/') { _closeSlashMenu(); return; }
    const query = val.slice(state.slashStart + 1, pos);
    if (/\s/.test(query)) { _closeSlashMenu(); return; } // whitespace in the query ends the command
    state.slashFiltered = _filterSlashItems(query);
    state.slashActiveIndex = 0;
    _renderSlashMenu();
    return;
  }

  if (pos > 0 && val[pos - 1] === '/' && canEdit()) {
    // Only trigger at the start of a line (or start of the doc) — "and/or"
    // shouldn't pop the menu open mid-word.
    const before = pos >= 2 ? val[pos - 2] : '\n';
    if (before === '\n' || before === ' ' || before === '\t') _openSlashMenuAt(pos - 1);
  }
}

/** Handle Up/Down/Enter/Tab/Escape while the slash menu is open; returns true if the key was consumed. */
export function _handleSlashMenuKeydown(e) {
  if (!state.slashOpen) return false;
  if (e.key === 'ArrowDown') { e.preventDefault(); state.slashActiveIndex = Math.min(state.slashActiveIndex + 1, state.slashFiltered.length - 1); _renderSlashMenu(); return true; }
  if (e.key === 'ArrowUp')   { e.preventDefault(); state.slashActiveIndex = Math.max(state.slashActiveIndex - 1, 0); _renderSlashMenu(); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    const item = state.slashFiltered[state.slashActiveIndex];
    if (item) _selectSlashItem(item); else _closeSlashMenu();
    return true;
  }
  if (e.key === 'Escape') { e.preventDefault(); _closeSlashMenu(); return true; }
  return false;
}
