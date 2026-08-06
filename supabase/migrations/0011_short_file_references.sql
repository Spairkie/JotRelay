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
-- Concurrency AND non-reuse: two devices uploading to the same room at
-- nearly the same moment must not be assigned the same file_no, and a
-- number, once issued, must never be reissued to a different file even
-- after the original is deleted — resolveFileRef() resolves a reference
-- purely by (room_id, file_no), so a reused number would make an existing
-- `syncpad-file:N` reference in someone's note content silently start
-- opening a completely different file. An earlier version of this trigger
-- computed max(file_no)+1 from the *currently existing* rows, which broke
-- exactly that guarantee: deleting the highest-numbered file and uploading
-- a new one reissued the deleted number. Fixed by tracking a persistent
-- per-room counter (syncpad_rooms.file_no_seq) that only ever increases,
-- independent of what's since been deleted — an atomic
-- `update ... set file_no_seq = file_no_seq + 1 returning file_no_seq`
-- both assigns the next number and provides the same row-level-locking
-- serialization the old `for update` lock did (a second concurrent
-- insert's trigger blocks on this same UPDATE until the first commits),
-- so the concurrency guarantee is unchanged.
-- ============================================================

alter table public.syncpad_files add column if not exists file_no integer;
alter table public.syncpad_rooms add column if not exists file_no_seq integer not null default 0;

-- Backfill any pre-existing rows, oldest-first per room, before the
-- uniqueness constraint below is added. A no-op on a fresh install (no rows
-- yet) or a re-run (no rows left with a null file_no).
with numbered as (
  select id, room_id, row_number() over (partition by room_id order by uploaded_at, id) as rn
  from public.syncpad_files
  where file_no is null
)
update public.syncpad_files f
   set file_no = numbered.rn
  from numbered
 where f.id = numbered.id;

-- Seed each room's counter to the highest file_no it has already issued
-- (0 if none), so newly assigned numbers continue after existing ones
-- instead of restarting at 1 and immediately colliding. Only touches rooms
-- still at the column's default (0) — safe to rerun, and doesn't clobber a
-- counter that's already advanced past its files (the expected state once
-- deletions have happened, which is the entire point of this migration).
update public.syncpad_rooms r
   set file_no_seq = coalesce(
     (select max(f.file_no) from public.syncpad_files f where f.room_id = r.room_id),
     0
   )
 where file_no_seq = 0;

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
    update public.syncpad_rooms
       set file_no_seq = file_no_seq + 1
     where room_id = new.room_id
    returning file_no_seq into new.file_no;

    if new.file_no is null then
      -- Best-effort fallback: the room row somehow doesn't exist yet
      -- (files should never be uploadable before their room is created),
      -- so the UPDATE above matched nothing. Falls back to the old
      -- max()-based computation rather than failing the upload outright —
      -- loses the never-reused guarantee only in this shouldn't-happen case.
      select coalesce(max(file_no), 0) + 1 into new.file_no
        from public.syncpad_files where room_id = new.room_id;
    end if;
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
