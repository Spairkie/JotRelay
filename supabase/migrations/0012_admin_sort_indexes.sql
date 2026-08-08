-- ============================================================
-- SyncPad – Admin dashboard sort/filter indexes
-- SAFE TO RERUN: CREATE INDEX IF NOT EXISTS is idempotent.
--
-- What this migration adds
-- ─────────────────────────
-- Three indexes covering columns the admin dashboard actively sorts and
-- range-filters on, but which had no supporting index:
--
--   - syncpad_rooms.updated_at  — the Rooms tab's default sort column
--     (src/admin/state.js: roomsSort = { col: 'updated_at', dir: 'desc' }),
--     also range-filtered by the "active in the last 24h" stat
--     (src/admin/stats.js: .gte('updated_at', dayAgoIso)).
--   - syncpad_rooms.created_at  — the Rooms tab's other clickable sort
--     column (src/admin/rooms-tab.js's data-col="created_at" header), also
--     range-filtered by the "created since X" activity stat
--     (src/admin/stats.js: .gte('created_at', activitySinceIso)).
--   - syncpad_files.uploaded_at — the admin Files tab's default sort
--     (src/admin/files-tab.js: .order('uploaded_at', { ascending: false })).
--
-- Without these, each of those queries requires a full sequential scan of
-- the table (plus an in-memory sort for the ORDER BY cases) rather than an
-- index-order scan — fine at small scale, but scales linearly with total
-- room/file count instead of with the page size actually requested, and is
-- the kind of gap that's cheap to close now and only gets more expensive to
-- discover later. Every other actively-sorted/filtered admin-dashboard
-- column already has a matching index (see 0001_base_schema.sql,
-- 0006_admin_dashboard_improvements.sql) — this fills in the three that
-- were missed.
-- ============================================================

create index if not exists idx_syncpad_rooms_updated_at
  on public.syncpad_rooms(updated_at);

create index if not exists idx_syncpad_rooms_created_at
  on public.syncpad_rooms(created_at);

create index if not exists idx_syncpad_files_uploaded_at
  on public.syncpad_files(uploaded_at);
