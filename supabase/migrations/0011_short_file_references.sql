-- ============================================================
-- SyncPad – Short, human-typable file references (file_no)
-- SAFE TO RERUN: column/constraint/trigger creation all guarded by
-- existence checks; the backfill only ever touches rows still missing
-- file_no, so a second run is a no-op.
--
-- What this migration adds
-- ─────────────────────────
-- An inserted file reference (`syncpad-file:<file_path>`, e.g.
-- `[report.pdf](syncpad-file:e2e-fixture-main-9f3k2/1737483920123_report.pdf)`)
-- embeds the full storage path — room id, a millisecond upload timestamp,
-- and the sanitized filename — making it long and effectively impossible to
-- type by hand. Every new insert now uses a short, sequential-per-room
-- integer instead (`syncpad-file:3`), assigned by the trigger below. The
-- client (src/files.js's resolveFileRef) resolves either shape: a bare
-- number looks up this new file_no column; anything else (contains a "/")
-- is treated as a literal legacy storage path exactly as before, so content
-- written before this migration keeps resolving unchanged — no note content
-- needs to be rewritten.
--
-- Concurrency: two devices uploading to the same room at nearly the same
-- moment must not be assigned the same file_no. The trigger locks the
-- room's own syncpad_rooms row (`for update`) before computing
-- max(file_no)+1 — since that lock is held for the trigger's own INSERT
-- transaction, a second concurrent insert's trigger blocks until the first
-- one commits, then correctly sees its row when computing its own next
-- number. Same "let Postgres's own row locking serialize it" idea as
-- rpc_consume_view_once's atomic UPDATE ... WHERE, just via a lock instead
-- of a conditional update (a plain insert has no existing row to condition
-- on).
-- ============================================================

alter table public.syncpad_files add column if not exists file_no integer;

-- Backfill any pre-existing rows, oldest-first per room, before the
-- uniqueness constraint below is added. A no-op on a fresh install (no rows
-- yet) or a re-run (no rows left with a null file_no).
with numbered as (
  select id, row_number() over (partition by room_id order by uploaded_at, id) as rn
  from public.syncpad_files
  where file_no is null
)
update public.syncpad_files f
   set file_no = numbered.rn
  from numbered
 where f.id = numbered.id;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'syncpad_files_room_file_no_unique'
  ) then
    alter table public.syncpad_files
      add constraint syncpad_files_room_file_no_unique unique (room_id, file_no);
  end if;
end $$;

create or replace function public.syncpad_assign_file_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.file_no is null then
    -- Best-effort lock: if the room row somehow doesn't exist yet (files
    -- should never be uploadable before their room is created), this locks
    -- nothing and the number below is still computed, just without the
    -- concurrency guarantee — better than failing the upload outright.
    perform 1 from public.syncpad_rooms where room_id = new.room_id for update;
    select coalesce(max(file_no), 0) + 1 into new.file_no
      from public.syncpad_files where room_id = new.room_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_syncpad_files_file_no on public.syncpad_files;

create trigger trg_syncpad_files_file_no
  before insert on public.syncpad_files
  for each row
  execute function public.syncpad_assign_file_no();

create index if not exists idx_syncpad_files_room_file_no
  on public.syncpad_files (room_id, file_no);
