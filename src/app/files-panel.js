// SyncPad – app/files-panel.js
// The Files side panel: listing/sorting, upload (including the shared
// paste/drop-image upload path used by editor-behavior.js), download,
// delete, and bulk-select.

import { copyToClipboard } from '../utils.js';
import { uploadFile, listFiles, deleteFile, getDownloadUrl, getForceDownloadUrl } from '../files.js';
import { canUploadFiles, canDeleteFiles, editBlockedReason } from '../permissions.js';
import { broadcastFilesChange } from '../live-broadcast.js';
import * as UI from '../ui.js';
import { openFilePreview } from '../file-preview.js';
import { state } from './state.js';
import { _insertTextAtActiveCursor } from './editor-behavior.js';

function _updateBulkBar() {
  const n = state.selectedFiles.size;
  const countEl  = document.getElementById('files-bulk-count');
  const deleteEl = document.getElementById('files-bulk-delete');
  if (countEl)  countEl.textContent = `${n} selected`;
  if (deleteEl) deleteEl.disabled   = n === 0;
}

function _sortFiles(files) {
  const arr = [...files];
  switch (state.filesSort) {
    case 'oldest':    return arr.sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at));
    case 'name-asc':  return arr.sort((a, b) => a.filename.localeCompare(b.filename));
    case 'name-desc': return arr.sort((a, b) => b.filename.localeCompare(a.filename));
    case 'size-desc': return arr.sort((a, b) => b.file_size - a.file_size);
    case 'size-asc':  return arr.sort((a, b) => a.file_size - b.file_size);
    default:          return arr.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)); // newest
  }
}

/**
 * Upload one or more images pasted/dropped straight into the editor and
 * insert a syncpad-file: markdown reference for each at the cursor —
 * mirrors the Files panel's own multi-upload flow (sequential, one progress
 * indicator, one summary toast) rather than duplicating a second UX for it.
 */
export async function _uploadAndInsertImages(files) {
  if (!canUploadFiles()) {
    UI.showToast(editBlockedReason() || 'File upload is disabled. Text-encrypted rooms do not allow new file uploads in v1.', 'warning');
    return;
  }
  const tooLarge = files.filter(f => f.size > 10 * 1024 * 1024);
  const toUpload = files.filter(f => f.size <= 10 * 1024 * 1024);
  if (tooLarge.length) {
    UI.showToast(
      tooLarge.length === files.length ? 'Image too large (max 10 MB).' : `${tooLarge.length} image${tooLarge.length !== 1 ? 's' : ''} skipped (max 10 MB).`,
      'error',
    );
  }
  if (!toUpload.length) return;

  UI.setUploadingState(true, toUpload.length > 1 ? `Uploading image 1 of ${toUpload.length}…` : 'Uploading image…');
  let succeeded = 0, failed = 0;
  for (let i = 0; i < toUpload.length; i++) {
    if (toUpload.length > 1) UI.setUploadingState(true, `Uploading image ${i + 1} of ${toUpload.length}…`);
    try {
      const record = await uploadFile(state.roomId, toUpload[i]);
      _insertTextAtActiveCursor(`![${record.filename}](syncpad-file:${record.file_path})\n`);
      succeeded++;
    } catch { failed++; }
  }
  UI.setUploadingState(false);

  if (succeeded) { broadcastFilesChange(); await refreshFiles(); }

  if (!failed) {
    UI.showToast(succeeded === 1 ? 'Image uploaded.' : `${succeeded} images uploaded.`, 'success');
  } else if (succeeded) {
    UI.showToast(`${succeeded} uploaded, ${failed} failed.`, 'error');
  } else {
    UI.showToast(failed === 1 ? 'Could not upload image.' : 'Could not upload images.', 'error');
  }
}

export async function refreshFiles() {
  let files;
  try {
    files = _sortFiles(await listFiles(state.roomId));
  } catch {
    UI.showToast('Could not load files — check your connection.', 'error');
    return;
  }
  UI.renderFilesList(
    files,
    async (file) => {
      try {
        const url = await getForceDownloadUrl(file.file_path, file.filename);
        const a   = document.createElement('a');
        a.href = url; a.download = file.filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } catch { UI.showToast('Could not download file.', 'error'); }
    },
    async (file) => {
      if (!canDeleteFiles()) { UI.showToast(editBlockedReason() || 'File deletion is disabled.', 'warning'); return; }
      const ok = await UI.showConfirm(
        `Delete "${file.filename}"?`,
        { confirmLabel: 'Delete', danger: true },
      );
      if (!ok) return;
      try {
        await deleteFile(file.id, file.file_path);
        UI.showToast('File deleted.', 'success');
        broadcastFilesChange();
        await refreshFiles();
      } catch (err) {
        const msg = err?.code === 'METADATA_DELETE_FAILED'
          ? err.message
          : 'Could not delete file.';
        UI.showToast(msg, 'error', 5000);
        await refreshFiles();
      }
    },
    {
      canDelete: canDeleteFiles(),
      canDownload: !state.room?.downloads_disabled,
      selectMode: state.filesSelectMode,
      selectedIds: state.selectedFiles,
      onSelectionChange: (file, checked) => {
        if (checked) state.selectedFiles.add(file.id);
        else         state.selectedFiles.delete(file.id);
        _updateBulkBar();
      },
      onPreview: async (file) => {
        try {
          await openFilePreview(
            file,
            getDownloadUrl,
            async (f) => {
              try {
                const url = await getForceDownloadUrl(f.file_path, f.filename);
                const a   = document.createElement('a');
                a.href = url; a.download = f.filename;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
              } catch { UI.showToast('Could not download file.', 'error'); }
            }
          );
        } catch { UI.showToast('Could not open preview.', 'error'); }
      },
      onCopyLink: async (file) => {
        try {
          // Always mint a fresh URL rather than reusing a cached one — a
          // cached entry can already be up to 55 minutes old, and this link
          // is meant to be shared and possibly opened later, not used
          // immediately like the Download button.
          const url = await getForceDownloadUrl(file.file_path, file.filename, { fresh: true });
          const ok  = await copyToClipboard(url);
          UI.showToast(
            ok ? `Link copied — valid ~55 min.` : 'Could not copy link.',
            ok ? 'success' : 'error',
          );
        } catch { UI.showToast('Could not create link.', 'error'); }
      },
    }
  );
}

export function _wireFiles() {
  // ── Files ──────────────────────────────────────────────────────────────────
  UI.setFileHandlers(async (files) => {
    if (!canUploadFiles()) { UI.showToast(editBlockedReason() || 'File upload is disabled. Text-encrypted rooms do not allow new file uploads in v1.', 'warning'); return; }

    const tooLarge = files.filter(f => f.size > 10 * 1024 * 1024);
    const toUpload = files.filter(f => f.size <= 10 * 1024 * 1024);
    if (tooLarge.length) {
      UI.showToast(
        tooLarge.length === files.length
          ? 'File too large (max 10 MB).'
          : `${tooLarge.length} file${tooLarge.length !== 1 ? 's' : ''} skipped (max 10 MB).`,
        'error',
      );
    }
    if (!toUpload.length) return;

    UI.setUploadingState(true, toUpload.length > 1 ? `Uploading 1 of ${toUpload.length}…` : 'Uploading…');
    let succeeded = 0, failed = 0;
    // Sequential (not Promise.all) so the progress indicator can report which
    // file is in flight, and so a slow/failing upload doesn't race storage
    // writes for the same room against each other.
    for (let i = 0; i < toUpload.length; i++) {
      if (toUpload.length > 1) UI.setUploadingState(true, `Uploading ${i + 1} of ${toUpload.length}…`);
      try {
        await uploadFile(state.roomId, toUpload[i]);
        succeeded++;
      } catch { failed++; }
    }
    UI.setUploadingState(false);

    if (succeeded) { broadcastFilesChange(); await refreshFiles(); }

    if (!failed) {
      UI.showToast(succeeded === 1 ? 'File uploaded.' : `${succeeded} files uploaded.`, 'success');
    } else if (succeeded) {
      UI.showToast(`${succeeded} uploaded, ${failed} failed.`, 'error');
    } else {
      UI.showToast(failed === 1 ? 'Could not upload file.' : 'Could not upload files.', 'error');
    }
  });

}

export function _wireFilesSortOrder() {
  // ── Files — sort order ────────────────────────────────────────────────────
  document.getElementById('files-sort')?.addEventListener('change', (e) => {
    state.filesSort = e.target.value;
    refreshFiles();
  });

}

export function _wireFilesBulkSelect() {
  // ── Files — bulk select ────────────────────────────────────────────────────
  document.getElementById('files-select-toggle')?.addEventListener('click', () => {
    state.filesSelectMode = !state.filesSelectMode;
    state.selectedFiles.clear();
    document.getElementById('files-select-toggle')?.classList.toggle('active', state.filesSelectMode);
    document.getElementById('files-bulk-bar')?.classList.toggle('hidden', !state.filesSelectMode);
    _updateBulkBar();
    refreshFiles();
  });
  document.getElementById('files-bulk-cancel')?.addEventListener('click', () => {
    state.filesSelectMode = false;
    state.selectedFiles.clear();
    document.getElementById('files-select-toggle')?.classList.remove('active');
    document.getElementById('files-bulk-bar')?.classList.add('hidden');
    refreshFiles();
  });
  document.getElementById('files-bulk-delete')?.addEventListener('click', async () => {
    if (!state.selectedFiles.size) return;
    if (!canDeleteFiles()) { UI.showToast(editBlockedReason() || 'File deletion is disabled.', 'warning'); return; }
    const count = state.selectedFiles.size;
    const ok = await UI.showConfirm(
      `Permanently delete ${count} file${count !== 1 ? 's' : ''}? This cannot be undone.`,
      { confirmLabel: 'Delete', danger: true },
    );
    if (!ok) return;
    const ids = [...state.selectedFiles];
    state.selectedFiles.clear();
    let failed = 0;
    // Load current file list so we have file_path for each id
    let allFiles;
    try { allFiles = await listFiles(state.roomId); }
    catch { UI.showToast('Could not load files — check your connection.', 'error'); return; }
    for (const id of ids) {
      const f = allFiles.find(x => x.id === id);
      if (!f) continue;
      try {
        await deleteFile(f.id, f.file_path);
      } catch { failed++; }
    }
    broadcastFilesChange();
    if (failed) UI.showToast(`${ids.length - failed} deleted, ${failed} failed.`, 'error');
    else        UI.showToast(`${ids.length} file${ids.length !== 1 ? 's' : ''} deleted.`, 'success');
    await refreshFiles();
    _updateBulkBar();
  });

}
