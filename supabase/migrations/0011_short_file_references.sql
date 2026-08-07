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

alter table public.syncpad_files add column if not exists file_no bigint;

-- Widen an existing int4 file_no column from an earlier version of this
-- migration up to bigint (a no-op on a fresh install, where the column
-- was just created as bigint directly above). See the seed block below
-- for why int4 wasn't wide enough to safely stay on.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'syncpad_files'
      and column_name = 'file_no' and data_type = 'integer'
  ) then
    alter table public.syncpad_files alter column file_no type bigint;
  end if;
end $$;

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
  next_file_no  bigint not null default 0
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'syncpad_room_file_counters'
      and column_name = 'next_file_no' and data_type = 'integer'
  ) then
    alter table public.syncpad_room_file_counters alter column next_file_no type bigint;
  end if;
end $$;

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
-- mark that may simply no longer exist anywhere.
--
-- `file_no` was originally a 32-bit integer column, and — before the fix
-- below that makes the assignment trigger always ignore client input —
-- the insert policies on syncpad_files let any anon/authenticated caller
-- set file_no directly to an arbitrary value, including one close to the
-- old int4 max (2,147,483,647). Two distinct problems followed from that:
-- (1) an installation with such a row would overflow plain `+ 50000000`
-- integer arithmetic here and abort the whole seed statement, for every
-- room, not just the offending one, since it's a single grouped
-- INSERT...SELECT; (2) even a *clamped* seed sitting right at the int4
-- ceiling would itself overflow on the very next ordinary upload's
-- `next_file_no + 1`, turning a one-time migration failure into a
-- permanent per-room failure instead — an actual regression versus the
-- pre-migration `max(file_no) + 1` behavior for that narrow value range.
-- Both are closed by widening file_no/next_file_no to bigint above: the
-- seed is computed in `numeric` (arbitrary precision, so `+ 50000000` can
-- never overflow no matter how large max(file_no) already is) and only
-- clamped — to the bigint max, not int4's — right before casting back
-- down to the column's actual (now bigint) type. Reaching that far higher
-- ceiling would require a room to have already received a file_no within
-- 50 million of 9,223,372,036,854,775,807, which needs the same
-- since-closed pre-fix exploit but at a scale with no realistic path to
-- ever occurring, so the clamped case is no longer one this migration
-- needs to treat as reachable.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'syncpad_room_file_counters_seeded_marker'
  ) then
    -- LEFT JOIN from syncpad_rooms, not a plain SELECT from syncpad_files
    -- grouped by room_id: a room that issued file numbers under an earlier
    -- version of this trigger and has since deleted every one of its files
    -- has no surviving syncpad_files rows at all, so a files-only query
    -- would emit no seed row for it whatsoever. Its next upload would then
    -- create a fresh counter starting at 1 via syncpad_assign_file_no()'s
    -- own on-conflict-insert, silently reissuing file_no 1 (and onward)
    -- even though an old syncpad-file:1 reference may still be circulating
    -- for the deleted file that originally held it — the exact class of bug
    -- this whole buffered-seed mechanism exists to prevent, just for rooms
    -- with zero surviving files instead of a lower max(file_no). coalesce
    -- to 0 gives such a room the same +50000000 buffer as every other room.
    insert into public.syncpad_room_file_counters (room_id, next_file_no)
    select r.room_id, least(coalesce(max(f.file_no), 0)::numeric + 50000000, 9223372036854775807::numeric)::bigint
      from public.syncpad_rooms r
      left join public.syncpad_files f on f.room_id = r.room_id
     group by r.room_id
    on conflict (room_id) do nothing;

    -- A tiny marker table, not a real feature table, purely so the seed
    -- above never runs a second time (re-running it would add another
    -- +50000000 on top of whatever's already there). Nothing ever selects
    -- from or deletes it. Same reasoning as syncpad_room_file_counters
    -- above for enabling RLS with zero client policies below: Supabase's
    -- default privileges would otherwise let any anon-key caller insert
    -- unlimited rows into it directly (it has no uniqueness constraint
    -- and nothing else reads it, so nothing else would notice).
    create table public.syncpad_room_file_counters_seeded_marker (seeded_at timestamptz not null default now());
  end if;
end $$;

alter table public.syncpad_room_file_counters_seeded_marker enable row level security;

create or replace function public.syncpad_assign_file_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Always overwrite file_no server-side, regardless of what (if
  -- anything) the caller sent — file_no is pure internal bookkeeping,
  -- the app's own client code never sets it, and the insert policies on
  -- syncpad_files otherwise let any anon/authenticated caller supply an
  -- arbitrary value directly. Previously this only assigned when
  -- new.file_no was null: a caller could insert an explicit file_no
  -- (e.g. 1) into a room with no counter row yet, after which every
  -- subsequent *normal* app upload (file_no null, counter starts at 1)
  -- would collide with that same value, roll back, and fail again on
  -- every retry — the room's uploads would be permanently broken.
  insert into public.syncpad_room_file_counters (room_id, next_file_no)
  values (new.room_id, 1)
  on conflict (room_id) do update
    set next_file_no = public.syncpad_room_file_counters.next_file_no + 1
  returning next_file_no into new.file_no;
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
