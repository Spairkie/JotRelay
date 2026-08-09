-- ============================================================
-- SyncPad – Comment anchor-text snapshot
-- SAFE TO RERUN: ADD COLUMN IF NOT EXISTS and the guarded constraint block
-- below are both idempotent.
--
-- What this migration adds
-- ─────────────────────────
-- anchor_text: a snapshot of the exact text a comment was anchored to at
-- creation time, so the client can detect "the commented text no longer
-- exists" and delete the comment automatically (see
-- src/app/comments-preview.js's _pruneDeletedCommentAnchors()) — Google
-- Docs/Notion-style "comment disappears when its text is deleted" behavior.
--
-- Same ciphertext convention as the existing `text` column (see
-- 0003_room_comments.sql's header comment): for an encrypted room this
-- holds ciphertext, encrypted by the caller with the same room key, so this
-- table still needs no separate encryption handling of its own.
--
-- Nullable, unlike `text` — existing rows created before this migration
-- have no snapshot to backfill from (the original selection is gone), and
-- the client already treats a null/missing snapshot as "not trackable,
-- leave it alone" rather than an error.
-- ============================================================

alter table public.syncpad_room_comments
  add column if not exists anchor_text text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'syncpad_room_comments_anchor_text_len_check'
  ) then
    alter table public.syncpad_room_comments
      add constraint syncpad_room_comments_anchor_text_len_check
      check (anchor_text is null or length(anchor_text) <= 4000); -- same headroom as the text column
  end if;
end $$;
