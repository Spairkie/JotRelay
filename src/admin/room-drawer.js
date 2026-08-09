// JotRelay – admin/room-drawer.js
// The room detail drawer: fetch + render a single room's full detail, and
// wire its inline actions (clear/lock/quarantine/delete).

import { state } from './state.js';
import { escapeHtml, formatFileSize } from '../utils.js';
import { showConfirm, showPrompt, showAlert } from '../ui.js';
import {
  _fullDate, _isExpired, _roomUrl, _showToast, _friendlyErrorMessage,
  _logAdminAction, _adminTypedConfirm, _deleteRoomAndStorage,
} from './shared.js';
import { _loadStats } from './stats.js';

export async function _openRoomDetail(roomId) {
  const drawer    = document.getElementById('admin-drawer');
  const inner     = document.getElementById('admin-drawer-inner');
  const backdrop  = document.getElementById('admin-drawer-backdrop');
  if (!drawer || !inner) return;

  inner.innerHTML = `<div class="admin-drawer-loading">Loading room details…</div>`;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('visible');

  // Fetch detailed room data
  const selectCols = [
    'room_id', 'room_name', 'content', 'created_at', 'updated_at', 'expires_at',
    'encryption_enabled', 'passcode_hash', 'view_once', 'viewed', 'editing_locked',
    'cleared_reason',
    ...(state.hasQuarantine ? ['quarantined_at', 'quarantined_by', 'quarantine_reason'] : []),
  ].join(', ');

  const [roomRes, filesRes, reportsRes] = await Promise.allSettled([
    state.sb.from('syncpad_rooms').select(selectCols).eq('room_id', roomId).single(),
    state.sb.from('syncpad_files').select('id, filename, file_size, mime_type, uploaded_at').eq('room_id', roomId),
    state.sb.from('syncpad_room_reports').select('id, report_reason, status, created_at').eq('room_id', roomId).order('created_at', { ascending: false }).limit(5),
  ]);

  const room    = roomRes.status === 'fulfilled'    ? roomRes.value.data    : null;
  const files   = filesRes.status === 'fulfilled'   ? filesRes.value.data  || [] : [];
  const reports = reportsRes.status === 'fulfilled' ? reportsRes.value.data || [] : [];

  if (!room) {
    inner.innerHTML = `<div class="admin-drawer-loading">Room not found or access denied.</div>`;
    return;
  }

  const totalFileSize = files.reduce((s, f) => s + (f.file_size || 0), 0);
  const isQuarantined = state.hasQuarantine && !!room.quarantined_at;

  inner.innerHTML = `
    <div class="admin-drawer-header">
      <h2 class="admin-drawer-title">Room Details</h2>
      <button class="admin-drawer-close" id="admin-drawer-close-btn" aria-label="Close drawer">✕</button>
    </div>

    <div class="admin-drawer-body">

      <div class="admin-detail-section">
        <div class="admin-detail-row admin-detail-row--id">
          <span class="admin-detail-label">Room ID</span>
          <span class="admin-detail-value admin-detail-id">${escapeHtml(room.room_id)}
            <button class="admin-detail-copy" data-copy="${escapeHtml(room.room_id)}" title="Copy room ID">📋</button>
          </span>
        </div>
        ${room.room_name ? `
        <div class="admin-detail-row">
          <span class="admin-detail-label">Name</span>
          <span class="admin-detail-value">${escapeHtml(room.room_name)}</span>
        </div>` : ''}
        <div class="admin-detail-row">
          <span class="admin-detail-label">Created</span>
          <span class="admin-detail-value">${_fullDate(room.created_at)}</span>
        </div>
        <div class="admin-detail-row">
          <span class="admin-detail-label">Last updated</span>
          <span class="admin-detail-value">${_fullDate(room.updated_at)}</span>
        </div>
        <div class="admin-detail-row">
          <span class="admin-detail-label">Expires</span>
          <span class="admin-detail-value">${room.expires_at ? `${_fullDate(room.expires_at)} (${_isExpired(room.expires_at) ? 'expired' : 'active'})` : 'Never'}</span>
        </div>
      </div>

      <div class="admin-detail-section">
        <div class="admin-detail-row">
          <span class="admin-detail-label">Encrypted</span>
          <span class="admin-detail-value">${room.encryption_enabled ? '🔐 Yes' : 'No'}</span>
        </div>
        <div class="admin-detail-row">
          <span class="admin-detail-label">Passcode</span>
          <span class="admin-detail-value">${room.passcode_hash ? '🔑 Yes' : 'No'}</span>
        </div>
        <div class="admin-detail-row">
          <span class="admin-detail-label">View-once</span>
          <span class="admin-detail-value">${room.view_once ? `Yes${room.viewed ? ' (viewed)' : ' (not yet viewed)'}` : 'No'}</span>
        </div>
        <div class="admin-detail-row">
          <span class="admin-detail-label">Editing locked</span>
          <span class="admin-detail-value">${room.editing_locked ? '🔒 Yes' : 'No'}</span>
        </div>
        ${state.hasQuarantine ? `
        <div class="admin-detail-row">
          <span class="admin-detail-label">Quarantined</span>
          <span class="admin-detail-value">${isQuarantined ? `⛔ Yes — ${escapeHtml(room.quarantine_reason || '')} (${_fullDate(room.quarantined_at)})` : 'No'}</span>
        </div>` : ''}
      </div>

      <div class="admin-detail-section">
        <div class="admin-detail-row">
          <span class="admin-detail-label">Files</span>
          <span class="admin-detail-value">${files.length} file${files.length !== 1 ? 's' : ''} (${formatFileSize(totalFileSize)})</span>
        </div>
        <div class="admin-detail-row">
          <span class="admin-detail-label">Reports</span>
          <span class="admin-detail-value">${reports.length ? reports.map(r => `<span class="admin-badge admin-badge--${r.status === 'new' ? 'alert' : 'muted'}">${escapeHtml(r.report_reason || r.status)}</span>`).join(' ') : 'None'}</span>
        </div>
        ${!room.encryption_enabled && room.content ? `
        <div class="admin-detail-row admin-detail-row--vertical">
          <span class="admin-detail-label">Content preview</span>
          <pre class="admin-detail-content-preview">${escapeHtml(room.content.slice(0, 300))}${room.content.length > 300 ? '\n…' : ''}</pre>
        </div>` : ''}
      </div>

      <div class="admin-detail-actions">
        <a class="admin-action-btn admin-action-primary" href="${_roomUrl(room.room_id)}" target="_blank" rel="noopener">↗ Open room</a>
        <button class="admin-action-btn admin-detail-copy" data-copy="${location.origin}${_roomUrl(room.room_id)}">🔗 Copy link</button>
        <button class="admin-action-btn admin-action-clear" id="drawer-clear-btn" data-room-id="${escapeHtml(room.room_id)}">🧹 Clear content</button>
        ${room.editing_locked
          ? `<button class="admin-action-btn" id="drawer-unlock-btn" data-room-id="${escapeHtml(room.room_id)}">🔓 Unlock editing</button>`
          : `<button class="admin-action-btn" id="drawer-lock-btn" data-room-id="${escapeHtml(room.room_id)}">🔒 Lock editing</button>`
        }
        ${state.hasQuarantine && !isQuarantined
          ? `<button class="admin-action-btn admin-action-danger" id="drawer-quarantine-btn" data-room-id="${escapeHtml(room.room_id)}">⛔ Quarantine</button>`
          : ''}
        ${state.hasQuarantine && isQuarantined
          ? `<button class="admin-action-btn" id="drawer-unquarantine-btn" data-room-id="${escapeHtml(room.room_id)}">✅ Unquarantine</button>`
          : ''}
        <button class="admin-action-btn admin-action-danger" id="drawer-delete-btn" data-room-id="${escapeHtml(room.room_id)}">🗑 Delete room</button>
      </div>

    </div>`;

  // Wire drawer buttons
  document.getElementById('admin-drawer-close-btn')?.addEventListener('click', _closeDrawer);

  inner.querySelectorAll('.admin-detail-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(
        () => _showToast('Copied.', 'success'),
        () => _showToast('Could not copy.', 'error'),
      );
    });
  });

  document.getElementById('drawer-clear-btn')?.addEventListener('click', async () => {
    const ok = await showConfirm(`Clear content from room "${room.room_id}"?`, { confirmLabel: 'Clear', danger: true });
    if (!ok) return;
    const { error } = await state.sb.from('syncpad_rooms').update({ content: '', cleared_reason: 'manual' }).eq('room_id', room.room_id);
    if (error) { await showAlert(`Error: ${_friendlyErrorMessage(error)}`); return; }
    await _logAdminAction('clear_room', { target_room_id: room.room_id });
    _showToast('Room cleared.', 'success');
    _closeDrawer();
    await _loadStats();
  });

  document.getElementById('drawer-lock-btn')?.addEventListener('click', async () => {
    const { error } = await state.sb.from('syncpad_rooms').update({ editing_locked: true }).eq('room_id', room.room_id);
    if (error) { await showAlert(`Error: ${_friendlyErrorMessage(error)}`); return; }
    await _logAdminAction('lock_editing', { target_room_id: room.room_id });
    _showToast('Editing locked.', 'success'); _closeDrawer();
  });
  document.getElementById('drawer-unlock-btn')?.addEventListener('click', async () => {
    const { error } = await state.sb.from('syncpad_rooms').update({ editing_locked: false }).eq('room_id', room.room_id);
    if (error) { await showAlert(`Error: ${_friendlyErrorMessage(error)}`); return; }
    await _logAdminAction('unlock_editing', { target_room_id: room.room_id });
    _showToast('Editing unlocked.', 'success'); _closeDrawer();
  });

  document.getElementById('drawer-quarantine-btn')?.addEventListener('click', async () => {
    const reasonInput = await showPrompt('Enter a reason for quarantine (optional):', { placeholder: 'e.g. Abusive content' });
    if (reasonInput === null) return; // user cancelled
    // admin_quarantine_room() rejects an empty p_reason server-side. Supply a
    // default here so the RPC and the raw-update fallback below always agree
    // on a non-empty reason, rather than the fallback silently accepting an
    // empty one the RPC intentionally disallows.
    const reason = reasonInput.trim() || 'No reason provided';
    const { error } = await state.sb.rpc('admin_quarantine_room', {
      p_room_id: room.room_id, p_reason: reason, p_quarantined_by: state.session?.user?.email || 'admin',
    });
    if (error) {
      // Fall back to direct update if RPC not available
      const { error: e2 } = await state.sb.from('syncpad_rooms').update({
        quarantined_at: new Date().toISOString(),
        quarantined_by: state.session?.user?.email || 'admin',
        quarantine_reason: reason,
      }).eq('room_id', room.room_id);
      if (e2) { await showAlert(`Error: ${_friendlyErrorMessage(e2)}`); return; }
    }
    await _logAdminAction('quarantine_room', { target_room_id: room.room_id, metadata: { reason } });
    _showToast('Room quarantined.', 'success'); _closeDrawer();
  });

  document.getElementById('drawer-unquarantine-btn')?.addEventListener('click', async () => {
    const { error } = await state.sb.rpc('admin_unquarantine_room', { p_room_id: room.room_id });
    if (error) {
      const { error: e2 } = await state.sb.from('syncpad_rooms').update({
        quarantined_at: null, quarantined_by: null, quarantine_reason: null,
      }).eq('room_id', room.room_id);
      if (e2) { await showAlert(`Error: ${_friendlyErrorMessage(e2)}`); return; }
    }
    await _logAdminAction('unquarantine_room', { target_room_id: room.room_id });
    _showToast('Room unquarantined.', 'success'); _closeDrawer();
  });

  document.getElementById('drawer-delete-btn')?.addEventListener('click', async () => {
    const ok = await _adminTypedConfirm(
      `Delete room "${room.room_id}"?`,
      `This permanently removes the room, all files, and all reports. Type the room ID to confirm:`,
      room.room_id,
    );
    if (!ok) return;
    const { error } = await _deleteRoomAndStorage(room.room_id);
    if (error) { await showAlert(`Error: ${_friendlyErrorMessage(error)}`); return; }
    const idx = state.rooms.findIndex(r => r.room_id === room.room_id);
    if (idx !== -1) state.rooms.splice(idx, 1);
    await _logAdminAction('delete_room', { target_room_id: room.room_id });
    _showToast('Room deleted.', 'success');
    _closeDrawer();
    // Re-render the rooms table
    const tbody = document.getElementById('admin-rooms-tbody');
    if (tbody) {
      const row = tbody.querySelector(`tr[data-room-id="${CSS.escape(room.room_id)}"]`);
      row?.remove();
    }
    await _loadStats();
  });
}

export function _closeDrawer() {
  const drawer    = document.getElementById('admin-drawer');
  const backdrop  = document.getElementById('admin-drawer-backdrop');
  if (!drawer) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop?.classList.remove('visible');
}
