# JotRelay — Release Checklist

Use this checklist before publishing a new version or sharing the demo link.

> ⚠️ Reminder: JotRelay is a personal/demo project. All room controls are frontend-only.  
> View-once is convenience-only, not secure destruction; viewers may still copy or capture content before it clears.  
> Do not use for sensitive data.

---

## 1. Local / Core Tests

- [ ] Landing screen loads at root URL (`/JotRelay/`)
- [ ] **Create room** — lands on `/<roomId>`, editor is ready
- [ ] **Edit note** — text syncs live in a second tab
- [ ] **Refresh room** — content reloads from Supabase correctly
- [ ] **Hard refresh** — app recovers; no blank screen
- [ ] **Join room** by pasting a link into the landing screen join input
- [ ] **Join room** by pasting a bare room ID
- [ ] **Editable link** — opens editor, typing is allowed
- [ ] **Read-only share link** (`/JotRelay/share/:token`) — editor is `readonly`, no upload/delete controls visible
- [ ] **Invalid/missing room** — read-only share link (`/JotRelay/share/:token`) to a nonexistent room shows a clear message, does not crash
- [ ] **Lock editing** — all devices see the edit-blocked banner; typing is disabled
- [ ] **Unlock editing** — banner clears; typing resumes

---

## 2. Collaboration

- [ ] **Two tabs** — device count shows 2, both appear in Devices panel
- [ ] **Typing indicator** — typing in Tab 1 shows "…is typing" in Tab 2
- [ ] **No self-indicator** — typing indicator does NOT appear in the tab you are typing in
- [ ] **Typing stops** — indicator disappears after ~3 s of no typing
- [ ] **Read-only viewer** — appears as "viewer" in Devices panel, not "editor"
- [ ] **Read-only typing** — viewer typing does NOT broadcast a typing indicator to other tabs
- [ ] **Cursor/activity line** — approximate editor line updates in other devices' Devices panel
- [ ] **Device rename** — tap your device name, rename it; other tabs see the new name
- [ ] **Conflict notice** — edit in Tab 1 while Tab 2 has unsaved edits; notice shows Apply / Keep mine / Copy remote / Dismiss

---

## 3. Editor & Tools

- [ ] **Source mode** — textarea is editable, Live surface hidden
- [ ] **Live mode** (default for fresh rooms) — the CodeMirror 6 surface renders formatting inline and is itself directly editable (not a read-only render); textarea hidden
- [ ] **Split mode** — Source and Live visible side by side, scroll-synced
- [ ] **Editable tables in Live mode** — click into a cell and type; Tab/Shift-Tab/Enter navigate between cells; edits persist back to the raw Markdown
- [ ] **Checklist preview** — GFM checkboxes render; checking one updates the raw note
- [ ] **Safe Markdown** — pasting `<script>alert(1)</script>` or raw HTML into the editor does NOT execute or render as HTML in preview
- [ ] **Built-in templates** — at least 3 templates apply correctly (replace and append)
- [ ] **Custom templates** — save, rename, delete; templates persist after refresh
- [ ] **Find in note** — `Ctrl/⌘+F` opens panel; search term highlights; Prev/Next navigate correctly
- [ ] **Export TXT** — downloads a plain-text file
- [ ] **Export MD** — downloads a Markdown file
- [ ] **Export HTML** — downloads a rendered HTML page that opens in a browser
- [ ] **Copy as plain text** — right-click a selection (or right-click with nothing selected, for the whole note) → "Copy as plain text" strips Markdown syntax before copying
- [ ] **Monospace toggle** — `Ctrl/⌘+Shift+M` switches font
- [ ] **Timestamp insert** — footer Time button inserts current date/time

---

## 4. Room Settings & Security

All of these are frontend/convenience controls except Lock editing (section 1) — see `docs/security.md` before treating any of them as a real access boundary.

- [ ] **Set passcode** — Settings panel prompts for passcode + confirm; mismatched entries show an inline error, not a silent failure
- [ ] **Passcode gate** — a fresh visit to a passcoded room shows the passcode screen before any content; correct passcode unlocks, incorrect one shows an error and does not unlock
- [ ] **Remove passcode** — room opens directly again on the next visit
- [ ] **Enable encryption** — passphrase prompt; existing content re-encrypts; encryption badge appears
- [ ] **Encrypted room, no key** — a fresh visit prompts for the passphrase before showing any content; wrong passphrase shows an error, does not reveal ciphertext
- [ ] **Disable encryption** — requires re-entering the passphrase to confirm; content reverts to plaintext
- [ ] **Auto-expire** — set a short custom duration (e.g. 10s); after it passes, reopening the room shows the content cleared; the in-editor expiration bar shows a live countdown while armed
- [ ] **View-once** — enable it, then open the room from a second, non-creator device/context; content clears server-side after that first view; the creator's own device is exempt and never consumes it
- [ ] **Device limit** — set a low limit (e.g. 2); joining from that many distinct devices (excluding the creator) clears the room; the creator's own devices don't count against the limit
- [ ] **Timed reveal** — set a short custom delay (e.g. 10s); a non-creator visitor sees the `#reveal-screen` countdown instead of the note; the creator's own device sees the note normally the whole time; once the delay passes, the waiting visitor is auto-revealed into the room without a manual reload
- [ ] **Share modal security chips** — with passcode/encryption/lock/view-once/expiry/timed-reveal set, the Share modal shows a chip for each active one

---

## 5. Comments & History

- [ ] **Add comment** — via the floating add-comment button, `Ctrl/⌘+Shift+/`, the selection context menu, or the Comments panel; a margin dot appears at the anchored line
- [ ] **Comment dot/bubble** — clicking a margin dot expands a floating bubble with the full text and Prev/Next navigation; the dot and bubble render above the document text and any remote collaborator's caret, never hidden behind either
- [ ] **Delete comment** — removes it from the panel, the margin, and (in a second tab) live
- [ ] **Comment auto-delete** — deleting the anchored text itself removes the orphaned comment
- [ ] **History → Versions tab** — lists past snapshots; Restore round-trips content correctly; the scrubber slider previews each snapshot
- [ ] **History → Activity tab** — shows a merged, chronological feed of saved versions, comments, and file uploads; switching between the two tabs preserves each one's own state

---

## 6. Ask AI

Requires the `ask-ai` Supabase Edge Function deployed with a `GEMINI_API_KEY` secret — see `supabase/functions/ask-ai/README.md`. If it isn't deployed, confirm the failure mode is a clear toast, not a silent no-op or an unhandled error.

- [ ] **First use in a browser** — shows the one-time consent notice before sending anything
- [ ] **Selection required** — running Ask AI with nothing selected shows a toast, does not call the Edge Function
- [ ] **Result lands as a comment** — the AI's response is added as a comment on the original selection; the note text itself is unchanged
- [ ] **All entry points work** — toolbar button, right-click context menu, Tools panel, command palette, and `Alt+Shift+A` all reach the same flow
- [ ] **Room switch mid-request** — starting Ask AI, then navigating to a different room before it resolves, discards the result instead of landing a comment in the wrong room

---

## 7. Keyboard Shortcuts

Every shortcut below must work identically whether focus is in the Write-mode
textarea or the CM6 live surface (Preview/Split) — historically these only
worked in Write mode because shortcuts.js only recognized the plain
`<textarea>` as "the editor"; that was fixed, so this section is also the
regression check for that fix. Test each one in **both** Write mode and
Preview mode.

- [ ] `Ctrl/⌘ + S` — force saves (status briefly shows "Saving…")
- [ ] `Ctrl/⌘ + F` — opens Find panel, focuses search input
- [ ] `Ctrl/⌘ + B` — bolds selected text
- [ ] `Ctrl/⌘ + I` — italicizes selected text
- [ ] `Ctrl/⌘ + K` — inserts `[link text](url)`
- [ ] `` Ctrl/⌘ + ` `` — wraps selection in inline code
- [ ] `Ctrl/⌘ + Shift + S` — toggles Split view
- [ ] `Ctrl/⌘ + Shift + M` — toggles Monospace
- [ ] `Ctrl/⌘ + Shift + /` — opens the floating comment composer at the selection/caret
- [ ] `Ctrl/⌘ + /` — opens keyboard shortcuts modal
- [ ] `Ctrl/⌘ + K` **outside the editor** (e.g. focus on a button) — opens command palette instead of inserting a link
- [ ] `Alt + Shift + P` — toggles Preview mode
- [ ] `Alt + Shift + S` — opens the Share modal
- [ ] `Alt + Shift + T` — inserts a timestamp at the caret
- [ ] `Alt + Shift + C` — copies the whole note to the clipboard
- [ ] `Alt + Shift + A` — runs Ask AI on the current selection
- [ ] `Esc` — closes open panel, modal, or More dropdown
- [ ] `Ctrl/⌘ + B/I/K` in **read-only mode** — does nothing (no text change)
- [ ] `Ctrl/⌘ + B/I/K` in **locked mode** — does nothing
- [ ] `Ctrl/⌘ + Shift + T`, `+ C`, `+ P` — do nothing app-specific (these were moved to Alt+Shift to avoid colliding with browser/OS shortcuts — reopen-closed-tab, Inspect Element, Firefox private window)

---

## 8. Files

- [ ] **Upload via file picker** — click upload zone, select file, list updates
- [ ] **Drag-and-drop on upload zone** — drop overlay appears; file uploads
- [ ] **Drag-and-drop on Files panel body** — drop anywhere in the panel; overlay appears; file uploads
- [ ] **Drag-and-drop on editor area** — drop onto the textarea area; overlay appears; file uploads
- [ ] **Upload blocked in read-only mode** — dragging a file shows "upload disabled" toast; no upload occurs
- [ ] **File list refreshes** after upload (also in a second tab via Realtime)
- [ ] **Download file** — download button fetches signed URL; file saves
- [ ] **Delete file** — confirm dialog; file disappears from list (also in second tab)
- [ ] **Read-only user** — sees file list with preview + download only; no upload zone, no delete button
- [ ] **Encrypted room upload** — a file uploaded to an encrypted room decrypts correctly for preview/download; filename/type remain readable (not encrypted)

---

## 9. File Preview

- [ ] **Preview PNG/JPG/GIF/WebP** — image shown in modal lightbox at full width
- [ ] **Preview SVG** — "Open SVG in new tab" shown (not embedded inline)
- [ ] **Preview PDF** — "Open PDF in new tab" button shown
- [ ] **Preview .txt/.log/.json/.xml** — preformatted plain text shown
- [ ] **Preview .md** — Markdown rendered via safe renderer (no raw HTML)
- [ ] **Preview .csv** — HTML table rendered; header row visible
- [ ] **Unsupported file** (.zip, .docx, etc.) — shows filename, type, size, and Open/Download button
- [ ] **Large file (>100 KB text)** — truncation warning visible; only first ~100 KB shown
- [ ] **Close via ✕ button** — modal closes
- [ ] **Close via backdrop click** — modal closes
- [ ] **Close via Esc key** — modal closes
- [ ] **Download button in preview** — triggers download, then closes modal
- [ ] **Preview works in read-only mode** — preview button present; upload still blocked

---

## 10. Admin dashboard

- [ ] `/JotRelay/admin` shows a login form (email + password)
- [ ] Invalid credentials show an error message; valid credentials load the dashboard
- [ ] **Rooms tab** — lists/paginates rooms; filter chips and search work; Clear/Delete (single and bulk) work; CSV export works
- [ ] **Reports tab** — lists reports; status filter chips work; Dismiss/Review and Delete-room work
- [ ] **Files tab** — lists/paginates files; search by filename/room works; per-file delete works; storage-used total is correct
- [ ] **Audit Log tab** — records admin actions (clear/delete room, dismiss report, etc.); shows a "not configured" message (not an error) if the optional migration isn't applied
- [ ] **Cleanup tab** — expired-room cleanup and Storage Orphan Reconciliation (dry-run, then delete) run without error
- [ ] Non-admin user (or no login) cannot reach dashboard data — `is_syncpad_admin()` RLS blocks
- [ ] `PGRST301` error shown as "You do not have admin access." (not a raw error code)
- [ ] Logout button signs out and returns to login form

---

## 11. Themes & Appearance

- [ ] **Charcoal Amber** (default) — loads without data-theme attribute; amber accent
- [ ] **Midnight Blue** — blue accent; dark background
- [ ] **Forest Green** — green accent; dark background
- [ ] **Terminal** — bright green accent; high contrast
- [ ] **Mocha Dark** — warm brown accent; dark background
- [ ] **Crimson Night** — red accent; dark background
- [ ] **Paper Light** — light background; readable text in all panels
- [ ] **Lavender Light** — light lilac background; readable text in all panels
- [ ] **Arctic** — light teal background; readable text in all panels
- [ ] **Rose** — light pink background; readable text in all panels
- [ ] **Theme picker** groups Dark/Light sections correctly and shows no hover-preview flicker
- [ ] **Theme persists** after page refresh
- [ ] **All text readable** in every light theme (Paper Light, Lavender Light, Arctic, Rose) — no invisible text

---

## 12. Mobile

- [ ] Landing screen renders correctly on narrow viewport
- [ ] **Bottom action bar** is visible and all 5 buttons are tappable
- [ ] **Share modal** opens full-width; links and QR codes are visible
- [ ] **Files panel** is full-width; upload zone visible; file rows are tappable
- [ ] **File preview modal** fills the viewport; scrollable
- [ ] `/JotRelay/admin` dashboard renders correctly on mobile viewport
- [ ] **Tap targets** are at least 44×44 px for all buttons
- [ ] **Orientation change** — layout reflows correctly
- [ ] **On-screen keyboard** — the bottom action bar/comment composer/expiration bar reposition above the keyboard instead of being covered by it
- [ ] **Background/reopen** — background the tab (or switch apps) for 30+ seconds, then reopen; content resyncs without a stale-data flash, and without a jarring resync on a quick alt-tab

---

## 13. Deployment

- [ ] `supabase/migrations/0001_base_schema.sql` applied successfully in Supabase SQL Editor
- [ ] `syncpad-files` Storage bucket exists and is **private**
- [ ] Storage policies applied (upload, read, delete for `anon`)
- [ ] Storage cleanup warning acknowledged: SQL-only room deletion does not remove physical `syncpad-files` objects
- [ ] Optional `syncpad-cleanup` Edge Function deployed or manual bucket pruning process documented
- [ ] Optional `ask-ai` Edge Function deployed with a `GEMINI_API_KEY` secret, if Ask AI is meant to work on this deployment
- [ ] GitHub Pages is serving from the correct branch and folder
- [ ] `service-worker.js`'s `CACHE_VERSION` is bumped when cached assets change (check the file directly for the current value — it changes almost every release)
- [ ] Hard refresh (`Ctrl+Shift+R`) loads fresh content, no stale cache issues
- [ ] `404.html` is deployed and room URL redirect works
- [ ] Mobile browser tested (iOS Safari, Android Chrome)
- [ ] Supabase credentials in `index.html` are your real project values

---

## 14. Automated tests

- [ ] `npm test` runs without errors (or known failures documented) — it starts `tests/spa-server.js` on port 5555 automatically if nothing's already listening there
- [ ] All spec files in `tests/` pass — see `docs/playwright.md` §4 for the current list and count; spot-check at minimum: `landing`, `editor`, `editor-modes`, `markdown`, `live-editor-rendering`, `search`, `settings`, `routing`, `shortcuts`, `comments`, `editor-context-menu`, `read-only`, `templates`, `accessibility`, `utils`

---

## 15. Documentation

- [ ] **View-once caveat is visible** — docs/UX copy clearly says view-once is convenience-only, not secure destruction
- [ ] README.md describes only **actually implemented** features
- [ ] Storage cleanup claims distinguish admin UI deletion from optional service-role Edge Function cleanup
- [ ] Known Limitations section is present and accurate
- [ ] DEPLOYMENT.md has correct SQL and storage setup steps
- [ ] DEPLOYMENT.md security disclaimer is present
- [ ] Screenshots added to `docs/screenshots/` or placeholder paths noted in README
- [ ] `RELEASE_CHECKLIST.md` is present (this file)

## 16. Anti-spam and abuse-control checks

- [ ] Contact form still includes Web3Forms `botcheck` honeypot field
- [ ] Report reason allowlist enforced (frontend + DB constraint)
- [ ] Report details max length enforced (frontend + DB constraint)
- [ ] Supabase RLS allows `anon` insert-only for `syncpad_room_reports`
- [ ] Supabase RLS blocks `anon` select/update/delete on `syncpad_room_reports`
- [ ] Share-link table remains RPC-only for `anon` users (no direct select/update/delete)


### Optional service-role storage cleanup

- [ ] `supabase/functions/syncpad-cleanup` deployed when backend cleanup is needed
- [ ] Dry-run output reviewed before `dryRun:false`
- [ ] Finds objects in `syncpad-files` with no matching `syncpad_files` row
- [ ] Deletes physical objects for encrypted expired rooms before DB deletion
- [ ] Logs count-only metrics (no file content)
