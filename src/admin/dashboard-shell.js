// JotRelay – admin/dashboard-shell.js
// The dashboard frame: header, stat cards, activity chart, tab bar, drawer
// mount points, keyboard shortcuts, and tab-switch dispatch. Owns the
// module-level dashboard state's lifecycle (init on render, teardown on
// logout/re-render).
//
// `onLogout` is passed in by the caller (admin.js's initAdmin) rather than
// imported directly, so this module never needs to import admin.js — that
// would form entry(admin.js) -> dashboard-shell.js -> admin.js cycle.

import { state } from './state.js';
import { escapeHtml } from '../utils.js';
import { getIcon } from '../icons.js';
import { _probeColumn, _probeTable, _skeletonTabHtml, _homePath } from './shared.js';
import { _loadStats } from './stats.js';
import { _closeDrawer } from './room-drawer.js';
import { _renderRoomsTab } from './rooms-tab.js';
import { _renderReportsTab } from './reports-tab.js';
import { _renderFilesTab } from './files-tab.js';
import { _renderAuditTab } from './audit-tab.js';
import { _renderCleanupTab } from './cleanup-tab.js';

export async function _renderDashboard(sb, session, { onLogout } = {}) {
  state.sb = sb; state.session = session;
  state.activeTab = 'rooms';

  // Probe schema for optional features
  state.hasQuarantine = await _probeColumn(sb, 'syncpad_rooms', 'quarantined_at');
  state.hasAuditTable = await _probeTable(sb, 'syncpad_admin_audit_logs');

  const screen = document.getElementById('admin-screen');
  screen.innerHTML = `
    <div class="admin-shell">

      <div class="admin-header">
        <a class="admin-header-brand" href="${_homePath()}" title="Back to JotRelay">${getIcon('admin', 18)} JotRelay Admin</a>
        <div class="admin-header-actions">
          <span class="admin-user-email">${escapeHtml(session?.user?.email ?? '')}</span>
          <span class="admin-refreshed-label" id="admin-refreshed-label" title="Last data refresh"></span>
          <button class="admin-icon-btn" id="admin-refresh-btn" title="Refresh (r)" aria-label="Refresh dashboard">↺</button>
          <a class="admin-logout-btn" id="admin-home-btn" href="${_homePath()}">Back to JotRelay</a>
          <button class="admin-logout-btn" id="admin-logout-btn">Sign out</button>
        </div>
      </div>

      <div class="admin-stats-row" id="admin-stats-row">
        <div class="admin-stat-card admin-stat-card--clickable" id="stat-card-rooms" data-target-tab="rooms" role="button" tabindex="0" title="Go to Rooms tab">
          <div class="admin-stat-icon">${getIcon('edit', 16)}</div>
          <div class="admin-stat-value admin-skeleton" id="stat-rooms">—</div>
          <div class="admin-stat-label">Total rooms</div>
        </div>
        <div class="admin-stat-card admin-stat-card--clickable" id="stat-card-active" data-target-tab="rooms" data-filter="active-today" role="button" tabindex="0" title="Show rooms active in the last 24h">
          <div class="admin-stat-icon">${getIcon('users', 16)}</div>
          <div class="admin-stat-value admin-skeleton" id="stat-active">—</div>
          <div class="admin-stat-label">Active today</div>
        </div>
        <div class="admin-stat-card admin-stat-card--clickable" id="stat-card-files" data-target-tab="files" role="button" tabindex="0" title="Go to Files tab">
          <div class="admin-stat-icon">${getIcon('files', 16)}</div>
          <div class="admin-stat-value admin-skeleton" id="stat-files">—</div>
          <div class="admin-stat-label">Files</div>
        </div>
        <div class="admin-stat-card" id="stat-card-storage" title="Total size of all uploaded files">
          <div class="admin-stat-icon">${getIcon('upload', 16)}</div>
          <div class="admin-stat-value admin-skeleton" id="stat-storage">—</div>
          <div class="admin-stat-label">Storage used</div>
        </div>
        <div class="admin-stat-card admin-stat-card--alert admin-stat-card--clickable" id="stat-card-reports" data-target-tab="reports" role="button" tabindex="0" title="Go to Reports tab">
          <div class="admin-stat-icon">${getIcon('warning', 16)}</div>
          <div class="admin-stat-value admin-skeleton" id="stat-reports">—</div>
          <div class="admin-stat-label">Open reports</div>
        </div>
        <div class="admin-stat-card admin-stat-card--clickable" id="stat-card-expired" data-target-tab="rooms" data-filter="expired" role="button" tabindex="0" title="Show expired rooms">
          <div class="admin-stat-icon">${getIcon('clock', 16)}</div>
          <div class="admin-stat-value admin-skeleton" id="stat-expired">—</div>
          <div class="admin-stat-label">Expired rooms</div>
        </div>
      </div>

      <div class="admin-activity" id="admin-activity">
        <div class="admin-activity-header">
          <h3>Room creation — last 14 days</h3>
          <span class="admin-activity-total" id="admin-activity-total"></span>
        </div>
        <div class="admin-activity-chart" id="admin-activity-chart"><div class="admin-skeleton-bar" style="height:64px"></div></div>
      </div>

      <div class="admin-tabs" id="admin-tabs" role="tablist">
        <button class="admin-tab active" data-tab="rooms"   role="tab" aria-selected="true">Rooms</button>
        <button class="admin-tab"        data-tab="reports" role="tab" aria-selected="false">Reports</button>
        <button class="admin-tab"        data-tab="files"   role="tab" aria-selected="false">Files</button>
        <button class="admin-tab"        data-tab="audit"   role="tab" aria-selected="false">Audit Log</button>
        <button class="admin-tab"        data-tab="cleanup" role="tab" aria-selected="false">Cleanup</button>
      </div>

      <div class="admin-content" id="admin-content"></div>

    </div>

    <!-- Room detail drawer -->
    <div class="admin-drawer" id="admin-drawer" aria-hidden="true">
      <div class="admin-drawer-inner" id="admin-drawer-inner"></div>
    </div>
    <div class="admin-drawer-backdrop" id="admin-drawer-backdrop"></div>
  `;

  // ── Stat card click navigation ────────────────────────────────
  screen.querySelectorAll('.admin-stat-card--clickable').forEach(card => {
    const onClick = () => {
      const tab    = card.dataset.targetTab;
      const filter = card.dataset.filter;
      // A card with no data-filter (e.g. "Total rooms") means "show
      // everything" — must actively reset to the 'all' filter, not just
      // skip setting one, or a previous card's filter (e.g. "Active
      // today") stays applied underneath the "Total rooms" label.
      if (tab === 'rooms') state.roomsFilter = filter || 'all';
      switchTab(tab);
    };
    card.addEventListener('click', onClick);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
  });

  // ── Tab switching ──────────────────────────────────────────────
  const contentEl = document.getElementById('admin-content');

  // Tab-specific filters (e.g. state.roomsFilter) are set directly by the caller
  // — see the stat-card click handler above — before switchTab() runs, not
  // threaded through here.
  async function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.admin-tab').forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    contentEl.innerHTML = _skeletonTabHtml();
    if (tab === 'rooms')   await _renderRoomsTab(contentEl);
    if (tab === 'reports') await _renderReportsTab(contentEl);
    if (tab === 'files')   await _renderFilesTab(contentEl);
    if (tab === 'audit')   await _renderAuditTab(contentEl);
    if (tab === 'cleanup') await _renderCleanupTab(contentEl);
    state.lastRefreshed = new Date();
    _updateRefreshedLabel();
  }

  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ── Drawer close ──────────────────────────────────────────────
  document.getElementById('admin-drawer-backdrop').addEventListener('click', _closeDrawer);

  // ── Refresh button ────────────────────────────────────────────
  document.getElementById('admin-refresh-btn').addEventListener('click', async () => {
    const btn = document.getElementById('admin-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '↻'; }
    await Promise.all([_loadStats(), switchTab(state.activeTab)]);
    if (btn) { btn.disabled = false; btn.textContent = '↺'; }
  });

  // ── Logout ────────────────────────────────────────────────────
  document.getElementById('admin-logout-btn').addEventListener('click', async () => {
    _teardownDashboard();
    await sb.auth.signOut();
    onLogout?.();
  });

  // ── Keyboard shortcuts ────────────────────────────────────────
  _setupKeyboardShortcuts(switchTab);

  // ── Initial load ──────────────────────────────────────────────
  await Promise.all([_loadStats(), switchTab('rooms')]);
}

function _teardownDashboard() {
  if (state.shortcutsHandler) {
    document.removeEventListener('keydown', state.shortcutsHandler);
    state.shortcutsHandler = null;
  }
  if (state.refreshedTimer) { clearInterval(state.refreshedTimer); state.refreshedTimer = null; }
  state.rooms = []; state.reports = []; state.files = []; state.audit = [];
  state.roomsSelected.clear();
  // Filter/search/sort/pagination aren't reset above despite state.js's own
  // header comment promising it here — without this, signing out and a
  // different admin signing back in on the same tab (no full page reload)
  // silently inherited whatever the previous admin had filtered/searched/
  // sorted to.
  state.roomsOffset = 0; state.roomsTotal = 0; state.roomsFilter = 'all';
  state.roomsSort = { col: 'updated_at', dir: 'desc' }; state.roomsSearch = '';
  state.reportsOffset = 0; state.reportsTotal = 0; state.reportsFilter = 'new';
  state.filesOffset = 0; state.filesTotal = 0;
  state.auditOffset = 0;
}

function _setupKeyboardShortcuts(switchTab) {
  if (state.shortcutsHandler) document.removeEventListener('keydown', state.shortcutsHandler);
  state.shortcutsHandler = (e) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    const inInput = tag === 'input' || tag === 'textarea' || tag === 'select';
    // Esc — close drawer
    if (e.key === 'Escape') { _closeDrawer(); return; }
    if (inInput) return;
    // / — focus search
    if (e.key === '/') {
      e.preventDefault();
      const search = document.getElementById('admin-room-search') ||
                     document.getElementById('admin-files-search');
      search?.focus();
      return;
    }
    // r — refresh
    if (e.key === 'r' || e.key === 'R') {
      document.getElementById('admin-refresh-btn')?.click();
    }
  };
  document.addEventListener('keydown', state.shortcutsHandler);
}

function _updateRefreshedLabel() {
  if (state.refreshedTimer) clearInterval(state.refreshedTimer);
  const update = () => {
    const el = document.getElementById('admin-refreshed-label');
    if (!el || !state.lastRefreshed) return;
    const secs = Math.floor((Date.now() - state.lastRefreshed) / 1000);
    if (secs < 5)   { el.textContent = 'Updated just now'; return; }
    if (secs < 60)  { el.textContent = `Updated ${secs}s ago`; return; }
    if (secs < 3600){ el.textContent = `Updated ${Math.floor(secs / 60)}m ago`; return; }
    el.textContent = `Updated ${state.lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };
  update();
  state.refreshedTimer = setInterval(update, 10000);
}
