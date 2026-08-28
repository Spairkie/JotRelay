// JotRelay – admin/rooms-tab.js
// The Rooms tab: filter/search/sort, pagination, CSV export, bulk actions,
// and per-row actions (clear/copy/detail/delete).

import { state } from './state.js';
import { escapeHtml, formatTimestamp } from '../utils.js';
import { showConfirm, showAlert } from '../ui.js';
import {
  ROOMS_PAGE_SIZE, ADMIN_QUERY_BATCH_SIZE,
  _accessDeniedHtml, _isExpired, _roomUrl, _showToast, _friendlyErrorMessage,
  _logAdminAction, _adminTypedConfirm, _deleteRoomAndStorage, _renderPager,
  _selectAllPages, _chunks, _escapePostgrestFilterValue,
} from './shared.js';
import { _loadStats } from './stats.js';
import { _openRoomDetail } from './room-drawer.js';

export async function _renderRoomsTab(contentEl) {
  state.roomsOffset = 0;
  state.rooms = [];
  state.roomsSelected.clear();

  const selectCols = [
    'room_id', 'room_name', 'updated_at', 'created_at', 'expires_at',
    'encryption_enabled', 'passcode_hash', 'view_once', 'editing_locked', 'content',
    ...state.hasQuarantine ? ['quarantined_at', 'quarantine_reason'] : [],
  ].join(', ');

  // ── Load first page ───────────────────────────────────────────
  const result = await _fetchRooms(selectCols, 0);
  if (result.error) { contentEl.innerHTML = _accessDeniedHtml(result.error); return; }
  state.rooms = result.data || [];
  state.roomsTotal = result.count ?? 0;

  // ── Build UI ───────────────────────────────────────────────────
  contentEl.innerHTML = `
    <div class="admin-tab-content">

      <div class="admin-filter-chips" id="admin-room-filter-chips" role="group" aria-label="Filter rooms">
        ${_roomFilterChips()}
      </div>

      <div class="admin-toolbar">
        <input id="admin-room-search" class="admin-search-input" placeholder="Search by ID or name… (press /)" autocomplete="off" />
        <span class="admin-count-label" id="admin-room-count"></span>
        <button class="admin-action-btn" id="admin-rooms-export" title="Export the current filter/search as CSV">⬇ Export CSV</button>
      </div>

      <div class="admin-bulk-bar hidden" id="admin-rooms-bulk-bar">
        <span class="admin-bulk-label" id="admin-bulk-label"></span>
        <button class="admin-action-btn admin-action-clear" id="admin-bulk-clear">🧹 Clear selected</button>
        <button class="admin-action-btn admin-action-danger" id="admin-bulk-delete">🗑 Delete selected</button>
        <button class="admin-action-btn" id="admin-bulk-deselect">✕ Deselect all</button>
      </div>

      <div class="admin-table-wrap" id="admin-rooms-table-wrap">
        <table class="admin-table" id="admin-rooms-table">
          <thead>
            <tr>
              <th class="admin-th-check"><input type="checkbox" id="admin-rooms-select-all" aria-label="Select all visible rooms" /></th>
              <th class="admin-th-sortable" data-col="room_name">Room <span class="admin-sort-icon" id="sort-icon-room_name"></span></th>
              <th class="admin-th-sortable" data-col="updated_at">Updated <span class="admin-sort-icon" id="sort-icon-updated_at">↓</span></th>
              <th class="admin-th-sortable" data-col="created_at">Created <span class="admin-sort-icon" id="sort-icon-created_at"></span></th>
              <th>Flags</th>
              <th class="admin-th-content-hide">Content</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="admin-rooms-tbody"></tbody>
        </table>
        <div id="admin-rooms-empty" class="admin-empty hidden"></div>
      </div>

      <div class="admin-pager-row" id="admin-rooms-pager"></div>

    </div>`;

  _wireRoomsTab(contentEl, selectCols);
}

function _roomFilterChips() {
  const filters = [
    { id: 'all',         label: 'All' },
    { id: 'active',      label: 'Active' },
    { id: 'active-today', label: 'Active today' },
    { id: 'expired',     label: 'Expired' },
    { id: 'encrypted',   label: 'Encrypted' },
    { id: 'passcode',    label: 'Passcode' },
    { id: 'locked',      label: 'Locked' },
    ...(state.hasQuarantine ? [{ id: 'quarantined', label: 'Quarantined' }] : []),
  ];
  return filters.map(f =>
    `<button class="admin-chip${state.roomsFilter === f.id ? ' active' : ''}" data-filter="${f.id}">${f.label}</button>`
  ).join('');
}

/**
 * Apply the current Rooms tab filter chip + search box to a query. Shared by
 * the paginated fetch and the CSV export, so "export" always means "export
 * exactly what's on screen" rather than drifting from it over time.
 */
function _applyRoomsFilters(q) {
  const now = new Date().toISOString();
  if (state.roomsFilter === 'active')      q = q.or(`expires_at.is.null,expires_at.gt.${now}`);
  else if (state.roomsFilter === 'active-today') q = q.gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  else if (state.roomsFilter === 'expired') q = q.lt('expires_at', now).not('expires_at', 'is', null);
  else if (state.roomsFilter === 'encrypted') q = q.eq('encryption_enabled', true);
  else if (state.roomsFilter === 'passcode')  q = q.not('passcode_hash', 'is', null);
  else if (state.roomsFilter === 'locked')    q = q.eq('editing_locked', true);
  else if (state.roomsFilter === 'quarantined' && state.hasQuarantine)
    q = q.not('quarantined_at', 'is', null);

  if (state.roomsSearch) {
    // PostgREST's .or() filter string treats comma/parenthesis/period as
    // syntax (condition separators, grouping), so a search term containing
    // one would otherwise break the query — wrap the value in double quotes
    // (escaping any backslash/quote within it) so it's taken literally.
    const s = `%${_escapePostgrestFilterValue(state.roomsSearch)}%`;
    q = q.or(`room_id.ilike."${s}",room_name.ilike."${s}"`);
  }
  return q;
}

async function _fetchRooms(selectCols, offset) {
  const q = state.sb.from('syncpad_rooms')
    .select(selectCols, { count: 'exact' })
    .order(state.roomsSort.col, { ascending: state.roomsSort.dir === 'asc' })
    .range(offset, offset + ROOMS_PAGE_SIZE - 1);
  return _applyRoomsFilters(q);
}

/**
 * Export every room matching the current filter/search (not just the
 * visible page) as a downloadable CSV. Room content is deliberately
 * excluded — this is a metadata export for record-keeping/audits, not a
 * bulk content dump.
 */
async function _exportRoomsCsv() {
  const btn = document.getElementById('admin-rooms-export');
  if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }

  const cols = [
    'room_id', 'room_name', 'created_at', 'updated_at', 'expires_at',
    'encryption_enabled', 'passcode_hash', 'view_once', 'editing_locked',
    ...state.hasQuarantine ? ['quarantined_at'] : [],
  ].join(', ');

  const { rows, error } = await _selectAllPages((from, to) =>
    _applyRoomsFilters(
      state.sb.from('syncpad_rooms').select(cols).order('room_id', { ascending: true }).range(from, to)
    )
  );

  if (btn) { btn.disabled = false; btn.textContent = '⬇ Export CSV'; }
  if (error) { await showAlert(`Export failed: ${_friendlyErrorMessage(error)}`); return; }
  if (!rows.length) { _showToast('No rooms match the current filter — nothing to export.', ''); return; }

  const header = [
    'room_id', 'room_name', 'created_at', 'updated_at', 'expires_at',
    'encrypted', 'has_passcode', 'view_once', 'editing_locked',
    ...state.hasQuarantine ? ['quarantined'] : [],
  ];
  const csvRows = rows.map((r) => [
    r.room_id, r.room_name || '', r.created_at || '', r.updated_at || '', r.expires_at || '',
    r.encryption_enabled ? 'yes' : 'no', r.passcode_hash ? 'yes' : 'no',
    r.view_once ? 'yes' : 'no', r.editing_locked ? 'yes' : 'no',
    ...state.hasQuarantine ? [r.quarantined_at ? 'yes' : 'no'] : [],
  ]);

  _downloadCsv(`jotrelay-rooms-${new Date().toISOString().slice(0, 10)}.csv`, header, csvRows);
  await _logAdminAction('export_rooms_csv', { metadata: { count: rows.length } });
  _showToast(`Exported ${rows.length} room${rows.length !== 1 ? 's' : ''}.`, 'success');
}

/** RFC 4180-ish CSV serialization: quote a field only when it needs it. */
function _toCsv(header, rows) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    // room_name is fully user-controlled; a leading =/+/-/@ opens it as a
    // formula in Excel/Sheets/LibreOffice (classic CSV/formula injection —
    // e.g. `=HYPERLINK("http://evil.example","click")`). Prefix with a
    // apostrophe, the standard neutralizer these apps already treat as
    // "force text", same as GitHub/GitLab do for CSV exports of user content.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((row) => row.map(esc).join(',')).join('\r\n');
}

function _downloadCsv(filename, header, rows) {
  const blob = new Blob([_toCsv(header, rows)], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function _wireRoomsTab(contentEl, selectCols) {
  const tbody      = document.getElementById('admin-rooms-tbody');
  const searchEl   = document.getElementById('admin-room-search');
  const countEl    = document.getElementById('admin-room-count');
  const emptyEl    = document.getElementById('admin-rooms-empty');
  const bulkBar    = document.getElementById('admin-rooms-bulk-bar');
  const bulkLabel  = document.getElementById('admin-bulk-label');
  const pagerEl    = document.getElementById('admin-rooms-pager');

  // ── Shared page loader — fetches exactly one page at `offset` and
  //    replaces the current row set. Used by search/filter/sort (always
  //    offset 0, since the result set changed shape) and by the pager's
  //    Prev/Next (offset ± ROOMS_PAGE_SIZE).
  async function goToPage(offset) {
    state.roomsOffset = offset;
    const r = await _fetchRooms(selectCols, offset);
    if (!r.error) { state.rooms = r.data || []; state.roomsTotal = r.count ?? 0; }
    renderRows();
  }

  // ── Search (debounced) ─────────────────────────────────────────
  let searchTimer;
  searchEl.value = state.roomsSearch;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.roomsSearch = searchEl.value.trim();
      state.roomsSelected.clear();
      goToPage(0);
    }, 300);
  });

  // ── Filter chips ───────────────────────────────────────────────
  document.getElementById('admin-room-filter-chips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.admin-chip');
    if (!chip) return;
    state.roomsFilter = chip.dataset.filter;
    state.roomsSelected.clear();
    document.querySelectorAll('.admin-chip').forEach(c => c.classList.toggle('active', c === chip));
    goToPage(0);
  });

  // ── Column sorting ─────────────────────────────────────────────
  document.querySelectorAll('.admin-th-sortable').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.roomsSort.col === col) {
        state.roomsSort.dir = state.roomsSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.roomsSort = { col, dir: 'desc' };
      }
      // Update sort icons
      document.querySelectorAll('.admin-sort-icon').forEach(ic => ic.textContent = '');
      const icon = document.getElementById(`sort-icon-${col}`);
      if (icon) icon.textContent = state.roomsSort.dir === 'asc' ? '↑' : '↓';

      state.roomsSelected.clear();
      goToPage(0);
    });
  });

  // ── CSV export (current filter/search, every matching row — not just
  //    the visible page) ──────────────────────────────────────────
  document.getElementById('admin-rooms-export')?.addEventListener('click', () => _exportRoomsCsv());

  // ── Select-all checkbox ────────────────────────────────────────
  document.getElementById('admin-rooms-select-all')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    state.rooms.forEach(r => checked ? state.roomsSelected.add(r.room_id) : state.roomsSelected.delete(r.room_id));
    tbody.querySelectorAll('.admin-row-check').forEach(cb => { cb.checked = checked; });
    updateBulkBar();
  });

  // ── Bulk action bar ────────────────────────────────────────────
  function updateBulkBar() {
    const count = state.roomsSelected.size;
    bulkBar.classList.toggle('hidden', count === 0);
    if (bulkLabel) bulkLabel.textContent = `${count} room${count !== 1 ? 's' : ''} selected`;
  }

  document.getElementById('admin-bulk-deselect')?.addEventListener('click', () => {
    state.roomsSelected.clear();
    tbody.querySelectorAll('.admin-row-check').forEach(cb => { cb.checked = false; });
    const selectAll = document.getElementById('admin-rooms-select-all');
    if (selectAll) selectAll.checked = false;
    updateBulkBar();
  });

  document.getElementById('admin-bulk-clear')?.addEventListener('click', async () => {
    const ids = Array.from(state.roomsSelected);
    const ok = await showConfirm(
      `Clear content from ${ids.length} room${ids.length !== 1 ? 's' : ''}?\n\nThe rooms are kept; only the note text is removed. This cannot be undone.`,
      { confirmLabel: 'Clear all', danger: true }
    );
    if (!ok) return;
    let errs = 0;
    for (const batch of _chunks(ids, ADMIN_QUERY_BATCH_SIZE)) {
      const { error } = await state.sb.from('syncpad_rooms')
        .update({ content: '', cleared_reason: 'manual' })
        .in('room_id', batch);
      if (error) { errs++; console.error('[admin] bulk-clear error', error); }
      else {
        batch.forEach(id => {
          const room = state.rooms.find(r => r.room_id === id);
          if (room) room.content = '';
        });
      }
    }
    await _logAdminAction('bulk_clear_rooms', { metadata: { count: ids.length } });
    state.roomsSelected.clear();
    updateBulkBar();
    renderRows();
    await _loadStats();
    if (errs) await showAlert(`${errs} room(s) could not be cleared. Check console for details.`);
    else _showToast(`Cleared ${ids.length} room${ids.length !== 1 ? 's' : ''}.`, 'success');
  });

  document.getElementById('admin-bulk-delete')?.addEventListener('click', async () => {
    const ids = Array.from(state.roomsSelected);
    const ok = await _adminTypedConfirm(
      `Permanently delete ${ids.length} room${ids.length !== 1 ? 's' : ''}?`,
      `This will delete all files in these rooms and cannot be undone.\n\nType DELETE to confirm:`,
      'DELETE',
    );
    if (!ok) return;
    let errs = 0;
    for (const id of ids) {
      const { error } = await _deleteRoomAndStorage(id);
      if (error) { errs++; console.error('[admin] bulk-delete error', id, error); }
      else {
        const idx = state.rooms.findIndex(r => r.room_id === id);
        if (idx !== -1) { state.rooms.splice(idx, 1); state.roomsTotal = Math.max(0, state.roomsTotal - 1); }
      }
    }
    await _logAdminAction('bulk_delete_rooms', { metadata: { count: ids.length } });
    state.roomsSelected.clear();
    updateBulkBar();
    renderRows();
    await _loadStats();
    if (errs) await showAlert(`${errs} room(s) could not be deleted. Check console for details.`);
    else _showToast(`Deleted ${ids.length} room${ids.length !== 1 ? 's' : ''}.`, 'success');
  });

  // ── Row renderer ───────────────────────────────────────────────
  function buildFlags(room) {
    const flags = [];
    if (room.encryption_enabled) flags.push('<span class="admin-badge admin-badge--enc" title="Encrypted">ENC</span>');
    if (room.passcode_hash)      flags.push('<span class="admin-badge admin-badge--pass" title="Passcode">PASS</span>');
    if (room.view_once)          flags.push('<span class="admin-badge admin-badge--once" title="View-once">1×</span>');
    if (_isExpired(room.expires_at)) flags.push('<span class="admin-badge admin-badge--exp" title="Expired">EXP</span>');
    if (room.editing_locked)     flags.push('<span class="admin-badge admin-badge--muted" title="Editing locked">🔒</span>');
    if (state.hasQuarantine && room.quarantined_at) flags.push('<span class="admin-badge admin-badge--alert" title="Quarantined">⛔</span>');
    return flags.join(' ') || '<span class="admin-muted">—</span>';
  }

  function renderRows() {
    tbody.innerHTML = '';

    if (!state.rooms.length) {
      emptyEl.textContent = state.roomsSearch || state.roomsFilter !== 'all'
        ? 'No rooms match your search / filter.' : 'No rooms found.';
      emptyEl.classList.remove('hidden');
      if (pagerEl) pagerEl.innerHTML = '';
      return;
    }
    emptyEl.classList.add('hidden');

    const rows = state.rooms.map(room => {
      const contentPreview = room.encryption_enabled
        ? '<span class="admin-muted admin-badge admin-badge--enc">Encrypted</span>'
        : room.content
          ? escapeHtml(room.content.slice(0, 80)) + (room.content.length > 80 ? '…' : '')
          : '<span class="admin-muted">(empty)</span>';
      const isChecked = state.roomsSelected.has(room.room_id);
      return `
        <tr data-room-id="${escapeHtml(room.room_id)}">
          <td><input type="checkbox" class="admin-row-check" data-room-id="${escapeHtml(room.room_id)}" ${isChecked ? 'checked' : ''} aria-label="Select room ${escapeHtml(room.room_id)}" /></td>
          <td>
            <button class="admin-room-id-btn admin-room-id" data-room-id="${escapeHtml(room.room_id)}" title="View room details">${escapeHtml(room.room_id)}</button>
            ${room.room_name ? `<div class="admin-room-name">${escapeHtml(room.room_name)}</div>` : ''}
          </td>
          <td class="admin-ts">${formatTimestamp(room.updated_at)}</td>
          <td class="admin-ts">${formatTimestamp(room.created_at)}</td>
          <td>${buildFlags(room)}</td>
          <td class="admin-content-preview admin-th-content-hide">${contentPreview}</td>
          <td class="admin-actions">
            <a class="admin-action-btn admin-action-link" href="${_roomUrl(room.room_id)}" target="_blank" rel="noopener" title="Open room">↗</a>
            <button class="admin-action-btn admin-action-copy" data-room-id="${escapeHtml(room.room_id)}" title="Copy room link">🔗</button>
            <button class="admin-action-btn admin-action-detail" data-room-id="${escapeHtml(room.room_id)}" title="View details">…</button>
            <button class="admin-action-btn admin-action-clear" data-room-id="${escapeHtml(room.room_id)}" title="Clear note content">🧹</button>
            <button class="admin-action-btn admin-action-delete" data-room-id="${escapeHtml(room.room_id)}" title="Delete room permanently">🗑</button>
          </td>
        </tr>`;
    }).join('');
    tbody.insertAdjacentHTML('beforeend', rows);

    if (countEl) countEl.textContent = `${state.roomsTotal} room${state.roomsTotal !== 1 ? 's' : ''}`;
    _renderPager(pagerEl, {
      offset: state.roomsOffset, pageSize: ROOMS_PAGE_SIZE,
      loadedCount: state.rooms.length, total: state.roomsTotal,
      onNavigate: goToPage,
    });

    // Wire newly-added rows
    _wireRows(tbody, updateBulkBar, selectCols, renderRows);
  }

  renderRows();
}

function _wireRows(tbody, updateBulkBar, selectCols, renderRows) {
  // Checkbox selection
  tbody.querySelectorAll('.admin-row-check:not([data-wired])').forEach(cb => {
    cb.dataset.wired = '1';
    cb.addEventListener('change', () => {
      const id = cb.dataset.roomId;
      if (cb.checked) state.roomsSelected.add(id);
      else            state.roomsSelected.delete(id);
      const selectAll = document.getElementById('admin-rooms-select-all');
      if (selectAll) selectAll.checked = state.rooms.every(r => state.roomsSelected.has(r.room_id));
      updateBulkBar();
    });
  });

  // Room ID / name click → detail drawer
  tbody.querySelectorAll('.admin-room-id-btn:not([data-wired])').forEach(btn => {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => _openRoomDetail(btn.dataset.roomId));
  });

  // Detail button
  tbody.querySelectorAll('.admin-action-detail:not([data-wired])').forEach(btn => {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => _openRoomDetail(btn.dataset.roomId));
  });

  // Copy link button
  tbody.querySelectorAll('.admin-action-copy:not([data-wired])').forEach(btn => {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const url = `${location.origin}${_roomUrl(btn.dataset.roomId)}`;
      navigator.clipboard.writeText(url).then(
        () => _showToast('Room link copied.', 'success'),
        () => _showToast('Could not copy link.', 'error'),
      );
    });
  });

  // Clear button
  tbody.querySelectorAll('.admin-action-clear:not([data-wired])').forEach(btn => {
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const roomId = btn.dataset.roomId;
      const ok = await showConfirm(
        `Clear content from room "${roomId}"?\n\nThe room is kept; only the note text is removed.`,
        { confirmLabel: 'Clear content', danger: true },
      );
      if (!ok) return;
      btn.disabled = true;
      const { error } = await state.sb.from('syncpad_rooms')
        .update({ content: '', cleared_reason: 'manual' }).eq('room_id', roomId);
      if (error) {
        await showAlert(`Error clearing room: ${_friendlyErrorMessage(error)}`);
        btn.disabled = false; return;
      }
      const room = state.rooms.find(r => r.room_id === roomId);
      if (room) room.content = '';
      await _logAdminAction('clear_room', { target_room_id: roomId });
      renderRows();
      await _loadStats();
      _showToast('Room content cleared.', 'success');
    });
  });

  // Delete button
  tbody.querySelectorAll('.admin-action-delete:not([data-wired])').forEach(btn => {
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const roomId = btn.dataset.roomId;
      const ok = await _adminTypedConfirm(
        `Delete room "${roomId}"?`,
        `This permanently removes the room, all files, and all reports.\n\nType the room ID to confirm:`,
        roomId,
      );
      if (!ok) return;
      btn.disabled = true;
      const { error } = await _deleteRoomAndStorage(roomId);
      if (error) {
        await showAlert(`Error deleting room: ${_friendlyErrorMessage(error)}`);
        btn.disabled = false; return;
      }
      const idx = state.rooms.findIndex(r => r.room_id === roomId);
      if (idx !== -1) { state.rooms.splice(idx, 1); state.roomsTotal = Math.max(0, state.roomsTotal - 1); }
      await _logAdminAction('delete_room', { target_room_id: roomId });
      renderRows();
      await _loadStats();
      _showToast('Room deleted.', 'success');
    });
  });
}
