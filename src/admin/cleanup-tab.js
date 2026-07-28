// SyncPad – admin/cleanup-tab.js
// The Cleanup tab: server-side expired-room RPC, manual danger-button
// deletion, and Storage orphan reconciliation via the syncpad-cleanup
// Edge Function.

import { state } from './state.js';
import { showConfirm } from '../ui.js';
import { getIcon } from '../icons.js';
import {
  _friendlyErrorMessage, _logAdminAction, _adminTypedConfirm,
  _listExpiredEncryptedRoomFilePaths, _removeStorageObjects, _deleteExpiredRoomsAndStorage,
  _resetEntireDatabase,
} from './shared.js';
import { _loadStats } from './stats.js';

export async function _renderCleanupTab(contentEl) {
  contentEl.innerHTML = `
    <div class="admin-tab-content admin-cleanup">
      <div class="admin-cleanup-section">
        <h3>${getIcon('clock', 16)} Cleanup Expired Rooms</h3>
        <p class="admin-cleanup-desc">
          Run the server-side cleanup function to permanently delete all rooms whose
          expiry time (<code>expires_at</code>) has passed. This calls the
          <code>run_cleanup_expired_syncpad_rooms_as_admin()</code> database function.
        </p>
        <button id="admin-cleanup-btn" class="admin-action-btn admin-action-primary">Run cleanup</button>
        <div id="admin-cleanup-result" class="admin-cleanup-result hidden"></div>
      </div>

      <hr class="admin-divider" />

      <div class="admin-cleanup-section admin-cleanup-danger">
        <h3>${getIcon('warning', 16)} Manual Expired Room Deletion</h3>
        <p class="admin-cleanup-desc">
          Directly delete all rooms where <code>expires_at</code> is in the past.
          Use this only if the RPC function is unavailable. This action is <strong>irreversible</strong>.
        </p>
        <button id="admin-manual-cleanup-btn" class="admin-action-btn admin-action-danger">Delete all expired rooms now</button>
        <div id="admin-manual-cleanup-result" class="admin-cleanup-result hidden"></div>
      </div>

      <hr class="admin-divider" />

      <div class="admin-cleanup-section">
        <h3>${getIcon('trash', 16)} Storage Orphan Reconciliation</h3>
        <p class="admin-cleanup-desc">
          Calls the <code>syncpad-cleanup</code> Edge Function to find files that exist in
          Storage but have no matching <code>syncpad_files</code> row — left behind by
          interrupted uploads or gaps this dashboard doesn't otherwise cover — and remove
          them. Starts with a dry run; nothing is deleted until you confirm the count.
          This is a separate, optional deploy step — it does not run automatically and
          is not required for the rest of SyncPad to work.
          Requires the Edge Function to be deployed (<code>supabase functions deploy syncpad-cleanup --no-verify-jwt</code>,
          see <code>supabase/functions/syncpad-cleanup/README.md</code>).
        </p>
        <button id="admin-orphan-preview-btn" class="admin-action-btn admin-action-primary">Preview orphaned files</button>
        <div id="admin-orphan-result" class="admin-cleanup-result hidden"></div>
      </div>

      <hr class="admin-divider" />

      <div class="admin-cleanup-section admin-cleanup-danger">
        <h3>${getIcon('warning', 16)} Reset Database (Debug)</h3>
        <p class="admin-cleanup-desc">
          <strong>For local/dev cleanup only.</strong> Permanently deletes every room and its
          files, comments, revisions, share links, and reports — the entire dataset, not just
          expired rooms — and clears the rate-limit log. Admin accounts and this audit log are
          left untouched. This action is <strong>irreversible</strong> and affects every room in
          this Supabase project, not just ones you created.
        </p>
        <button id="admin-reset-db-btn" class="admin-action-btn admin-action-danger">Reset entire database…</button>
        <div id="admin-reset-db-result" class="admin-cleanup-result hidden"></div>
      </div>
    </div>`;

  document.getElementById('admin-cleanup-btn').addEventListener('click', async () => {
    const btn = document.getElementById('admin-cleanup-btn');
    const resultEl = document.getElementById('admin-cleanup-result');
    const ok = await showConfirm('Run server-side cleanup to delete all expired rooms?', { confirmLabel: 'Run cleanup' });
    if (!ok) return;
    btn.disabled = true; btn.textContent = 'Running…';
    resultEl.classList.add('hidden'); resultEl.className = 'admin-cleanup-result';

    // The RPC deletes DB rows for expired encrypted rooms outright, but a raw
    // SQL delete never touches Storage — it would silently orphan their files.
    // Snapshot which rooms it's about to delete and sweep their files first,
    // the same way the manual danger-button path already does.
    const { storagePaths, error: snapshotErr } = await _listExpiredEncryptedRoomFilePaths();
    if (snapshotErr) {
      btn.disabled = false; btn.textContent = 'Run cleanup';
      resultEl.classList.remove('hidden'); resultEl.classList.add('admin-cleanup-result--error');
      resultEl.textContent = `Error: ${snapshotErr.message}`;
      return;
    }
    const { error: storageErr } = await _removeStorageObjects(storagePaths);
    if (storageErr) {
      btn.disabled = false; btn.textContent = 'Run cleanup';
      resultEl.classList.remove('hidden'); resultEl.classList.add('admin-cleanup-result--error');
      resultEl.textContent = `Error clearing storage: ${storageErr.message}`;
      return;
    }

    const { data, error } = await state.sb.rpc('run_cleanup_expired_syncpad_rooms_as_admin');
    btn.disabled = false; btn.textContent = 'Run cleanup';
    if (error) {
      resultEl.classList.remove('hidden'); resultEl.classList.add('admin-cleanup-result--error');
      resultEl.textContent = `Error: ${_friendlyErrorMessage(error)}`;
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const cleared = row?.cleared_unencrypted ?? 0;
    const deleted = row?.deleted_encrypted ?? 0;
    resultEl.classList.remove('hidden'); resultEl.classList.add('admin-cleanup-result--success');
    resultEl.textContent = `✓ Cleanup complete. ${cleared} room${cleared !== 1 ? 's' : ''} cleared, ${deleted} encrypted room${deleted !== 1 ? 's' : ''} deleted (${storagePaths.length} file${storagePaths.length !== 1 ? 's' : ''} removed from storage).`;
    await _logAdminAction('cleanup_expired', { metadata: { cleared_unencrypted: cleared, deleted_encrypted: deleted, storage_files_removed: storagePaths.length } });
    await _loadStats();
  });

  document.getElementById('admin-manual-cleanup-btn').addEventListener('click', async () => {
    const btn = document.getElementById('admin-manual-cleanup-btn');
    const resultEl = document.getElementById('admin-manual-cleanup-result');
    const ok = await showConfirm('Delete ALL rooms where expires_at is in the past?\n\nThis is permanent and cannot be undone.', { confirmLabel: 'Delete all expired', danger: true });
    if (!ok) return;
    btn.disabled = true; btn.textContent = 'Deleting…';
    resultEl.classList.add('hidden'); resultEl.className = 'admin-cleanup-result';
    const { error, count } = await _deleteExpiredRoomsAndStorage();
    btn.disabled = false; btn.textContent = 'Delete all expired rooms now';
    if (error) {
      resultEl.classList.remove('hidden'); resultEl.classList.add('admin-cleanup-result--error');
      resultEl.textContent = `Error: ${_friendlyErrorMessage(error)}`; return;
    }
    const deleted = count ?? '?';
    resultEl.classList.remove('hidden'); resultEl.classList.add('admin-cleanup-result--success');
    resultEl.textContent = `✓ Deleted ${deleted} expired room${deleted !== 1 ? 's' : ''}.`;
    await _logAdminAction('manual_cleanup_expired', { metadata: { deleted_count: deleted } });
    await _loadStats();
  });

  document.getElementById('admin-reset-db-btn').addEventListener('click', async () => {
    const btn = document.getElementById('admin-reset-db-btn');
    const resultEl = document.getElementById('admin-reset-db-result');
    const ok = await _adminTypedConfirm(
      'Reset entire database?',
      'This permanently deletes every room, file, comment, revision, share link, and report in this Supabase project — not just yours. Admin accounts and this audit log are kept.\n\nType RESET EVERYTHING to confirm.',
      'RESET EVERYTHING',
    );
    if (!ok) return;
    btn.disabled = true; btn.textContent = 'Resetting…';
    resultEl.classList.add('hidden'); resultEl.className = 'admin-cleanup-result';
    const { error, roomsDeleted } = await _resetEntireDatabase();
    btn.disabled = false; btn.textContent = 'Reset entire database…';
    if (error) {
      resultEl.classList.remove('hidden'); resultEl.classList.add('admin-cleanup-result--error');
      resultEl.textContent = `Error: ${_friendlyErrorMessage(error)}`; return;
    }
    resultEl.classList.remove('hidden'); resultEl.classList.add('admin-cleanup-result--success');
    resultEl.textContent = `✓ Database reset. ${roomsDeleted} room${roomsDeleted !== 1 ? 's' : ''} deleted.`;
    await _logAdminAction('reset_entire_database', { metadata: { rooms_deleted: roomsDeleted } });
    await _loadStats();
  });

  _wireOrphanReconciliation();
}

function _wireOrphanReconciliation() {
  const previewBtn = document.getElementById('admin-orphan-preview-btn');
  const resultEl   = document.getElementById('admin-orphan-result');

  const invoke = (dryRun) => state.sb.functions.invoke('syncpad-cleanup', { body: { mode: 'orphans', dryRun } });

  const showError = (error) => {
    resultEl.classList.remove('hidden'); resultEl.className = 'admin-cleanup-result admin-cleanup-result--error';
    // supabase-js's FunctionsFetchError ("Failed to send a request to the
    // Edge Function") means the request never even reached a function —
    // almost always because syncpad-cleanup was never deployed to this
    // Supabase project (it's a separate, optional `supabase functions
    // deploy` step, not something any migration or the app itself sets up).
    // Swap the SDK's generic network-failure wording for the actual likely
    // cause and the exact command to fix it, rather than leaving the admin
    // to guess what a bare "failed to send a request" means.
    const isUnreachable = error?.name === 'FunctionsFetchError'
      || /failed to send a request/i.test(error?.message || '');
    resultEl.textContent = isUnreachable
      ? 'The syncpad-cleanup Edge Function isn\'t reachable — it likely hasn\'t been deployed to this Supabase project yet. Deploy it with: supabase functions deploy syncpad-cleanup --no-verify-jwt (see supabase/functions/syncpad-cleanup/README.md). This feature is optional; the rest of the dashboard works without it.'
      : `Error: ${_friendlyErrorMessage(error)}`;
  };

  const runRemoval = async (orphanCount) => {
    const ok = await showConfirm(
      `Permanently delete ${orphanCount} orphaned file${orphanCount !== 1 ? 's' : ''} from storage?\n\nThis cannot be undone.`,
      { confirmLabel: 'Delete orphaned files', danger: true },
    );
    if (!ok) return;
    previewBtn.disabled = true;
    const { data, error } = await invoke(false);
    previewBtn.disabled = false; previewBtn.textContent = 'Preview orphaned files';
    if (error) { showError(error); return; }
    const removed = data?.orphans?.storageObjects?.removed ?? 0;
    resultEl.classList.remove('hidden'); resultEl.className = 'admin-cleanup-result admin-cleanup-result--success';
    resultEl.textContent = `✓ Removed ${removed} orphaned file${removed !== 1 ? 's' : ''} from storage.`;
    await _logAdminAction('reconcile_storage_orphans', { metadata: { removed } });
  };

  previewBtn.addEventListener('click', async () => {
    previewBtn.disabled = true; previewBtn.textContent = 'Scanning…';
    resultEl.classList.add('hidden'); resultEl.className = 'admin-cleanup-result';
    const { data, error } = await invoke(true);
    previewBtn.disabled = false; previewBtn.textContent = 'Preview orphaned files';
    if (error) { showError(error); return; }

    const orphanCount = data?.orphans?.orphanObjects ?? 0;
    const storedCount = data?.orphans?.storedObjects ?? 0;
    const trackedCount = data?.orphans?.trackedObjects ?? 0;
    resultEl.classList.remove('hidden'); resultEl.className = 'admin-cleanup-result';
    if (!orphanCount) {
      resultEl.classList.add('admin-cleanup-result--success');
      resultEl.textContent = `✓ No orphans found (${storedCount} stored, ${trackedCount} tracked).`;
      return;
    }
    resultEl.innerHTML = `Found <strong>${orphanCount}</strong> orphaned file${orphanCount !== 1 ? 's' : ''} out of ${storedCount} stored (${trackedCount} tracked). `;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'admin-action-btn admin-action-danger';
    removeBtn.textContent = `Remove ${orphanCount} orphaned file${orphanCount !== 1 ? 's' : ''}`;
    removeBtn.style.marginTop = '0.5rem';
    removeBtn.addEventListener('click', () => runRemoval(orphanCount));
    resultEl.appendChild(document.createElement('br'));
    resultEl.appendChild(removeBtn);
  });
}
