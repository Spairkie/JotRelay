// SyncPad – app/tools-and-modals.js
// Generic panel/modal close-wiring, the report-room modal, the Tools panel
// actions (clear/download/import/templates/find/history/comments), and the
// keyboard-shortcuts modal.

import { getDeviceId } from '../utils.js';
import { submitRoomReport, REPORT_REASONS } from '../rooms.js';
import { canClearNote, canImportText, canUseTemplates, editBlockedReason } from '../permissions.js';
import * as UI from '../ui.js';
import { state } from './state.js';
import { doClearNote } from './room-lifecycle.js';
import { _openTemplatesModalFresh, _openHistoryPanel } from './panels.js';
import { _openCommentsPanel, _navigateComment, _refreshPreviewIfActive } from './comments-preview.js';
import { _downloadBlob } from './export.js';
import { closeMoreDropdown } from './header.js';

// Use REPORT_REASONS imported from rooms.js to keep client and server in sync.
const REPORT_REASON_OPTIONS = REPORT_REASONS;

function _resetReportRoomModal() {
  const reasonEl = document.getElementById('report-room-reason');
  const detailsEl = document.getElementById('report-room-details');
  const errEl = document.getElementById('report-room-error');
  const okEl = document.getElementById('report-room-success');
  const submitEl = document.getElementById('report-room-submit');
  const charEl = document.getElementById('report-room-charcount');
  if (reasonEl) reasonEl.value = '';
  if (detailsEl) detailsEl.value = '';
  if (charEl) charEl.textContent = '0 / 1000';
  errEl?.classList.add('hidden');
  okEl?.classList.add('hidden');
  if (submitEl) { submitEl.disabled = false; submitEl.textContent = 'Submit report'; }
}

export function _wirePanelsAndModals() {
  // ── Panels / modals ────────────────────────────────────────────────────────
  document.querySelectorAll('.panel-close').forEach(btn =>
    btn.addEventListener('click', () => UI.closeAllPanels())
  );
  document.getElementById('panel-backdrop')?.addEventListener('click', () => UI.closeAllPanels());

  document.querySelectorAll('.modal-backdrop').forEach(backdrop =>
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) UI.closeAllModals(); })
  );
  document.getElementById('share-modal-close')?.addEventListener('click', () => UI.closeModal('share-modal'));
  document.getElementById('about-modal-close')?.addEventListener('click', () => UI.closeModal('about-modal'));

  document.getElementById('btn-report-room')?.addEventListener('click', () => {
    closeMoreDropdown();
    _resetReportRoomModal();
    UI.openModal('report-room-modal');
  });
  document.getElementById('report-room-cancel')?.addEventListener('click', () => UI.closeModal('report-room-modal'));
  document.getElementById('report-room-details')?.addEventListener('input', (e) => {
    const details = e.target;
    if (!details) return;
    if (details.value.length > 1000) details.value = details.value.slice(0, 1000);
    const charEl = document.getElementById('report-room-charcount');
    if (charEl) charEl.textContent = `${details.value.length} / 1000`;
  });
  document.getElementById('report-room-submit')?.addEventListener('click', async () => {
    const reasonEl = document.getElementById('report-room-reason');
    const detailsEl = document.getElementById('report-room-details');
    const errEl = document.getElementById('report-room-error');
    const okEl = document.getElementById('report-room-success');
    const submitEl = document.getElementById('report-room-submit');
    const reason = (reasonEl?.value || '').trim();
    const details = (detailsEl?.value || '').trim();

    errEl?.classList.add('hidden');
    if (okEl) okEl.classList.add('hidden');

    if (!REPORT_REASON_OPTIONS.has(reason)) {
      if (errEl) { errEl.textContent = 'Please select a valid reason.'; errEl.classList.remove('hidden'); }
      return;
    }

    if (details.length > 1000) {
      if (errEl) { errEl.textContent = 'Details must be 1000 characters or fewer.'; errEl.classList.remove('hidden'); }
      return;
    }

    try {
      if (submitEl) { submitEl.disabled = true; submitEl.textContent = 'Submitting…'; }
      await submitRoomReport({
        roomId: state.roomId,
        shareToken: state.isReadOnly ? state.shareToken : null,
        reason,
        details,
        mode: state.isReadOnly ? 'readonly' : 'editable',
        pageUrl: location.href,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        reporterDeviceId: getDeviceId(),
      });
      if (okEl) okEl.classList.remove('hidden');
      UI.showToast('Report submitted. Thank you.', 'success');
      setTimeout(() => UI.closeModal('report-room-modal'), 900);
    } catch {
      if (errEl) {
        errEl.textContent = 'Could not submit report right now. Please try again.';
        errEl.classList.remove('hidden');
      }
      if (submitEl) { submitEl.disabled = false; submitEl.textContent = 'Submit report'; }
    }
  });


}

export function _wireTools() {
  const editor = document.getElementById('note-editor');

  // ── Tools ──────────────────────────────────────────────────────────────────
  const toolActions = {
    'tool-clear': async () => {
      if (!canClearNote()) { UI.showToast(editBlockedReason() || 'Clear is disabled.', 'warning'); return; }
      if (!await UI.showConfirm('Clear the note for everyone? This cannot be undone.', { confirmLabel: 'Clear', danger: true })) return;
      doClearNote();
    },

    'tool-download': () => {
      // Export as Markdown (.md). Content is plain text / Markdown.
      _downloadBlob(UI.getEditorValue(), `${state.roomId}.md`, 'text/markdown');
      UI.showToast('Downloaded .md', 'success');
    },

    'tool-import': () => {
      if (!canImportText()) { UI.showToast(editBlockedReason() || 'Import is disabled.', 'warning'); return; }
      const inp = Object.assign(document.createElement('input'), {
        type: 'file', accept: '.txt,.md,text/plain,text/markdown',
      });
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        if (f.size > 5 * 1024 * 1024) {
          UI.showToast('File too large (max 5 MB for text import).', 'error');
          return;
        }
        const r = new FileReader();
        r.onerror = () => UI.showToast('Could not read file.', 'error');
        r.onload = (e) => {
          UI.setEditorValue(String(e.target.result ?? ''));
          // Trigger the normal local-input pipeline: word count, draft save,
          // debounced DB save, and live broadcast. The shared 'input' handler
          // (_wireEditorCore) enforces BODY_MAX centrally, so an over-limit
          // import is trimmed the same way any other over-limit edit is.
          editor?.dispatchEvent(new Event('input', { bubbles: true }));
          _refreshPreviewIfActive();
        };
        r.readAsText(f);
      };
      inp.click();
    },

    'tool-templates': () => {
      if (!canUseTemplates()) { UI.showToast(editBlockedReason() || 'Templates are disabled.', 'warning'); return; }
      _openTemplatesModalFresh();
    },
  };

  Object.entries(toolActions).forEach(([id, fn]) => {
    document.getElementById(id)?.addEventListener('click', () => { fn(); UI.closeAllPanels(); });
  });

  // Wired outside toolActions: each of these opens a side panel, and
  // toolActions' blanket closeAllPanels() after every action would close
  // that panel again immediately (tool-find had exactly this bug — opened
  // search-panel and then closeAllPanels() closed it again in the same tick).
  document.getElementById('tool-find')?.addEventListener('click', () => {
    UI.openPanel('search-panel');
    document.getElementById('search-input')?.focus();
  });
  document.getElementById('tool-history')?.addEventListener('click', () => { _openHistoryPanel(); });
  document.getElementById('tool-comments')?.addEventListener('click', () => { _openCommentsPanel(); });
  document.getElementById('comment-panel-prev')?.addEventListener('click', () => _navigateComment(-1));
  document.getElementById('comment-panel-next')?.addEventListener('click', () => _navigateComment(1));

}

export function _wireKeyboardShortcutsModal() {
  // ── Keyboard shortcuts modal ───────────────────────────────────────────────
  document.getElementById('btn-shortcuts')?.addEventListener('click', () => {
    closeMoreDropdown();
    UI.openModal('shortcuts-modal');
  });
  document.getElementById('shortcuts-modal-close')?.addEventListener('click', () => UI.closeModal('shortcuts-modal'));

}
