-- ============================================================
-- SyncPad – File content encryption
-- SAFE TO RERUN: ADD COLUMN IF NOT EXISTS is idempotent.
--
-- What this migration adds
-- ─────────────────────────
-- encrypted: marks whether a file's bytes in Storage are AES-256-GCM
-- ciphertext, encrypted client-side with the room's derived key before
-- upload (see src/files.js's uploadFile()) — the same key used for the
-- room's note text. filename and mime_type stay plaintext either way (kept
-- out of scope to avoid decrypting-to-render across every file-list/preview
-- call site); only the file's actual content is protected.
--
-- Defaults to false so every row that predates this migration — every file
-- ever uploaded, since encrypted rooms categorically rejected uploads
-- before this feature existed (see permissions.js's canUploadFiles(), which
-- used to block uploads outright whenever a room's encryption was enabled)
-- — is correctly read back as the plaintext it actually is.
-- ============================================================

alter table public.syncpad_files
  add column if not exists encrypted boolean not null default false;
