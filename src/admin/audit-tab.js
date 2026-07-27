// SyncPad – admin/audit-tab.js
// The Audit Log tab: paginated admin-action history, or an empty-state
// pointing at the migration when the audit table doesn't exist yet.

import { state } from './state.js';
import { escapeHtml, formatTimestamp } from '../utils.js';
import { AUDIT_PAGE_SIZE, _accessDeniedHtml, _renderPager } from './shared.js';
import { _openRoomDetail } from './room-drawer.js';

export async function _renderAuditTab(contentEl) {
  if (!state.hasAuditTable) {
    contentEl.innerHTML = `
      <div class="admin-tab-content">
        <div class="admin-empty admin-audit-empty">
          <div class="admin-audit-empty-icon">📋</div>
          <div class="admin-audit-empty-title">Audit log not configured</div>
          <div class="admin-audit-empty-body">
            The <code>syncpad_admin_audit_logs</code> table does not exist yet.
            Run the migration to enable audit logging for all admin actions.
          </div>
          <div class="admin-audit-empty-actions">
            <a class="admin-action-btn admin-action-primary" href="https://github.com/Spairkie/SyncPad/blob/main/supabase/migrations/0006_admin_dashboard_improvements.sql" target="_blank" rel="noopener">View migration SQL</a>
          </div>
        </div>
      </div>`;
    return;
  }

  state.auditOffset = 0; state.audit = [];
  const { data, error, count } = await state.sb
    .from('syncpad_admin_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(0, AUDIT_PAGE_SIZE - 1);

  if (error) { contentEl.innerHTML = _accessDeniedHtml(error); return; }
  state.audit = data || [];
  let total = count ?? 0;

  contentEl.innerHTML = `
    <div class="admin-tab-content">
      <div class="admin-toolbar">
        <span class="admin-count-label" id="admin-audit-count"></span>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Admin</th>
              <th>Action</th>
              <th>Target Room</th>
              <th>Result</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody id="admin-audit-tbody"></tbody>
        </table>
        <div id="admin-audit-empty" class="admin-empty hidden">No audit logs found.</div>
      </div>
      <div class="admin-pager-row" id="admin-audit-pager"></div>
    </div>`;

  const tbody   = document.getElementById('admin-audit-tbody');
  const emptyEl = document.getElementById('admin-audit-empty');
  const countEl = document.getElementById('admin-audit-count');
  const pagerEl = document.getElementById('admin-audit-pager');

  async function goToPage(offset) {
    state.auditOffset = offset;
    const { data: page, error: e2, count: c2 } = await state.sb
      .from('syncpad_admin_audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + AUDIT_PAGE_SIZE - 1);
    if (!e2) { state.audit = page || []; total = c2 ?? total; }
    renderRows();
  }

  function renderRows() {
    tbody.innerHTML = '';
    if (!state.audit.length) {
      emptyEl.textContent = 'No audit logs yet.'; emptyEl.classList.remove('hidden');
      if (countEl) countEl.textContent = '0 entries';
      if (pagerEl) pagerEl.innerHTML = '';
      return;
    }
    emptyEl.classList.add('hidden');
    tbody.insertAdjacentHTML('beforeend', state.audit.map(log => `
      <tr>
        <td class="admin-ts">${escapeHtml(log.admin_email || '—')}</td>
        <td><code class="admin-audit-action">${escapeHtml(log.action_type || '—')}</code></td>
        <td>${log.target_room_id ? `<button class="admin-room-id-btn admin-room-id" data-room-id="${escapeHtml(log.target_room_id)}">${escapeHtml(log.target_room_id)}</button>` : '<span class="admin-muted">—</span>'}</td>
        <td><span class="admin-badge ${log.result === 'failure' ? 'admin-badge--alert' : 'admin-badge--reviewed'}">${escapeHtml(log.result || 'success')}</span></td>
        <td class="admin-ts">${formatTimestamp(log.created_at)}</td>
      </tr>`).join(''));

    if (countEl) countEl.textContent = `${total} log entr${total !== 1 ? 'ies' : 'y'}`;
    _renderPager(pagerEl, {
      offset: state.auditOffset, pageSize: AUDIT_PAGE_SIZE,
      loadedCount: state.audit.length, total,
      onNavigate: goToPage,
    });

    tbody.querySelectorAll('.admin-room-id-btn:not([data-wired])').forEach(btn => {
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => _openRoomDetail(btn.dataset.roomId));
    });
  }

  renderRows();
}
