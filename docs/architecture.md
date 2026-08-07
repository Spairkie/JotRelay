# SyncPad Architecture

SyncPad is a vanilla-JS realtime notepad built on Supabase with no build step. There is no bundler, no framework, and no compilation phase — the browser loads ES modules directly from disk.

---

## 1. High-Level Architecture Diagram

```
Browser (HTML + CSS + ES Modules)
    ├── index.html               — shell, Supabase config, screen containers
    ├── service-worker.js        — PWA cache (cache-first, immutable per CACHE_VERSION)
    └── src/*.js                 — ES modules (no bundler)
            ├── app.js           — router, event wiring, global state
            ├── ui.js            — all DOM manipulation
            ├── sync.js          — dual-track sync (Broadcast + Postgres)
            ├── presence.js      — device list, typing indicator, cursor line
            ├── live-broadcast.js — Supabase Broadcast event dispatch
            ├── files.js         — upload, signed-URL cache, delete
            ├── file-preview.js  — in-app preview modal
            ├── markdown.js      — safe custom renderer
            ├── encryption.js    — AES-256-GCM + PBKDF2
            ├── permissions.js   — frontend permission context
            ├── settings.js      — room settings handlers
            ├── templates.js     — built-in + custom templates
            ├── theme.js         — CSS variable theme system
            ├── shortcuts.js     — keyboard shortcut handler
            ├── live-editor.js   — CodeMirror 6 "Live"/Split editing surface
            ├── rooms.js         — room CRUD, share links, short codes (Supabase queries/RPCs)
            ├── comments.js      — anchored inline comments (optional migration)
            ├── revisions.js     — version history snapshots (optional migration)
            ├── offline.js       — localStorage draft save/restore
            ├── admin.js         — admin dashboard (Supabase Auth)
            └── utils.js / icons.js / supabase.js — helpers

Supabase
    ├── syncpad_rooms       (Postgres + Realtime)
    ├── syncpad_files       (Postgres + Realtime)
    ├── syncpad_share_links (Postgres)
    ├── syncpad_room_reports (Postgres)
    └── syncpad-files       (Storage bucket, private, signed URLs)
```

---

## 2. Module Responsibilities

### `app.js`
The application entry point and central coordinator. It owns the URL router, wires all cross-module event listeners, and holds the canonical module-level state variables (see §5). It does NOT perform DOM manipulation directly — all rendering is delegated to `ui.js`.

### `ui.js`
Contains every function that reads from or writes to the DOM. All `document.querySelector`, `innerHTML`, `classList`, and event-listener registrations for UI elements live here. It does NOT contain business logic, network calls, or application state.

### `sync.js`
Implements the dual-track synchronisation strategy (Broadcast lane + Durable lane). It decides when to write to Postgres (1 s debounce), handles incoming Realtime events from other tabs, and performs conflict detection. It does NOT directly manage WebSocket subscription lifecycle — that is coordinated through `live-broadcast.js` and Supabase's Realtime client.

### `presence.js`
Tracks which devices are currently in the room and renders the device list, typing indicator, and cursor-line highlight. It consumes Supabase Presence events to maintain a live roster. It does NOT persist presence data to the database — presence state is ephemeral and lives only in the Realtime channel.

### `live-broadcast.js`
Provides a thin abstraction over Supabase Broadcast channels. It dispatches outbound broadcast events and registers listeners that other modules subscribe to. It does NOT implement any sync logic itself — it is purely a transport layer for the Broadcast lane.

### `files.js`
Handles file upload to the `syncpad-files` Storage bucket, maintains the signed-URL cache (`_urlCache`, 55-min TTL), and implements file deletion. It does NOT render file previews — that responsibility belongs to `file-preview.js`.

### `file-preview.js`
Renders the in-app preview modal for attached files (images, PDFs, text, etc.). It requests signed URLs from `files.js` and inserts the appropriate preview element into the modal. It does NOT manage the file list or interact with Storage directly.

### `markdown.js`
Implements a safe, custom Markdown renderer without relying on an external library. It sanitises output to prevent XSS and applies SyncPad-specific rendering rules. It does NOT handle editing or preview toggling — those are managed by `app.js` and `ui.js`.

### `encryption.js`
Provides AES-256-GCM encryption and decryption using the Web Crypto API, with PBKDF2 key derivation. It exposes functions to encrypt/decrypt room content given a passphrase and salt. It does NOT store keys or passphrases — key material is held in `app.js` module-level state and never written to disk or the database.

### `permissions.js`
Maintains the frontend permission context for the current session (e.g. read-only vs. read-write, owner status). It exposes getter functions used throughout the app to gate UI actions. It does NOT enforce permissions on the server; SyncPad intentionally keeps normal room/file RLS broad for a transparent demo project.

### `settings.js`
Implements handlers for the room settings panel: expiry presets, passcode changes, read-only toggles, and share-link management. It does NOT own the settings UI structure — the DOM is defined in `ui.js` and `index.html`.

### `templates.js`
Manages the 17 built-in templates and any custom templates persisted in `localStorage` under the key `syncpad_custom_templates`. It exposes `exportCustomTemplates()` and `importCustomTemplates(json)`, and enforces the `BODY_MAX = 50,000` character limit. It does NOT render the template picker UI — that is handled by `ui.js`.

### `theme.js`
Applies and persists the active theme by writing to the `data-theme` attribute on `<html>`, which triggers CSS custom-property cascades defined in `styles/base.css`. It does NOT contain any CSS itself — all theme colours and transition rules live in the stylesheet.

### `shortcuts.js`
Registers global `keydown` listeners and maps key combinations to application actions (formatting, navigation, search, etc.). It does NOT implement the actions themselves — it calls into `app.js` or `ui.js` functions.

### `admin.js`
Implements the `/admin` dashboard: Supabase Auth sign-in, RLS-gated admin queries, and the three admin tabs (Rooms, Reports, Cleanup). It calls the `run_cleanup_expired_syncpad_rooms_as_admin` RPC for the Cleanup tab. It does NOT share any state or logic with the regular room flow — it is a self-contained screen activated only on the `/admin` route.

### `utils.js`
Collects small, stateless helper functions (string formatting, date utilities, debounce, etc.) used across multiple modules. It does NOT import from any other SyncPad module — it is a pure utility leaf with no side effects.

---

## 3. Data Flow — Editing a Note

1. **User types** in the Write-mode `<textarea>`, or in the CM6-backed Live/Split surface (`live-editor.js`), which mirrors its content into the textarea on every change — the textarea remains the single source of truth every other module reads.
2. An `input` event fires on the textarea, handled by the listener `_wireEditorCore()` (`src/app/editor-behavior.js`) attaches, which calls `sync.js`'s `onLocalInput()`.
3. `onLocalInput()` does three things, gated by `permissions.js`'s `canEdit()`/`canBroadcastTyping()`/`canBroadcastLiveContent()`:
   - Saves an immediate local draft to `localStorage` (`offline.js`) — encrypted first if the room has text encryption enabled.
   - Broadcasts a metadata-only **typing** event (device id/name, no note content) over the room's Broadcast channel, throttled to ~250 ms, so other devices can show a typing indicator.
   - If the room is **not** encrypted and the note is under `LIVE_CONTENT_BROADCAST_MAX_CHARS` (32 000 chars), also broadcasts a **live-content** snapshot (the actual current text) over the same throttle — this is the fast-responsiveness lane. Encrypted rooms skip this entirely and rely on the durable lane only, so plaintext is never broadcast unencrypted.
   - Starts (or restarts) a 1-second debounce timer for the durable Postgres save.
4. **Other tabs/devices** receive the Broadcast events via `live-broadcast.js`, which dispatches them to `sync.js`'s `handleRemoteTyping()` / `handleRemoteLiveContent()` on the receiving side; the latter applies the new text to the textarea (and, if mounted, the live surface) unless the local user has typed within the last 3 seconds, in which case it's queued as a "pending remote" update instead.
5. When the 1-second debounce fires, `sync.js`'s durable-save callback re-checks `canEdit()` (a save queued before a lock/read-only/encryption change lands must not write stale or plaintext data), encrypts the content if needed, and writes it to the `syncpad_rooms` row in Postgres via `rooms.js`'s `saveContent()`.
6. Supabase **Postgres Realtime** fires an `UPDATE` event on all other subscribers, wired in `src/app/room-lifecycle.js`'s `subscribeToRoom()` callback.
7. `sync.js`'s `handleRemoteDatabaseChange()` handles it: it first ignores the event entirely if `updated_by_device` matches this client's own device id (an echo of our own write) — client clocks are never compared, since they can drift. Otherwise, same idle-vs-actively-typing check as step 4 decides whether to apply immediately or show the conflict notice (Apply / Keep mine / Copy remote / Dismiss).
8. If applied immediately, `sync.js` updates the textarea (via the `setEditorVal` callback wired in `startApp()`), which also re-syncs the live surface and refreshes the rendered preview if active.

---

## 4. Data Flow — Joining a Room

1. The browser loads `index.html`; `boot()` (`src/app/room-lifecycle.js`) runs.
2. `_parseRoute()` (`src/app/routing.js`) strips the configured base path (`window.SYNCPAD_CONFIG.basePath`, `/SyncPad`) from `location.pathname` and classifies the route — a room id, `/admin`, `/contact`/`/privacy`/`/terms`, `/share/:token`, or the landing screen.
3. For a room route, `boot()` calls **`joinRoom(roomId)`**, which tears down any previous session (`teardownRealtimeSession()`) and issues a Supabase query against `syncpad_rooms` for the given id via `rooms.js`'s `loadRoom()`. A room that doesn't exist yet is created on the spot (same as the landing page's Create Room button) unless the route is a forced-read-only one (`?mode=read`, `/share/:token`).
4. If the room has a passcode, `ui.js` renders the passcode prompt and `settings.js`'s `checkPasscode()` verifies a PBKDF2 hash client-side. If the room has text encryption, the submitted passphrase is passed to `encryption.js` to derive a CryptoKey, stored as `state.encKey`/`state.encSalt` in `src/app/state.js`'s shared `state` object (see §5) — verified by a trial decrypt of the stored content before proceeding.
5. `permissions.js`'s `setPermissionContext()` is updated with the resolved permission context (read-only URL, editing-locked, encrypted-without-key, cleared, view-once-consumed) — every UI branch that gates a write reads this.
6. `startApp()` renders the editor screen, decrypts and populates the textarea with the room's current content (preferring a newer local draft if one exists), applies the user's remembered editor mode (`_resolveInitialEditorMode()` — Live/Preview by default, or whichever mode was last chosen), and calls **`wireEvents()`** (`src/app/wiring.js`) to attach every editor/toolbar/panel/settings listener for this session — guarded by `state.eventsWired` so re-navigation never double-registers them.
7. Three Supabase subscriptions are started: **Realtime** on `syncpad_rooms` (durable sync lane, `rooms.js`), a **Presence** channel (device roster/typing/cursor, `presence.js`), and a **Broadcast** channel (typing + live-content + settings/files/clear events, `live-broadcast.js`) — plus Realtime subscriptions on `syncpad_files` and (if the optional migration is applied) `syncpad_room_comments`.
8. Device-limit and view-once bookkeeping run last: a device-limited room records this device's join (clearing the room if the configured device count is now reached), and a view-once room not yet viewed by a non-creator is atomically consumed *after* the content has already been rendered to this viewer.

---

## 5. State Management

Room/session/editor-UI state lives on a **single shared `state` object** — `export const state = {...}` in `src/app/state.js` — imported by reference everywhere across `src/app/*.js` (mutate its properties, never reassign the binding). This replaced an earlier generation of scattered file-scoped `let`s in a monolithic `app.js`; `app.js` today is a thin entry point (file-image resolver wiring, the passcode/encryption auth-gate forms, and starting the router) — routing, the join flow, and all feature-area event wiring live in `src/app/*.js`. `admin.js`'s dashboard state follows the identical pattern via `src/admin/state.js`.

Representative room-scoped properties (not exhaustive — see `src/app/state.js` for the full, current list):

| Property | Purpose |
|---|---|
| `state.roomId` / `state.room` | Active room id and the full row object fetched from Supabase |
| `state.encKey` / `state.encSalt` | Derived AES-256-GCM CryptoKey and PBKDF2 salt (null if unencrypted) |
| `state.markdownMode` | `'write' \| 'preview' \| 'split'` — current editor view mode |
| `state.expTimer` | Handle for the expiry countdown timer |
| `state.searchMatches` / `state.searchIndex` | Find & Replace match positions and current index |
| `state.lastComments` / `state.activeCommentId` | Last-fetched comments and which one's floating bubble is expanded |
| `state.followedDeviceId` | Which remote device (if any) the local view auto-scrolls to follow |

A handful of properties are deliberately **user-global, not room-scoped**, and persist across room navigation by design: editor preferences (`stripPaste`, `smartPunct`, `focusMode`, `typewriterMode`, `hidePresence`, `monospace`, `syncScroll`), and `filesSort`.

**Critical invariant**: every room-scoped property must be explicitly reset in `teardownRealtimeSession()` (`src/app/room-lifecycle.js`) — the single authoritative list, deliberately not duplicated here or in `CLAUDE.md` since a second copy drifts as properties are added. Failing to reset any of them can cause state bleed between room sessions (e.g. a stale encryption key being applied to an unencrypted room).

---

## 6. Sync Tracks

SyncPad uses two parallel synchronisation tracks to balance perceived latency against durability.

### Broadcast Lane (live typing)
- **Transport**: Supabase Broadcast channel (WebSocket message, no DB write)
- **Latency**: ~250 ms
- **Use case**: Propagating keystrokes in real time so collaborators see typing as it happens
- **Durability**: None — if a tab is offline or joins after a broadcast, the message is lost
- **Implementation**: `sync.js` sends via `live-broadcast.js`; receivers update `ui.js` directly

### Durable Lane (persistence)
- **Transport**: 1-second debounce → `UPDATE` on `syncpad_rooms` in Postgres → Supabase Realtime fires on all subscribers
- **Latency**: 1 s debounce + Realtime propagation (~100–300 ms)
- **Use case**: Persisting the authoritative room content and propagating it to tabs that may have missed broadcast events
- **Durability**: Full — content survives page refreshes, reconnections, and new joiners
- **Conflict detection**: An incoming update whose `updated_by_device` isn't this client's own is applied immediately if the user is idle, or held as a "pending remote" update with a conflict notice (Apply / Keep / Copy) if the user typed in the last 3 seconds. See `handleRemoteDatabaseChange()` in `sync.js`.
- **Reconnect reconciliation**: Realtime does **not** replay events missed while a socket was disconnected. On regaining connectivity, `app.js`'s `online` handler calls `loadRoom()` fresh (bypassing Realtime) and passes the result to `reconcileAfterReconnect()` (`sync.js`) *before* letting the queued debounced save flush. If another device wrote to the room during the outage and its content differs from what's in the editor, this always shows the same pending-remote conflict notice — regardless of the 3-second idle window above, since an offline gap can be far longer than that window covers — rather than silently overwriting the remote edit with the stale local queue. See `SP-AUDIT-0016` in the audit remediation history.

---

## 7. Signed URL Cache

Supabase Storage signed URLs are expensive to generate (one HTTPS round-trip each) and expire after a fixed window. `files.js` maintains:

```js
const _urlCache = new Map(); // fileId → { url, expiresAt }
```

- **TTL**: 55 minutes (conservative margin below Supabase's 60-minute signed-URL lifetime)
- **Cache hit**: The cached URL is returned immediately with no API call
- **Cache miss**: A new signed URL is fetched from Supabase Storage and stored with a fresh `expiresAt = Date.now() + 55 * 60 * 1000`
- **Cache eviction**: Entries are removed immediately on `deleteFile()` to prevent returning URLs for deleted objects. Expired entries are also swept lazily — every `getDownloadUrl()` / `getForceDownloadUrl()` call prunes any entry past its `expiresAt` before doing its own lookup — so a long-running session with many distinct files previewed over time doesn't grow the map unboundedly with dead entries.
- **Benefit**: Eliminates redundant API calls when the same file is previewed or linked multiple times within a session

---

## 8. Templates System

### Built-in Templates
- 13 entries hardcoded in `templates.js`
- Each entry has the shape `{ label, desc, body }`
- Read-only — users cannot modify or delete built-in templates

### Custom Templates
- Stored in `localStorage` under the key `syncpad_custom_templates` as a JSON array
- Subject to a body character limit: `BODY_MAX = 50,000` chars per template
- **Export**: `exportCustomTemplates()` returns a JSON string of all custom templates, suitable for download or clipboard copy
- **Import**: `importCustomTemplates(json)` parses the JSON string, validates entries, merges them into the stored list, and returns the count of successfully imported templates, or `-1` on parse/validation error

---

## 9. Admin Dashboard

The `/admin` route activates `admin.js` exclusively and is completely isolated from the regular room flow.

### Authentication
- `initAdmin()` is called by the router
- Renders a sign-in form; on submit, calls `supabase.auth.signInWithPassword()`
- Supabase RLS policies enforce the `is_syncpad_admin()` predicate on all admin queries — unauthenticated or non-admin sessions receive empty result sets or errors

### Tabs

Five tabs, each its own file under `src/admin/` (`rooms-tab.js`, `reports-tab.js`, `files-tab.js`, `audit-tab.js`, `cleanup-tab.js`), rendered by `dashboard-shell.js`:

| Tab | Data source | Actions |
|---|---|---|
| **Rooms** | Paginated, server-filtered/sorted `syncpad_rooms` rows (filter chips: All/Active/Active today/Expired/Encrypted/Passcode/Locked/Quarantined if that optional migration is applied); search by id or name | Per-row: view detail drawer, copy link, clear content, delete; bulk clear/delete for selected rows; export current filter as CSV |
| **Reports** | Paginated `syncpad_room_reports` rows, filterable by status (New/Reviewed/Dismissed/All) | Mark reviewed, dismiss, view the reported room, delete the reported room |
| **Files** | Paginated `syncpad_files` rows; search by filename or room id; aggregate storage-used stat | View the file's room, delete a file (storage object + metadata row) |
| **Audit Log** | `syncpad_admin_audit_logs` (optional migration — the tab probes for the table and degrades gracefully if it's absent) | Read-only record of admin actions (room/report/file mutations, CSV exports) for accountability |
| **Cleanup** | — | Batched expired-room cleanup; Storage Orphan Reconciliation (dry-run preview, then delete) via the optional `syncpad-cleanup` Edge Function |

The stat cards at the top of the dashboard (Rooms, Files, Reports) are clickable shortcuts that jump to the corresponding tab, pre-filtered where relevant (e.g. the "Active today" stat filters the Rooms tab).

The optional `supabase/functions/syncpad-cleanup` Edge Function runs with a service-role key, deletes known Storage objects for encrypted expired rooms before DB cleanup, and can remove orphaned bucket objects after a dry run. It's callable both as a backend cron/curl job (`SYNCPAD_CLEANUP_SECRET`) and directly from the admin dashboard's Cleanup tab, authenticated with the admin's own Supabase session instead.

---

## 10. PWA / Service Worker

`service-worker.js` implements **cache-first, read-only** for every same-origin GET request whose path is listed in `PRECACHE_ASSETS` — scoped to the same open `CACHE_VERSION` cache, and never written to outside the install handler's one-shot precache pass. The cached copy is returned immediately if present; a cache miss falls back to the network (and, for navigations specifically, to the offline error response if that also fails), but is never written back into the cache. Same-origin paths that *aren't* in `PRECACHE_ASSETS` (e.g. the landing page's presskit screenshots/demo video) bypass this worker's cache entirely — plain pass-through to ordinary browser/HTTP caching. Two reasons: those assets are unversioned (no `CACHE_VERSION` bump tracks when they change, so a cached copy could go stale forever), and one of them is a `<video>` — a cached whole-file `200` response would also match a later byte-`Range` request and get returned in full, which video loaders can abort on.

Navigations are split by whether the path looks like a real file (has an extension, e.g. `presskit/video/demo.mp4` opened in a new tab) or an in-app route (no extension, e.g. `/SyncPad/<room-id>`, `/SyncPad/admin`): only route-shaped navigations are mapped to the cached `index.html` shell. A direct navigation to an actual file always serves that file's own content, never the app shell, regardless of which worker is in control.

Every populated cache slot is treated as **immutable**: nothing ever writes to it outside the install handler, and the fetch handler has no way to repair a slot that's missing. That's only safe because the install handler requires **every** `PRECACHE_ASSETS` entry to succeed before this generation is allowed to activate at all — an earlier revision instead tolerated individual `cache.add()` failures (so one flaky asset wouldn't block install) and either left that one slot permanently offline-broken for the rest of the generation's lifetime, or (an even earlier attempt) self-healed it by writing the network response back in at request time. Self-healing traded one bug for a worse one: a currently-active worker keeps answering every fetch for pages it already controls for as long as it takes a newer worker to take over (often much longer than one page load), and the network always serves whatever is *currently deployed* regardless of which worker generation is asking — so a slot healed only after a *subsequent* deploy would pull that deploy's bytes into the *older* generation's cache, the same split-version problem this immutable design exists to prevent, just via a different path, with no way to verify a response actually belongs to the requesting generation without content-addressed URLs (which this project deliberately doesn't have — no build step). Not catching per-asset install failures fixes this at the root: a single miss rejects the whole `Promise.all`, which rejects the `install` event's `waitUntil()` promise, which the browser treats as a failed install — this worker is discarded without ever activating, any previously-active worker keeps controlling pages unaffected, and the browser retries installation on its own next opportunity. Each `cache.add()` call also passes `{ cache: 'reload' }` to bypass the browser's own HTTP cache during precache — without it, a returning client whose HTTP cache still has a fresh (not-yet-expired) response from the *previous* deploy would have `cache.add()` reuse those stale bytes instead of fetching the new ones, silently freezing part of a "new" generation as old content from the moment it's created.

- **Cache name**: `CACHE_VERSION` in `service-worker.js`, bumped on every release that changes precached assets (see `CHANGELOG.md` for the current value)
- **Bypass**: All requests to Supabase endpoints (different origin) bypass the service worker entirely and go directly to the network.
- **Cache invalidation**: Increment `CACHE_VERSION` to force all clients to discard the old cache on next activation. Update detection itself doesn't depend on this value — the browser independently re-fetches and byte-diffs `service-worker.js` on its own schedule, which is what `src/app/pwa.js`'s `updatefound` listener and the resulting "update available" bar are driven by.

---

## 11. CSS Architecture

Styles are split across several plain CSS files under `styles/`, loaded via ordered `<link>` tags in `index.html` (later files override earlier ones at equal specificity, mirroring the original single style.css's rule order): `base.css` (theme variables, reset, loading screen) → `landing.css` → `landing-demo.css` (the marketing page's coded hero demo — see `docs/marketing-site.md#coded-hero-demo`) → `app-shell.css` (header) → `editor.css` → `panels.css` (side panels) → `modals.css` → `file-preview.css` → `room-tools.css`. `admin.css` is lazy-loaded by `admin.js` only on the `/admin` route. There is no preprocessor, no CSS-in-JS, no utility framework, and no build/bundling step — every file is served as-is.

### Theming
- Themes are defined as sets of CSS custom properties (`--color-bg`, `--color-text`, etc.) scoped to `[data-theme="<name>"]` selectors on `<html>`
- `theme.js` switches the active theme by writing `document.documentElement.dataset.theme = themeName`
- The chosen theme is persisted in `localStorage` and restored on page load

### Available Themes
| Theme key | Description |
|---|---|
| `charcoal-amber` | Dark charcoal background with amber accent (default) |
| `midnight-blue` | Deep navy tones with blue highlights |
| `forest-green` | Dark green palette |
| `paper-light` | Light parchment — the only light theme |
| `terminal` | High-contrast black with green monospace aesthetic |
| `mocha-dark` | Warm dark brown palette |
| `lavender-light` | Light lilac — the second light theme |

### Transitions
Theme switches animate smoothly, but only on appropriate elements to avoid janky flashes on interactive controls:

- **Animated** (0.22 s ease): `body`, panels, modals — `background-color` only
- **NOT animated**: buttons — instant colour change to preserve click responsiveness
