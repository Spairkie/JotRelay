// JotRelay – admin/state.js
// Shared mutable dashboard state, as a single object rather than scattered
// module-level `let`s. Every admin/*.js module imports and reads/writes
// properties on the same `state` object — the binding itself never changes,
// only its contents, which is what makes sharing mutable state safely across
// ES modules require: an imported `let` binding can't be reassigned from
// outside its own module, but an imported object's properties can be.
//
// Reset on every dashboard init/logout — see _teardownDashboard() in
// dashboard-shell.js, which is the one place allowed to wholesale-replace
// the collection-typed fields (rooms/reports/files/audit/roomsSelected).
export const state = {
  sb:               null,
  session:          null,
  activeTab:        'rooms',
  lastRefreshed:    null,
  refreshedTimer:   null,
  shortcutsHandler: null,

  // Rooms tab
  rooms:         [],
  roomsOffset:   0,
  roomsTotal:    0,
  roomsFilter:   'all',
  roomsSort:     { col: 'updated_at', dir: 'desc' },
  roomsSearch:   '',
  roomsSelected: new Set(),
  hasQuarantine: false, // set after probing schema

  // Reports tab
  reports:       [],
  reportsOffset: 0,
  reportsFilter: 'new',
  reportsTotal:  0,

  // Files tab
  files:       [],
  filesOffset: 0,
  filesTotal:  0,

  // Audit tab
  audit:         [],
  auditOffset:   0,
  hasAuditTable: false,
};
