// SyncPad – app/command-palette.js
// A searchable index of app-wide actions, opened with Ctrl/Cmd+K outside the
// editor (see shortcuts.js) or the More menu's "Command Palette" item.
// Actions that already have a guarded, wired button elsewhere (permission
// checks, confirm dialogs, toasts) are run by clicking that button rather
// than re-implementing the guard here — one source of truth per action.

import { filterCommands } from '../utils.js';
import { THEMES, applyTheme } from '../theme.js';
import { canEdit } from '../permissions.js';
import * as UI from '../ui.js';
import { state } from './state.js';
import { _applyMarkdownMode } from './comments-preview.js';
import { _toggleMonospace } from './editor-behavior.js';
import { _openHistoryPanel } from './panels.js';
import { _openCommentsPanel } from './comments-preview.js';
import { _copyNoteToClipboard, closeMoreDropdown } from './header.js';

function _clickById(id) {
  return () => document.getElementById(id)?.click();
}

// Groups appear in this order in the empty-query (browse) state — filterCommands()
// returns the array unchanged when there's no search text, so this order is
// what a visitor sees before typing anything. Panels first (opening
// somewhere is the single most common reason to reach for the palette),
// then View/Room/Edit (things you *do*), Appearance, Help last (reference,
// least urgent).
function _paletteCommands() {
  return [
    { id: 'panel-tools',    label: 'Open Tools panel',    group: 'Panels', keywords: ['clear', 'import', 'download'], run: () => UI.togglePanel('tools-panel') },
    { id: 'panel-files',    label: 'Open Files panel',    group: 'Panels', keywords: ['attachments', 'upload'], run: () => UI.togglePanel('files-panel') },
    { id: 'panel-devices',  label: 'Open Devices panel',  group: 'Panels', keywords: ['presence', 'collaborators'], run: () => UI.togglePanel('presence-panel') },
    { id: 'panel-settings', label: 'Open Settings panel', group: 'Panels', keywords: ['passcode', 'encryption', 'expiration', 'lock'], run: () => UI.togglePanel('settings-panel') },
    { id: 'panel-find',     label: 'Find & Replace',      group: 'Panels', shortcut: 'Ctrl F', keywords: ['search'], run: () => { UI.openPanel('search-panel'); document.getElementById('search-input')?.focus(); } },
    { id: 'panel-history',  label: 'Open Version History', group: 'Panels', keywords: ['revisions', 'restore'], run: () => _openHistoryPanel() },
    { id: 'panel-comments', label: 'Open Comments',        group: 'Panels', run: () => _openCommentsPanel() },
    { id: 'panel-templates', label: 'Insert a template',   group: 'Panels', run: _clickById('tool-templates') },

    { id: 'mode-write',   label: 'Source mode (hide preview)',        group: 'View', run: () => _applyMarkdownMode('write') },
    { id: 'mode-preview', label: 'Toggle Live preview mode',          group: 'View', shortcut: 'Ctrl Shift P', keywords: ['preview'], run: () => _applyMarkdownMode(state.markdownMode === 'preview' ? 'write' : 'preview') },
    { id: 'mode-split',   label: 'Toggle Split view',                 group: 'View', shortcut: 'Ctrl Shift S', run: () => _applyMarkdownMode(state.markdownMode === 'split' ? 'write' : 'split') },
    { id: 'monospace',    label: state.monospace ? 'Turn off monospace font' : 'Turn on monospace font', group: 'View', shortcut: 'Ctrl Shift M', keywords: ['font'], run: () => _toggleMonospace() },

    { id: 'share',          label: 'Share this room',                 group: 'Room', shortcut: 'Ctrl Shift K', run: _clickById('btn-share') },
    { id: 'lock',           label: state.room?.editing_locked ? 'Unlock editing' : 'Lock editing', group: 'Room', run: _clickById('setting-lock-btn') },
    { id: 'clear-note',     label: 'Clear note for everyone…',        group: 'Room', keywords: ['delete', 'empty'], run: _clickById('tool-clear') },
    { id: 'report-room',    label: 'Report this room',                group: 'Room', run: _clickById('btn-report-room') },

    { id: 'insert-timestamp', label: 'Insert timestamp',              group: 'Edit', shortcut: 'Ctrl Shift T', run: _clickById('btn-insert-ts') },
    { id: 'copy-note',        label: 'Copy note contents',            group: 'Edit', shortcut: 'Ctrl Shift C', run: () => _copyNoteToClipboard() },
    { id: 'import-text',       label: 'Import a text/Markdown file',  group: 'Edit', run: _clickById('tool-import') },
    { id: 'download-md',       label: 'Download note as .md',         group: 'Edit', keywords: ['export'], run: _clickById('tool-download') },
    { id: 'export',            label: 'Export…',                      group: 'Edit', keywords: ['pdf', 'html', 'txt', 'print'], run: _clickById('btn-export') },

    ...THEMES.map((t) => ({
      id: `theme-${t.id}`, label: `Theme: ${t.label}`, group: 'Appearance', keywords: ['color', 'dark', 'light'],
      run: () => applyTheme(t.id),
    })),

    { id: 'about',      label: 'About SyncPad',       group: 'Help', run: _clickById('btn-about') },
    { id: 'shortcuts',  label: 'Keyboard shortcuts',  group: 'Help', shortcut: 'Ctrl /', run: _clickById('btn-shortcuts') },
    // #btn-replay-tour's own handler already guards on canEdit() (a
    // read-only viewer's tour would describe editing/autosave and a
    // Settings panel they can't reach) — but filtering only there still
    // let this entry render in the palette itself, so selecting it closed
    // the palette and then silently did nothing with no explanation. Same
    // predicate here keeps the entry from being offered at all instead of
    // exposing a no-op action.
    ...(canEdit() ? [{ id: 'replay-tour', label: 'Take the tour', group: 'Help', keywords: ['onboarding', 'walkthrough', 'help'], run: _clickById('btn-replay-tour') }] : []),
  ];
}

function _renderPaletteResults() {
  UI.renderCommandPaletteResults(state.paletteFiltered, state.paletteActiveIndex, _runPaletteCommand);
}

function _runPaletteCommand(id) {
  const cmd = state.paletteFiltered.find((c) => c.id === id);
  _closeCommandPalette();
  cmd?.run();
}

export function _openCommandPalette() {
  const input = document.getElementById('command-palette-input');
  state.paletteFiltered = _paletteCommands();
  state.paletteActiveIndex = 0;
  UI.openModal('command-palette-modal');
  if (input) { input.value = ''; input.focus(); }
  _renderPaletteResults();
}

function _closeCommandPalette() {
  UI.closeModal('command-palette-modal');
}

export function _wireCommandPalette() {
  document.getElementById('btn-command-palette')?.addEventListener('click', () => {
    closeMoreDropdown();
    _openCommandPalette();
  });

  const input = document.getElementById('command-palette-input');
  input?.addEventListener('input', () => {
    state.paletteFiltered = filterCommands(_paletteCommands(), input.value);
    state.paletteActiveIndex = 0;
    _renderPaletteResults();
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.paletteFiltered.length) state.paletteActiveIndex = (state.paletteActiveIndex + 1) % state.paletteFiltered.length;
      _renderPaletteResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.paletteFiltered.length) state.paletteActiveIndex = (state.paletteActiveIndex - 1 + state.paletteFiltered.length) % state.paletteFiltered.length;
      _renderPaletteResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = state.paletteFiltered[state.paletteActiveIndex];
      if (active) _runPaletteCommand(active.id);
    }
  });
}
