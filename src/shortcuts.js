// JotRelay – shortcuts.js
// Keyboard shortcut handling. All modifying shortcuts respect read-only mode.
//
// "In the editor" means either the plain Write-mode textarea OR the CM6
// live surface that Preview/Split show — see handlers.isLiveFocused below.
// Formatting actions (bold/italic/link/code) are dispatched through
// handlers.onApplyFormat rather than manipulated here directly, so they go
// through the same surface-aware logic the toolbar and context menu use
// (app.js's _applyFormatToActiveSurface) instead of a second copy of it
// hardcoded against the plain textarea.
//
// Shortcuts:
//   Ctrl/Cmd + S             Force save
//   Ctrl/Cmd + F             Find in note
//   Ctrl/Cmd + B             Bold selected text
//   Ctrl/Cmd + I             Italic selected text
//   Ctrl/Cmd + K             Insert markdown link (in the editor) / open the
//                            command palette (everywhere else)
//   Ctrl/Cmd + `             Inline code
//   Ctrl/Cmd + Shift + S     Split view
//   Ctrl/Cmd + Shift + M     Toggle monospace
//   Ctrl/Cmd + Shift + /     Add a comment at the cursor/selection
//   Ctrl/Cmd + /             Open shortcuts modal
//   Alt + Shift + P          Toggle preview
//   Alt + Shift + S          Open share modal
//   Alt + Shift + T          Insert timestamp
//   Alt + Shift + C          Copy note
//   Esc                      Close panel / modal / dropdown
//
// Why Alt+Shift for those last four: Ctrl/Cmd+Shift+<letter> collides with
// browser/OS chrome shortcuts that page JS cannot override no matter what
// preventDefault() does — Shift+T reopens the last closed tab in every major
// browser, Shift+C opens Chrome/Edge's "Inspect Element" picker, Shift+P
// opens a new Private Window in Firefox, and Shift+K opens Firefox's Web
// Console. Those four previously either silently didn't fire or fired a
// browser action instead of (or alongside) the app's. Alt+Shift+<letter> is
// not claimed by any current major browser's page-level or DevTools
// shortcuts, so it was picked as the replacement — same mnemonic letter,
// different modifier.

import { flushSave } from './sync.js';
import { canEdit }   from './permissions.js';

// Provided by app.js at init time
let _onTogglePreview  = null;
let _onToggleSplit    = null;
let _onToggleMonospace = null;
let _onOpenSearch     = null;
let _onForceClose     = null;  // Esc handler
let _onOpenShortcuts  = null;
let _onOpenShare      = null;
let _onInsertTimestamp = null;
let _onCopyNote       = null;
let _onAddComment     = null;
let _onOpenCommandPalette = null;
let _onApplyFormat    = null;  // (action: 'bold'|'italic'|'link'|'code') => void
let _isLiveFocused    = null;  // () => boolean — true when the CM6 live surface has real DOM focus

/** @type {HTMLTextAreaElement|null} */
let _editor = null;

/**
 * Register all keyboard shortcuts.
 * @param {object} handlers
 * @param {Function} handlers.onTogglePreview
 * @param {Function} handlers.onToggleSplit
 * @param {Function} handlers.onToggleMonospace
 * @param {Function} handlers.onOpenSearch
 * @param {Function} handlers.onForceClose   – called for Esc when not in editor
 * @param {Function} handlers.onOpenShortcuts
 * @param {Function} handlers.onApplyFormat  – (action) => void, surface-aware formatting
 * @param {Function} handlers.isLiveFocused  – () => boolean, is the CM6 live surface focused
 */
export function initShortcuts(handlers) {
  _onTogglePreview   = handlers.onTogglePreview;
  _onToggleSplit     = handlers.onToggleSplit;
  _onToggleMonospace = handlers.onToggleMonospace;
  _onOpenSearch      = handlers.onOpenSearch;
  _onForceClose      = handlers.onForceClose;
  _onOpenShortcuts   = handlers.onOpenShortcuts;
  _onOpenShare       = handlers.onOpenShare;
  _onInsertTimestamp = handlers.onInsertTimestamp;
  _onCopyNote        = handlers.onCopyNote;
  _onAddComment      = handlers.onAddComment;
  _onOpenCommandPalette = handlers.onOpenCommandPalette;
  _onApplyFormat     = handlers.onApplyFormat;
  _isLiveFocused     = handlers.isLiveFocused;
  _editor = document.getElementById('note-editor');

  document.addEventListener('keydown', _handleKeyDown, { capture: false });
}

export function destroyShortcuts() {
  document.removeEventListener('keydown', _handleKeyDown, { capture: false });
}

function _isMod(e) {
  return e.metaKey || e.ctrlKey;
}

function _handleKeyDown(e) {
  const mod   = _isMod(e);
  const alt   = e.altKey;
  const shift = e.shiftKey;
  const key   = e.key;
  // The plain textarea OR the CM6 live surface (Preview/Split) — whichever
  // actually has focus. Without the isLiveFocused() half of this, every
  // shortcut below would silently stop working the moment the live surface
  // (the default mode for new rooms) had focus, since document.activeElement
  // would be inside CM6's contenteditable content div, never `_editor`.
  const inEditor = document.activeElement === _editor || !!_isLiveFocused?.();
  const inTypingField = _isTypingField(document.activeElement);

  // ── Esc — close any open panel/modal/dropdown ────────────────────────────
  if (key === 'Escape') {
    _onForceClose?.();
    return; // don't preventDefault — allow browser default for inputs etc.
  }

  // ── Alt+Shift shortcuts — see the file header for why these four live on
  //    Alt+Shift instead of Ctrl/Cmd+Shift. ──────────────────────────────
  if (alt && shift && !mod) {
    if (inTypingField && !inEditor) return;
    if (key === 'P' || key === 'p') { e.preventDefault(); _onTogglePreview?.(); return; }
    if (key === 'S' || key === 's') { e.preventDefault(); _onOpenShare?.(); return; }
    if (key === 'T' || key === 't') { e.preventDefault(); if (canEdit()) _onInsertTimestamp?.(); return; }
    if (key === 'C' || key === 'c') { e.preventDefault(); _onCopyNote?.(); return; }
    return;
  }

  if (!mod) return;
  if (inTypingField && !inEditor) return;

  // ── Ctrl/Cmd shortcuts ───────────────────────────────────────────────────

  // Ctrl+S — force save. Matches both letter cases: with Caps Lock on and no
  // real Shift press, browsers report e.key as the uppercase letter, so a
  // lowercase-only check would silently stop matching (unlike the
  // Ctrl+Shift combos below, which already check both cases).
  if ((key === 's' || key === 'S') && !shift) {
    e.preventDefault();
    flushSave();
    return;
  }

  // Ctrl+/ — shortcuts modal. Must exclude Shift: some environments report
  // Shift+/ as e.key === '/' rather than the shifted '?' a US keyboard
  // layout normally produces (confirmed: Playwright's synthetic key events
  // do this) — without the guard, this unconditional match swallows every
  // Ctrl+Shift+/ press before it ever reaches the "add comment" handler
  // below, making that shortcut unreachable whenever a browser/layout goes
  // through this code path instead of the shifted '?'.
  if (key === '/' && !shift) {
    e.preventDefault();
    _onOpenShortcuts?.();
    return;
  }

  // Ctrl+F — find in note (both letter cases — see the Caps Lock note above)
  if ((key === 'f' || key === 'F') && !shift) {
    // Only intercept when editor is focused or no input is focused, to avoid
    // clobbering browser find-in-page when the user is in a settings input.
    if (inEditor || document.activeElement === document.body || document.activeElement === null) {
      e.preventDefault();
      _onOpenSearch?.();
    }
    return;
  }

  // Ctrl+K outside the editor — command palette. Inside the editor (either
  // surface), Ctrl+K stays "insert markdown link" (below) — same key,
  // contextual like Ctrl+F above, so it never fights muscle memory for
  // either use.
  if ((key === 'k' || key === 'K') && !shift && !inEditor) {
    e.preventDefault();
    _onOpenCommandPalette?.();
    return;
  }

  // ── Ctrl/Cmd+Shift combos ────────────────────────────────────────────────
  if (shift) {
    if (key === 'S' || key === 's') { e.preventDefault(); _onToggleSplit?.();     return; }
    if (key === 'M' || key === 'm') { e.preventDefault(); _onToggleMonospace?.(); return; }
    if (key === '?' || key === '/') { e.preventDefault(); _onAddComment?.(); return; }
  }

  // ── Markdown formatting (editor only, edit mode only) — routed through
  //    onApplyFormat so both surfaces (Write textarea, CM6 live) format
  //    whichever one the user is actually looking at. ─────────────────────
  if (!inEditor || !canEdit()) return;

  if ((key === 'b' || key === 'B') && !shift) { e.preventDefault(); _onApplyFormat?.('bold');   return; }
  if ((key === 'i' || key === 'I') && !shift) { e.preventDefault(); _onApplyFormat?.('italic'); return; }
  if ((key === 'k' || key === 'K') && !shift) { e.preventDefault(); _onApplyFormat?.('link');   return; }
  if (key === '`' && !shift) { e.preventDefault(); _onApplyFormat?.('code');   return; }
}

function _isTypingField(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  const nonTyping = new Set(['button', 'submit', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden', 'reset']);
  return !nonTyping.has(type);
}
