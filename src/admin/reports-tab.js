// SyncPad – admin/reports-tab.js
// The Reports tab: filter chips, pagination, review/dismiss/delete-room actions.

import { state } from './state.js';
import { escapeHtml, formatTimestamp } from '../utils.js';
import { showAlert } from '../ui.js';
import {
  REPORTS_PAGE_SIZE, _accessDeniedHtml, _showToast, _friendlyErrorMessage,
  _logAdminAction, _adminTypedConfirm, _deleteRoomAndStorage, _renderPager,
} from './shared.js';
import { _loadStats } from './stats.js';
import { _openRoomDetail } from './room-drawer.js';

export async function _renderReportsTab(contentEl) {
  state.reportsOffset = 0;
  state.reports = [];

  const result = await _fetchReports(0);
  if (result.error) { contentEl.innerHTML = _accessDeniedHtml(result.error); return; }
  state.reports = result.data || [];
  state.reportsTotal = result.count ?? 0;

  contentEl.innerHTML = `
    <div class="admin-tab-content">

      <div class="admin-filter-chips" id="admin-report-filter-chips" role="group" aria-label="Filter reports">
        ${_reportFilterChips()}
      </div>

      <div class="admin-toolbar">
        <span class="admin-count-label" id="admin-reports-count"></span>
      </div>

      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Room ID</th>
              <th>Reason</th>
              <th>Details</th>
              <th>Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="admin-reports-tbody"></tbody>
        </table>
        <div id="admin-reports-empty" class="admin-empty hidden"></div>
      </div>

      <div class="admin-pager-row" id="admin-reports-pager"></div>

    </div>`;

  _wireReportsTab();
}

function _reportFilterChips() {
  const filters = [
    { id: 'new',      label: 'New' },
    { id: 'reviewed', label: 'Reviewed' },
    { id: 'dismissed',label: 'Dismissed' },
    { id: 'all',      label: 'All' },
  ];
  return filters.map(f =>
    `<button class="admin-chip${state.reportsFilter === f.id ? ' active' : ''}" data-filter="${f.id}">${f.label}</button>`
  ).join('');
}

async function _fetchReports(offset) {
  let q = state.sb.from('syncpad_room_reports')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + REPORTS_PAGE_SIZE - 1);
  if (state.reportsFilter !== 'all') q = q.eq('status', state.reportsFilter);
  return q;
}

function _wireReportsTab() {
  const tbody    = document.getElementById('admin-reports-tbody');
  const emptyEl  = document.getElementById('admin-reports-empty');
  const countEl  = document.getElementById('admin-reports-count');
  const pagerEl  = document.getElementById('admin-reports-pager');

  async function goToPage(offset) {
    state.reportsOffset = offset;
    const r = await _fetchReports(offset);
    if (!r.error) { state.reports = r.data || []; state.reportsTotal = r.count ?? 0; }
    renderRows();
  }

  // Filter chips
  document.getElementById('admin-report-filter-chips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.admin-chip');
    if (!chip) return;
    state.reportsFilter = chip.dataset.filter;
    document.querySelectorAll('#admin-report-filter-chips .admin-chip').forEach(c => c.classList.toggle('active', c === chip));
    goToPage(0);
  });

  function statusBadge(status) {
    const map = { new: 'admin-badge--alert', reviewed: 'admin-badge--reviewed', dismissed: 'admin-badge--muted' };
    return `<span class="admin-badge ${map[status] || 'admin-badge--muted'}">${escapeHtml(status || '—')}</span>`;
  }

  // A status change (review/dismiss/delete-room) updates state.reports in
  // place, but under a non-"all" filter chip the fetch that populated
  // state.reports only ever returned rows matching that filter — a report
  // whose new status no longer matches would otherwise sit stuck on screen
  // (still visibly "New" filter, badge now reading Reviewed/Dismissed, no
  // action buttons since those only render for status === 'new') until the
  // admin manually re-filters or pages. Drop it from the in-memory list
  // instead, matching what re-fetching that filter would actually return.
  function _pruneReportsNotMatchingFilter() {
    if (state.reportsFilter === 'all') return;
    const before = state.reports.length;
    state.reports = state.reports.filter(r => r.status === state.reportsFilter);
    state.reportsTotal -= (before - state.reports.length);
  }

  function renderRows() {
    tbody.innerHTML = '';

    if (!state.reports.length) {
      emptyEl.textContent = state.reportsFilter === 'new'
        ? '✅ No open reports. You\'re all caught up!' : 'No reports match this filter.';
      emptyEl.classList.remove('hidden');
      if (countEl) countEl.textContent = '0 reports';
      if (pagerEl) pagerEl.innerHTML = '';
      return;
    }
    emptyEl.classList.add('hidden');

    const rows = state.reports.map(rep => {
      const details = rep.report_details
        ? escapeHtml(String(rep.report_details).slice(0, 80)) + (String(rep.report_details).length > 80 ? '…' : '')
        : '<span class="admin-muted">—</span>';
      return `
        <tr data-report-id="${escapeHtml(String(rep.id))}">
          <td>
            <button class="admin-room-id-btn admin-room-id" data-room-id="${escapeHtml(rep.room_id || '')}">${escapeHtml(rep.room_id || '—')}</button>
          </td>
          <td>${escapeHtml(rep.report_reason || '—')}</td>
          <td class="admin-content-preview">${details}</td>
          <td class="admin-ts">${formatTimestamp(rep.created_at)}</td>
          <td>${statusBadge(rep.status)}</td>
          <td class="admin-actions">
            ${rep.status === 'new'
              ? `<button class="admin-action-btn admin-action-primary"    data-report-id="${escapeHtml(String(rep.id))}" data-action="review">✓ Review</button>
                 <button class="admin-action-btn"                          data-report-id="${escapeHtml(String(rep.id))}" data-action="dismiss">✕ Dismiss</button>`
              : ''
            }
            ${rep.room_id
              ? `<button class="admin-action-btn admin-action-detail"     data-room-id="${escapeHtml(rep.room_id)}" data-action="view-room">👁 Room</button>
                 <button class="admin-action-btn admin-action-delete"     data-room-id="${escapeHtml(rep.room_id)}" data-report-id="${escapeHtml(String(rep.id))}" data-action="delete-room">🗑 Delete</button>`
              : ''
            }
          </td>
        </tr>`;
    }).join('');
    tbody.insertAdjacentHTML('beforeend', rows);

    if (countEl) countEl.textContent = `${state.reportsTotal} report${state.reportsTotal !== 1 ? 's' : ''}`;
    _renderPager(pagerEl, {
      offset: state.reportsOffset, pageSize: REPORTS_PAGE_SIZE,
      loadedCount: state.reports.length, total: state.reportsTotal,
      onNavigate: goToPage,
    });

    // Wire actions
    tbody.querySelectorAll('button[data-action]:not([data-wired])').forEach(btn => {
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const action   = btn.dataset.action;
        const reportId = btn.dataset.reportId;
        const roomId   = btn.dataset.roomId;

        if (action === 'review') {
          btn.disabled = true;
          const { error } = await state.sb.from('syncpad_room_reports').update({ status: 'reviewed' }).eq('id', reportId);
          if (error) { await showAlert(`Error: ${_friendlyErrorMessage(error)}`); btn.disabled = false; return; }
          const rep = state.reports.find(r => String(r.id) === reportId);
          if (rep) rep.status = 'reviewed';
          await _logAdminAction('review_report', { target_report_id: reportId });
          _pruneReportsNotMatchingFilter();
          renderRows();
          await _loadStats();
        }
        if (action === 'dismiss') {
          btn.disabled = true;
          const { error } = await state.sb.from('syncpad_room_reports').update({ status: 'dismissed' }).eq('id', reportId);
          if (error) { await showAlert(`Error: ${_friendlyErrorMessage(error)}`); btn.disabled = false; return; }
          const rep = state.reports.find(r => String(r.id) === reportId);
          if (rep) rep.status = 'dismissed';
          await _logAdminAction('dismiss_report', { target_report_id: reportId });
          _pruneReportsNotMatchingFilter();
          renderRows();
          await _loadStats();
        }
        if (action === 'view-room') {
          _openRoomDetail(roomId);
        }
        if (action === 'delete-room') {
          const ok = await _adminTypedConfirm(
            `Delete room "${roomId}"?`,
            `Permanently deletes the room and all files. Type the room ID to confirm:`,
            roomId,
          );
          if (!ok) return;
          btn.disabled = true;
          const { error } = await _deleteRoomAndStorage(roomId);
          if (error) { await showAlert(`Error: ${_friendlyErrorMessage(error)}`); btn.disabled = false; return; }
          state.reports.forEach(r => { if (r.room_id === roomId) r.status = 'reviewed'; });
          await _logAdminAction('delete_room', { target_room_id: roomId });
          _pruneReportsNotMatchingFilter();
          renderRows();
          await _loadStats();
          _showToast('Room deleted.', 'success');
        }
      });
    });

    // Room ID links in reports
    tbody.querySelectorAll('.admin-room-id-btn:not([data-wired])').forEach(btn => {
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => { if (btn.dataset.roomId) _openRoomDetail(btn.dataset.roomId); });
    });
  }

  renderRows();
}
