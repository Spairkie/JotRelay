// SyncPad – admin/files-tab.js
// The Files tab: search, pagination, storage totals, per-file delete.

import { state } from './state.js';
import { escapeHtml, formatFileSize, formatTimestamp } from '../utils.js';
import { showConfirm, showAlert } from '../ui.js';
import {
  FILES_PAGE_SIZE, FILES_BUCKET,
  _accessDeniedHtml, _showToast, _friendlyErrorMessage, _logAdminAction,
  _renderPager, _escapePostgrestFilterValue,
} from './shared.js';
import { _loadStats } from './stats.js';
import { _openRoomDetail } from './room-drawer.js';

const FILES_SELECT_COLS = 'id, filename, room_id, file_size, mime_type, uploaded_at, file_path, encrypted';

let _filesSearch = '';

/** Apply the current Files tab search box to a query — shared by the
 *  paginated fetch so search covers every matching file, not just
 *  whatever page happened to be loaded already. */
function _applyFilesFilters(q) {
  if (_filesSearch) {
    const s = `%${_escapePostgrestFilterValue(_filesSearch)}%`;
    q = q.or(`filename.ilike."${s}",room_id.ilike."${s}"`);
  }
  return q;
}

async function _fetchFiles(offset) {
  const q = state.sb.from('syncpad_files')
    .select(FILES_SELECT_COLS, { count: 'exact' })
    .order('uploaded_at', { ascending: false })
    .range(offset, offset + FILES_PAGE_SIZE - 1);
  return _applyFilesFilters(q);
}

export async function _renderFilesTab(contentEl) {
  state.filesOffset = 0; state.files = []; _filesSearch = '';

  const [filesRes, statsRes] = await Promise.allSettled([
    _fetchFiles(0),
    state.sb.from('syncpad_files').select('file_size'),
  ]);

  if (filesRes.status === 'rejected' || filesRes.value?.error) {
    contentEl.innerHTML = _accessDeniedHtml(filesRes.value?.error || filesRes.reason);
    return;
  }

  state.files      = filesRes.value.data || [];
  state.filesTotal = filesRes.value.count ?? 0;

  const allFiles  = statsRes.status === 'fulfilled' ? statsRes.value.data || [] : [];
  const totalSize = allFiles.reduce((s, f) => s + (f.file_size || 0), 0);

  contentEl.innerHTML = `
    <div class="admin-tab-content">

      <div class="admin-file-stats-row">
        <div class="admin-file-stat">
          <div class="admin-file-stat-value">${state.filesTotal}</div>
          <div class="admin-file-stat-label">Total files</div>
        </div>
        <div class="admin-file-stat">
          <div class="admin-file-stat-value">${formatFileSize(totalSize)}</div>
          <div class="admin-file-stat-label">Total storage used</div>
        </div>
      </div>

      <div class="admin-toolbar">
        <input id="admin-files-search" class="admin-search-input" placeholder="Search by filename or room ID…" autocomplete="off" />
        <span class="admin-count-label" id="admin-files-count"></span>
      </div>

      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Room ID</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th>Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="admin-files-tbody"></tbody>
        </table>
        <div id="admin-files-empty" class="admin-empty hidden">No files found.</div>
      </div>

      <div class="admin-pager-row" id="admin-files-pager"></div>

    </div>`;

  _wireFilesTab();
}

function _wireFilesTab() {
  const tbody    = document.getElementById('admin-files-tbody');
  const emptyEl  = document.getElementById('admin-files-empty');
  const countEl  = document.getElementById('admin-files-count');
  const pagerEl  = document.getElementById('admin-files-pager');
  const searchEl = document.getElementById('admin-files-search');

  async function goToPage(offset) {
    state.filesOffset = offset;
    const r = await _fetchFiles(offset);
    if (!r.error) { state.files = r.data || []; state.filesTotal = r.count ?? 0; }
    renderRows();
  }

  let searchTimer;
  searchEl?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _filesSearch = searchEl.value.trim();
      goToPage(0);
    }, 300);
  });

  function renderRows() {
    tbody.innerHTML = '';

    if (!state.files.length) {
      emptyEl.textContent = _filesSearch ? 'No files match your search.' : 'No files found.';
      emptyEl.classList.remove('hidden');
      if (countEl) countEl.textContent = '0 files';
      if (pagerEl) pagerEl.innerHTML = '';
      return;
    }
    emptyEl.classList.add('hidden');

    tbody.insertAdjacentHTML('beforeend', state.files.map(f => `
      <tr data-file-id="${escapeHtml(String(f.id))}">
        <td class="admin-filename">${f.encrypted ? '🔒 ' : ''}${escapeHtml(f.filename || '—')}</td>
        <td>
          <button class="admin-room-id-btn admin-room-id" data-room-id="${escapeHtml(f.room_id || '')}">${escapeHtml(f.room_id || '—')}</button>
        </td>
        <td class="admin-ts">${formatFileSize(f.file_size)}</td>
        <td class="admin-ts">${formatTimestamp(f.uploaded_at)}</td>
        <td class="admin-ts">${escapeHtml((f.mime_type || '').split('/')[1] || f.mime_type || '—')}</td>
        <td class="admin-actions">
          <button class="admin-action-btn admin-action-delete" data-file-id="${escapeHtml(String(f.id))}" data-file-path="${escapeHtml(f.file_path || '')}" data-filename="${escapeHtml(f.filename || '')}" title="Delete file">🗑 Delete</button>
        </td>
      </tr>`).join(''));

    if (countEl) countEl.textContent = `${state.filesTotal} file${state.filesTotal !== 1 ? 's' : ''}`;
    _renderPager(pagerEl, {
      offset: state.filesOffset, pageSize: FILES_PAGE_SIZE,
      loadedCount: state.files.length, total: state.filesTotal,
      onNavigate: goToPage,
    });

    // Wire room ID links
    tbody.querySelectorAll('.admin-room-id-btn:not([data-wired])').forEach(btn => {
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => { if (btn.dataset.roomId) _openRoomDetail(btn.dataset.roomId); });
    });

    // Wire delete buttons
    tbody.querySelectorAll('.admin-action-delete:not([data-wired])').forEach(btn => {
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const fileId   = btn.dataset.fileId;
        const filePath = btn.dataset.filePath;
        const filename = btn.dataset.filename;
        const ok = await showConfirm(`Delete file "${filename}"?\nThis cannot be undone.`, { confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        btn.disabled = true;

        // Delete from storage first, then DB
        const { error: se } = await state.sb.storage.from(FILES_BUCKET).remove([filePath]);
        if (se) {
          await showAlert(`Storage delete error: ${_friendlyErrorMessage(se)}\nThe file may already be missing.`);
          // Continue to remove DB row regardless
        }
        const { error: de } = await state.sb.from('syncpad_files').delete().eq('id', fileId);
        if (de) { await showAlert(`DB row delete error: ${_friendlyErrorMessage(de)}`); btn.disabled = false; return; }

        const idx = state.files.findIndex(f => String(f.id) === fileId);
        if (idx !== -1) state.files.splice(idx, 1);
        await _logAdminAction('delete_file', { target_file_id: fileId });
        state.filesTotal = Math.max(0, state.filesTotal - 1);
        await _loadStats();
        renderRows();
        _showToast('File deleted.', 'success');
      });
    });
  }

  renderRows();
}
