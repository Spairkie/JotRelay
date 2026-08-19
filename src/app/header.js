// JotRelay – app/header.js
// The app header: toolbar buttons, the "More" dropdown, room title
// inline-edit, room link copy, the mobile action bar, footer quick buttons
// (timestamp insert, floating-comment FAB, footer clock), and the segmented
// Write/Preview/Split control.

import { copyToClipboard, buildRoomUrl, insertTimestamp } from '../utils.js';
import { updateRoomDisplayName, normalizeRoomDisplayName } from '../rooms.js';
import { canEdit, editBlockedReason } from '../permissions.js';
import * as UI from '../ui.js';
import { state, BASE } from './state.js';
import { _applyMarkdownMode, _openFloatingCommentComposer } from './comments-preview.js';
import { _insertTextAtActiveCursor } from './editor-behavior.js';
import { _renderRoomHeader } from './room-lifecycle.js';
import { _openShareModal } from './landing.js';

export function closeMoreDropdown() {
  document.getElementById('more-dropdown')?.classList.remove('open');
  document.getElementById('btn-more')?.setAttribute('aria-expanded', 'false');
}

// Menu items the dropdown's own focus/arrow-key handling should ever land
// on — excludes anything currently display:none, regardless of which
// mechanism hid it (data-readonly-hide's CSS rule, or #btn-replay-tour's
// own canEdit()-driven .hidden toggle).
function _visibleMenuItems(dropdown) {
  return [...dropdown.querySelectorAll('[role="menuitem"]')].filter((el) => el.offsetParent !== null);
}

export function _copyNoteToClipboard() {
  return copyToClipboard(UI.getEditorValue())
    .then(ok => ok
      ? UI.showToast('Copied to clipboard.', 'success')
      : UI.showToast('Could not copy.', 'error'));
}

export function _wireHeader() {
  // ── Header ─────────────────────────────────────────────────────────────────
  document.getElementById('btn-tools')?.addEventListener('click', () => { closeMoreDropdown(); UI.togglePanel('tools-panel'); });
  document.getElementById('btn-files')?.addEventListener('click', () => { closeMoreDropdown(); UI.togglePanel('files-panel'); });
  document.getElementById('btn-presence')?.addEventListener('click', () => { closeMoreDropdown(); UI.togglePanel('presence-panel'); });
  document.getElementById('btn-settings')?.addEventListener('click', () => { closeMoreDropdown(); UI.togglePanel('settings-panel'); });
  document.getElementById('btn-about')?.addEventListener('click', () => { closeMoreDropdown(); UI.openModal('about-modal'); });
  // Manual replay bypasses hasSeenOnboarding() entirely — that flag only
  // gates the automatic first-room trigger in room-lifecycle.js, and
  // startOnboardingTour() itself has no such check, so calling it directly
  // here just works regardless of whether the tour has already been seen.
  // The button itself is data-readonly-hide'd, but that only hides it
  // visually — the command palette's "Take the tour" entry reaches this
  // same handler via a plain .click(), which fires regardless of visibility
  // — so the canEdit() guard belongs here too, the one place this action's
  // wired (command-palette.js's own header comment: "one source of truth
  // per action"). A read-only viewer's tour would open on a "start typing"
  // step and a Share step pointing at a Settings panel they can't reach.
  document.getElementById('btn-replay-tour')?.addEventListener('click', () => {
    if (!canEdit()) return;
    closeMoreDropdown();
    // startOnboardingTour() captures document.activeElement to restore on
    // close — closeMoreDropdown() above hides the dropdown but never moves
    // focus off whatever's still nominally focused inside it (this button
    // itself for a direct click; the command palette's own search input
    // for the "Take the tour" palette entry, which reaches this same
    // handler via a synthetic click after its modal closes). Either way
    // that's now an invisible element, so ending the tour would restore
    // focus to something a keyboard user can't see. #btn-more is the one
    // guaranteed-visible anchor both paths share.
    document.getElementById('btn-more')?.focus();
    UI.startOnboardingTour();
  });
  // A-3: device-count-badge — keyboard accessibility (role="button" set in HTML)
  const deviceCountBtn = document.getElementById('device-count-btn');
  deviceCountBtn?.addEventListener('click', () => UI.togglePanel('presence-panel'));
  deviceCountBtn?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); UI.togglePanel('presence-panel'); }
  });

  // More dropdown toggle
  const moreBtn      = document.getElementById('btn-more');
  const moreDropdown = document.getElementById('more-dropdown');
  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = moreDropdown?.classList.toggle('open');
    moreBtn.setAttribute('aria-expanded', String(!!open));
    if (open) {
      // data-readonly-hide (styles/modals.css) only reacts to
      // body.read-only-mode — deliberately narrow, since e.g. #btn-settings
      // also carries it and must stay reachable in a *locked* room (not
      // read-only-mode) so its owner can reach the very control that
      // unlocks it. "Take the tour" has no such reason to stay reachable
      // in any canEdit()-false state — locked, encrypted-without-key, or a
      // consumed view-once room all block it exactly like read-only-mode
      // does — so it needs the full predicate, computed here (menu-open
      // time is the one moment this actually needs to be current, rather
      // than kept reactively in sync with every permission-changing event).
      document.getElementById('btn-replay-tour')?.classList.toggle('hidden', !canEdit());
      // A-4: move focus to the first menu item when the dropdown opens.
      const firstItem = _visibleMenuItems(moreDropdown)[0];
      requestAnimationFrame(() => firstItem?.focus());
    }
  });
  // A-4: Arrow-key navigation and Escape within the more-dropdown.
  moreDropdown?.addEventListener('keydown', (e) => {
    // offsetParent is null for a display:none element regardless of which
    // mechanism hid it — data-readonly-hide's CSS rule (styles/modals.css)
    // or #btn-replay-tour's own canEdit()-driven .hidden toggle just above
    // — so this doesn't need to know which one applies. Without this, Arrow
    // navigation could try to focus a hidden item (a no-op — focus() does
    // nothing on a display:none element), leaving the actually-focused item
    // unchanged and every further press repeating the same no-op instead of
    // reaching the next real item.
    const items = _visibleMenuItems(moreDropdown);
    const idx   = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMoreDropdown();
      moreBtn?.focus();
    } else if (e.key === 'Tab') {
      // Close the dropdown when tabbing out of it.
      closeMoreDropdown();
    }
  });
  document.addEventListener('click', (e) => {
    if (!moreDropdown?.contains(e.target) && e.target !== moreBtn) closeMoreDropdown();
  });
  // No separate global Escape listener here: shortcuts.js's document-level
  // keydown handler already calls onForceClose() (wired in app/wiring.js) on
  // every Escape press, which does the same closeMoreDropdown() +
  // UI.closeAllPanels() + UI.closeAllModals() this used to duplicate here
  // (plus _closeEditorContextMenu(), which this listener never covered) —
  // having both fire on the same keypress was redundant, not two different
  // behaviors.

  document.getElementById('btn-share')?.addEventListener('click', () => {
    _openShareModal();
  });

  document.getElementById('room-name')?.addEventListener('click', () => {
    copyToClipboard(buildRoomUrl(BASE, state.roomId))
      .then(ok => ok
        ? UI.showToast('Room link copied!', 'success')
        : UI.showToast('Could not copy link.', 'error'));
  });

  document.getElementById('room-title-edit-btn')?.addEventListener('click', () => {
    if (!canEdit()) return;
    UI.setRoomTitleEditMode(true, (state.room?.room_name || '').trim());
  });
  document.getElementById('room-title-cancel-btn')?.addEventListener('click', () => UI.setRoomTitleEditMode(false));
  const saveTitle = async () => {
    if (!canEdit()) return;
    const input = document.getElementById('room-title-input');
    const normalized = normalizeRoomDisplayName(input?.value || '');
    // No-op when the name hasn't actually changed — avoids an unnecessary DB
    // write and a misleading "Room title updated." toast on blur without edits.
    if (normalized === (state.room?.room_name || '').trim()) {
      UI.setRoomTitleEditMode(false);
      return;
    }
    const saveBtn = document.getElementById('room-title-save-btn');
    if (saveBtn) saveBtn.disabled = true;
    try {
      await updateRoomDisplayName(state.roomId, normalized);
      state.room.room_name = normalized;
      _renderRoomHeader();
      UI.setRoomTitleEditMode(false);
      UI.showToast('Room title updated.', 'success');
    } catch {
      // Keep edit mode open so the user can retry without clicking Edit again.
      if (saveBtn) saveBtn.disabled = false;
      input?.focus();
      input?.select();
      UI.showToast('Could not save title — check your connection and try again.', 'error');
    }
  };
  document.getElementById('room-title-save-btn')?.addEventListener('click', saveTitle);
  document.getElementById('room-title-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
    if (e.key === 'Escape') { e.preventDefault(); UI.setRoomTitleEditMode(false); }
  });

}

export function _wireSegmentedMarkdownControl() {
  // ── Segmented markdown control ─────────────────────────────────────────────
  document.querySelectorAll('.md-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (!mode) return;
      _applyMarkdownMode(mode);
    });
  });

}

export function _wireMobileActionBar() {
  // ── Mobile action bar ──────────────────────────────────────────────────────
  // No Share button here — the header's own #btn-share already covers it.
  document.getElementById('mob-btn-files')?.addEventListener('click',    () => UI.togglePanel('files-panel'));
  document.getElementById('mob-btn-tools')?.addEventListener('click',    () => UI.togglePanel('tools-panel'));
  document.getElementById('mob-btn-presence')?.addEventListener('click', () => UI.togglePanel('presence-panel'));
  document.getElementById('mob-btn-settings')?.addEventListener('click', () => UI.togglePanel('settings-panel'));

}

export function _wireFooterQuickButtons() {
  // ── Footer quick buttons ───────────────────────────────────────────────────
  document.getElementById('btn-insert-ts')?.addEventListener('click', () => {
    if (!canEdit()) { UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning'); return; }
    _insertTextAtActiveCursor(insertTimestamp());
  });
  UI.initFooterClock();

  document.getElementById('btn-add-comment-fab')?.addEventListener('click', () => _openFloatingCommentComposer());

}
