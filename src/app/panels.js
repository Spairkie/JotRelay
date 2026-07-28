// SyncPad – app/panels.js
// Side-panel content that doesn't warrant its own module: Version History,
// Templates, Save-as-template, Find & Replace, and the Settings panel
// (passcode/encryption/expiration/view-once/device-limit/lock).

import { formatTimestamp, getDeviceId, parseDuration } from '../utils.js';
import { listRevisions } from '../revisions.js';
import { decryptContent, encryptContent, looksEncrypted } from '../encryption.js';
import { loadRoom, setDeviceLimit, clearDeviceLimit } from '../rooms.js';
import {
  TEMPLATES, getTemplate, getCustomTemplates,
  saveCustomTemplate, renameCustomTemplate, deleteCustomTemplate,
  exportCustomTemplates, importCustomTemplates,
} from '../templates.js';
import {
  setPasscode, removePasscode,
  enableEncryption, disableEncryption,
  setExpiration, clearExpiration,
  enableViewOnce, disableViewOnce,
  setEditingLocked,
} from '../settings.js';
import { flushSave, setEncryption, snapshotBeforeDestructiveChange } from '../sync.js';
import { clearDraft } from '../offline.js';
import { listFiles } from '../files.js';
import { broadcastSettingsChange, cancelPendingTypingBroadcast, cancelPendingLiveContentBroadcast } from '../live-broadcast.js';
import { canEdit, canUseTemplates, canChangeSettings, canToggleLock, editBlockedReason } from '../permissions.js';
import * as LiveEditor from '../live-editor.js';
import * as UI from '../ui.js';
import { state } from './state.js';
import { _refreshPreviewIfActive, _applyMarkdownMode } from './comments-preview.js';
import { _insertTextAtActiveCursor, _focusActiveEditorSurface } from './editor-behavior.js';
import { _renderRoomHeader, _updatePermissionContext, setupExpirationTimer } from './room-lifecycle.js';

// ── Version history ───────────────────────────────────────────────────────────

export async function _openHistoryPanel() {
  UI.openPanel('history-panel');
  UI.setHistoryLoading(true);
  try {
    const revisions = await listRevisions(state.roomId);
    const withPreviews = await Promise.all(revisions.map(async (rev) => {
      let preview = rev.content || '';
      if (looksEncrypted(preview)) {
        if (!state.encKey) { preview = null; }
        else {
          try { preview = await decryptContent(preview, state.encKey); }
          catch { preview = null; }
        }
      }
      return { ...rev, _preview: preview };
    }));
    UI.renderHistoryList(withPreviews, _restoreRevision, {
      canRestore: canEdit(),
      deviceId:   getDeviceId(),
    });

    // Scrubbable time-slider: oldest → newest → "Now" (the live content),
    // reusing the same decrypted previews already computed above.
    const oldestFirst = [...withPreviews].reverse().map((rev) => ({
      label:  formatTimestamp(rev.created_at),
      text:   rev._preview,
      locked: rev._preview == null,
      rev,
    }));
    oldestFirst.push({ label: 'Now', text: UI.getEditorValue(), isNow: true });
    if (canEdit()) {
      UI.renderHistoryScrubber(oldestFirst, (entry) => _restoreRevision(entry.rev));
    } else {
      UI.renderHistoryScrubber([], null);
    }
  } catch {
    UI.showToast('Could not load version history.', 'error');
  } finally {
    UI.setHistoryLoading(false);
  }
}

async function _restoreRevision(rev) {
  if (!canEdit()) { UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning'); return; }

  const ok = await UI.showConfirm(
    `Restore the version from ${formatTimestamp(rev.created_at)}? Your current content will be saved to history first.`,
    { confirmLabel: 'Restore', danger: true }
  );
  if (!ok) return;

  let plaintext = rev.content || '';
  if (looksEncrypted(plaintext)) {
    if (!state.encKey) { UI.showToast('Cannot restore an encrypted version without the passphrase.', 'error'); return; }
    try { plaintext = await decryptContent(plaintext, state.encKey); }
    catch { UI.showToast('Could not decrypt this version.', 'error'); return; }
  }

  await snapshotBeforeDestructiveChange();

  UI.setEditorValue(plaintext);
  const editor = document.getElementById('note-editor');
  editor?.dispatchEvent(new Event('input', { bubbles: true }));
  UI.updateWordCount(UI.getEditorValue());
  _refreshPreviewIfActive();
  UI.closeAllPanels();
  UI.showToast('Version restored.', 'success');
}

// ── Templates handler ─────────────────────────────────────────────────────────

export async function _onTemplateChosen(key, mode) {
  const body = getTemplate(key);
  if (body == null) return;
  if (!canUseTemplates()) { UI.showToast(editBlockedReason() || 'Templates are disabled.', 'warning'); return; }

  const editor = document.getElementById('note-editor');

  if (mode === 'insert') {
    // Insert at the current cursor position; fall back to append if no editor focus.
    _insertTextAtActiveCursor(body);
    // The shared 'input' handler (_wireEditorCore) enforces BODY_MAX centrally.
    editor?.dispatchEvent(new Event('input', { bubbles: true }));
    UI.updateWordCount(UI.getEditorValue());
    _refreshPreviewIfActive();
    UI.showToast('Template inserted.', 'success');
    return;
  }

  const current = UI.getEditorValue();
  let next;
  if (mode === 'append') {
    next = current && body ? `${current.replace(/\s+$/, '')}\n\n${body}` : (current + body);
  } else { // 'replace'
    next = body;
  }

  // 'replace' overwrites the whole note and 'append' can meaningfully change
  // it — preserve the pre-template content in history before either happens.
  await snapshotBeforeDestructiveChange();
  UI.setEditorValue(next);
  editor?.dispatchEvent(new Event('input', { bubbles: true }));
  UI.updateWordCount(UI.getEditorValue());
  _refreshPreviewIfActive();
  UI.closeModal('templates-modal');
  UI.showToast(mode === 'append' ? 'Template appended.' : 'Template applied.', 'success');
}

export function _openTemplatesModalFresh() {
  // openTemplatesModal()'s onRename/onDelete only trigger a rerender() of
  // this same `customs` object (src/ui/feature-modals.js) — they don't
  // re-fetch it, so renameCustomTemplate()/deleteCustomTemplate() writing
  // to localStorage alone left the open modal showing the pre-rename
  // label / the "deleted" template still in the list until it was closed
  // and reopened. Mutate this object in place alongside the persisted
  // write so the very next rerender() (called right after these callbacks
  // return) reflects it immediately.
  const customs = getCustomTemplates();
  UI.openTemplatesModal(
    TEMPLATES,
    customs,
    _onTemplateChosen,
    (key) => { deleteCustomTemplate(key); delete customs[key]; },
    (key, label) => { renameCustomTemplate(key, label); if (customs[key]) customs[key].label = label; },
    {
      onExport: () => {
        const json = exportCustomTemplates();
        const blob = new Blob([json], { type: 'application/json' });
        const a    = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(blob), download: 'syncpad-templates.json',
        });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        UI.showToast('Templates exported.', 'success');
      },
      onImport: () => {
        const inp = Object.assign(document.createElement('input'), {
          type: 'file', accept: 'application/json,.json',
        });
        inp.onchange = () => {
          const f = inp.files[0]; if (!f) return;
          if (f.size > 1024 * 1024) { UI.showToast('File too large (max 1 MB for template import).', 'error'); return; }
          const r = new FileReader();
          r.onerror = () => UI.showToast('Could not read file.', 'error');
          r.onload = (e) => {
            let count;
            try { count = importCustomTemplates(String(e.target.result)); }
            catch (err) {
              if (err?.code === 'QUOTA_EXCEEDED') { UI.showToast('Browser storage is full — could not import templates.', 'error'); return; }
              UI.showToast('Import failed.', 'error'); return;
            }
            if (count < 0) { UI.showToast('Invalid file - expected a JSON object of templates.', 'error'); return; }
            UI.showToast(`Imported ${count} template${count !== 1 ? 's' : ''}.`, 'success');
            UI.closeModal('templates-modal');
            setTimeout(_openTemplatesModalFresh, 150);
          };
          r.readAsText(f);
        };
        inp.click();
      },
    }
  );
}

export function _wireSaveAsTemplate() {
  // ── Save as template ───────────────────────────────────────────────────────
  document.getElementById('btn-save-as-template')?.addEventListener('click', async () => {
    const body = UI.getEditorValue().trim();
    if (!body) { UI.showToast('The note is empty — nothing to save as a template.', 'warning'); return; }
    const label = await UI.showPrompt('Template name:', { defaultValue: 'My template', confirmLabel: 'Save' });
    if (!label?.trim()) return;
    try {
      const { truncated } = saveCustomTemplate(label.trim(), body);
      UI.showToast(
        truncated
          ? `Saved as template "${label.trim()}" (body capped at 50 KB).`
          : `Saved as template "${label.trim()}".`,
        'success',
      );
      if (document.getElementById('templates-modal')?.classList.contains('visible')) {
        UI.closeModal('templates-modal');
        setTimeout(_openTemplatesModalFresh, 150);
      }
    } catch (err) {
      if (err?.code === 'QUOTA_EXCEEDED') { UI.showToast('Browser storage is full — template could not be saved.', 'error'); return; }
      UI.showToast('Could not save template.', 'error');
    }
  });

}

// ── Find & Replace panel ───────────────────────────────────────────────────────

export function _wireFindReplacePanel() {
  const editor = document.getElementById('note-editor');

  const searchInput  = document.getElementById('search-input');
  const searchCount  = document.getElementById('search-count');
  const replaceInput = document.getElementById('replace-input');
  const replaceOne   = document.getElementById('replace-one');
  const replaceAll   = document.getElementById('replace-all');

  // Enable/disable replace buttons based on edit permission and match count.
  const _syncReplaceButtons = () => {
    const enabled = canEdit() && state.searchMatches.length > 0;
    if (replaceOne) replaceOne.disabled = !enabled;
    if (replaceAll) replaceAll.disabled = !enabled;
  };

  const _runSearch = () => {
    const raw = searchInput?.value || '';
    state.searchTerm = state.caseSensitive ? raw : raw.toLowerCase();
    state.searchMatches = [];
    state.searchIndex   = -1;
    if (!state.searchTerm || !editor) {
      if (searchCount) searchCount.textContent = '';
      // Collapse any selection left by the previous _jumpToMatch() call so the
      // editor doesn't keep showing a stale highlighted range.
      if (editor) UI.setEditorSelection(editor.selectionEnd, editor.selectionEnd);
      if (state.markdownMode === 'preview' && LiveEditor.isMounted()) {
        const sel = LiveEditor.getSelection();
        LiveEditor.setSelection(sel.to, sel.to);
      }
      _syncReplaceButtons();
      return;
    }
    const text = state.caseSensitive ? editor.value : editor.value.toLowerCase();
    let pos = 0;
    while (true) {
      const idx = text.indexOf(state.searchTerm, pos);
      if (idx === -1) break;
      state.searchMatches.push({ start: idx, end: idx + state.searchTerm.length });
      pos = idx + 1;
    }
    if (state.searchMatches.length > 0) {
      state.searchIndex = 0;
      _jumpToMatch(0);
    } else if (searchCount) {
      searchCount.textContent = 'No results';
    }
    _syncReplaceButtons();
  };

  const _jumpToMatch = (idx, { keepFocus = false } = {}) => {
    if (!editor || !state.searchMatches.length) return;
    const m = state.searchMatches[idx];
    if (!m) return;
    // Only steal focus from the editor when the search/replace inputs don't
    // own it — otherwise typing in the search panel scrolls away mid-query.
    const active = document.activeElement;
    const searchPanelFocused = active === searchInput || active === replaceInput;
    // Preview mode hides the plain textarea entirely (`editor.classList.add
    // ('hidden')` in UI.setMarkdownMode) — moving its selectionStart/
    // selectionEnd and scrollTop there has no visible effect, which used to
    // be worked around by force-switching back to Write mode just to show
    // the match. That fought the user's chosen mode every time they hit
    // Enter/Next in the search box. Route to the CM6 live surface instead,
    // the same selection+scrollIntoView primitive the TOC widget uses, and
    // only fall back to a mode switch when the live surface failed to mount
    // (rare — classic-renderer fallback has no caret to move at all).
    if (state.markdownMode === 'preview' && LiveEditor.isMounted()) {
      LiveEditor.setSelection(m.start, m.end);
      if (!searchPanelFocused && !keepFocus) LiveEditor.focus();
      if (searchCount) searchCount.textContent = `${idx + 1} / ${state.searchMatches.length}`;
      return;
    }
    if (state.markdownMode === 'preview') _applyMarkdownMode('write');
    if (!searchPanelFocused && !keepFocus) editor.focus();
    UI.setEditorSelection(m.start, m.end);
    // Scroll into view
    try {
      const before = editor.value.substring(0, m.start);
      const lineNum = (before.match(/\n/g) || []).length;
      const lineH   = parseInt(getComputedStyle(editor).lineHeight) || 20;
      editor.scrollTop = Math.max(0, lineNum * lineH - editor.clientHeight / 2);
    } catch {}
    if (searchCount) searchCount.textContent = `${idx + 1} / ${state.searchMatches.length}`;
  };

  searchInput?.addEventListener('input', _runSearch);
  // Single consolidated keydown handler for the search input.
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!state.searchMatches.length) return;
      state.searchIndex = (state.searchIndex + 1) % state.searchMatches.length;
      // Enter navigates — focus the editor so the selection highlight is visible.
      editor?.focus();
      _jumpToMatch(state.searchIndex);
    }
    // stopPropagation matters here: the panel's generic focus-trap (see
    // openPanel() in ui/panels.js) also listens for Tab on document and
    // wraps focus back to the panel's first/last focusable item when
    // Replace's buttons are disabled (no active search yet), #replace-input
    // IS that last item — so without stopping propagation, the trap would
    // immediately re-fire on this same keydown and undo the focus() below.
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); replaceInput?.focus(); }
    if (e.key === 'Escape') { UI.closeAllPanels(); _focusActiveEditorSurface(); }
  });
  replaceInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Tab'    && e.shiftKey)  { e.preventDefault(); e.stopPropagation(); searchInput?.focus(); }
    if (e.key === 'Enter')  { e.preventDefault(); replaceOne?.click(); }
    if (e.key === 'Escape') { UI.closeAllPanels(); _focusActiveEditorSurface(); }
  });

  document.getElementById('search-next')?.addEventListener('click', () => {
    if (!state.searchMatches.length) return;
    state.searchIndex = (state.searchIndex + 1) % state.searchMatches.length;
    _jumpToMatch(state.searchIndex);
    // Return focus to search input so keyboard nav continues naturally.
    searchInput?.focus();
  });
  document.getElementById('search-prev')?.addEventListener('click', () => {
    if (!state.searchMatches.length) return;
    state.searchIndex = (state.searchIndex - 1 + state.searchMatches.length) % state.searchMatches.length;
    _jumpToMatch(state.searchIndex);
    searchInput?.focus();
  });

  // Replace current match and advance to the next one.
  replaceOne?.addEventListener('click', () => {
    if (!canEdit()) { UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning'); return; }
    if (!state.searchMatches.length || !editor) return;
    const m = state.searchMatches[Math.max(0, state.searchIndex)];
    if (!m) return;
    const replacement = replaceInput?.value ?? '';
    UI.replaceEditorRange(m.start, m.end, replacement);
    UI.updateWordCount(editor.value);
    _refreshPreviewIfActive();
    // Re-index so positions reflect the changed content, then advance.
    _runSearch();
    if (state.searchMatches.length > 0) {
      state.searchIndex = Math.min(state.searchIndex, state.searchMatches.length - 1);
      _jumpToMatch(state.searchIndex, { keepFocus: true });
    }
    // Keep focus in the replace input so the user can continue replacing.
    replaceInput?.focus();
  });

  // Replace every match at once.
  replaceAll?.addEventListener('click', () => {
    if (!canEdit()) { UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning'); return; }
    if (!state.searchMatches.length || !state.searchTerm || !editor) return;
    const count = state.searchMatches.length;
    const replacement = replaceInput?.value ?? '';
    // Escape the raw search term for safe use in RegExp.
    // Use the un-lowercased raw input for the pattern when case-sensitive.
    const rawTerm = searchInput?.value || '';
    const escaped = rawTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags   = state.caseSensitive ? 'g' : 'gi';
    // A whole-document, potentially-multi-match transform — not a single
    // contiguous range — so this goes through setEditorValue()'s
    // similar-length cursor-preserve heuristic rather than replaceEditorRange().
    UI.setEditorValue(editor.value.replace(new RegExp(escaped, flags), replacement));
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    UI.updateWordCount(editor.value);
    _refreshPreviewIfActive();
    _runSearch();
    UI.showToast(`Replaced ${count} match${count !== 1 ? 'es' : ''}.`, 'success');
    // Return focus to search so the user can start a new query.
    searchInput?.focus();
  });

  // ── Case-sensitive toggle (Aa button) ─────────────────────────────────────
  const caseBtn = document.getElementById('search-case');
  caseBtn?.addEventListener('click', () => {
    state.caseSensitive = !state.caseSensitive;
    caseBtn.setAttribute('aria-pressed', String(state.caseSensitive));
    caseBtn.classList.toggle('is-active', state.caseSensitive);
    _runSearch();
    searchInput?.focus();
  });

}

// ── Expiration preset helpers ─────────────────────────────────────────────────

export function _selectExpirationPreset(preset) {
  state.expPreset = preset;
  document.querySelectorAll('[data-exp-preset]').forEach((el) => el.classList.toggle('is-active', el.dataset.expPreset === preset));
  document.getElementById('exp-custom-row')?.classList.toggle('hidden', preset !== 'custom');
  _updateExpirationPreview();
}

function _buildExpirationDuration() {
  if (state.expPreset !== 'custom') return state.expPreset;
  const value = document.getElementById('exp-custom-value')?.value?.trim();
  const unit = document.getElementById('exp-custom-unit')?.value?.trim();
  if (!value) return { error: 'Please enter a number for custom auto-expire.' };
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { error: 'Custom auto-expire must be a number greater than 0.' };
  if (!['s', 'm', 'h', 'd'].includes(unit)) return { error: 'Unsupported unit. Use seconds, minutes, hours, or days.' };
  return `${n}${unit}`;
}

function _updateExpirationPreview() {
  const preview = document.getElementById('setting-exp-preview');
  if (!preview) return;
  const built = _buildExpirationDuration();
  if (typeof built === 'object' && built?.error) {
    preview.textContent = 'Preview: Select a valid duration.';
    return;
  }
  const ms = parseDuration(built);
  if (!ms) { preview.textContent = 'Preview: Select a valid duration.'; return; }
  preview.textContent = `Preview: This room will clear around ${new Date(Date.now() + ms).toLocaleString()}.`;
}

// ── Settings panel ────────────────────────────────────────────────────────────

export function _wireSettings() {
  document.getElementById('setting-passcode-btn')?.addEventListener('click', async () => {
    if (!canChangeSettings()) { UI.showToast(editBlockedReason() || 'Settings are disabled.', 'warning'); return; }
    if (state.room.passcode_hash) {
      if (!await UI.showConfirm('Remove the room passcode?', { confirmLabel: 'Remove', danger: true })) return;
      try {
        await removePasscode(state.roomId);
        state.room = await loadRoom(state.roomId);
        _updatePermissionContext();
        _renderRoomHeader();
        UI.renderSettingsPanel(state.room);
        broadcastSettingsChange();
        UI.showToast('Passcode removed.', 'success');
      } catch { UI.showToast('Could not remove passcode.', 'error'); }
    } else {
      const pc = await UI.showPrompt('Set a new passcode:', { placeholder: 'Passcode…', confirmLabel: 'Set passcode' });
      if (!pc?.trim()) return;
      try {
        await setPasscode(state.roomId, pc);
        state.room = await loadRoom(state.roomId);
        _updatePermissionContext();
        _renderRoomHeader();
        UI.renderSettingsPanel(state.room);
        broadcastSettingsChange();
        UI.showToast('Passcode set.', 'success');
      } catch { UI.showToast('Could not set passcode.', 'error'); }
    }
  });

  document.getElementById('setting-enc-btn')?.addEventListener('click', async () => {
    if (!canChangeSettings()) { UI.showToast(editBlockedReason() || 'Settings are disabled.', 'warning'); return; }
    const encBtn = document.getElementById('setting-enc-btn');
    if (state.room.encryption_enabled) {
      if (!await UI.showConfirm('Disable encryption? Content will be stored in plaintext.', { confirmLabel: 'Disable', danger: true })) return;
      await flushSave();
      cancelPendingTypingBroadcast();
      cancelPendingLiveContentBroadcast();
      const pp = await UI.showPrompt('Enter the current passphrase to confirm:', { placeholder: 'Passphrase…', confirmLabel: 'Confirm' });
      if (!pp) return;
      // PBKDF2 key derivation takes 1-3 s — indicate progress on the button.
      if (encBtn) { encBtn.disabled = true; encBtn.textContent = 'Decrypting…'; }
      try {
        // Pass plaintext (editor value), passphrase, stored salt, and current DB ciphertext
        await disableEncryption(state.roomId, UI.getEditorValue(), pp, state.encSalt, state.room.content);
        state.encKey = null; state.encSalt = null;
        // v1: tell sync.js the new encrypt/decrypt fns immediately.
        setEncryption(null, null);
        state.room   = await loadRoom(state.roomId);
        clearDraft(state.roomId);
        _updatePermissionContext();
        _renderRoomHeader();
        UI.renderSettingsPanel(state.room);
        UI.setEncryptionBadge(false);
        UI.showEncryptionLockedBanner(false);
        broadcastSettingsChange();
        UI.showToast('Encryption disabled.', 'success');
      } catch (err) {
        UI.renderSettingsPanel(state.room); // restore button state
        UI.showToast(err.message || 'Could not disable encryption.', 'error', 4000);
      }
    } else {
      await flushSave();
      cancelPendingTypingBroadcast();
      cancelPendingLiveContentBroadcast();
      let existingFiles;
      try { existingFiles = await listFiles(state.roomId); }
      catch { existingFiles = []; } // non-critical — just skip the warning if file list fails
      if (existingFiles.length && !await UI.showConfirm('This room has file attachments. SyncPad v1 encrypts note text only — files are not encrypted. Continue?', { confirmLabel: 'Continue' })) return;
      const pp = await UI.showPrompt('Set an encryption passphrase:', { placeholder: 'Passphrase…', confirmLabel: 'Enable encryption' });
      if (!pp?.trim()) return;
      // PBKDF2 key derivation takes 1-3 s — indicate progress on the button.
      if (encBtn) { encBtn.disabled = true; encBtn.textContent = 'Encrypting…'; }
      try {
        const { salt, key } = await enableEncryption(state.roomId, UI.getEditorValue(), pp);
        state.encKey = key; state.encSalt = salt;
        // v1: switch sync.js to encrypted lane immediately.
        setEncryption(
          (pt) => encryptContent(pt, state.encKey),
          (ct) => decryptContent(ct, state.encKey),
        );
        state.room   = await loadRoom(state.roomId);
        clearDraft(state.roomId);
        _updatePermissionContext();
        _renderRoomHeader();
        UI.renderSettingsPanel(state.room);
        UI.setEncryptionBadge(true);
        broadcastSettingsChange();
        UI.showToast('Encryption enabled.', 'success');
      } catch {
        UI.renderSettingsPanel(state.room); // restore button state
        UI.showToast('Could not enable encryption.', 'error');
      }
    }
  });

  // Toggle the expiration controls panel open/closed. The button label is
  // 'Set' (no expiration) or 'Modify' (expiration exists). The actual removal
  // is handled by setting-exp-remove-btn inside the controls section.
  document.getElementById('setting-exp-btn')?.addEventListener('click', () => {
    const controls = document.getElementById('setting-exp-controls');
    if (!controls) return;
    const isHidden = controls.classList.toggle('hidden');
    controls.toggleAttribute('inert', isHidden); // keep its clipped controls out of Tab order while collapsed
    if (!isHidden) _updateExpirationPreview(); // refresh preview when expanding
  });
  document.querySelectorAll('[data-exp-preset]').forEach((el) => el.addEventListener('click', () => _selectExpirationPreset(el.dataset.expPreset || '10m')));
  document.getElementById('exp-custom-value')?.addEventListener('input', _updateExpirationPreview);
  document.getElementById('exp-custom-unit')?.addEventListener('change', _updateExpirationPreview);
  document.getElementById('setting-exp-apply-btn')?.addEventListener('click', async () => {
    if (!canChangeSettings()) { UI.showToast(editBlockedReason() || 'Settings are disabled.', 'warning'); return; }
    const errorEl = document.getElementById('setting-exp-error');
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
    const built = _buildExpirationDuration();
    if (typeof built === 'object' && built?.error) {
      if (errorEl) { errorEl.textContent = built.error; errorEl.classList.remove('hidden'); }
      return;
    }
    try {
      await setExpiration(state.roomId, built);
      state.room = await loadRoom(state.roomId);
      _renderRoomHeader();
      UI.renderSettingsPanel(state.room);
      setupExpirationTimer();
      broadcastSettingsChange();
      UI.showToast('Auto-expire set.', 'success');
    } catch { UI.showToast('Could not set auto-expire.', 'error'); }
  });
  document.getElementById('setting-exp-remove-btn')?.addEventListener('click', async () => {
    if (!canChangeSettings()) { UI.showToast(editBlockedReason() || 'Settings are disabled.', 'warning'); return; }
    if (!state.room.expires_at) { UI.showToast('No auto-expire is currently set.', 'warning'); return; }
    try {
      await clearExpiration(state.roomId);
      state.room = await loadRoom(state.roomId);
      _renderRoomHeader();
      UI.renderSettingsPanel(state.room);
      UI.hideExpirationBar();
      broadcastSettingsChange();
      UI.showToast('Auto-expire removed.', 'success');
    } catch { UI.showToast('Could not remove auto-expire.', 'error'); }
  });
  _selectExpirationPreset('10m');

  document.getElementById('setting-vo-btn')?.addEventListener('click', async () => {
    if (!canChangeSettings()) { UI.showToast(editBlockedReason() || 'Settings are disabled.', 'warning'); return; }
    try {
      if (state.room.view_once) {
        await disableViewOnce(state.roomId);
        UI.showToast('View-once disabled.', 'success');
      } else {
        await enableViewOnce(state.roomId);
        UI.showToast('View-once enabled. The note clears after the first viewer sees it.', 'success', 5000);
      }
      state.room = await loadRoom(state.roomId);
      _renderRoomHeader();
      UI.renderSettingsPanel(state.room);
      broadcastSettingsChange();
    } catch { UI.showToast('Could not update view-once setting.', 'error'); }
  });

  document.getElementById('setting-dl-btn')?.addEventListener('click', async () => {
    if (!canChangeSettings()) { UI.showToast(editBlockedReason() || 'Settings are disabled.', 'warning'); return; }
    try {
      if (state.room.device_limit) {
        await clearDeviceLimit(state.roomId);
        UI.showToast('Device limit removed.', 'success');
      } else {
        const input = document.getElementById('setting-dl-input');
        const n = Math.round(Number(input?.value));
        if (!Number.isFinite(n) || n < 1 || n > 50) {
          UI.showToast('Enter a device limit between 1 and 50.', 'warning');
          return;
        }
        await setDeviceLimit(state.roomId, n);
        UI.showToast(`Device limit set. The note clears once ${n} device${n === 1 ? '' : 's'} have joined.`, 'success', 5000);
      }
      state.room = await loadRoom(state.roomId);
      _renderRoomHeader();
      UI.renderSettingsPanel(state.room);
      broadcastSettingsChange();
    } catch { UI.showToast('Could not update device limit. Has supabase/migrations/0005_device_limit.sql been run?', 'error', 5000); }
  });

  // Lock-editing toggle
  document.getElementById('setting-lock-btn')?.addEventListener('click', async () => {
    if (!canToggleLock()) { UI.showToast(editBlockedReason() || 'Lock controls are disabled.', 'warning'); return; }
    const target = !state.room.editing_locked;
    try {
      if (target) { await flushSave(); cancelPendingTypingBroadcast(); cancelPendingLiveContentBroadcast(); }
      await setEditingLocked(state.roomId, target);
      state.room = await loadRoom(state.roomId);
      _updatePermissionContext();
      _renderRoomHeader();
      UI.renderSettingsPanel(state.room);
      UI.setLockedMode(!!state.room.editing_locked);
      broadcastSettingsChange();
      UI.showToast(target ? 'Editing locked.' : 'Editing unlocked.', 'success');
    } catch { UI.showToast('Could not update editing lock.', 'error'); }
  });

}
