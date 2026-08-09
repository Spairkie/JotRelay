// SyncPad – files.js
// File upload, download, and deletion.
//
// Delete order: storage FIRST, then metadata.
// Rationale: if storage succeeds but the metadata delete fails, the orphaned
// DB row points to a nonexistent file (user sees a broken download link).
// If we delete metadata first and storage fails, the user has no way to
// access or delete the file through the UI.
// Broken download links are self-evident; orphaned storage is invisible.
//
// NOTE: ON DELETE CASCADE on syncpad_files only removes the metadata rows
// when a room is deleted. It does NOT remove the physical files in the
// syncpad-files Storage bucket. Those must be cleaned up separately.
import { getSupabaseClient } from './supabase.js';
import { logSupabaseError, getDeviceId } from './utils.js';
import { encryptBuffer, decryptBuffer } from './encryption.js';

const BUCKET   = 'syncpad-files';
const TABLE    = 'syncpad_files';
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// ── Signed URL cache ──────────────────────────────────────────────────────────
// Supabase signed URLs are valid for 3600 s (1 hour). We cache them for 55 min
// (3300 s) to avoid redundant API calls on every download/preview interaction
// while leaving a 5-minute safety margin before expiry.
//
// Two separate caches are kept because they request different Content-Disposition
// behavior from Storage:
//   _urlCache          – plain signed URL, served inline. Used for previews
//                        (images, PDFs/SVGs opened in a new tab, fetch()'d text/
//                        markdown/CSV) where the browser must render the content,
//                        not download it.
//   _downloadUrlCache   – signed URL requested with `download: <original filename>`,
//                        which makes Storage return a Content-Disposition: attachment
//                        header carrying the real filename. This is required because
//                        the storage path is `${roomId}/${timestamp}_${sanitizedName}`
//                        and the anchor `download` attribute is not honored by modern
//                        browsers for cross-origin URLs — without this, a saved file
//                        would be named e.g. "1737483920123_my_file.pdf" instead of
//                        the name the uploader actually gave it.
const _urlCache         = new Map(); // filePath → { url: string, expiresAt: number }
const _downloadUrlCache = new Map(); // filePath → { url: string, expiresAt: number }
const URL_TTL_MS = 55 * 60 * 1000; // 55 minutes in milliseconds

// `room_id:file_no` → file row. Populated opportunistically by listFiles()
// (whenever the Files panel has been loaded this session) so resolving a
// syncpad-file: reference by its short number usually doesn't need its own
// round trip — see resolveFileRef() below, which falls back to a direct
// query on a cache miss (e.g. a reference to a file inserted by another
// device, in a session where this device never opened the Files panel).
const _fileByRoomAndNo = new Map();
function _cacheFileRows(roomId, files) {
  for (const f of files) {
    if (f.file_no != null) _fileByRoomAndNo.set(`${roomId}:${f.file_no}`, f);
  }
}

// Both caches are only pruned reactively (on lookup/delete), not on a timer —
// a room with many distinct files previewed over a long session would
// otherwise accumulate expired entries indefinitely for the life of the tab.
// Sweeping expired entries on every read keeps steady-state size bounded by
// "distinct files actually requested in the last 55 min", not "ever".
function _evictExpired(cache) {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) cache.delete(key);
  }
}

// ── Decrypted blob URL cache (encrypted files only) ─────────────────────────
// A decrypted file's plaintext bytes never change, so — unlike the signed-URL
// caches above — this has no TTL; it's cached for the tab's lifetime and only
// evicted when the file itself is deleted (see deleteFile()). Each entry is a
// browser object URL (URL.createObjectURL), which must be explicitly revoked
// on eviction or it leaks the underlying Blob for the life of the page.
const _blobUrlCache = new Map(); // filePath → object URL string

async function _getDecryptedBlobUrl(filePath, mimeType, key) {
  const cached = _blobUrlCache.get(filePath);
  if (cached) return cached;

  const signedUrl = await getDownloadUrl(filePath);
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`Could not fetch file (HTTP ${res.status}).`);
  const cipherBuf = await res.arrayBuffer();
  const plainBuf  = await decryptBuffer(cipherBuf, key);
  const url = URL.createObjectURL(new Blob([plainBuf], { type: mimeType || 'application/octet-stream' }));
  _blobUrlCache.set(filePath, url);
  return url;
}

function _evictBlobUrl(filePath) {
  const url = _blobUrlCache.get(filePath);
  if (url) { URL.revokeObjectURL(url); _blobUrlCache.delete(filePath); }
}

/**
 * @param {string} roomId
 * @param {File} file
 * @param {{ encryptionKey?: CryptoKey }} [opts] – pass the room's derived key
 *   for an encrypted room to encrypt the file's bytes client-side before
 *   upload (AES-256-GCM, same key as the note text). Omit for an
 *   unencrypted room — the file uploads as-is, unchanged from before.
 */
export async function uploadFile(roomId, file, { encryptionKey } = {}) {
  if (file.size > MAX_SIZE) throw new Error('File too large. Maximum size is 10 MB.');
  const sb       = getSupabaseClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${roomId}/${Date.now()}_${safeName}`;

  let body        = file;
  let contentType = file.type || 'application/octet-stream';
  const encrypted = !!encryptionKey;
  if (encrypted) {
    const plainBuf  = await file.arrayBuffer();
    const cipherBuf = await encryptBuffer(plainBuf, encryptionKey);
    // Opaque content-type for ciphertext — the real mime_type is still kept
    // in metadata (see below) so preview/render logic can route on it
    // synchronously without decrypting first.
    body        = new Blob([cipherBuf], { type: 'application/octet-stream' });
    contentType = 'application/octet-stream';
  }

  const { error: uploadError } = await sb.storage.from(BUCKET).upload(
    filePath, body, { contentType }
  );
  if (uploadError) {
    logSupabaseError('uploadFile:storage', uploadError, { room_id: roomId });
    throw new Error('Could not upload file.');
  }

  const { data, error: dbError } = await sb.from(TABLE)
    .insert({
      room_id:           roomId,
      filename:          file.name,
      file_path:         filePath,
      // Original plaintext size, not the ~28-byte-larger ciphertext blob —
      // more accurate for display and cheap to keep since it's already
      // known before encryption.
      file_size:         file.size,
      mime_type:         file.type || null,
      uploaded_by_device: getDeviceId(),
      encrypted,
    })
    .select()
    .single();

  if (dbError) {
    logSupabaseError('uploadFile:metadata', dbError, { room_id: roomId });
    // Roll back the storage upload (best-effort — ignore error)
    await sb.storage.from(BUCKET).remove([filePath]).catch(() => {});
    throw new Error('Could not save file metadata.');
  }

  return data;
}

/**
 * Get an inline signed URL for a file — used for previews (images, PDFs/SVGs
 * opened in a new tab, fetch()'d text/markdown/CSV). Renders in the browser
 * rather than forcing a download; does not carry the original filename.
 */
export async function getDownloadUrl(filePath) {
  _evictExpired(_urlCache);
  // Return cached URL if still valid
  const cached = _urlCache.get(filePath);
  if (cached && Date.now() < cached.expiresAt) return cached.url;

  const { data, error } = await getSupabaseClient()
    .storage.from(BUCKET).createSignedUrl(filePath, 3600);
  if (error) {
    logSupabaseError('getDownloadUrl', error, { file_path: filePath });
    throw new Error('Could not generate download link.');
  }
  _urlCache.set(filePath, { url: data.signedUrl, expiresAt: Date.now() + URL_TTL_MS });
  return data.signedUrl;
}

/**
 * Get a signed URL that forces a browser download with the file's original
 * name via a server-set Content-Disposition header. Use this for actual
 * "Download" actions; use getDownloadUrl() for inline preview.
 * @param {string} filePath
 * @param {string} filename  – original filename to save as
 * @param {object} [opts]
 * @param {boolean} [opts.fresh=false]  – bypass the cache and mint a new URL.
 *   A cached entry can be up to 55 minutes old when returned, leaving as
 *   little as ~5 minutes of the underlying 60-minute signed URL's real
 *   lifetime — fine for an immediate download, but not for "copy a link to
 *   share with someone who might not open it right away," where the whole
 *   point is a link that's actually good for close to the full ~55 minutes.
 */
export async function getForceDownloadUrl(filePath, filename, { fresh = false } = {}) {
  _evictExpired(_downloadUrlCache);
  const cached = fresh ? null : _downloadUrlCache.get(filePath);
  if (cached && Date.now() < cached.expiresAt) return cached.url;

  const { data, error } = await getSupabaseClient()
    .storage.from(BUCKET).createSignedUrl(filePath, 3600, { download: filename || true });
  if (error) {
    logSupabaseError('getForceDownloadUrl', error, { file_path: filePath });
    throw new Error('Could not generate download link.');
  }
  // supabase-js double-encodes the `download` query param it builds from
  // `filename` (e.g. "(" round-trips as "%2528" instead of "%28") — it's the
  // one part of the signed URL that isn't inside the signed token (it's a
  // plain query param appended after it), so it's safe to overwrite with a
  // correctly, singly-encoded value instead of trusting the SDK's own.
  let signedUrl = data.signedUrl;
  if (filename) {
    const url = new URL(signedUrl);
    url.searchParams.set('download', filename);
    signedUrl = url.toString();
  }
  _downloadUrlCache.set(filePath, { url: signedUrl, expiresAt: Date.now() + URL_TTL_MS });
  return signedUrl;
}

/**
 * Get a URL suitable for inline preview (image src, PDF/SVG new-tab link,
 * fetch()'d text/markdown/CSV) — same use as getDownloadUrl(), but decrypts
 * first when the file was uploaded encrypted. Returns a local blob: object
 * URL for encrypted files (see _getDecryptedBlobUrl above) or a plain signed
 * URL otherwise.
 * @param {object} file – row from syncpad_files
 * @param {CryptoKey|null} [key] – the room's decryption key, if available
 */
export async function getFilePreviewUrl(file, key) {
  if (file.encrypted && key) return _getDecryptedBlobUrl(file.file_path, file.mime_type, key);
  return getDownloadUrl(file.file_path);
}

/**
 * Get a URL suitable for a "Download" action, saving under the file's
 * original name. For an encrypted file this is a decrypted blob: URL — same
 * origin, so the anchor's `download` attribute is honored natively without
 * needing Storage's `download` query param trick (see getForceDownloadUrl).
 * @param {object} file – row from syncpad_files
 * @param {CryptoKey|null} [key] – the room's decryption key, if available
 */
export async function getFileDownloadUrl(file, key) {
  if (file.encrypted && key) return _getDecryptedBlobUrl(file.file_path, file.mime_type, key);
  return getForceDownloadUrl(file.file_path, file.filename);
}

/**
 * Delete a file. Removes storage first, then metadata.
 *
 * Step 1: Delete from storage. If it fails, abort with an error — the file
 *         remains accessible to the user via the download link.
 * Step 2: Delete the metadata row. If it fails, throw a distinct error so the
 *         caller can surface a clear warning to the user (the physical file
 *         is gone, but the row still appears in the list and points nowhere).
 *
 * The two-step delete intentionally throws on either failure so the caller
 * sees an explicit error instead of silently leaving an inconsistency.
 *
 * @param {string} fileId
 * @param {string} filePath
 * @param {{ roomId?: string, fileNo?: number }} [ref] – when provided,
 *   evicts the deleted file's entry from the getFileByNo() short-reference
 *   cache too (see _fileByRoomAndNo above) — otherwise a syncpad-file:N
 *   reference to this now-deleted file would keep resolving to its stale
 *   cached row (and, from that, a signed URL for a storage object that no
 *   longer exists) instead of correctly reporting "File not found" the
 *   next time it's encountered in the note, for as long as this tab's
 *   session lasts. Optional — a caller that never went through
 *   getFileByNo()/listFiles() for this room has nothing to evict.
 */
export async function deleteFile(fileId, filePath, { roomId, fileNo } = {}) {
  const sb = getSupabaseClient();

  // Evict cached signed URLs so stale links are not returned after deletion.
  _urlCache.delete(filePath);
  _downloadUrlCache.delete(filePath);
  _evictBlobUrl(filePath);
  if (roomId != null && fileNo != null) _fileByRoomAndNo.delete(`${roomId}:${fileNo}`);

  // Step 1: Delete from storage. Abort if this fails.
  const { error: se } = await sb.storage.from(BUCKET).remove([filePath]);
  if (se) {
    logSupabaseError('deleteFile:storage', se, { file_path: filePath });
    throw new Error('Could not delete the file from storage.');
  }

  // Step 2: Remove the metadata row. Storage is already gone; surface this.
  const { error: de } = await sb.from(TABLE).delete().eq('id', fileId);
  if (de) {
    logSupabaseError('deleteFile:metadata (orphaned row)', de, { file_id: fileId });
    const err = new Error('File removed from storage, but the metadata row could not be deleted. Refresh the file list.');
    err.code = 'METADATA_DELETE_FAILED';
    throw err;
  }
}

export async function listFiles(roomId) {
  const { data, error } = await getSupabaseClient()
    .from(TABLE).select('*').eq('room_id', roomId)
    .order('uploaded_at', { ascending: false });
  if (error) { logSupabaseError('listFiles', error, { room_id: roomId }); throw error; }
  _cacheFileRows(roomId, data || []);
  return data || [];
}

/**
 * Look up a file by its short per-room number (see 0011_short_file_references.sql).
 * Checks the listFiles() cache first; falls back to a direct query for a
 * reference this device hasn't seen yet (e.g. someone else inserted it, and
 * the Files panel hasn't been opened this session).
 * @returns {Promise<object|null>}
 */
export async function getFileByNo(roomId, fileNo) {
  const key = `${roomId}:${fileNo}`;
  if (_fileByRoomAndNo.has(key)) return _fileByRoomAndNo.get(key);
  const { data, error } = await getSupabaseClient()
    .from(TABLE).select('*').eq('room_id', roomId).eq('file_no', fileNo).maybeSingle();
  if (error || !data) return null;
  _fileByRoomAndNo.set(key, data);
  return data;
}

/**
 * Resolve a syncpad-file: reference (the part after the scheme) embedded in
 * note content to a real, previewable/downloadable signed URL. Two shapes:
 *   - a bare per-room file number ("3") — the short, human-typable form
 *     every insert/paste/drop has produced since 0011_short_file_references.sql.
 *   - anything else — a full legacy storage path (contains "/"), the only
 *     shape that existed before file_no; resolved exactly as before so
 *     notes written before this change keep working unmodified. Legacy
 *     paths predate the `encrypted` column entirely, so they're never
 *     encrypted — no row lookup (and thus no decryption) is needed for them.
 * @param {string} roomId
 * @param {string} ref
 * @param {CryptoKey|null} [key] – the room's decryption key, if available
 */
export async function resolveFileRef(roomId, ref, key) {
  if (/^\d+$/.test(ref)) {
    const row = await getFileByNo(roomId, Number(ref));
    if (!row) throw new Error('File not found.');
    return getFilePreviewUrl(row, key);
  }
  return getDownloadUrl(ref);
}

export function subscribeToFiles(roomId, onFilesChange) {
  const sb = getSupabaseClient();
  const ch = sb.channel(`db-files-${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE,
        filter: `room_id=eq.${roomId}` }, () => onFilesChange())
    .subscribe();
  return () => sb.removeChannel(ch);
}
