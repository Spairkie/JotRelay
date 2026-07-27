-- ============================================================
-- SyncPad – Anonymous Write Rate Limiting
-- SAFE TO RERUN: CREATE OR REPLACE / DROP+CREATE TRIGGER guarded by
-- existence checks, fully idempotent.
--
-- ⚠️  NOT YET TESTED AGAINST A LIVE SUPABASE PROJECT. Fully applied and
-- exercised against a real local PostgreSQL 16 instance (schema built from
-- every prior migration in this directory, plus minimal stubs for the
-- Supabase-managed pieces this migration touches — auth.users/auth.uid(),
-- storage.buckets/objects): every code path was actually run, not just
-- read — 30/30 room-creates then a correctly-rejected 31st, a second
-- device_id unaffected by the first's limit, 10/10 reports then a
-- correctly-rejected 11th, an authenticated admin bypassing an
-- already-exhausted device_id's limit, the log-cleanup function actually
-- deleting aged rows, and syncpad_client_ip() verified on all three paths
-- (a real x-forwarded-for header extracts correctly; malformed JSON and a
-- missing header both fail open to null rather than erroring). What that
-- setup can't reproduce is the real Supabase edge/PostgREST layer itself —
-- specifically, whether *this* project's `request.headers` actually
-- contains `x-forwarded-for` the way this migration assumes. That part is
-- unverified. Apply to a development/staging project first and confirm:
-- (1) room creation and report submission still succeed under normal use,
-- (2) `select public.syncpad_client_ip()` from the SQL Editor doesn't error
-- (it may return null there — the SQL Editor isn't a PostgREST request —
-- that's expected), (3) ideally, log a real client request's identifier via
-- a temporary `raise notice` in enforce_syncpad_rooms_rate_limit() to
-- confirm the IP path is actually populating in production traffic, not
-- silently no-op'd the whole time.
-- Run this in your Supabase project → SQL Editor after 0001_base_schema.sql.
--
-- What this migration adds
-- ─────────────────────────
-- docs/security.md documents room_id + the anon key as a sufficient write
-- credential with "no rate limiting described in this document," and lists
-- "application-level rate limiting for room creation" as something to
-- evaluate. `syncpad_rooms` and `syncpad_room_reports` both carry an
-- `anon ... with check (true)` INSERT policy — any anon-key holder can
-- create unlimited rooms or submit unlimited reports today.
--
-- Adds a small BEFORE INSERT trigger on each table, the same technique
-- 0001's room-lock trigger and 0008's quarantine trigger already use, so it
-- applies no matter which policy or code path permitted the write. Each
-- insert is checked against a short rolling window, keyed on whichever
-- identifiers are available:
--   • created_by_device / reporter_device_id — always present (client-
--     generated, see src/utils.js's getDeviceId()). Trivially spoofable by
--     a determined scripted attacker (a fresh device_id per request costs
--     them nothing), so this alone only stops accidental runaway loops and
--     unsophisticated abuse — not a strong guarantee.
--   • the request's IP address, read defensively from PostgREST's
--     `request.headers` GUC (`x-forwarded-for`, first entry). Stronger,
--     but depends on Supabase's edge actually setting that header the way
--     this migration assumes — hence "untested" above. If it's ever
--     unavailable or malformed, syncpad_client_ip() returns null and the
--     IP-based check is silently skipped rather than blocking anything.
-- Either identifier tripping its own limit blocks the insert; neither
-- being available (e.g. a direct SQL Editor insert with no device_id and
-- no PostgREST request context) fails OPEN — this is deliberate: a
-- rate limiter with an ambiguous identity should never be the reason
-- room creation stops working for everyone.
--
-- A signed-in admin (is_syncpad_admin()) and the backend cleanup job
-- ('backend-cleanup') are exempt, same as the other write-gating triggers.
-- ============================================================

-- ── Log table ──────────────────────────────────────────────────────────────
-- Internal bookkeeping only — RLS enabled with zero policies (default deny
-- for anon/authenticated); only the SECURITY DEFINER trigger functions
-- below ever touch it, running as the table owner, which bypasses RLS
-- unless FORCE ROW LEVEL SECURITY is set (it deliberately is not here).

create table if not exists public.syncpad_rate_limit_log (
  id          bigint generated always as identity primary key,
  action      text        not null check (action in ('room_create', 'room_report')),
  identifier  text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_syncpad_rate_limit_log_lookup
  on public.syncpad_rate_limit_log (action, identifier, created_at);

alter table public.syncpad_rate_limit_log enable row level security;

-- ── Client IP helper ──────────────────────────────────────────────────────
-- Reads PostgREST's `request.headers` GUC (a JSON object of the incoming
-- request's headers, lowercased keys) for `x-forwarded-for`, set by
-- Supabase's edge network to the real client IP. Wrapped so ANY failure —
-- the setting missing entirely (e.g. called outside a PostgREST request,
-- like the SQL Editor), malformed JSON, header absent, whatever — returns
-- null instead of raising. Never let this be the reason a write fails.

create or replace function public.syncpad_client_ip()
returns text
language plpgsql
stable
as $$
declare
  raw text;
begin
  raw := current_setting('request.headers', true);
  if raw is null then
    return null;
  end if;
  return nullif(trim(split_part(raw::json->>'x-forwarded-for', ',', 1)), '');
exception
  when others then
    return null;
end;
$$;

-- ── Shared rate-check helper ──────────────────────────────────────────────
-- Returns true if identifier has already hit max_count for this action
-- within window_minutes. A null identifier always returns false (never
-- blocks — the caller only invokes this for identifiers it already knows
-- are non-null).

create or replace function public.syncpad_rate_limit_exceeded(
  p_action text,
  p_identifier text,
  p_max_count integer,
  p_window_minutes integer
)
returns boolean
language sql
stable
as $$
  select p_identifier is not null and (
    select count(*) >= p_max_count
    from public.syncpad_rate_limit_log
    where action = p_action
      and identifier = p_identifier
      and created_at > now() - make_interval(mins => p_window_minutes)
  );
$$;

-- ── Room creation ──────────────────────────────────────────────────────────
-- Limits: 30 new rooms per device per 15 minutes, 60 per IP per 15 minutes
-- (looser than the per-device limit since one IP can legitimately cover
-- several people, e.g. behind a shared/NAT'd or corporate connection).
-- Tune both to taste — these are deliberately generous defaults chosen to
-- avoid blocking normal use (a user quickly spinning up several rooms to
-- organize different notes is legitimate), not a tight anti-abuse bound.

create or replace function public.enforce_syncpad_rooms_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device text := nullif(trim(coalesce(NEW.created_by_device, '')), '');
  v_ip     text := public.syncpad_client_ip();
begin
  if coalesce(NEW.created_by_device, '') = 'backend-cleanup' or public.is_syncpad_admin() then
    return NEW;
  end if;

  if public.syncpad_rate_limit_exceeded('room_create', v_device, 30, 15)
     or public.syncpad_rate_limit_exceeded('room_create', v_ip, 60, 15)
  then
    raise exception 'Too many rooms created recently. Please wait a few minutes and try again.' using errcode = '42501';
  end if;

  if v_device is not null then
    insert into public.syncpad_rate_limit_log (action, identifier) values ('room_create', v_device);
  end if;
  if v_ip is not null then
    insert into public.syncpad_rate_limit_log (action, identifier) values ('room_create', v_ip);
  end if;

  return NEW;
end;
$$;

drop trigger if exists syncpad_rooms_enforce_rate_limit on public.syncpad_rooms;

create trigger syncpad_rooms_enforce_rate_limit
  before insert on public.syncpad_rooms
  for each row
  execute function public.enforce_syncpad_rooms_rate_limit();

-- ── Room reports ────────────────────────────────────────────────────────────
-- Limits: 10 reports per device per 15 minutes, 20 per IP per 15 minutes —
-- tighter than room creation since legitimate report volume from one
-- person/connection should be low, but still generous enough that someone
-- genuinely working through several problem rooms isn't blocked.

create or replace function public.enforce_syncpad_room_reports_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device text := nullif(trim(coalesce(NEW.reporter_device_id, '')), '');
  v_ip     text := public.syncpad_client_ip();
begin
  if public.is_syncpad_admin() then
    return NEW;
  end if;

  if public.syncpad_rate_limit_exceeded('room_report', v_device, 10, 15)
     or public.syncpad_rate_limit_exceeded('room_report', v_ip, 20, 15)
  then
    raise exception 'Too many reports submitted recently. Please wait a few minutes and try again.' using errcode = '42501';
  end if;

  if v_device is not null then
    insert into public.syncpad_rate_limit_log (action, identifier) values ('room_report', v_device);
  end if;
  if v_ip is not null then
    insert into public.syncpad_rate_limit_log (action, identifier) values ('room_report', v_ip);
  end if;

  return NEW;
end;
$$;

drop trigger if exists syncpad_room_reports_enforce_rate_limit on public.syncpad_room_reports;

create trigger syncpad_room_reports_enforce_rate_limit
  before insert on public.syncpad_room_reports
  for each row
  execute function public.enforce_syncpad_room_reports_rate_limit();

-- ── Log table cleanup ───────────────────────────────────────────────────────
-- The log only needs to remember the last p_window_minutes (15) of activity
-- for the checks above to work; keeping a day's worth is a comfortable
-- margin for debugging/tuning without letting the table grow unbounded.
-- Same "schedule via pg_cron if available, else leave for manual/other
-- maintenance" pattern as 0001's cleanup_expired_syncpad_rooms().

create or replace function public.cleanup_syncpad_rate_limit_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.syncpad_rate_limit_log
   where created_at < now() - interval '1 day';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

comment on function public.cleanup_syncpad_rate_limit_log()
  is 'Prunes syncpad_rate_limit_log rows older than 1 day. Intended for pg_cron or manual SQL maintenance.';

revoke all on function public.cleanup_syncpad_rate_limit_log() from public;
revoke all on function public.cleanup_syncpad_rate_limit_log() from anon;
revoke all on function public.cleanup_syncpad_rate_limit_log() from authenticated;

do $do$
declare
  existing_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled; automatic rate-limit-log cleanup was not scheduled. Enable pg_cron and rerun this script to schedule it.';
    return;
  end if;

  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'syncpad-rate-limit-log-cleanup'
   limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'syncpad-rate-limit-log-cleanup',
    '*/30 * * * *',
    $cron$select public.cleanup_syncpad_rate_limit_log();$cron$
  );
end;
$do$;
