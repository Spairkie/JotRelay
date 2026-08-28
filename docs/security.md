# JotRelay Security Model

> **Scope:** This document describes the security architecture of JotRelay as a personal/demo project. JotRelay is not designed for sensitive data — see [Known Limitations](#known-limitations--threat-model) before storing anything confidential.

---

## Table of Contents

1. [Security Model Overview](#security-model-overview)
2. [Text Encryption](#text-encryption)
3. [XSS Mitigations](#xss-mitigations)
4. [File Access and Signed URLs](#file-access-and-signed-urls)
5. [Supabase RLS Summary](#supabase-rls-summary)
6. [Admin Security](#admin-security)
7. [Known Limitations / Threat Model](#known-limitations--threat-model)
8. [Before Going to Production](#before-going-to-production)

---

## Security Model Overview

JotRelay has two distinct categories of access controls: controls that are enforced by the backend (Supabase RLS policies and RPCs) and controls that are implemented purely in frontend JavaScript. The distinction matters because frontend-only controls can be bypassed by anyone who can call the Supabase REST API directly using the public anon key.

### Frontend-Only Controls (NOT Backend-Enforced)

These features exist as UX conveniences. They do not constitute security boundaries.

| Feature | How It Works | Bypass |
|---|---|---|
| Passcode protection | PBKDF2 hash of the passcode is stored in `syncpad_rooms`; the client computes and compares the hash | The hash is readable by anyone with the anon key; the passcode itself is not stored, but a determined attacker can attempt offline brute-force against the hash |
| View-once rooms | Server clears content after the first non-creator editable view | A viewer can still copy or screenshot content before the server clears it; the clearing is not atomic with the act of viewing |
| Read-only links (`?mode=read`, `/share/:token`) | The frontend hides edit affordances and blocks local write attempts when a forced-read-only route is detected | `room_id` + the anon key is sufficient to write regardless of which link was used — a read-only visitor necessarily learns `room_id` from viewing the room's content, so a technical visitor can call the write path directly, bypassing the UI entirely. Use room lock for an actual guarantee that a room can't be edited (see below) |
| Timed reveal | `joinRoom()` shows a countdown screen instead of the room's content whenever `reveal_at` is in the future and the visiting device isn't the room's creator (`created_by_device`) | A pure client-side `SELECT`-time comparison — a technical visitor querying the REST API directly with the anon key sees the content before `reveal_at`, same as any other frontend-only control here |

### Backend-Enforced Controls

These controls are implemented as Supabase Row Level Security (RLS) policies and server-side functions. They cannot be bypassed through the REST API with only the anon key.

| Feature | Mechanism |
|---|---|
| Per-table access control | RLS policies on `syncpad_rooms`, `syncpad_files`, `syncpad_share_links`, `syncpad_room_reports` |
| Room reports | Anon users can INSERT only; no SELECT, UPDATE, or DELETE |
| Admin access | `is_syncpad_admin()` database function checked by Supabase Auth and RLS on every admin query |
| Share token resolution | Exposed via RPC only for anon users — no direct table SELECT on `syncpad_share_links` |
| Room lock | `syncpad_rooms_enforce_lock` trigger (`enforce_syncpad_rooms_lock()` in `supabase/migrations/0001_base_schema.sql`) rejects any content change to a room while `editing_locked = true`, at the database level — not just in the frontend. Exempt: the backend expiry-cleanup job and signed-in admins, both of which need to be able to override a lock. This is the one control a room owner can rely on for an actual "nobody can edit this" guarantee |
| Room quarantine (optional, `/admin`) | Same trigger technique as room lock, added by `supabase/migrations/0008_quarantine_enforcement.sql` — requires `0006_admin_dashboard_improvements.sql` first. Frontend-only if `0008` isn't applied (see `0006`'s header) |

---

## Text Encryption

JotRelay supports optional in-browser AES-256-GCM encryption for room text content. When encryption is enabled, plaintext is never transmitted over the network.

### Algorithm and Key Derivation

- **Cipher:** AES-256-GCM (authenticated encryption — provides both confidentiality and integrity)
- **Key derivation:** PBKDF2 with SHA-256, 200,000 iterations for text encryption
- **Salt:** Generated per room, stored in `syncpad_rooms.encryption_salt`
- **Passphrase:** Provided by the user — never stored anywhere

The key is derived entirely in the browser from the user's passphrase and the room salt. The derived key is held in memory for the session and discarded when the page is closed.

### What IS Encrypted

- Room text content stored in the database
- Real-time sync uses database-only content delivery when encryption is active — plaintext Broadcast channel snapshots are suppressed
- File attachments uploaded to an encrypted room — their bytes are AES-256-GCM-encrypted client-side with the same room key before upload (see [File Access and Signed URLs](#file-access-and-signed-urls)). Any file uploaded before encryption was turned on for the room, or uploaded to a room that has never had encryption enabled, remains plaintext — encryption only applies going forward, from the moment it's switched on.

### What Is NOT Encrypted

- A file's name and MIME type — kept in plaintext database columns (`syncpad_files.filename`, `.mime_type`) even for an encrypted room's files, so the app can list, sort, and route preview logic for a file without decrypting it first. Only the file's actual content is protected.
- Files uploaded before the room's encryption was enabled (see above)
- Room metadata (title, creation time, settings flags, encryption salt)
- Share link records

### Threat Model for Encrypted Rooms

Encryption protects against a passive observer who can read the Supabase database but does not know the passphrase. It does not protect against:

- An attacker who obtains the passphrase
- Compromise of the client device or browser
- Offline dictionary attacks against a weak passphrase (the PBKDF2 iteration count raises the cost but does not eliminate the risk)

---

## XSS Mitigations

User-supplied content is rendered in several contexts. The following mitigations are applied.

### HTML Escaping

`escapeHtml()` from `utils.js` is applied to all user content before it is inserted into the DOM as HTML. This covers room text rendered outside the Markdown path, room IDs used in export `<title>` elements, and other interpolated values.

### Markdown Renderer

The Markdown renderer does not pass raw HTML through. Its pipeline is:

1. All input is escaped with `escapeHtml()` first
2. A safe allow-list of HTML tags is applied — only explicitly permitted tags survive
3. No arbitrary HTML pass-through

`javascript:` link hrefs are blocked: the renderer checks the protocol of any link before emitting an `<a>` tag. Links with a `javascript:` protocol are dropped.

The same scheme allowlist applies to the editable Live/Split surface (`live-editor.js`, CodeMirror 6): ctrl/cmd-click only opens a link whose destination matches `^https?://`, and its inline image widget only resolves `https?://` URLs or the app's own `syncpad-file:` pseudo-scheme (resolved server-side to a signed URL for a private-bucket attachment) — never `javascript:`/`data:`.

### SVG Files

SVG files are not previewed inline. They are opened in a new browser tab. This prevents execution of embedded scripts that SVG files can legally contain.

---

## File Access and Signed URLs

Files are stored in a private Supabase Storage bucket named `syncpad-files`. The bucket is never made public.

### Access Flow

1. A client requests a file by its storage path.
2. The backend generates a signed URL valid for 1 hour.
3. The client fetches the file directly from the signed URL.

### Signed URL Cache

`files.js` maintains an in-memory signed URL cache with a 55-minute TTL (5 minutes shorter than the URL lifetime) to avoid redundant signing API calls. The cache entry for a file is evicted immediately when that file is deleted.

### Encryption Note

Signed URLs provide time-limited access control regardless of encryption — anyone who obtains a valid signed URL within its 1-hour window can fetch whatever bytes sit at that Storage path.

For an unencrypted room, those bytes are the plaintext file — do not store sensitive files in an unencrypted JotRelay room.

For an encrypted room, `uploadFile()` (`src/files.js`) encrypts the file's bytes with the room's derived key (AES-256-GCM, IV prepended) before upload, and the Storage object's `Content-Type` is set to the opaque `application/octet-stream` rather than the file's real MIME type — so a signed URL by itself, without the room passphrase, yields only ciphertext. The client decrypts fetched bytes into a local, in-memory `Blob`/object URL for preview and download; the plaintext is never written back to Storage. `syncpad_files.encrypted` marks which files went through this path (`supabase/migrations/0014_file_encryption.sql`).

---

## Supabase RLS Summary

Row Level Security is enabled on all JotRelay tables. The policies are the authoritative enforcement layer for data access.

| Table | Anon SELECT | Anon INSERT | Anon UPDATE | Anon DELETE | Notes |
|---|---|---|---|---|---|
| `syncpad_rooms` | Policy-gated (open — content itself isn't secret to holders of `room_id`) | Policy-gated (open) | Policy-gated (open) | No | `room_id` + the anon key is sufficient to read and write — this is intentional (see Known Limitations below). The `syncpad_rooms_enforce_lock` and `syncpad_rooms_enforce_quarantine` triggers (independent of RLS, `0001` and `0008` respectively) are the actual write-blocking controls, gating on `editing_locked`/`quarantined_at` rather than on who's asking. Admins also write directly via their own `is_syncpad_admin()`-gated policy |
| `syncpad_files` | Policy-gated | Policy-gated | No | No | Access tied to room access |
| `syncpad_share_links` | No direct access | Policy-gated | No | No | Resolution via RPC only |
| `syncpad_room_reports` | No | Yes (insert only) | No | No | Reports are write-only for anon users |

Admin queries are additionally gated by the `is_syncpad_admin()` function, which is evaluated server-side on every request. A user without the admin flag in Supabase Auth cannot satisfy this predicate regardless of what they send in the request.

---

## Admin Security

- The `/admin` route requires authentication via Supabase Auth (email and password).
- Every admin database query is gated by the `is_syncpad_admin()` RLS policy — there is no admin-only API surface that bypasses RLS.
- JWT expiry and insufficient privilege errors (`PGRST301`) are surfaced to the admin UI as the human-readable message "You do not have admin access." rather than exposing internal error details.

### Admin session and Supabase role

JotRelay uses a single shared Supabase client for both the normal app and the admin dashboard. After a user signs in via Supabase Auth at `/admin`, the client's effective role changes from `anon` to `authenticated`. Supabase RLS policies are role-specific — policies written for `to anon` do not apply to `authenticated` requests, and vice versa.

Without a matching set of baseline policies for the `authenticated` role, normal app operations (saving room content, uploading files, etc.) fail with RLS permission errors after admin login. The `supabase/migrations/0001_base_schema.sql` script includes **authenticated baseline** policies that mirror the anon policies for `syncpad_rooms`, `syncpad_files`, and the `syncpad-files` storage bucket. These do not grant additional privileges — they simply ensure normal app features continue to work during an authenticated session. Elevated admin actions (delete rooms, bulk manage files) are still gated by `is_syncpad_admin()` in separate policies.

---

## Known Limitations / Threat Model

JotRelay is a personal/demo project. The following are known weaknesses that should be understood before using it for anything important.

**Anonymous by design.** JotRelay has no backend-enforced user identity system. There are no user accounts tied to rooms at the database level. "Ownership" of a room is a frontend concept only.

**Anon key is public.** The Supabase anon key is embedded in the frontend bundle and is not secret. Anyone who reads the page source has the anon key and can call the Supabase REST API directly. This bypasses the passcode check and read-only links specifically (see above) — it does not bypass room lock or, if applied, room quarantine, both of which are independently enforced server-side regardless of how the request is made (see Supabase RLS Summary above).

**Room IDs are short random strings, and knowing one is enough to edit it.** `room_id` + the anon key is sufficient to read *and write* a room — there is no separate credential a room's creator holds that other visitors don't. If the character space and length of room IDs are known, an attacker with enough requests can enumerate rooms and edit whatever they find. `0010_anonymous_write_rate_limiting.sql` (if applied) limits how fast a single device/IP can *create new* rooms or submit reports — it does not limit reads, edits, or lookups against already-existing room IDs, so it does not address enumeration-of-existing-rooms on its own. Evaluate Supabase's built-in rate limiting for that broader case. Lock a room (`editing_locked`) for any content you don't want a lucky guesser to be able to change.

**Passcode hashes are accessible.** The PBKDF2 hash of a room passcode is stored in `syncpad_rooms` and is readable to anyone with the anon key. The passcode itself is not stored, but offline brute-force against a weak passcode is possible.

**Files are not end-to-end encrypted for the filename/type, and not encrypted at all outside an encrypted room.** In an unencrypted room, files sit in Supabase Storage in plaintext. In an encrypted room, a file's *content* is AES-256-GCM-encrypted client-side with the room's key before upload (see [Encryption Note](#encryption-note) above) — but its filename and MIME type are not, and files uploaded before the room's encryption was turned on stay plaintext. Either way, signed URLs provide time-limited access, not encryption at rest from Supabase's own perspective (ciphertext or plaintext, Supabase can still read the bucket).

**localStorage is origin-scoped.** Custom templates and drafts stored in `localStorage` are accessible to any JavaScript running on the same origin. If a third-party script is ever loaded on the JotRelay origin (analytics, embeds), it would have access to this data.

**View-once display precedes clearing, by design.** The client must render the content before the server clears it, so a viewer can always copy or screenshot the content in that window — no server-side design can prevent that without refusing to show the content at all. The clearing *write* itself is atomic: `consumeViewOnceAtomic()` (`src/rooms.js`) conditions the `UPDATE` on `viewed = false`, so two viewers opening the same view-once link at nearly the same instant can't both have their write "win" — exactly one clear succeeds, closing the read-then-write race a naive check-then-update would have.

**Recommendation:** Do NOT use JotRelay to store passwords, personal health information (HIPAA/PHI), personally identifiable information (PII), classified or regulated data, or any information that would cause harm if disclosed.

---

## Before Going to Production

If JotRelay is ever deployed for broader use, the following items should be addressed first.

**Web3Forms allowed domain.** The contact/report form uses Web3Forms. Configure the allowed domain in the Web3Forms dashboard to restrict form submissions to your production domain. Without this, anyone can submit forms using your Web3Forms key from any origin.

**RLS audit.** JotRelay intentionally keeps `syncpad_rooms` and file RLS broad for a transparent demo project — `room_id` is the only credential, for both reading and writing. What's actually enforced independent of RLS: the room lock trigger, and (if `0008_quarantine_enforcement.sql` is applied) the quarantine trigger. Everything else — `syncpad_rooms` SELECT/UPDATE/INSERT and all of `syncpad_files`' policies — is broad by design (file access is tied to room access, not a separate credential).

**Storage bucket review.** Confirm the `syncpad-files` bucket has no public access enabled. Review the storage policies to ensure that file SELECT and INSERT are tied to room membership in a way that RLS enforces, not just frontend logic.

**Rate limiting.** `supabase/migrations/0010_anonymous_write_rate_limiting.sql` adds a per-device/per-IP rolling-window limit on new room creation (30/15min per device, 60/15min per IP) and report submission (10/15min per device, 20/15min per IP) — apply it if you haven't. It does not cover share-link resolution, room lookups, or edits to existing rooms; evaluate Supabase's built-in rate limiting for the REST API and RPC endpoints to reduce the viability of room ID enumeration more broadly.

**Room ID entropy.** If room IDs are short, consider increasing their length or character space to raise the cost of brute-force enumeration.

**PBKDF2 iterations.** Passcode hashes use 100,000 PBKDF2 iterations and text encryption uses 200,000. Review current OWASP guidance before any broader launch and adjust if needed.

**Content Security Policy.** Add a `Content-Security-Policy` header that restricts script sources to your own origin. This hardens the XSS mitigations already present in the code by providing a browser-enforced second line of defense.

**Dependency audit.** Run `npm audit` (or equivalent) and resolve high/critical findings before launch.
