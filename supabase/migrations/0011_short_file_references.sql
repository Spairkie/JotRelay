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
-- a new one reissued the deleted number.
--
-- Fixed by tracking a persistent per-room counter in its own table
-- (syncpad_room_file_counters), NOT a column on syncpad_rooms itself —
-- that was tried first and reverted: syncpad_rooms has a BEFORE UPDATE
-- trigger (set_syncpad_rooms_updated_at) that unconditionally stamps
-- updated_at = now() on *any* update to the row, including one that only
-- touches an unrelated bookkeeping column. Every file upload would have
-- silently bumped the room's "last modified" time, which (among other
-- things) breaks draft restoration — isDraftNewer() in room-lifecycle.js
-- compares a locally-saved draft's timestamp against updated_at, so a
-- draft saved before an upload would wrongly appear stale afterward even
-- though the room's actual text content never changed. A separate table
-- sidesteps that trigger entirely. An atomic
-- `insert ... on conflict (room_id) do update set next_file_no = next_file_no + 1 returning next_file_no`
-- both assigns the next number and provides the same row-level-locking
-- serialization the old `for update` lock did (a second concurrent
-- insert's trigger blocks on this same statement until the first
-- commits), so the concurrency guarantee is unchanged.
-- ============================================================

alter table public.syncpad_files add column if not exists file_no integer;

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

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'syncpad_files_room_file_no_unique'
  ) then
    alter table public.syncpad_files
      add constraint syncpad_files_room_file_no_unique unique (room_id, file_no);
  end if;
end $$;

-- One row per room; absence means "never issued a file_no yet" (the
-- trigger below starts such a room at 1 on its first upload).
create table if not exists public.syncpad_room_file_counters (
  room_id       text primary key references public.syncpad_rooms(room_id) on delete cascade,
  next_file_no  integer not null default 0
);

-- Pure server-side bookkeeping — no client (anon or authenticated) ever
-- has a legitimate reason to read or write this table directly; every
-- access goes through the SECURITY DEFINER trigger function below, which
-- runs as the table owner and bypasses RLS regardless. Supabase grants its
-- API roles broad default privileges on newly created public tables, so
-- without this, any anon-key caller could enumerate every room_id that has
-- ever had a file uploaded (a privacy leak on its own, and a stepping
-- stone into the room via syncpad_rooms' own open policies), or write
-- directly to next_file_no to force collisions or reissue deleted
-- references. Enabling RLS with zero policies denies both.
alter table public.syncpad_room_file_counters enable row level security;

-- Seed a counter row for every room that already has files, ONLY the
-- first time this migration ever runs on a given database (gated on the
-- counters table not existing yet, checked before it's created above, so
-- this whole block runs at most once — safe even though CREATE TABLE
-- itself is otherwise idempotent). Deliberately seeds well *above* the
-- current max(file_no), not exactly at it: a project that already ran an
-- earlier version of this migration (the max(file_no)+1 one, or the
-- syncpad_rooms.file_no_seq one both reverted above) may have already
-- deleted a file that held a higher number than anything currently
-- present — that number is genuinely unrecoverable once deleted (no
-- audit trail of every number ever issued exists), so seeding exactly at
-- the current max would silently reissue it, one more time, for exactly
-- the rooms where it matters.
--
-- IMPORTANT: this buffer is a practical mitigation, not a mathematical
-- guarantee. A room's true historical high-water mark is bounded only by
-- how many times a file was ever inserted into it, which this migration
-- has no record of for installs that ran an older, reuse-prone version of
-- this trigger — so no finite offset can be *proven* collision-free in
-- the abstract. What makes 50,000,000 the right practical choice: getting
-- a real collision requires a single room to have historically issued,
-- and then lost to a pre-migration deletion, more than 50 million file
-- references — for a notepad app's file-attachment feature (realistic
-- usage: tens to low thousands of files per room, ever), that's not a
-- plausible operational history, only a theoretical one. The buffer trades
-- consecutive-from-1 numbering after an upgrade (new numbers start higher
-- for rooms that had files before this migration) for that practical
-- non-reuse guarantee, without needing to know a historical high-water
-- mark that may simply no longer exist anywhere. (`file_no` is a 32-bit
-- integer, so the offset also stays far short of overflow: even a room
-- that already had a large max(file_no) has well over 2 billion headroom
-- left after adding it.)
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'syncpad_room_file_counters_seeded_marker'
  ) then
    insert into public.syncpad_room_file_counters (room_id, next_file_no)
    select f.room_id, max(f.file_no) + 50000000
      from public.syncpad_files f
     group by f.room_id
    on conflict (room_id) do nothing;

    -- A tiny marker table, not a real feature table, purely so the seed
    -- above never runs a second time (re-running it would add another
    -- +50000000 on top of whatever's already there). Nothing ever selects
    -- from or deletes it.
    create table public.syncpad_room_file_counters_seeded_marker (seeded_at timestamptz not null default now());
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
    insert into public.syncpad_room_file_counters (room_id, next_file_no)
    values (new.room_id, 1)
    on conflict (room_id) do update
      set next_file_no = public.syncpad_room_file_counters.next_file_no + 1
    returning next_file_no into new.file_no;
  end if;
  return new;
exception
  when foreign_key_violation then
    -- Best-effort fallback: the room row somehow doesn't exist yet (files
    -- should never be uploadable before their room is created), so the
    -- counter table's FK to syncpad_rooms rejected the insert above.
    -- Falls back to the old max()-based computation rather than failing
    -- the upload outright — loses the never-reused guarantee only in this
    -- shouldn't-happen case.
    select coalesce(max(file_no), 0) + 1 into new.file_no
      from public.syncpad_files where room_id = new.room_id;
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
