// SyncPad – app/wiring.js
// Glues keyboard shortcuts (shortcuts.js) to the scattered action functions
// spread across app/*, and is the single orchestrator that wires every
// room-scoped DOM listener exactly once per page lifecycle.

import { initShortcuts } from '../shortcuts.js';
import { insertTimestamp } from '../utils.js';
import { canEdit, editBlockedReason } from '../permissions.js';
import * as LiveEditor from '../live-editor.js';
import * as UI from '../ui.js';
import { state } from './state.js';
import { _applyMarkdownMode, _openFloatingCommentComposer } from './comments-preview.js';
import {
  _toggleMonospace, _insertTextAtActiveCursor, _applyFormatToActiveSurface,
  _closeEditorContextMenu, _wireEditorCore, _wireEditorToolbarAndLifecycle,
  _wireEditorContextMenu, _wireSlashMenuDismissal, _wirePasteSanitization,
  _wireEditorPreferenceToggles,
} from './editor-behavior.js';
import { _openShareModal } from './landing.js';
import { _copyNoteToClipboard, closeMoreDropdown, _wireHeader, _wireSegmentedMarkdownControl, _wireMobileActionBar, _wireFooterQuickButtons } from './header.js';
import { _wirePanelsAndModals, _wireTools, _wireKeyboardShortcutsModal } from './tools-and-modals.js';
import { _wireFiles, _wireFilesSortOrder, _wireFilesBulkSelect } from './files-panel.js';
import { _wireSettings, _wireSaveAsTemplate, _wireFindReplacePanel } from './panels.js';
import { _wireExportModal } from './export.js';
import { _openCommandPalette, _wireCommandPalette } from './command-palette.js';

function _wireShortcuts() {
  initShortcuts({
    onTogglePreview:    () => {
      _applyMarkdownMode(state.markdownMode === 'preview' ? 'write' : 'preview');
    },
    onToggleSplit: () => {
      _applyMarkdownMode(state.markdownMode === 'split' ? 'write' : 'split');
    },
    onToggleMonospace: () => _toggleMonospace(),
    onOpenSearch: () => {
      UI.openPanel('search-panel', { dimBackdrop: false });
      document.getElementById('search-input')?.focus();
    },
    onForceClose: () => {
      closeMoreDropdown();
      _closeEditorContextMenu();
      UI.closeAllPanels();
      UI.closeAllModals();
    },
    onOpenShortcuts: () => UI.openModal('shortcuts-modal'),
    onOpenShare: () => {
      _openShareModal();
      UI.showToast('Share opened.', 'success');
    },
    onInsertTimestamp: () => {
      if (!canEdit()) { UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning'); return; }
      _insertTextAtActiveCursor(insertTimestamp());
      UI.showToast('Timestamp inserted.', 'success');
    },
    onCopyNote: () => _copyNoteToClipboard(),
    onAddComment: () => _openFloatingCommentComposer(),
    onOpenCommandPalette: () => _openCommandPalette(),
    onApplyFormat: (action) => _applyFormatToActiveSurface(action),
    isLiveFocused: () => LiveEditor.isMounted() && LiveEditor.hasFocus(),
  });

}

export function wireEvents() {
  // Shortcuts are always re-wired: they were destroyed in teardownRealtimeSession()
  // and their callbacks reference module-level state, not captured room locals.
  _wireShortcuts();

  // All DOM element listeners below are one-time-only. On multi-room navigation
  // shortcuts are re-wired above, but these must not accumulate.
  if (state.eventsWired) return;
  state.eventsWired = true;

  _wireEditorCore();
  _wireEditorToolbarAndLifecycle();
  _wireHeader();
  _wireSegmentedMarkdownControl();
  _wireMobileActionBar();
  _wireFooterQuickButtons();
  _wirePanelsAndModals();
  _wireTools();
  _wireFiles();
  _wireFilesSortOrder();
  _wireFilesBulkSelect();
  _wireSettings();
  _wireExportModal();
  _wireKeyboardShortcutsModal();
  _wireSaveAsTemplate();
  _wireFindReplacePanel();
  _wirePasteSanitization();
  _wireEditorPreferenceToggles();
  _wireCommandPalette();
  _wireEditorContextMenu();
  _wireSlashMenuDismissal();

  // Test-synchronization hook only — tests/helpers.js's createRoom() waits on
  // this so a test's first interaction with the room never races the one-time
  // DOM wiring above. Not read by any app code.
  window.__syncpadEventsWired = true;
}
