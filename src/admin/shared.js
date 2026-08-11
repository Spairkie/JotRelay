// JotRelay – admin/shared.js
// Constants, path/schema helpers, storage/audit helpers, and small render/dialog
// utilities shared across every admin/*.js tab module.

import { state } from './state.js';
import { escapeHtml } from '../utils.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const FILES_BUCKET              = 'syncpad-files';
export const STORAGE_REMOVE_BATCH_SIZE = 100;
export const ADMIN_QUERY_BATCH_SIZE    = 100;
export const ROOMS_PAGE_SIZE           = 25;
export const FILES_PAGE_SIZE           = 50;
export const AUDIT_PAGE_SIZE           = 50;
export const REPORTS_PAGE_SIZE         = 50;
// PostgREST caps unpaginated selects at its own default page size — any
// "fetch every matching row" query (as opposed to the paginated tab UIs
// above, which intentionally fetch one page at a time) must page through
// with .range() or it silently drops rows past the first page. Mirrors the
// selectAll() helper in supabase/functions/syncpad-cleanup/index.ts.
export const SELECT_ALL_PAGE_SIZE      = 1000;

// ── Path helpers ──────────────────────────────────────────────────────────────

export function _basePath() {
  const raw = String(window.SYNCPAD_CONFIG?.basePath ?? '/JotRelay').trim();
  if (!raw || raw === '/') return '';
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}
export function _homePath()  { return `${_basePath() || ''}/`; }
export function _roomUrl(id) { return `${_basePath() || ''}/${encodeURIComponent(id)}`; }

// ── Schema probing ────────────────────────────────────────────────────────────

export async function _probeColumn(sb, table, column) {
  try {
    const { error } = await sb.from(table).select(column).limit(0);
    return !error;
  } catch { return false; }
}

export async function _probeTable(sb, table) {
  try {
    const { error } = await sb.from(table).select('id').limit(0);
    return !error;
  } catch { return false; }
}

// ── Audit logging ─────────────────────────────────────────────────────────────

export async function _logAdminAction(actionType, details = {}) {
  if (!state.hasAuditTable || !state.sb) return;
  try {
    await state.sb.from('syncpad_admin_audit_logs').insert({
      admin_email:     state.session?.user?.email,
      action_type:     actionType,
      target_room_id:  details.target_room_id || null,
      target_file_id:  details.target_file_id || null,
      target_report_id: details.target_report_id || null,
      result:          details.result || 'success',
      error_msg:       details.error_msg || null,
      metadata:        details.metadata || null,
    });
  } catch { /* silently swallow — audit failure must not break admin actions */ }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

export async function _listRoomFilePaths(roomId) {
  const { rows, error } = await _selectAllPages((from, to) =>
    state.sb.from('syncpad_files').select('file_path').eq('room_id', roomId).order('id').range(from, to)
  );
  if (error) return { paths: [], error };
  return { paths: rows.map(r => r.file_path).filter(Boolean), error: null };
}

export async function _removeStorageObjects(paths) {
  const unique = Array.from(new Set((paths || []).filter(Boolean)));
  for (let i = 0; i < unique.length; i += STORAGE_REMOVE_BATCH_SIZE) {
    const { error } = await state.sb.storage.from(FILES_BUCKET).remove(unique.slice(i, i + STORAGE_REMOVE_BATCH_SIZE));
    if (error) return { error };
  }
  return { error: null };
}

export function _chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Page through every row matching a query via .range(), rather than relying
 * on a single unpaginated select — which PostgREST silently truncates at its
 * own default page size. `queryFactory(from, to)` must apply `.range(from, to)`
 * to the same query each call — and must also apply a stable `.order()` on a
 * unique column. Without one, PostgREST doesn't guarantee the same row
 * ordering between separate paginated requests, so rows can be skipped or
 * duplicated across pages once a query matches more than one page's worth —
 * silently dropping a file path from a cleanup sweep while the accompanying
 * delete still removes every matching row.
 */
export async function _selectAllPages(queryFactory) {
  const rows = [];
  for (let from = 0; ; from += SELECT_ALL_PAGE_SIZE) {
    const to = from + SELECT_ALL_PAGE_SIZE - 1;
    const { data, error } = await queryFactory(from, to);
    if (error) return { rows, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < SELECT_ALL_PAGE_SIZE) break;
  }
  return { rows, error: null };
}

export async function _deleteRoomAndStorage(roomId) {
  const { paths, error: listErr } = await _listRoomFilePaths(roomId);
  if (listErr) return { error: listErr };
  const { error: storageErr } = await _removeStorageObjects(paths);
  if (storageErr) return { error: storageErr };
  const { error } = await state.sb.from('syncpad_rooms').delete().eq('room_id', roomId);
  if (!error) {
    // syncpad_room_reports.room_id has no FK to syncpad_rooms, so report rows
    // survive the room delete. Mark any still-"new" reports reviewed so they
    // don't keep reappearing in the "New" filter/stat card pointing at a room
    // that no longer exists. Best-effort: the room delete already succeeded
    // and must not be reported as failed because of this secondary write.
    try {
      await state.sb.from('syncpad_room_reports').update({ status: 'reviewed' }).eq('room_id', roomId).eq('status', 'new');
    } catch (e) {
      console.error('[admin] failed to mark reports reviewed after room delete', e);
    }
  }
  return { error };
}

export async function _listExpiredEncryptedRoomFilePaths() {
  const nowIso = new Date().toISOString();
  const { rows: rooms, error: roomsErr } = await _selectAllPages((from, to) =>
    state.sb.from('syncpad_rooms').select('room_id')
      .lt('expires_at', nowIso).not('expires_at', 'is', null).eq('encryption_enabled', true)
      .order('room_id').range(from, to)
  );
  if (roomsErr) return { storagePaths: [], error: roomsErr };
  const roomIds = rooms.map(r => r.room_id).filter(Boolean);
  if (!roomIds.length) return { storagePaths: [], error: null };

  const paths = [];
  for (const batch of _chunks(roomIds, ADMIN_QUERY_BATCH_SIZE)) {
    const { rows, error } = await _selectAllPages((from, to) =>
      state.sb.from('syncpad_files').select('file_path').in('room_id', batch).order('id').range(from, to)
    );
    if (error) return { storagePaths: [], error };
    paths.push(...rows.map(r => r.file_path).filter(Boolean));
  }
  return { storagePaths: paths, error: null };
}

export async function _deleteExpiredRoomsAndStorage() {
  const nowIso = new Date().toISOString();
  const { rows: rooms, error: roomsErr } = await _selectAllPages((from, to) =>
    state.sb.from('syncpad_rooms').select('room_id').lt('expires_at', nowIso).not('expires_at', 'is', null)
      .order('room_id').range(from, to)
  );
  if (roomsErr) return { error: roomsErr, count: null };
  const roomIds = rooms.map(r => r.room_id).filter(Boolean);
  if (!roomIds.length) return { error: null, count: 0 };

  const files = [];
  for (const batch of _chunks(roomIds, ADMIN_QUERY_BATCH_SIZE)) {
    const { rows, error } = await _selectAllPages((from, to) =>
      state.sb.from('syncpad_files').select('file_path').in('room_id', batch).order('id').range(from, to)
    );
    if (error) return { error, count: null };
    files.push(...rows);
  }
  const { error: storageErr } = await _removeStorageObjects(files.map(r => r.file_path));
  if (storageErr) return { error: storageErr, count: null };

  let deleted = 0;
  for (const batch of _chunks(roomIds, ADMIN_QUERY_BATCH_SIZE)) {
    const { error, count } = await state.sb.from('syncpad_rooms').delete({ count: 'exact' }).in('room_id', batch);
    if (error) return { error, count: null };
    deleted += count || 0;
  }

  // Mirrors _deleteRoomAndStorage()'s report cleanup, batched the same way as
  // the rest of this function. syncpad_room_reports.room_id has no FK to
  // syncpad_rooms, so report rows survive the room delete — best-effort, the
  // room deletes already succeeded and must not be reported as failed because
  // of this secondary write.
  for (const batch of _chunks(roomIds, ADMIN_QUERY_BATCH_SIZE)) {
    try {
      await state.sb.from('syncpad_room_reports').update({ status: 'reviewed' }).in('room_id', batch).eq('status', 'new');
    } catch (e) {
      console.error('[admin] failed to mark reports reviewed after expired-room cleanup', e);
    }
  }

  return { error: null, count: deleted };
}

/**
 * Debug-only, full-reset helper: deletes every room and its storage files,
 * regardless of expiry — unlike _deleteExpiredRoomsAndStorage() above, which
 * this otherwise mirrors closely. Deleting from syncpad_rooms cascades
 * (on delete cascade, see the migrations) to syncpad_files/
 * syncpad_room_comments/syncpad_room_revisions/syncpad_share_links/
 * syncpad_room_codes/syncpad_room_seen_devices/syncpad_room_edit_tokens
 * automatically. syncpad_room_reports has no FK to syncpad_rooms (rows
 * survive a room delete on purpose, so a report stays reviewable after its
 * room is gone) so it's cleared explicitly here, along with
 * syncpad_rate_limit_log (not room-scoped, but resetting it is the whole
 * point of a debug "start over" button). Deliberately does NOT touch
 * syncpad_admins (would lock out admin access) or syncpad_admin_audit_logs
 * (audit trail; its target_room_id FK is ON DELETE SET NULL, so it already
 * survives on its own).
 */
export async function _resetEntireDatabase() {
  const { rows: rooms, error: roomsErr } = await _selectAllPages((from, to) =>
    state.sb.from('syncpad_rooms').select('room_id').order('room_id').range(from, to)
  );
  if (roomsErr) return { error: roomsErr, roomsDeleted: null };
  const roomIds = rooms.map(r => r.room_id).filter(Boolean);

  if (roomIds.length) {
    const files = [];
    for (const batch of _chunks(roomIds, ADMIN_QUERY_BATCH_SIZE)) {
      const { rows, error } = await _selectAllPages((from, to) =>
        state.sb.from('syncpad_files').select('file_path').in('room_id', batch).order('id').range(from, to)
      );
      if (error) return { error, roomsDeleted: null };
      files.push(...rows);
    }
    const { error: storageErr } = await _removeStorageObjects(files.map(r => r.file_path));
    if (storageErr) return { error: storageErr, roomsDeleted: null };

    for (const batch of _chunks(roomIds, ADMIN_QUERY_BATCH_SIZE)) {
      const { error } = await state.sb.from('syncpad_rooms').delete().in('room_id', batch);
      if (error) return { error, roomsDeleted: null };
    }
  }

  const { error: reportsErr } = await state.sb.from('syncpad_room_reports').delete().not('id', 'is', null);
  if (reportsErr) return { error: reportsErr, roomsDeleted: roomIds.length };

  // Best-effort — this table is optional (Phase 40's rate-limiting
  // migration) and its absence shouldn't fail the whole reset. Supabase's
  // client resolves with an { error } value on failure rather than
  // throwing, so a bare try/catch here never actually caught anything —
  // including a real failure like RLS silently blocking the delete, which
  // left rate-limit counters intact while this still reported success.
  const { error: rateLimitErr } = await state.sb.from('syncpad_rate_limit_log').delete().not('id', 'is', null);
  if (rateLimitErr) console.error('[admin] failed to clear syncpad_rate_limit_log during full reset', rateLimitErr);

  // The storage removal above only ever reaches files this reset itself
  // just deleted syncpad_files rows for — it can't know about a Storage
  // object that has no matching row at all (an interrupted upload, or any
  // other gap predating this reset). A "start over" button that still
  // leaves orphaned bytes behind isn't a full reset, so sweep those too.
  // Best-effort and silent-if-unavailable: the syncpad-cleanup Edge
  // Function is an optional, separately-deployed piece (see its README),
  // and its absence shouldn't fail (or even warn on) the reset itself —
  // the room/file part above is the part this button actually promises.
  // functions.invoke() resolves (doesn't throw) even when the Edge
  // Function is unreachable — it reports that via the returned `error`,
  // same as every other supabase-js call — so check that, not a catch
  // block, or an undeployed function would silently look handled here.
  await state.sb.functions.invoke('syncpad-cleanup', { body: { mode: 'orphans', dryRun: false } }).catch(() => {});

  return { error: null, roomsDeleted: roomIds.length };
}

// ── Utility helpers ───────────────────────────────────────────────────────────

export function _isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export function _escapePostgrestFilterValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Render Prev/Next pagination controls + a "Showing X-Y of Z" range label.
 * Shared by every paginated tab (Rooms/Reports/Files/Audit) so page-turning
 * UI and its edge cases (first/last page, empty result set) live in exactly
 * one place instead of four near-duplicate copies.
 *
 * Each page replaces the tab's row set outright (a real server-fetched page,
 * not an ever-growing appended list) — callers own re-fetching the data for
 * the new offset and re-rendering rows; this only renders the controls and
 * wires Prev/Next to call back with the new offset.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {number}   opts.offset       - current page's starting offset
 * @param {number}   opts.pageSize
 * @param {number}   opts.loadedCount  - rows actually returned for this page
 * @param {number}   opts.total        - total matching rows (server count)
 * @param {(nextOffset:number) => void} opts.onNavigate - called with the new offset on Prev/Next
 */
export function _renderPager(container, { offset, pageSize, loadedCount, total, onNavigate }) {
  if (!container) return;
  if (!total) { container.innerHTML = ''; return; }

  const from = offset + 1;
  const to   = offset + loadedCount;
  const page = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = offset > 0;
  const hasNext = offset + loadedCount < total;

  container.innerHTML = `
    <div class="admin-pager">
      <span class="admin-pager-range">Showing ${from}–${to} of ${total}</span>
      <div class="admin-pager-nav">
        <button class="admin-pager-btn" id="admin-pager-prev" ${hasPrev ? '' : 'disabled'} aria-label="Previous page">‹ Prev</button>
        <span class="admin-pager-page">Page ${page} of ${pageCount}</span>
        <button class="admin-pager-btn" id="admin-pager-next" ${hasNext ? '' : 'disabled'} aria-label="Next page">Next ›</button>
      </div>
    </div>`;

  container.querySelector('#admin-pager-prev')?.addEventListener('click', () => onNavigate(Math.max(0, offset - pageSize)));
  container.querySelector('#admin-pager-next')?.addEventListener('click', () => onNavigate(offset + pageSize));
}

export function _fullDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
}

export function _showToast(message, type = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast${type ? ' toast-' + type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 2800);
}

// Shared by every admin query/mutation error path — a session that expires
// mid-action should read exactly the same as one that expired before the
// page loaded, per docs/security.md ("You do not have admin access.",
// not the raw Postgres/PostgREST error).
export function _isRlsError(error) {
  return error?.code === 'PGRST301' || error?.message?.includes('permission') || error?.message?.includes('policy');
}

export function _friendlyErrorMessage(error) {
  return _isRlsError(error) ? 'You do not have admin access.' : (error?.message || 'Unknown error');
}

export function _accessDeniedHtml(error) {
  const isRls = _isRlsError(error);
  return `
    <div class="admin-access-denied">
      <div class="admin-access-denied-icon">🚫</div>
      <div class="admin-access-denied-title">${isRls ? 'You do not have admin access.' : 'Failed to load data.'}</div>
      ${isRls ? '' : `<div class="admin-access-denied-detail">${escapeHtml(error?.message ?? 'Unknown error')}</div>`}
      <div style="margin-top:1rem">
        <button onclick="window.location.reload()" class="admin-action-btn admin-action-primary">Retry</button>
      </div>
    </div>`;
}

export function _skeletonTabHtml() {
  return `
    <div class="admin-tab-content admin-skeleton-tab" aria-busy="true" aria-label="Loading…">
      <div class="admin-toolbar">
        <div class="admin-skeleton-bar" style="width:220px;height:32px;border-radius:6px"></div>
        <div class="admin-skeleton-bar" style="width:80px;height:16px;border-radius:4px"></div>
      </div>
      <div class="admin-table-wrap">
        ${Array.from({ length: 5 }, () => `
          <div class="admin-skeleton-row">
            <div class="admin-skeleton-bar" style="width:5%;height:14px;border-radius:3px"></div>
            <div class="admin-skeleton-bar" style="width:22%;height:14px;border-radius:3px"></div>
            <div class="admin-skeleton-bar" style="width:12%;height:14px;border-radius:3px"></div>
            <div class="admin-skeleton-bar" style="width:12%;height:14px;border-radius:3px"></div>
            <div class="admin-skeleton-bar" style="width:10%;height:14px;border-radius:3px"></div>
            <div class="admin-skeleton-bar" style="width:18%;height:14px;border-radius:3px"></div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ── Admin dialog helpers ──────────────────────────────────────────────────────

export function _adminGetHost() {
  return document.getElementById('admin-screen') || document.body;
}

export function _adminTypedConfirm(title, description, expectedValue) {
  return new Promise((resolve) => {
    _ensureAdminDialogStyles();
    const host = _adminGetHost();
    const el = document.createElement('div');
    el.className = 'admin-dialog-backdrop';
    el.innerHTML = `
      <div class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="adlg-title">
        <div id="adlg-title" class="admin-dialog-title">${escapeHtml(title)}</div>
        <p class="admin-dialog-msg">${escapeHtml(description).replace(/\n/g, '<br>')}</p>
        <input class="admin-dialog-input" type="text" autocomplete="off" spellcheck="false"
          placeholder="${escapeHtml(expectedValue)}" aria-label="Confirmation input" />
        <div class="admin-dialog-actions">
          <button class="admin-dialog-cancel admin-dialog-btn">Cancel</button>
          <button class="admin-dialog-ok admin-dialog-btn admin-dialog-btn--danger" disabled>Confirm</button>
        </div>
      </div>`;
    host.appendChild(el);
    const input = el.querySelector('.admin-dialog-input');
    const okBtn = el.querySelector('.admin-dialog-ok');
    const cleanup = (r) => { el.remove(); document.removeEventListener('keydown', onKey); resolve(r); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cleanup(false); } };
    input.addEventListener('input', () => { okBtn.disabled = input.value !== expectedValue; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !okBtn.disabled) cleanup(true); });
    okBtn.addEventListener('click', () => { if (!okBtn.disabled) cleanup(true); });
    el.querySelector('.admin-dialog-cancel').addEventListener('click', () => cleanup(false));
    el.addEventListener('click', (e) => { if (e.target === el) cleanup(false); });
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => input.focus());
  });
}

let _adminDialogStylesInjected = false;
function _ensureAdminDialogStyles() {
  if (_adminDialogStylesInjected) return;
  _adminDialogStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.admin-dialog-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999}
.admin-dialog{background:var(--bg-surface,#1e1e2e);border:1px solid var(--border,#333);border-radius:10px;padding:1.5rem;max-width:440px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.4)}
.admin-dialog-title{font-weight:700;font-size:1rem;margin-bottom:.5rem;color:var(--text-primary,#e0e0e0)}
.admin-dialog-msg{margin:0 0 1rem;font-size:.9rem;color:var(--text-secondary,#aaa);line-height:1.5;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word}
.admin-dialog-title{overflow-wrap:break-word;word-break:break-word}
.admin-dialog-input{width:100%;padding:.5rem .75rem;font-size:.875rem;border:1px solid var(--border,#333);border-radius:6px;background:var(--bg-elevated,#252538);color:var(--text-primary,#e0e0e0);margin-bottom:1rem;box-sizing:border-box;font-family:monospace}
.admin-dialog-input:focus{outline:none;border-color:var(--accent,#f5a623)}
.admin-dialog-actions{display:flex;justify-content:flex-end;gap:.5rem;flex-wrap:wrap}
.admin-dialog-btn{padding:.45rem 1rem;border-radius:6px;border:1px solid var(--border,#333);font-size:.875rem;cursor:pointer;transition:opacity .15s}
.admin-dialog-btn:disabled{opacity:.4;cursor:not-allowed}
.admin-dialog-btn--primary{background:var(--accent,#f5a623);color:var(--text-inverse,#000);border-color:var(--accent,#f5a623)}
.admin-dialog-btn--danger{background:var(--red,#f87171);color:var(--text-inverse,#fff);border-color:var(--red,#f87171)}
.admin-dialog-cancel{background:var(--bg-elevated,#252538);color:var(--text-primary,#e0e0e0)}
`;
  document.head.appendChild(style);
}
