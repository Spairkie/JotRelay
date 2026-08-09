# CLAUDE.md — JotRelay Development Guide

This file is a reference for AI coding assistants (Claude Code) working on the JotRelay codebase.

---

## 1. Project Overview

JotRelay is a vanilla-JavaScript realtime shared notepad built on Supabase. It has no build step, no bundler, and no framework — ES modules load directly in the browser. Features include live collaborative editing (Supabase Broadcast), durable saves to Postgres, per-room encryption (AES-256-GCM), file uploads with signed-URL caching, Markdown preview, 17 built-in templates plus user-defined custom templates, 10 visual themes, presence tracking (devices/cursors/typing indicators), room settings (passcode, expiry, lock), and an admin dashboard backed by Supabase Auth and RLS.

---

## 2. Setup & Running Locally

**Serve the app (port 5555):**
```
npm run serve
```
Then open `http://localhost:5555/JotRelay/`. `index.html` hardcodes `window.SYNCPAD_CONFIG.basePath = '/JotRelay'` and every static asset reference (`<link>`/`<script>` src) as an absolute `/JotRelay/...` path, matching where GitHub Pages actually hosts the site — so `npm run serve` runs `tests/spa-server.js` directly (not `npx serve .`) rather than trying to reproduce that with a generic static-file server. It strips the `/JotRelay` prefix before resolving a file on disk and only falls back to `index.html` when no real file matches, so both real assets (`/JotRelay/styles/base.css` → `styles/base.css`) and in-app routes (`/JotRelay/<room-id>`, `/JotRelay/admin`, etc.) resolve correctly. (A generic static server pointed at the repo root — `npx serve .` without this prefix-stripping — will 404 or silently return `index.html` for every real asset, since `styles/base.css` only exists at that path, not at `JotRelay/styles/base.css`.)

**Install Playwright browsers (first time only):**
```
npx playwright install
```

**Run the full test suite:**
```
npm test
```
`npm test` starts `tests/spa-server.js` automatically via Playwright's `webServer` config if nothing is already listening on port 5555.

Supabase credentials are injected into `index.html` as `window.SYNCPAD_CONFIG`. No `.env` file or build step is required — just serve and open.

---

## 3. Architecture Overview

### Module Responsibilities

| File | Responsibility |
|---|---|
| `src/app.js` | Thin entry point (file-image resolver wiring, passcode/encryption auth-gate forms, starts the router). Routing, the room join flow, and all feature-area event wiring live in `src/app/*.js`; see `src/app.js`'s header comment for the module map. |
| `src/ui.js` | Barrel re-exporting `src/ui/*.js` — all DOM manipulation: `showConfirm()`, `openTemplatesModal()`, `renderFilesList()`, `renderDevicesList()`, etc. See `src/ui.js`'s header comment for the per-file split (core/dialogs/panels/editor/collab/feature-modals). |
| `src/sync.js` | Live typing via Supabase Broadcast + durable save to Postgres (1 s debounce) |
| `src/presence.js` | Device tracking, typing indicators, cursor position broadcasting |
| `src/live-broadcast.js` | Low-level Supabase Broadcast event wiring |
| `src/live-editor.js` | CodeMirror 6 "Live"/Split editable preview surface — Typora-style seamless markdown editing (hidden syntax markers, inline tables/images/checkboxes, remote cursors), mounted whenever the mode toggle is off Write |
| `src/keyboard-viewport.js` | Tracks the on-screen keyboard via `window.visualViewport`, exposing it as a `--kb-inset` CSS custom property (bottom-anchored fixed UI opts in via `bottom: calc(<base> + var(--kb-inset, 0px))`) and re-triggering each editor surface's own native caret-visibility scroll after a keyboard resize settles. Also toggles `body.keyboard-open` off focus entering/leaving any text surface on mobile (a separate signal from `--kb-inset`, needed on platforms where the viewport already resizes natively and `--kb-inset` legitimately stays 0) so the bottom action bar can be hidden outright while typing, not just repositioned. Imported for its side effects only. |
| `src/footnote-popover.js` | Hover/click popover showing a footnote's definition text without navigating away — shared by the classic renderer (`src/ui/editor.js`) and the CM6 Live surface (`src/live-editor.js`) |
| `src/rooms.js` | Room CRUD, read-only share links, and short room codes (Supabase queries/RPCs) |
| `src/comments.js` | Anchored inline comments (optional `0003_room_comments.sql` migration) |
| `src/revisions.js` | Version-history snapshots (optional `0004_version_history.sql` migration) |
| `src/offline.js` | localStorage draft save/restore (encrypted-at-rest for encrypted rooms) |
| `src/files.js` | File upload, download, delete, and 55-min signed-URL cache |
| `src/file-preview.js` | In-app preview modal for images, text, CSV, Markdown, and PDF |
| `src/markdown.js` | Safe custom Markdown renderer (Lezer parse tree) — no raw HTML pass-through |
| `src/markdown-highlight-extension.js` | Shared `==highlight==` grammar extension used by both `markdown.js` and `live-editor.js` so the two renderers agree on syntax |
| `src/markdown-table-utils.js` | GFM table-alignment parsing shared by `markdown.js` and `live-editor.js` |
| `src/markdown-emoji-map.js` | GitHub-style `:shortcode:` → Unicode emoji table shared by `markdown.js` and `live-editor.js`'s emoji widget decoration |
| `src/encryption.js` | AES-256-GCM encryption + PBKDF2 key derivation (Web Crypto API) |
| `src/permissions.js` | Frontend permission context — `isReadOnly`, `isOwner`, `isLocked` |
| `src/settings.js` | Room settings handlers — passcode, expiry, lock |
| `src/templates.js` | 17 built-in templates + localStorage custom templates; `BODY_MAX = 50000` |
| `src/theme.js` | CSS variable theme system — 10 themes, toggled via `data-theme` on `<html>` |
| `src/shortcuts.js` | Keyboard shortcut handler |
| `src/admin.js` | Admin dashboard entry point (auth-state routing only) — Supabase Auth (`signInWithPassword`), RLS via `is_syncpad_admin()`. Dashboard shell + tabs live in `src/admin/*.js`; see `src/admin.js`'s header comment for the module map. |
| `src/utils.js` | `escapeHtml()`, `formatFileSize()`, `countWords()` |
| `src/icons.js` | SVG icon strings |
| `src/supabase.js` | Supabase client initialisation |

See [`docs/architecture.md`](docs/architecture.md) for narrative module-by-module responsibility writeups and data-flow diagrams covering the top-level modules in the table above. The `src/app/*.js`, `src/ui/*.js`, and `src/admin/*.js` per-file splits are documented in each barrel file's own header comment (`src/app.js`, `src/ui.js`, `src/admin.js`), not in `docs/architecture.md`.

The app root (`/JotRelay/`) is the product's marketing landing page — `#landing-screen` in `index.html`, styled by `styles/landing.css`, wired up by `src/app/landing.js`. The actual create/join room screen lives at `/JotRelay/app/` (`#app-landing-screen`, route type `'app-landing'` in `src/app/routing.js`) — every "Create a Room"/"Join a room" control on the marketing page is a plain link there, not an inline form. A press kit lives in `presskit/` (logos, screenshots, fact sheet). See [`docs/marketing-site.md`](docs/marketing-site.md) for the full route/section map, the asset-generation scripts in `scripts/`, and how to swap in real screenshots/video later.

### Data Flow

1. `app.js` detects route changes and calls module init functions.
2. `sync.js` subscribes to a Broadcast channel for the current room; on local edits it broadcasts immediately and queues a 1 s debounced Postgres write.
3. `presence.js` tracks connected devices and cursor/typing state via a separate Broadcast channel.
4. `permissions.js` is populated from the room row after load; all UI branches that gate actions must consult it.
5. `ui.js` is the single place that touches the DOM — other modules call `UI.*` functions instead of querying or mutating the DOM directly.
6. `encryption.js` wraps/unwraps content before it reaches the network or the editor; the key and salt are kept in module-level variables and cleared on navigation.

---

## 4. Key Patterns & Conventions

### DOM Manipulation
All DOM writes go through `src/ui.js`. Never manipulate the DOM from `sync.js`, `files.js`, or any other module directly — call or add a function in `ui.js` instead.

### State Management
The `app/*` modules keep their room/session/editor-UI state as properties on a single shared `state` object (`export const state = {...}` in `src/app/state.js`, imported by reference everywhere — mutate its properties, never reassign the binding) rather than scattered `let`s. Every property that is room-specific **must** be reset to `null` (or an empty structure) when navigating away from a room — see `teardownRealtimeSession()` in `src/app/room-lifecycle.js`, which is the authoritative, actively-maintained list (room id/content, encryption key/salt, editor mode, search state, comment/slash-menu UI state, files-panel selection, subscriptions, timers, etc.). Don't duplicate that list elsewhere in docs — it grows as features are added and a second copy will drift; link to the function instead. User-global preferences (e.g. `stripPaste`, `smartPunct`, `filesSort`) are deliberately *not* reset — they persist across rooms by design. (`admin.js`'s dashboard state follows the same pattern via `src/admin/state.js`.)

### Escaping User Content
Any user-supplied string that is interpolated into an HTML template **must** be passed through `escapeHtml()` from `src/utils.js` first. Never trust room names, file names, note bodies, or any other user content without escaping.

```js
import { escapeHtml } from './utils.js';
el.innerHTML = `<span>${escapeHtml(userValue)}</span>`;
```

### Confirm Dialogs
Never call `window.confirm()`. Use the custom async dialog instead:

```js
const ok = await UI.showConfirm('Are you sure?', {
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
  danger: true,   // focuses Cancel by default; use for destructive actions
});
if (!ok) return;
```

### Imports
There is no bundler. Use standard ES module `import`/`export` syntax. Paths must be relative (e.g., `'./utils.js'`). Do not use bare specifiers.

### BASE Path
The app is served under `/JotRelay`. This constant is defined in `src/app/state.js` (`BASE`) and `service-worker.js`. Any new route or asset reference must respect this prefix.

### Supabase Credentials
Credentials are read from `window.SYNCPAD_CONFIG` which is injected inline in `index.html`. Do not hard-code keys anywhere else.

### Theme Transitions
Transitions for background-color (0.22 s ease) are applied to `body`, panels, and modals. Do **not** add CSS transitions to buttons — this would clobber interaction feedback (hover/active states).

---

## 5. Common Gotchas

- **`wireEvents()` accumulates listeners.** If called more than once (e.g., on re-navigation) it registers duplicate listeners. Guard calls with a cleanup flag or ensure it is called exactly once per page lifecycle.

- **Room state must be fully reset on navigation.** When leaving a room, every room-scoped `state.*` property must be reset to `null` (or empty) — see `teardownRealtimeSession()` in `src/app/room-lifecycle.js` for the current, complete list. Stale state causes subtle bugs that are hard to reproduce. If you add a new room-scoped property, add its reset there too.

- **Signed-URL cache eviction.** `src/files.js` caches signed URLs in a `Map` with a 55-minute TTL. When a file is deleted, call the eviction helper so the stale URL is not served to subsequent requests.

- **Expiration minimum is 1 second.** `_buildExpirationDuration()` only requires a positive number (`n > 0`, enforced client-side via the input's `min="1"`) — there is no artificial floor beyond that. A 1-second custom expiry is a legitimate (if aggressive) choice; it is not validated further.

- **Bulk file delete requires `danger: true`.** Pass `{ danger: true }` to `showConfirm()` so that Cancel is focused by default, protecting users from accidental mass deletion.

- **Fresh rooms open in Live/Preview mode, not Write.** `_resolveInitialEditorMode()` (`src/app/state.js`) defaults to `'preview'` when no mode has been chosen yet, so `#note-editor` starts hidden (`class="hidden"`) — a plain `<textarea>` element that Playwright's actionability checks (`.click()`, `.fill()`) refuse to act on. Any test that touches `#note-editor` directly must switch to Write mode first (`ensureWriteMode(page)` or `typeInEditor()`, which calls it automatically) rather than assuming Write is the default.

- **The app never uses `window.prompt()` / `window.confirm()`.** `UI.showPrompt()` and `UI.showConfirm()` (`src/ui/dialogs.js`) are custom in-app modals (`#sp-prompt-modal`, `#sp-confirm-modal`), not native browser dialogs — `page.once('dialog', ...)` will never fire for them in tests. Fill `#sp-prompt-input` and click `#sp-prompt-ok`/`#sp-confirm-ok` directly (see `fillPromptDialog()` in `tests/helpers.js`).

- **Read-only share links with passcode/encryption.** A read-only visitor to a passcode-protected or encrypted room still sees the normal authentication screen (passcode/encryption prompt) and must pass it to view the room — the info screen is only shown when the room/share link itself doesn't exist. Passing the gate does not grant edit access on a forced-read-only route (`?mode=read`, `/share/:token`) — those stay read-only regardless.

- **`room_id` alone is a sufficient write credential; `?mode=read` and `/share/:token` are a UI/UX convention, not a server-enforced boundary.** A plain room link (typed, bookmarked, or shared) is directly editable — visiting a URL for a room that doesn't exist yet creates it, same as the landing page's Create Room button (see `joinRoom()`'s not-found fallback in `src/app/room-lifecycle.js`). `?mode=read` and `/share/:token` discourage editing in the app's own UI but don't stop a technical visitor from writing directly, since they necessarily learn `room_id` from viewing the room's content. For a genuine, server-enforced "nobody can edit this" guarantee, use the room lock feature (`editing_locked`) — it's enforced by a Postgres trigger regardless of how the write is attempted. See `supabase/migrations/0009_revert_edit_token_write_gating.sql` for the reasoning (this reverted an earlier edit-token requirement that turned out to cost more in lost-access lockouts and deployment fragility than it was worth for a project not meant to hold sensitive data).

- **Admin route uses Supabase Auth.** The admin dashboard authenticates via `signInWithPassword` and relies on the `is_syncpad_admin()` RLS function. Anonymous users must not be able to reach admin data even if they manipulate the client.

---

## 6. Adding New Features — Checklist

Work through this list for every new feature or non-trivial change:

- [ ] **DOM changes go in `ui.js`.** Add or modify a function in `src/ui.js` rather than reaching into the DOM from another module.
- [ ] **Escape all user content.** Every user-supplied value rendered into HTML must pass through `escapeHtml()`.
- [ ] **Use `showConfirm()`, not `window.confirm()`.** Any destructive or confirmation flow uses the async custom dialog. Add `danger: true` for irreversible actions.
- [ ] **Guard `wireEvents()`.** If your feature calls `wireEvents()` or attaches listeners, ensure they cannot accumulate across navigations.
- [ ] **Reset state on nav.** If you introduce new room-scoped module variables, add them to the navigation cleanup path in `teardownRealtimeSession()` (`src/app/room-lifecycle.js`).
- [ ] **Respect permissions.** Gate any write or destructive action behind the relevant flag from `src/permissions.js` (`isReadOnly`, `isOwner`, `isLocked`).
- [ ] **Respect `BODY_MAX`.** Content written to the editor must not silently exceed the 50,000-character limit defined in `src/templates.js`.
- [ ] **Evict caches on delete.** If your feature deletes a resource that is cached (e.g., a signed URL), evict the cache entry immediately.
- [ ] **No raw HTML in the Markdown renderer.** `src/markdown.js` intentionally strips raw HTML. Do not add a pass-through — use structured renderer output instead.
- [ ] **Write a Playwright test.** Every user-visible feature should have at least one end-to-end test in `tests/`.

---

## 7. Testing Guidance

**Screenshots taken while working (manual UI verification, ad hoc checks, etc.) are worth a second look.** Before discarding one, check whether it's a good candidate for `presskit/` (clean, representative UI at a real breakpoint/theme, no debug overlays or test-fixture content) — if so, flag it to the user instead of letting it disappear into a scratch/temp directory.

Tests live in `tests/` and run with `npm test`. `playwright.config.js` defines four browser projects — `chromium`, `firefox`, `webkit`, and `mobile-chrome` — but only `chromium` is active by default so `npm test` works without a full Playwright browser download; the other three are present but commented out. Uncomment them locally if you have the full browser set installed (`npx playwright install`).

### Test Helpers (`tests/helpers.js`)

| Helper | Purpose |
|---|---|
| `createRoom(page)` | Navigate to landing and create a new room; returns the room ID |
| `goToLanding(page)` | Navigate to the JotRelay landing page |
| `supabaseAvailable(page)` | Detect a CDN-blocked environment so a test can skip cleanly instead of timing out |
| `ensureWriteMode(page)` | Switch to Write mode if `#note-editor` is currently hidden (rooms default to Live/Preview — see §5) |
| `typeInEditor(page, text)` | Type text into the main editor (calls `ensureWriteMode` first) |
| `getEditorContent(page)` | Return the current editor text content |
| `openPanel(page, name)` | Open a named side panel (e.g., `'files'`, `'settings'`) |
| `openMoreMenu(page)` | Open the header's "More" dropdown (parent of several desktop panel buttons) |
| `setEditorMode(page, mode)` | Switch to `'write'` / `'preview'` / `'split'` via the segmented control |
| `openSettingsPanel(page)` | Open the Settings panel via the more-menu |
| `waitForToast(page, text)` | Wait for a toast notification containing the given text |
| `waitForModal(page, id)` | Wait for a modal with the given id to become visible |
| `closeModal(page, id)` | Close a modal by clicking its visible close/cancel button |
| `closePanels(page)` | Close all open side panels |
| `roomIdFromUrl(url)` | Extract the room ID from a JotRelay URL |
| `fillPromptDialog(page, value)` | Fill and confirm the app's custom `showPrompt()` modal (`#sp-prompt-modal`) — the app never uses the browser's native `window.prompt()`, so `page.once('dialog', ...)` will never fire for it |
| `getShareUrl(page, type)` | Open the Share modal, read the editable or read-only link, and close it |

### Writing New Tests

1. Create a new file in `tests/` named after the feature (e.g., `tests/encryption.spec.js`).
2. Import helpers from `./helpers.js`.
3. Use `test.describe` to group related scenarios.
4. Keep each test focused on a single behaviour — prefer many small tests over one large flow.

### Testing Browser-Only Module Code (`inBrowser()`)

For logic in ES modules that uses browser APIs (Web Crypto, `localStorage`, etc.), use Playwright's `page.evaluate()` to import and exercise the module inside the browser context rather than mocking the APIs in Node:

```js
const result = await page.evaluate(async () => {
  const { someFunction } = await import('/JotRelay/src/utils.js');
  return someFunction('input');
});
```

This avoids the need for a separate Node-compatible build and keeps tests honest about real browser behaviour.

---

## 8. Rebranding Checklist

This project has no build step — nothing renders HTML/JSON from a template — so the product name can't be fully centralized. `src/brand.js` exports `BRAND_NAME`, imported by the handful of JS modules that render the name at runtime (exported-file `<title>`, native share-sheet title, command-palette label, admin "Back to…" buttons, console log prefixes). Change it there and those follow automatically. Everything below still needs a manual find/replace on a future rename:

- **`index.html`** — `<title>`, all `<meta>` tags (description/OG/Twitter), the wordmark markup (currently `Jot<span>Relay</span>` in 5 places — nav logo, footer logo, landing logo × 2, header logo), and every other visible copy string.
- **`manifest.json`** — `name`, `short_name`.
- **`package.json`** — `name`, `description`.
- **Docs & presskit** — `README.md`, `CHANGELOG.md`, this file's own prose, `DEPLOYMENT.md`, `RELEASE_CHECKLIST.md`, `docs/**`, `presskit/**` text files.
- **`sitemap.xml`, `robots.txt`, `404.html`** — if they reference the name as text (not as a path segment — see below).

**Deliberately excluded from any rename pass, permanently** (not an oversight to revisit — renaming these has real cost or breaks live state):
- Postgres identifiers in `supabase/**` (`syncpad_*` tables/columns/functions/triggers) and the `syncpad-cleanup` edge function. Renaming live production schema is a real zero-downtime migration project, not a text swap, and no end user ever sees these identifiers.
- `localStorage` key string literals (`syncpad_theme`, `syncpad_recent_rooms`, etc.) — renaming the string would orphan every existing visitor's saved preferences/drafts.
- The `syncpad-file:` pseudo-scheme, `data-syncpad-file` attribute, `.syncpad-file-link` class — embedded in every already-saved room's content; renaming breaks file/image references in existing rooms.
- The `BASE` path constant (`src/app/state.js`), `service-worker.js`'s cache name/scope, and every `/JotRelay`-style URL path segment (`href`/`src` attributes, `manifest.json`'s `start_url`/`scope`, `sitemap.xml`, `robots.txt`, `og:url`/`og:image`). This one **is** meant to change eventually, but only in lockstep with whatever the app is actually deployed under (a GitHub Pages project-site path matching the repo name, or `''` for a root-domain host like Netlify) — changing it any other time serves 404s to real visitors mid-transition. See the SyncPad → JotRelay rebrand PRs for the exact sequencing this required.

---

## 9. Git Workflow

### Branch Naming
Use the format `claude/<phase>-<description>`, e.g.:
```
claude/phase1-stability
claude/phase2-file-preview-fixes
```

### Commit Message Format
```
<type>(<scope>): <short imperative description>
```

**Types:** `feat`, `fix`, `refactor`, `test`, `chore`, `docs`

**Examples:**
```
feat(files): evict signed-URL cache on deleteFile
fix(sync): reset _roomId to null on room nav
refactor(ui): extract renderDevicesList from app.js
test(encryption): add Playwright tests for AES round-trip
chore(deps): update Playwright to 1.44
```

Keep commits atomic: one logical change per commit. Do not bundle unrelated fixes. Avoid committing directly to `main` — always work on a feature branch and open a PR.
