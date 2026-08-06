# Changelog

All notable changes to SyncPad are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Phase 48 — Brand mark redesign, code-fence visual proportion, landing demo keyboard nav

#### Changed
- **Brand mark redesigned.** The mark (two overlapping solid cards + a separate circular refresh-arrow badge) read as a generic icon-generator composition — the refresh-arrow glyph in particular is close to the single most common "sync" stock icon there is, doing nothing to make the mark ownable. Replaced with two offset rounded cards — an outlined back card, a solid front card with bold content lines — where the offset itself suggests sync/mirroring instead of a bolted-on badge. `presskit/icon/icon-simple.svg` (a separate "simplified" SVG for favicon/small sizes) is gone: the new mark was tested down to native 16px and reads clearly at every size up to 512px, so `icon.svg` is now the single source for the press kit, the PWA install icons, and the browser-tab favicon alike — one less place for two files to silently drift apart. `scripts/generate-icon-pngs.mjs` and `src/theme.js`'s runtime theme-matched-favicon renderer both updated to match.
- **Fenced code blocks narrowed to 90% of the content measure** (desktop only; full width below 768px). Not an overflow fix — code blocks were already contained to the same measure as headings/paragraphs — but a bordered/backgrounded box reaching flush to both edges reads as more prominent than prose, which rarely wraps all the way to the edge, so blocks visually dominated the page despite being the "correct" width on paper. Still left-aligned to the same edge as the rest of the content; `overflow-x:auto` still covers any line that doesn't fit even the narrower box.

#### Added
- **Theme-matched favicon.** The browser-tab favicon now re-tints to the active theme's own background/accent colors whenever the theme changes, including the PNG `<link>` fallbacks for browsers without SVG-favicon support (rasterized via an offscreen canvas, async).
- **Keyboard navigation for the landing page's two tablists** (the coded demo's scene tabs, the "SyncPad features" tabs) — Left/Right/Home/End roving focus per the ARIA APG Tabs pattern; previously click-only plus default per-button Tab stops.

#### Fixed
Two rounds of Codex review findings on this phase's changes, all confirmed real and fixed: the PNG favicon fallbacks not re-tinting on theme change; `markdownToPlainText()` silently dropping image alt text and running table cells together with no separator; the document mini-map rebuilding on ordinary scrolling (traced to CM6 raising `geometryChanged` from virtualized-viewport DOM churn, not just real content/size changes — fixed with a tolerance-based "did anything actually change" comparison in `rebuild()` itself, including comparing each heading's exact document offset so a stale tick can never silently outlive an edit); the minimap's keyboard-nav helper consuming vertical arrow keys in a horizontal tablist; the file-preview modal's code narrowing not gated to desktop; and PWA install icons (`icon-192.png`/`icon-512.png`/`apple-touch-icon.png`) rasterizing with transparent corners despite `manifest.json` declaring them maskable.

### Phase 47 — Follow-up polish: export-copy-text bug, dead-code sweep, emoji shortcodes, favicon set

#### Fixed
- **The Export panel's "Copy as plain text" button copied raw Markdown source, `**`/`#`/`[]()` markers and all** — its handler called `copyToClipboard(UI.getEditorValue())` directly instead of the purpose-built `markdownToPlainText()` (which already existed, fully implemented, but had never been wired to anything). Now strips markup as the label promises; "Export as Markdown" already covers the raw-source use case.
- Fenced code blocks hardened against a CSS Grid content-based sizing edge case: `.editor-wrap`'s `grid-template-columns: 1fr` (and the split-mode `1fr 1fr`) had no explicit minimum, so an unbreakable long line could in principle force the grid track wider than its intended measure before `overflow:hidden` ever got a chance to clip it. Changed to `minmax(0, 1fr)` and added an explicit `max-width: 100%` on `.note-preview pre`/`.preview-markdown-body pre` as a documented guarantee — verified via direct DOM-geometry measurement (both wrapping and deliberately unbreakable long lines) that code blocks already matched the heading/paragraph content measure pixel-for-pixel in every surface tested; this is defense-in-depth, not a fix for a reproduced visual bug.
- Removed dead exports found via a full-repo usage audit: `getCaretPos()` (`live-editor.js`), `isPresenceHidden()` (`presence.js`), `templateKeys()` (`templates.js`) — confirmed zero call sites anywhere in the repo. `markdownToPlainText()` was in the same unused-export list but turned out to be the fix above, not dead code.
- Removed a dead legacy share-modal CSS block (`styles/modals.css`) — `.share-badge(--edit/--view)`, `.share-card(--edit/--view)`, `.share-card-header/-title`, `.share-url-box/-text`, `.share-copy-btn`, `.share-native-btn`, `.share-note`, `.share-passcode-notice`, `.share-encryption-notice`, `.share-security-notice`, `.share-send-to-phone`, `.share-steps`, `.share-qr-title`, `.share-room-summary/-badges/-badge`, `.share-summary-label` — all confirmed zero references in any `.js`/`.html`, left over from a share-modal redesign that moved to the current icon-action layout without cleaning up the old rules. Also removed the equally-dead `.toggle-switch`/`.toggle-track`/`.toggle-thumb` component (`styles/panels.css`).

#### Added
- **Emoji shortcodes** (`:smile:`, `:tada:`, `:rocket:`, `:thumbsup:`, …) now render as Unicode emoji in the classic renderer (`markdown.js`'s new `_EMOJI_MAP`, ~150 commonly-typed GitHub-style names) — `markdownLanguage`'s grammar already parsed `:shortcode:` as an `Emoji` node structurally (previously only its syntax-highlight color was neutralized, per Phase 33); this adds the actual text conversion, with an unrecognized shortcode left as literal text rather than dropped. Live-surface visual conversion (a widget decoration matching the images/checkboxes pattern) is scoped out for now — see `docs/markdown-feature-audit.md`'s "Areas for further work".
- **Favicon set redesigned and correctly wired.** `presskit/icon/icon-simple.svg` — a bold single-card mark already built and explicitly commented as "tuned for legibility at favicon/small sizes" — was never actually used as the browser-tab favicon; `index.html` linked the full two-card+badge mark at 192px instead, which a side-by-side rendered comparison at real tab size (16px/32px) confirmed blurs into an indistinct smudge at that scale. `index.html` now references `assets/favicon.svg` (primary) plus `favicon-32.png`/`favicon-16.png` fallbacks, all from the simple mark; added `assets/apple-touch-icon.png` (180px, full mark — reads fine at that size). `scripts/generate-icon-pngs.mjs` now generates the app's shipped `assets/*` icons directly (previously only documented as doing so, not actually implemented) alongside the presskit set, so one script run keeps every icon in sync. Service worker cache bumped to `syncpad-v45` and the new assets added to its precache list.

#### Verified
- All 6 Codex-bot findings from PR #102's review confirmed present in the actual current code (not just marked resolved on GitHub): minimap keyboard activation, `_liveTocOpen` reset on mount, demo `scrollIntoViewIfNeeded()` fixes, mobile tagline wrap, DEPLOYMENT.md's reconciled one-file instructions, and scroll-spy clearing outside tracked sections.
- Visual pass across the landing page (brand-intro, hero/demo, features/workflow, footer/CTA) via direct screenshot — confirmed no layout regressions, scroll-spy nav highlighting works correctly in the browser, reveal-on-scroll animations settle cleanly.
- Markdown feature coverage reviewed end to end against `docs/markdown-feature-audit.md` — already GFM-complete with well-reasoned scope decisions; emoji shortcodes (above) was the one confirmed gap worth closing.

### Phase 46 — Coded hero demo, theme picker redesign, live TOC/mini-map, brand-intro landing section

#### Added
- **Coded hero demo** replacing the landing page's static screenshot/video with a hand-built, dependency-free scripted sequence (5 scenes: Write → Collaborate → Review → Share → Handoff) driven by `src/app/landing-demo.js`, with a mobile-frame variant, autoplay with a per-tab progress fill, pause-on-manual-interaction, and pause/resume tied to viewport visibility via `IntersectionObserver`.
- **Typora-inspired brand-intro section** at the top of the landing page (`#lp-intro`) — full-viewport centered wordmark, a typed tagline with a blinking caret, a "Scroll to explore" cue, `prefers-reduced-motion` support, no scroll-jacking. `.lp-nav` moved below it in document order (stays `position: sticky`).
- **Active-section nav highlighting** — an `IntersectionObserver`-driven scroll spy underlines whichever nav link matches the section currently in view.
- **Document mini-map** in the Live editor surface — a thin always-faintly-visible rail along the scroller edge with one tick per heading, positioned proportionally in the document; brightens on hover, jumps to its heading on click, hidden on touch/coarse-pointer devices.
- `[TOC]` now renders open by default in Live mode instead of requiring a click to expand.
- `#btn-share` gets a distinct accent-tinted hover instead of the generic header-icon treatment.

#### Changed
- **Theme picker redesigned**: removed the hover-preview interaction (hovering/tabbing a swatch used to live-repaint the whole app), replaced flat color chips with a small "window" mockup swatch (header bar + accent pill) and a CSS-only hover/active lift.
- Icon set audited (93 inline SVGs + every `getIcon()` definition) against the app's stroke convention; fixed the two real inconsistencies found and removed two dead duplicate icon defs (`preview`/`import`, byte-identical to `eye`/`upload`).
- Hero demo's collaborator character renamed Alex → Hans throughout (markup, JS, tests).

#### Fixed (docs accuracy audit)
- Template/theme counts stale across README/CLAUDE.md/architecture docs/presskit README/tests (13→17 templates, 7→10 themes).
- README's Screenshots section pointed at a nonexistent `docs/screenshots/` folder; repointed at the real `presskit/screenshot/*.png` assets.
- `docs/playwright.md`'s spec-file table was missing `landing-demo.spec.js` and undercounted the total.
- Service worker cache version comment was stale in README.
- **Real gap**: `DEPLOYMENT.md` claimed `baseline.sql` includes every migration, but it predates `0010`/`0011` — documented in both `baseline.sql`'s header and `DEPLOYMENT.md`'s migration table, and reconciled with the prominent "brand-new project? run one file" instructions that hadn't been updated to match.
- A brand-intro layout bug found during verification: the "Scroll to explore" cue rendered on top of the wordmark instead of near the viewport bottom — an animated `transform` on its parent established a new containing block for the cue's `position: absolute`, even though the animation settles on `transform: none` (the computed/used value is an identity matrix, not literally "none"). Fixed by moving the cue to be a sibling of the animated wrapper instead of a child.
- 6 findings from an automated Codex review addressed: minimap ticks not keyboard-activatable, `_liveTocOpen` leaking across room mount/destroy, the new intro pushing the demo below its `IntersectionObserver` autoplay threshold (breaking 3 existing tests), mobile tagline clipping, the DEPLOYMENT.md reconciliation above, and scroll-spy nav state not clearing outside tracked sections.

### Phase 45 — Live TOC/footnote interactivity, code-fence-in-blockquote fix, shorter file references, code line numbers

#### Fixed
- **A fenced code block nested inside a blockquote (or GFM alert) lost the quote's indentation/border in the Live/Split surface** — its own `padding-left`/would-be `border-left` sat at the same CSS specificity as the blockquote's line class, so whichever rule was declared later in the stylesheet simply clobbered the other instead of the two combining. Removed the code block's left/right border entirely (a background band + top/bottom caps reads just as clearly, and sidesteps the conflict) and added higher-specificity combined selectors (`.cm-md-blockquote.cm-md-codeblock` etc.) so the code block's own indent now adds to the quote's instead of replacing it.
- **The `[TOC]` marker's rendered "Contents" box didn't hide the raw `[TOC]` text underneath it** in the Live surface — `_computeTocBadges()` used an *additive* `Decoration.widget()` (insert-only) instead of `Decoration.replace()`, so the literal marker sat right below the box. Now replaces it, with the standard reveal-while-touched behavior (editing the line shows the raw text again) every other hideable construct in this file already has.
- **Every Contents entry was inert** — `.cm-md-inline-toc a` had `pointer-events: none`, silently killing the click-to-navigate `mousedown` handler that was already correctly wired in JS. Removed it; also fixed a second, related bug this exposed once clicks started reaching the links: `preventDefault()` on `mousedown` doesn't stop the *following* native click from still following the `<a href="#">`, appending a bare `#` to the URL and fighting the scroll — added a `click` handler that suppresses the default and (for a keyboard-triggered activation, detected via `event.detail === 0`, since Enter/Space on a focused link never fires `mousedown`) performs the navigation itself.
- **Footnote references had no interactivity beyond a single scroll-to-bottom jump** — added a click/tap-to-toggle inline popover (littlefoot.js convention; researched against Wikipedia/Gwern/ARIA-tooltip-vs-disclosure-widget guidance) showing the footnote's text in place, in both the static preview and the Live surface. New shared module `src/footnote-popover.js` (`toggleFootnotePopover`/`closeFootnotePopover`) keeps the interaction — and its accessibility behavior (`aria-expanded`, Escape closes and returns focus, outside-click closes) — from drifting between the two renderers.
- **Uploaded/inserted file references were a long, untypable `syncpad-file:<room-id>/<timestamp>_<filename>` path** — added a short, sequential-per-room `file_no` column (`supabase/migrations/0011_short_file_references.sql`, **must be run manually in Supabase's SQL Editor**, same as every prior migration in this repo) assigned by a `BEFORE INSERT` trigger that locks the room row first so concurrent uploads from different devices can't collide. New inserts/pastes/drops now produce `syncpad-file:3` instead of the old long path; `src/files.js`'s new `resolveFileRef()` transparently resolves either shape (a bare number via the new column, anything else — i.e. a `/`-containing legacy path — exactly as before), so content written before this migration keeps working unmodified. The Files panel shows each file's number as a small clickable `#N` badge (copies the reference to the clipboard) so the short form is discoverable without needing the Insert button at all.

#### Added
- **Opt-in "Code line numbers" setting** (Settings > Editor). Static preview: a gutter *sibling* to `<code>`, not wrapper spans inside it — `Prism.highlightAllUnder()` replaces `<code>`'s entire innerHTML for any language it recognizes, which would otherwise silently destroy per-line markup living inside it. Live surface: each fenced-code line is already its own real element there, so a plain CSS `counter-increment` + inline `::before` is enough — no gutter overlay needed. Both count only real code lines, not the fence's own opening/closing delimiter lines.

#### Verified
Full manual pass in a live browser session against an expanded `syncpad-markdown-test.md` (now also covering: a code fence nested in a list item, the blockquote-nested case's expected visual behavior, a footnote referenced twice, and a longer code block for exercising line numbers) — all of the above confirmed working, including keyboard-only activation of the Contents links (Tab + Enter) and the footnote popover (Tab + Enter, Escape to close and restore focus). One pre-existing test (`tests/utils.spec.js`'s footnote-markup assertion) updated to match the new `data-footnote-ref`/`aria-expanded` attributes. Full suite re-run end to end: 356 passed, 2 flaky (pre-existing timing races, unrelated to this round — pass on retry), 7 skipped (admin pagination, expected without seeded data), 0 hard failures.

### Phase 44 — Codex's PR #97 findings, comment-dot visibility, and test-suite room reuse

Codex reviewed PR #97 (Phase 42) and left 9 inline comments; all 9 were verified as real bugs against current code (not false positives) and fixed here, alongside one more bug found while fixing them and a rework of the test suite's room-per-test pattern.

#### Fixed
- **Files-panel "Insert" ignored `downloads_disabled`** (`src/app/files-panel.js`) — now gated on `canEdit() && !state.room?.downloads_disabled`, matching Preview/Copy-link/Download's existing condition.
- **Non-image "Insert" produced an inert link** — `_renderLink()` (`src/markdown.js`) only accepted `http(s)`/`mailto` URLs, so a `syncpad-file:` reference rendered as literal text. Added a resolvable `syncpad-file:` branch (`data-syncpad-file` + resolved client-side, same as the existing image path) to both the static renderer (`src/ui/editor.js`'s `_resolveFileImages`, extended to also resolve `a[data-syncpad-file]`) and the CM6 Live surface (`src/live-editor.js`'s ctrl/cmd-click handling).
- **Mixed image+non-image drops silently discarded the non-image files** — the double-upload fix's `stopPropagation()` blocked `.editor-area`'s generic drop handler entirely. Now marks which files were already claimed (`e._syncpadHandledFiles`) instead, so the generic handler still picks up the rest.
- **Uploaded filenames weren't Markdown-escaped** before interpolation into a generated `[label](url)`/`![label](url)` reference — a bracket in the filename broke the reference. Added `_escapeMdLabel()`, used by both the new Insert action and the pre-existing `_uploadAndInsertImages()`.
- **`resetScrollSync()` leaked scroll-sync listeners across room navigation** — it only reset the `_scrollSyncWired` guard, not the actual listeners/reference, so a stale pair from a previous room kept syncing even after toggling Sync Scroll off. Now calls `unwireScrollSync()`.
- **A heading's HTML comment leaked into its anchor slug/URL** even though it renders invisible — `_slugifyHeading()` now strips `<!-- ... -->` before slugifying, fixing both the direct heading-render path and the `[TOC]`-marker pre-collection pass from one place.
- **Files-panel "Insert" could steal focus from the Live surface in Split mode**, inserting into the wrong (stale) surface — added the same `mousedown` → `preventDefault()` wiring already used for Settings toggles.
- **`scroll-behavior: smooth` on `.note-preview`/`.cm-scroller` animated every scrollTop assignment**, including the Split-mode proportional sync handlers' — reintroducing the exact jitter/fighting-panes bug the prior round's epsilon-guard fix was meant to remove, since intermediate animation-frame scroll events fired after the handler's re-entrancy lock had already cleared. Removed the blanket CSS; TOC/footnote anchor clicks now opt into smoothness explicitly and only for themselves (`_wireInternalAnchorScroll` in `src/ui/editor.js`; a new `smooth` option on `src/live-editor.js`'s `_scrollPosIntoView`, used only by the `[TOC]` widget).
- **The comment floating bubble's `top` transition fired on every reposition**, including plain scroll-triggered refreshes, making it visibly lag behind its anchor during ordinary scrolling instead of only animating on Prev/Next. Threaded a new `animate` flag from `_navigateComment()` through `renderFloatingComments()` so the transition-enabling class is only present for an explicit navigation.
- **Comment margin dots silently vanished for anchors outside the current viewport** — `LiveEditor.coordsAtPos()` returns null for undrawn positions (the same root cause the Phase 43 scroll fix worked around). Added `estimateViewportY()`, a `lineBlockAt()`-based fallback used only by comment-dot positioning (the floating comment composer, which needs a precise X too, keeps using `coordsAtPos()` directly since it only ever opens at the current, necessarily-visible selection).
- **`openPanel()`'s generic focus trap overrode a caller's explicit `.focus()` call** (`src/ui/panels.js`) — its `requestAnimationFrame` callback always focused the panel's first focusable item, even when the caller (e.g. the Ctrl+F shortcut, which focuses `#search-input` specifically) had already set focus somewhere deliberate a tick earlier. Surfaced by the test-suite room-reuse rework below, which changed room-entry timing enough to expose a pre-existing race. Now checks `panel.contains(document.activeElement)` first and only falls back to the first-focusable default when nothing in the panel has focus yet.

#### Changed — test suite
`tests/helpers.js`'s `createRoom()` inserted a brand-new room for every single call (~300+ across the suite), which is what tripped this project's own anonymous-write rate limiter (`0010_anonymous_write_rate_limiting.sql`) during this session's own manual runs. `createRoom()` now reuses one fixed fixture room (reset to pristine defaults — content, files, comments, passcode, lock, expiry, device limit — via a direct Supabase call before each use) instead; same signature/return value, so the large majority of spec files needed no changes. `tests/settings.spec.js`, `tests/history.spec.js`, and `tests/short-room-code.spec.js` — encryption (anon can't undo it without the passphrase a prior test used), version history, and short codes (anon has no direct delete access to either) — use a new `createFreshRoom()` (the old always-fresh behavior) instead, isolating their harder-to-reset state. One test in `tests/room-errors.spec.js` that specifically asserts two navigations land on *different* room IDs also switched to `createFreshRoom()` for both. One test in `tests/remote-selection.spec.js` ("no Follow toggle is shown") exercises the *real* Supabase Presence subscription rather than injecting synthetic data like the rest of that file — Presence/Realtime connection state lives outside Postgres and isn't something a DB-level reset can clear, so a previous test's still-timing-out connection could leak into it against the reused fixture room; switched to `createFreshRoom()` as well.

#### Verified
Full manual pass across the live app (landing, all three editor modes, templates, all 7 themes, comments, files, settings, presence/devices, command palette, Find & Replace, admin dashboard's five tabs) — no bugs found beyond what's fixed above, zero console errors. Full suite run twice end-to-end against the reused-fixture path (`npx playwright test --workers=1`, matching `playwright.config.js`'s serial default): first run surfaced the `openPanel()` focus-trap bug and the `remote-selection.spec.js` presence leak above; second run after both fixes: 355 passed, 3 flaky (pass on retry, pre-existing timing races unrelated to room reuse — none touch presence or DB state), 7 skipped (admin pagination tests, expected without seeded data), 0 hard failures, ~13 minutes total (down from 56 minutes before the reuse rework).

### Phase 43 — Fix real Live-editor bugs missed by Phase 42, plus an admin debug reset

Phase 42 was mis-verified: its testing mostly exercised the static `markdown.js` renderer (via a forced-visible `#note-preview` override) instead of the CM6 Live surface real users actually see by default. Re-investigated directly in a live browser session against the real Live surface, confirmed each gap, and fixed it.

#### Fixed
- **TOC links (and Follow-mode/Find-&-Replace jumps) didn't scroll at all** in the Live surface — traced to `EditorView.scrollIntoView()` not producing a visible scroll anywhere in this app's actual runtime (confirmed: the effect moves the selection correctly but never touches `.cm-scroller`'s `scrollTop`; ruled out a stale vendor bundle, the wrong scrollable ancestor, and a duplicate `@codemirror/view` copy). All three call sites in `src/live-editor.js` (`_TocWidget`'s click handler, `scrollToPos()`, `setSelection()`) now compute and apply the scroll manually via `view.lineBlockAt(pos).top` — `coordsAtPos()` alone isn't enough since it returns null for any position that isn't currently drawn, which is exactly the case that needs scrolling.
- **Nested blockquotes rendered with a flat, identical border regardless of depth** in the Live surface — the static renderer already nested correctly; the CM6 decoration just never computed nesting depth. Now computed per line and depth-scaled in both the decoration class and `styles/editor.css`.
- **HTML comments were fully visible (just dimmed) in the Live surface**, not hidden — there was no handling for `Comment`/`CommentBlock` nodes at all in the seamless-editing tree walk; they only looked dimmed by coincidence (inherited generic code-comment syntax styling). Now hidden entirely while the selection isn't touching them, same reveal-on-touch pattern as every other hideable element in this file.
- **Footnote definition markers left a dangling `:`** ("1.: text" instead of "1. text") — the replace range only covered the `[^1]` text, not the following `:` that marks it as a definition.

#### Added
- **Admin "Reset Database (Debug)" action** (`src/admin/cleanup-tab.js`, `src/admin/shared.js`) — for local/dev cleanup: deletes every room (cascading to files/comments/revisions/share links/codes/seen-devices/edit-tokens) plus reports and the rate-limit log, leaving admin accounts and the audit log untouched. Gated behind `_adminTypedConfirm` (a typed confirmation phrase, not just yes/no) given how destructive and broad this is — not scoped to the admin's own rooms.

### Phase 42 — Editor polish: scroll sync, navigation, context menu, comments, cursor, code blocks, file insertion

A batch of editor UX fixes and small features, verified both by direct code tracing/Node scripts and a full manual pass in a live browser session (every item below confirmed working with zero console errors).

#### Added
- **Sync scroll setting** (`src/app/state.js`, `index.html`, `src/app/editor-behavior.js`): a new Editor-preferences toggle (on by default, matching prior always-on behavior) that gates Split mode's Write/Live proportional scroll sync — both the CM6 path (`live-editor.js`'s `wireScrollSync`/`unwireScrollSync`) and the non-live rendered-HTML fallback path (`ui/editor.js`, which gained matching `wireScrollSync`/`unwireScrollSync`/`setSplitScrollSync` exports). Takes effect immediately on toggle, not just on the next mode switch.
- **Insert file/image from the Files panel into the note** (`src/ui/panels.js`, `src/app/files-panel.js`, `src/file-preview.js`): a new per-file "Insert" action reusing the existing `syncpad-file:` URL scheme — image files insert as `![...]`, everything else as a plain `[...]` link, using the same image-vs-generic detection (`_isImage`/`_ext`, now exported) the preview modal already relies on.

#### Fixed
- **Fenced code block inside a list item silently dropped every line but the first** (`src/markdown.js`). `@lezer/markdown` emits one `CodeText` sibling per line in that context (unlike a top-level fence's single contiguous `CodeText`) — the renderer only ever read the first via `getChild()`. Now collects and joins every `CodeText` child.
- **HTML comments (`<!-- ... -->`) rendered as visible escaped text** instead of being invisible (`src/markdown.js`). Split the combined `HTMLTag`/`CommentBlock`/`ProcessingInstructionBlock` case: stray literal HTML tags still render as escaped visible text (no interpretation, unchanged), but both the block-level `CommentBlock` and the distinct inline `Comment` node now render as nothing.
- **Double upload on drag-and-drop**: dropping an image onto the Write-mode textarea fired two separate `drop` listeners — the image-insert handler in `editor-behavior.js` and the generic upload-zone handler in `ui/editor.js`'s `setFileHandlers` — since `#note-editor` is a descendant of `.editor-area`. Added `e.stopPropagation()` to the inner handler.
- **TOC and footnote links only jumped instantly**, not smoothly (`styles/editor.css`): added `scroll-behavior: smooth` to `.note-preview` and `.note-live .cm-scroller` (respecting `prefers-reduced-motion`). The anchors themselves were already real, working `#id` links — this was a pure CSS easing gap, not a broken-navigation one.
- **Context menu simplified**: removed the redundant "Copy as plain text" action and the six formatting actions (bold/italic/strikethrough/highlight/code/link) — all already one click away on the always-visible toolbar. "Copy" is now the single, context-aware action: it copies a raw-markdown-source slice in Write/Live/Split (unchanged), and — a latent bug fixed along the way — correctly reads `window.getSelection()` when the plain rendered `#note-preview` fallback is the visible surface, instead of silently reading the hidden textarea's stale selection. Added a touch-target sizing pass (`@media (pointer: coarse)`) for the shorter, now more mobile-native-feeling menu.
- **Comment-to-comment navigation jumped instantly and fully rebuilt its DOM every click** (`src/ui/collab.js`, `styles/editor.css`). `renderFloatingComments()` now reuses the existing bubble element across Prev/Next navigation (confirmed via same-node identity) with a `top` transition, rather than tearing it down and rebuilding from scratch. Along the way, fixed an incidental bug where the bubble inherited a keyframe animation authored for the unrelated `.comment-floating-composer`, permanently overwriting its resting `transform` once the animation finished.
- **Cursor/caret sometimes invisible in the Live/Split (CM6) surface** (`src/live-editor.js`). Root cause: CM6's `drawSelection()` extension hides the native caret and drives its own via an infinite CSS blink animation that only restarts (from its visible phase) on a selection-changing transaction — if the tab is backgrounded and refocused mid-cycle, the animation can resume on its invisible phase and stay stuck there. Now forces a no-op reselect on window focus / tab-visible to restart the blink fresh (verified: the animation name reliably toggles on a simulated `visibilitychange`). Also added an explicit `caret-color` to the plain Write textarea as a defensive baseline (contrast across all 7 themes was already fine — this just removes any ambiguity).

#### Investigated, confirmed already correct — no change
- **Blockquote nesting**: traced 2- and 3-level nested blockquotes through the real parser/renderer (`_dequoteText`/`_renderFragmentBlocks` in `src/markdown.js`) and confirmed correct recursive rendering; also confirmed visually in a live browser session.
- **CM6's own right-click context menu**: already correctly shared via event bubbling through `.editor-wrap` — no separate/duplicate wiring, no `preventDefault()` blocking it.

#### Out of scope this round
Math/subscript/superscript/HTML formatting — raised as an open question rather than assumed; declined per explicit instruction, since real HTML pass-through would reverse `markdown.js`'s documented "never interpret raw HTML" security stance.

### Phase 41 — Doc-accuracy pass and test-suite repair

A full pass over the project: read the whole codebase, ran the test suite (159 of ~360 tests were failing), browsed every feature live in a browser, and audited every doc against current code. The docs and the test suite had each drifted independently from the app and from each other.

#### Fixed — test suite
- **Root cause of the bulk of the failures**: fresh rooms default to Live/Preview mode (`_resolveInitialEditorMode()`, `src/app/state.js`), which keeps `#note-editor` (the plain textarea most tests act on) hidden — Playwright's actionability checks refuse to `.click()`/`.fill()` a hidden element. Added `ensureWriteMode()` to `tests/helpers.js` and applied it across ~16 spec files.
- The app's custom `showPrompt()`/`showConfirm()` dialogs (`src/ui/dialogs.js`) are not native browser dialogs — `page.once('dialog', …)` never fires for them. Added `fillPromptDialog()` to `tests/helpers.js`.
- Roughly a dozen smaller per-file fixes: wrong element ids/selectors that had drifted from the real DOM (`#btn-templates` → `#tool-templates`, `#templates-list` → `.templates-list`), a strict-mode-violating `.panel-close` selector matching 7 elements, wrong assumptions about native Tab order vs. the app's own single-hop keyboard shortcuts, an async gap around template-apply needing a toast wait, and a Windows clipboard CRLF-normalization false failure.
- **`serve.json`'s SPA rewrite pointed at `/SyncPad/index.html`**, a path that doesn't exist on disk (the real file is `/index.html`) — silently broke `npx serve .` for anyone not using the project's own `tests/spa-server.js`, for who knows how long. Fixed the rewrite destination.
- **`editor-context-menu.spec.js`'s read-only-viewer test had a real race**, not a flaky one: it created a read-only share link and navigated to it before the 1 s debounced Postgres save (`src/sync.js`) had landed, so the freshly-loaded read-only view saw the room's stale (empty) body instead of what was just typed. Fixed by waiting for the save-status indicator to read "Saved" before creating the share link — the same race exists for a real user who shares a link immediately after typing, worth keeping in mind if it resurfaces elsewhere.
- Two full clean runs at the end of this pass: 353 passed, 0 hard failures, 5 flaky-but-pass-on-retry (real browser/animation-frame timing, not deterministically fixable), 7 skipped (gated behind optional migrations, as intended).

#### Fixed — real application bugs found along the way
- **`src/markdown.js`**: a link whose label text is itself the same bare URL (e.g. `[https://x.com](https://x.com)`) rendered as a duplicate nested `<a>` tag. Added `_unwrapRedundantAnchor()`.
- **`src/shortcuts.js`**: `Ctrl+/` unconditionally intercepted before the shift check below it, making `Ctrl+Shift+/` ("add comment") unreachable. Added a `&& !shift` guard.
- **`src/app/panels.js`**: the custom-templates modal held a one-time snapshot of `customs`; renaming or deleting a template updated localStorage but not the open modal, requiring a close/reopen to see the change. Now mutates the in-memory object alongside the localStorage write.
- **`src/app/panels.js`**: Search panel's dedicated Tab shortcut (search input → replace input, and back) fought the generic per-panel focus trap (`openPanel()` in `src/ui/panels.js`) — when Replace's buttons are disabled (no active search yet), `#replace-input` is also the trap's computed "last focusable," so the instant the dedicated handler moved focus there, the trap's own bubble-phase listener saw the same keydown and immediately wrapped focus back to the panel's first item, undoing the move. Fixed with `e.stopPropagation()` in the dedicated handler.
- **`src/app/comments-preview.js`**: two comments anchored to the same line (or close together) produced margin dots at an identical pixel position — `.comment-dot` has no horizontal spread (CSS: fixed `right: 6px`), so the later dot fully covered the earlier one, making it unclickable. `_refreshFloatingComments()` now enforces a minimum vertical gap between dots.
- **`src/files.js`**: `@supabase/supabase-js`'s `createSignedUrl(..., { download })` double-encodes special characters in the filename it builds into the URL's `download` query param — a file named `My Report (Final).txt` downloaded as literally `My Report %28Final%29.txt`, because the SDK's own encoding pass ran over an already-percent-encoded string. Since `download` is a plain, unsigned query param appended after the signed token (not part of the cryptographic signature), `getForceDownloadUrl()` now overwrites it with a correctly, singly-encoded value after the SDK call.

#### Fixed — docs
Rewrote `CLAUDE.md`, `README.md`, `docs/architecture.md`, `docs/playwright.md`, `docs/security.md`, `DEPLOYMENT.md`, and `RELEASE_CHECKLIST.md` against current code rather than patching individual stale lines: missing modules in the module tables (`rooms.js`, `live-editor.js`, `comments.js`, `revisions.js`, `offline.js`, and the two markdown-sharing helper files), an actively wrong keyboard shortcut in the README (`Ctrl+Shift+P` documented, `Alt+Shift+P` real), the admin dashboard's tab count (3 documented, 5 real), the theme count (5 documented, 7 real), a State Management section in `docs/architecture.md` that described a different, outdated architecture than the current shared-`state`-object pattern, a missing migration row in `DEPLOYMENT.md`'s optional-features table, and a stale `tests/playwright.md` file-count/helper-table. Theme picker itself intentionally left untouched throughout, per explicit instruction.

### Phase 40 — Close out the deliberately-not-done items from Phase 35/39

Branch: `claude/syncpad-review-fixes-180t01`

Four items flagged along the way in earlier phases as "known, real, but deliberately not addressed" — either out of scope for the pass that found them, or blocked by this environment's lack of CDN/live-database access. All four turned out to be tractable with more direct verification effort; addressed here.

#### Fixed
- **`tests/helpers.js`'s `createRoom()` waited on `window.__syncpadEventsWired`, a flag the app never set** (true of the pre-split monolith too — not introduced by Phase 39). `wireEvents()` (`src/app/wiring.js`) now sets it once its one-time DOM wiring finishes, matching exactly what the test helper already expected. Verified live: the flag is unset before `wireEvents()` runs and `true` immediately after.
- **Missing SRI hashes on CDN `<script>` tags** (`index.html`), flagged in Phase 35 as blocked by this environment's `cdn.jsdelivr.net` network policy. Worked around it: `registry.npmjs.org` is reachable, and jsdelivr's `/npm/` CDN serves files byte-identical to the published npm package — downloaded the exact tarballs (verified against the npm registry's own shasum), computed SHA-384 hashes locally (cross-checked with both `openssl` and Node's `crypto`), and added `integrity`/`crossorigin` to all four script tags. Along the way, found that `@supabase/supabase-js`'s `dist/umd/supabase.min.js` — the file `index.html` was actually requesting — has never existed in any 2.x npm release; jsdelivr was synthesizing it on the fly via its own minifier, which can't be independently reproduced to verify a hash against. Switched to the package's own published (and jsdelivr/unpkg-designated) `dist/umd/supabase.js` instead, and pinned the floating `@2` tag to an exact version (`@2.110.9`) so the hash can't silently stop matching a future release.
- **No rate limiting on anonymous room creation or report submission**, a known gap already documented in `docs/security.md`. Added `supabase/migrations/0010_anonymous_write_rate_limiting.sql` — a `BEFORE INSERT` trigger on both `syncpad_rooms` and `syncpad_room_reports`, in the same style as the existing room-lock/quarantine triggers, rate-limiting per device_id and (opportunistically, failing open if unavailable) per IP. Unlike everything else in this phase, this one is **not** self-verifying just by being merged — it's a migration the project owner must apply. But it's also the one piece of this whole session verified against a real, running Postgres instance rather than just read for correctness: found a local PostgreSQL 16 server already available in this environment, built the full schema from every prior migration plus minimal stubs for the Supabase-managed pieces (`auth.users`/`auth.uid()`, `storage.buckets`), and actually ran every code path — tripped both limits at the exact configured threshold, confirmed a second identifier is unaffected by the first's exhausted limit, confirmed the admin exemption bypasses an already-exhausted limit, confirmed the log-cleanup function deletes aged rows, and confirmed the IP-extraction helper's happy path plus two failure modes (malformed header JSON, missing header) all fail open rather than erroring. What that setup can't reproduce is Supabase's real edge/PostgREST layer — whether *this* project's `request.headers` actually contains `x-forwarded-for` the way the migration assumes remains genuinely unverified; the migration's own header spells out exactly what to check before trusting it in production. `src/rooms.js`'s `createRoom()`/`submitRoomReport()` now detect this specific trigger's error and surface its message directly instead of a generic "check your connection" one.
- **CM6 live-editor decorations vs. the static Lezer renderer**, flagged after Phase 38 as a *possible* future "parse once, render twice" unification. Investigated properly this time by reading all of `live-editor.js` rather than assuming: the framing doesn't actually hold up. CM6 needs an incremental parser wired into its own transaction system; the static renderer needs a one-shot parse of arbitrary text with no `EditorState` at all — neither can use the other's tree, so there's no real "twice" to eliminate. Most of `live-editor.js`'s tree-walking builds interactive, selection-aware decorations (reveal-while-touched, clickable checkboxes, live image loading) with no equivalent on the static-HTML side to share with. What *did* turn out to be genuinely, safely duplicated: `live-editor.js`'s `_tableAlignments()` and `markdown.js`'s `_tableAligns()` were near-identical pure functions, both parsing a GFM table's delimiter row into per-column alignment, with zero CM6/DOM dependency in either. Extracted into `src/markdown-table-utils.js`, used by both. Everything else stays as two separate, purpose-built implementations — forcing a deeper shared abstraction here would add real risk to the hot-path editor for cosmetic code reuse, not an actual architectural improvement.

### Phase 39 — Split `app.js` into `src/app/*.js`

Branch: `claude/syncpad-review-fixes-180t01`

`app.js` (4303 lines) was the last remaining monolith, explicitly deferred in Phase 36's `ui.js`/`admin.js` split as "a separate, larger effort" because of `wireEvents()`'s many helper closures. Split it into 14 focused modules under `src/app/`, following the same shared-mutable-`state`-object pattern already proven for `src/admin/state.js`:

- `state.js` — the shared `state` object, `BASE`, editor-preference localStorage keys, and the slash-menu item list.
- `routing.js` — URL route parsing, PWA "resume last room", recent-rooms list, and the Back/Forward-reload + root-link-suppress top-level listeners.
- `room-lifecycle.js` — `boot()`, the join flow, `startApp()`, realtime room-state transitions, the expiration timer, and `teardownRealtimeSession()`.
- `landing.js` — the landing screen and the contact form.
- `files-panel.js`, `editor-behavior.js`, `comments-preview.js`, `panels.js`, `header.js`, `tools-and-modals.js`, `export.js`, `command-palette.js` — one feature area each (files, editor typing/formatting/slash-menu/context-menu, comments + Write/Preview/Split mode, side panels, header/chrome, generic panel/modal wiring, export, command palette).
- `wiring.js` — the single orchestrator (`wireEvents()`) that wires every room-scoped DOM listener exactly once, plus the keyboard-shortcuts glue.
- `pwa.js` — service-worker registration and install-prompt wiring (side effects only).

`src/app.js` is now a 30-line entry point: wires the file-image resolver and the passcode/encryption auth-gate forms, then calls `boot()`.

Verified mechanically rather than by hand: a scripted word-boundary check confirmed all 143 top-level functions/consts from the original file have exactly one home in the new split (zero missing, zero duplicated); a live-browser check imported all 14 new modules and the real `app.js` entry point with zero resolution errors; two new Playwright checks confirmed the landing screen and contact page boot with zero uncaught errors; the full existing test suite was re-run against the split. No behavior changes — this is a mechanical reorganization, same as Phase 36.

Along the way, discovered (but left unfixed, out of scope for this refactor) that `tests/helpers.js`'s `createRoom()` waits on `window.__syncpadEventsWired === true`, a flag the app never actually sets (true of the original monolith too, not introduced by this split) — masked in this sandbox because `createRoom()` always skips earlier for lack of Supabase network access.

### Phase 38 — Rebuild `markdown.js` on the shared Lezer parse tree

Branch: `claude/syncpad-review-fixes-180t01`

`markdown.js` was a hand-rolled, line-oriented regex renderer maintained independently of the CM6 live editor's own Markdown parser (`@lezer/markdown`), which meant every syntax edge case had to be reasoned about and kept in sync twice. Rebuilt it to parse with the exact same Lezer grammar (including the shared `==highlight==` extension, now factored out into `src/markdown-highlight-extension.js` and imported by both `live-editor.js` and `markdown.js`) and render safe HTML by walking the resulting parse tree instead of scanning regex against raw lines.

Built and proved out as a staged, parallel module (`src/markdown-lezer.js`) first: verified byte-for-byte output parity against the old renderer across ~50 hand-built cases, every assertion in the existing Markdown test suite, and a companion-API check (`renderMarkdownWithToc`, `renderTocHtml`, `markdownToPlainText`, heading-id slugification) — surfacing and fixing 17 distinct tree-walking issues along the way (Lezer's "gap text" between marked-up child nodes needing explicit fill-in, reference-link resolution, GFM alert/table/list edge cases, heading-id slug source, footnote/blockquote checkbox-index alignment). One output is a real, disprovable divergence and stays that way on purpose: nested emphasis like `**bold *and italic* still bold**` now renders correctly per CommonMark, where the old regex-based renderer produced garbled markup — not treated as a bug to replicate.

With parity confirmed, swapped it in: `src/markdown.js`'s content is now the Lezer-based renderer (same exported API, so `app.js`/`file-preview.js` needed no changes), `src/markdown-lezer.js` and its Node-only parity harness (`tests/markdown-lezer-parity.mjs`) were removed now that there's only one implementation to compare against itself. Security posture is unchanged: every raw-HTML-shaped node (`HTMLBlock`/`HTMLTag`/`CommentBlock`/`ProcessingInstructionBlock`) still renders as literal escaped text, never interpreted, and link/image URLs still go through the same scheme allowlist.

### Phase 35 — Third-party audit verification pass

Branch: `claude/syncpad-review-fixes-180t01`

An external audit report was checked claim-by-claim against the current codebase and runtime behavior rather than applied at face value. Several of its headline findings (Markdown placeholder-collision, double-encoded link hrefs, event-listener leaks on room navigation, missing focus traps, uncaught `JSON.parse` in template export, unhandled offline service-worker rejections, missing mobile safe-area padding) turned out to already be fixed in this codebase — the audit appears to have been run against an older snapshot or without executing the code. Those are recorded as already-fixed/disproved rather than re-touched. The findings below were independently confirmed against current code and fixed.

#### Fixed
- **View-once consumption had a client-side read-then-write race.** `consumeViewOnce()` (`src/settings.js`) checked a client-held `room` snapshot's `viewed` flag, then issued an unconditional `UPDATE` — two viewers opening the same view-once link at nearly the same instant could both pass the check and both write. Added `consumeViewOnceAtomic()` (`src/rooms.js`), which conditions the `UPDATE` itself on `.eq('viewed', false)` and reports back whether *this* call's write actually matched a row, so only one of two racing consumers can ever win. New test in `tests/settings.spec.js`.
- **Reconnecting after an offline period could silently overwrite a remote edit.** Supabase Realtime does not replay `postgres_changes` events missed while a socket was disconnected, so the `online` handler's unconditional `flushSave()` had no way to know the room had changed server-side during the outage — it would just push the stale local queue over it. Added `reconcileAfterReconnect()` (`src/sync.js`), which the `online` handler now calls with a fresh `loadRoom()` result *before* flushing: if another device wrote to the room during the outage and its content differs from the editor, this shows the same pending-remote conflict notice already used for live conflicts, rather than silently overwriting the remote edit. New tests in `tests/room-errors.spec.js`.
- **Signed URL caches (`_urlCache`, `_downloadUrlCache` in `src/files.js`) grew unboundedly for the life of a tab.** Entries were only evicted on explicit file deletion; a long session previewing many distinct files would accumulate expired-but-never-removed entries. Both caches now sweep expired entries opportunistically on every lookup.
- **All 7 CSS themes' `--text-muted` token failed WCAG AA contrast** against their own panel backgrounds (as low as ~1.7:1 against a 4.5:1 requirement for normal text) — it's used throughout `styles/*.css` for real informative text (hints, timestamps, labels, descriptions), not just decorative content. Also fixed `--text-secondary` in the Forest Green and Mocha Dark themes, which fell just short (3.5–4.3:1). Adjusted lightness only (same hue/saturation) in `styles/base.css` so the fix stays visually consistent with each theme's palette; all 7 themes now meet ≥4.5:1 against every background variant they're used on (`--bg-surface`, `--bg-elevated`, `--bg-input`).
- `package.json`'s `repository.url` pointed at a local dev-proxy address (`http://local_proxy@127.0.0.1:.../git/Spairkie/SyncPad`) instead of the real GitHub URL.

#### Investigated, not changed
- **Hardcoded Supabase URL/anon key in `index.html`.** The key is a `sb_publishable_...` key — Supabase's public-by-design key format, meant to be embedded client-side; RLS (not key secrecy) is the actual access boundary. Working as intended, consistent with this project's documented "no build step, no `.env`" architecture (`CLAUDE.md` §2–4). Not a vulnerability.
- **Read-only links (`?mode=read`, `/share/:token`) are not server-enforced.** Already explicitly documented as a deliberate, previously-reverted tradeoff (see `supabase/migrations/0009_revert_edit_token_write_gating.sql` and `CLAUDE.md`'s "Common Gotchas"). Re-introducing edit-token gating would change security semantics and was previously reverted for causing lockouts — left as-is per this pass's scope (fix confirmed *bugs*, not re-open settled architectural tradeoffs).
- **Missing Subresource Integrity (SRI) hashes on CDN `<script>` tags.** Real gap, but this environment's network policy blocks outbound access to `cdn.jsdelivr.net`, so no hash could be computed against the actual pinned file bytes — shipping a guessed/wrong hash would break script loading for every user, which is worse than the status quo. Left for a follow-up pass with CDN access; hashes should be computed with `openssl dgst -sha384` against the exact pinned URLs in `index.html`.
- **`src/ui.js` is a large (~110 KB) single file mixing many UI concerns.** Confirmed a real maintainability smell, but splitting it is a large, high-blast-radius refactor with no behavior change to show for it — out of scope for a bug-fix pass; recommended as separate follow-up work.
- **No application-level rate limiting on anonymous room/report creation.** Already documented as a known gap in `docs/security.md`; addressing it (edge function + CAPTCHA, or Supabase-level throttling) is a new feature, not a bug fix.

### Phase 36 — Modularize `ui.js`/`admin.js`, consolidate `app.js` state

Branch: `claude/syncpad-review-fixes-180t01`

Split the two largest files into per-domain modules (`src/ui/*.js`, `src/admin/*.js`), each with a thin barrel/entry point so every existing call site kept working unchanged. Also consolidated `app.js`'s ~40 scattered module-level `let`s into a single `state` object, matching the pattern used for `admin.js`'s dashboard state — preparatory groundwork for a possible future split of `app.js` itself, not attempted here since `wireEvents()`'s many helper closures make that a separate, larger effort.

#### Fixed (found by automated PR review — P1, both in the `ui.js` split above)
- **`ui/core.js` dropped `_footerTimeFormatter`/`_footerClockTimer`** during the split — both were declared at the top of the former monolithic `ui.js` but never carried over, so `initFooterClock()` (called by every room's `wireEvents()`) threw a `ReferenceError` and aborted room startup. Restored both declarations in `ui/core.js`.
- **`service-worker.js`'s `PRECACHE_ASSETS` still listed only `src/ui.js` and `src/admin.js`**, not any of the new `ui/*.js`/`admin/*.js` files — an offline PWA launch before another online service-worker-controlled load could 503 on any of them, breaking `app.js`'s module graph. Added all 15 new module paths; bumped cache to `syncpad-v38`.

### Phase 37 — Merge cursor chat into Comments

Branch: `claude/syncpad-review-fixes-180t01`

Cursor chat (an ephemeral, viewport-anchored, broadcast-only message near a caret — never persisted, no independent lifetime) and Comments (a persisted, text-range-anchored annotation, side-panel only) were two separate features with overlapping UI (both opened a small floating input near the caret). Merged them into one: Comments is now the single annotation type, addable either from the side panel or from a floating composer opened right at the current selection — the same trigger surface (FAB, `Ctrl/⌘ + Shift + /`, editor context menu's "Add comment") cursor chat used, but submitting now always persists a real anchored comment instead of broadcasting an ephemeral one. Existing comments also gained a floating display: clicking a margin dot expands a bubble with the full text/author, plus Prev/Next navigation between comments (from either the bubble or the side panel header) — cursor chat's floating/ephemeral polish, applied to comments' persistence and cross-device visibility (comments' own realtime `postgres_changes` subscription already shows new ones live, making cursor chat's separate broadcast channel and emoji quick-react redundant — both removed).

- `src/live-broadcast.js`: removed `broadcastCursorChat()`/`broadcastCursorChatReaction()` and the `cursor_chat`/`cursor_chat_reaction` broadcast events.
- `src/ui/collab.js`: replaced the ephemeral cursor-chat bubble/composer (`showCursorChatBubble`, `addCursorChatReaction`, fade timers, emoji quick-react) with `openFloatingCommentComposer()`/`closeFloatingCommentComposer()` (renamed, now always persists) and `renderFloatingComments()` (margin dots + one expandable bubble with Prev/Next/delete, replacing `renderCommentMargin()`).
- `src/app.js`: `_openCursorChatComposer()` → `_openFloatingCommentComposer()`, now anchors to the current selection (not just caret) and submits via the existing `_submitComment()` path; added `_toggleCommentBubble()`/`_navigateComment()`/`state.activeCommentId` for the floating bubble's open/collapse and Prev/Next; the editor context menu's "Add comment" now opens the floating composer directly instead of the side panel.
- `index.html`/CSS: `#btn-cursor-chat-fab` → `#btn-add-comment-fab` (now `data-readonly-hide`, matching other edit-only actions), `#cursor-chat-layer` → `#comment-floating-layer`, Prev/Next buttons added to the Comments panel header.
- `tests/cursor-chat.spec.js` removed; its coverage folded into `tests/comments.spec.js` (composer, bubble expand/collapse, navigation, delete) and `tests/editor-context-menu.spec.js`/`tests/shortcuts.spec.js` (updated for the new floating-composer behavior).

### Phase 34 — Pre-user-testing push: scroll sync, default mode, Find, TOC, cross-mode feature parity, device count

Branch: `claude/codebase-review-testing-fjicqa`

#### Fixed
- **Phantom scroll in Split mode.** `wireScrollSync()`'s bidirectional sync guarded re-entrancy with a boolean `lock` cleared on the next animation frame — a timing race, not a real guard, since a `scrollTop` write's resulting `scroll` event is dispatched by the browser on a schedule this code doesn't control. When that echo arrived after the lock had already cleared, it read as a fresh user scroll and bounced back to the other pane, visibly correcting both panes by a few pixels after every real scroll (and after every content reflow while typing). Fixed by comparing the actual target position against the current one (skip the write when already within 1px) instead of guessing about timing — a real scroll still propagates, but the echo it produces computes back to where the source pane already sits and becomes a no-op.
- **TOC widget links did nothing in Live/Split mode.** The `[TOC]` marker's rendered "Contents" list had `href="#"` with no handler — a deliberate "non-interactive" design choice made before this feature had click-to-jump behavior anywhere else in the surface. Wired a `mousedown` handler (fires before the editor's own focus-stealing) that moves the caret to the heading's position and scrolls it into view, matching the same `EditorView.scrollIntoView` primitive "Follow" mode already used.
- **Find & Replace only worked in Write mode.** `_jumpToMatch()` force-switched back to Write mode whenever a match was found in Preview mode, because its selection/scroll logic only knew how to manipulate the (in Preview, hidden) plain textarea — every Enter/Next in the search box fought the user's chosen mode. Added `LiveEditor.setSelection()` (the CM6 counterpart of setting `selectionStart`/`selectionEnd` + `scrollTop`) and routed match highlighting through it when the live surface is mounted; Split mode is unaffected since its textarea stays visible and already worked.
- **Timestamp insert, pasted/dropped image insert, and template "insert at cursor" only landed correctly in Write mode.** All three went through `UI.insertAtCursor()`, which unconditionally targets the plain textarea's (possibly stale, and in Preview mode invisible) selection — the insert would land in the DOM but not where the user was actually looking. Added `_insertTextAtActiveCursor()`, which mirrors the same "use the CM6 proxy when Preview is active or the live pane has focus" check the toolbar formatting helper (`_applyFormatToActiveSurface`) already used, and switched all three call sites to it.
- **Escape in the Find/Replace panel refocused the textarea even when it was hidden** (Preview mode) — added `_focusActiveEditorSurface()` and used it in place of the two blind `editor?.focus()` calls.
- Audited the remaining cursor-position-dependent features (cursor chat, right-click context-menu formatting/comment, presence cursor-line tracking) — all were already routed through the existing live-vs-textarea checks (`_currentSelectionRange()`, `_onLiveCursorActivity`, `_openCursorChatComposer`'s own `live` branch) and needed no change.
- **Connected-device count could stay stale after a real tab close.** Presence cleanup (`destroyPresence()`/`untrack()`) only ran on `beforeunload`, which mobile Safari/iOS (including this app's installed-PWA path) is documented to skip or delay on a genuine tab close/background rather than a navigation — until the WebSocket eventually times out server-side, that device keeps counting as connected. Added the same cleanup on `pagehide`, the more reliably-fired modern sibling event; registering both is safe since `destroyPresence()` no-ops once already torn down.

#### Changed
- **Default editor mode is now Live (Preview), not Write/Source, and the choice is remembered.** `_applyMarkdownMode()` persists whichever mode (`write`/`preview`/`split`) is switched to under `syncpad_editor_mode`; a room applies that remembered mode once its content has actually loaded (mounting the live surface needs real content, so this can't happen before `setContentNoSave()`), defaulting new users to Preview. Room-navigation teardown still resets the in-memory mode to a content-independent `write` placeholder for the loading screen, but that's no longer the mode the next room actually opens into.
- Reviewed the full set of locally-remembered preferences (theme, monospace, strip-paste, smart punctuation, focus mode, typewriter mode, hide-presence, device name, recent/last room) against the new editor-mode preference above — the existing set already covers the durable, cross-session choices worth remembering; per-room/per-search state (case-sensitive search, follow-device, panel open state) is correctly left un-persisted since it isn't a "preference" so much as session-local context.

#### Phase 34 follow-up: self-review caught two gaps the fixes above hadn't closed

- **A room opening straight into Live mode left keyboard focus on the now-invisible Write textarea.** `startApp()`'s initial-focus call (`if (!isMobile() && !_isReadOnly) UI.focusEditor()`) unconditionally targeted `#note-editor` — harmless while every room always opened in Write, but once "Default editor mode is now Live" (above) made Preview a real starting mode, this call would silently focus a `display: none` element, leaving no visible caret anywhere until the user clicked in. Switched to the `_focusActiveEditorSurface()` helper from the Escape-key fix above, which already knows to focus the live surface when Preview is active.
- **Pasting or dropping an image did nothing while the live surface had focus** — true in Preview always, and in Split whenever the live pane (rather than the textarea) had focus. `_insertTextAtActiveCursor()` fixed where an uploaded image's markdown *lands*, but the upload was never triggered in the first place: the paste/dragover/drop listeners that call `_uploadAndInsertImages()` are bound to `#note-editor` specifically (`editor.addEventListener('paste', …)` etc. in `_wireEditorToolbarAndLifecycle()`), so they simply never see an event whose target is inside the CM6 surface instead. Added matching `paste`/`dragover`/`drop` handlers directly on the CM6 view via `EditorView.domEventHandlers` (a new `onImageFiles` mount option), extracting image files from the clipboard/drag payload and routing them through the same `_uploadAndInsertImages()` path — CM6 itself has no useful default behavior for an image-only paste (no text representation to insert), so leaving this unhandled meant a silent no-op rather than an error.

### Phase 33 — Follow-up: fix emoji-shortcode mis-coloring from Phase 32

Branch: `claude/codebase-review-testing-fjicqa`

#### Fixed
- **Unconverted emoji shortcodes (`:smile:`) no longer pick up string-literal coloring in Live/Split mode.** `markdownLanguage`'s own built-in Emoji extension tags a shortcode match with `tags.character`, which `@lezer/highlight` defines as a sub-tag of `tags.string` (`character: t(string)`) — so Phase 32's new string-highlighting rule was inheriting onto it too, visibly (mis)coloring literal, still-unconverted shortcode text (shortcodes remain unsupported by design; see "Emoji" in `docs/markdown-feature-audit.md`) as if it were a real string. Fixed with an explicit, more-specific `{ tag: tags.character, color: 'inherit' }` override — real string/char content in the 5 supported code languages is unaffected (none of them use `tags.character` for their own literals). New test in `tests/live-editor-rendering.spec.js`.
- Investigated a second, related-looking case (raw HTML typed directly in prose, e.g. `<div>…</div>` as a literal example, picking up the same tag-name coloring `​```html` fenced blocks need) and determined it's not fixable the same way — traced to `markdownLanguage` itself nesting an HTML grammar for raw HTML content independent of this feature (only the color is new; the parse already existed), with no tag-hierarchy distinction available between "fenced code" and "prose" instances of the same tag. Documented as an accepted, non-breaking side effect in `docs/markdown-feature-audit.md` rather than risking a fragile ancestor-aware decoration override for a cosmetic edge case — the literal-text and never-executes safety properties both still hold.

### Phase 32 — Syntax highlighting for fenced code blocks in Live/Split mode

Branch: `claude/codebase-review-testing-fjicqa`

#### Added
- **Real syntax highlighting for fenced code blocks in the CM6 Live/Split surface**, closing the one known gap flagged after Phase 30's table/alert/footnote rendering fixes — a `js`/`python`/`json`/`html`/`css`/`bash` code block previously showed as plain monospace text with no token coloring in Live/Split mode, unlike the static export/Preview-fallback path (Prism.js). Vendored `@codemirror/lang-javascript`, `-python`, `-json`, `-html`, `-css`, and `@codemirror/legacy-modes`' shell mode into `vendor/codemirror.js`, wired through `markdown()`'s `codeLanguages` option (maps a fence's info string — `js`, `ts`, `jsx`, `tsx`, `py`, `json`, `html`, `xml`, `css`, `sh`, `bash`, `zsh` — to the right language parser; anything else keeps the previous plain-text behavior).
- Extended the live surface's shared `HighlightStyle` to cover the standard `@lezer/highlight` token tags (keyword, string, number, comment, function, operator, …) using the exact same `--syntax-string`/`--syntax-number`/`--syntax-fn`/`--syntax-regex` CSS variables `panels.css` already uses for the static renderer's Prism-highlighted code — a code block looks color-consistent whichever surface it's viewed in.
- Fenced code blocks also gained a background box (`.cm-md-codeblock`) matching the classic renderer's `<pre>` styling — a new `FencedCode` case in the seamless-decoration walk applies a per-line background/border class across the block (rounded corners on the first/last line) rather than wrapping a block element, since the lines need to stay individually editable.
- Verified against the full markdown feature-test document again (screenshot + a fresh full-document render pass) — no regressions in any of the other 33 sections; two harmless, expected side effects noted (not fixed, not bugs): raw HTML typed directly in prose (section 11's `<div>`/`<script>` example) and a literal `:smile:`-shaped run of text (section 18) now pick up incidental tag/string coloring from the same shared `HighlightStyle`, since those node types were already being parsed by the base grammar before this change — only the color mapping is new, and neither affects the actual rendering-safety or literalness guarantees those sections test for.
- New tests in `tests/live-editor-rendering.spec.js`: a language-tagged fence produces highlighted token spans and the new background-box class; a bare fence (no language) stays plain, exactly as before.

### Phase 31 — Fresh production DB baseline SQL script

Branch: `claude/codebase-review-testing-fjicqa`

#### Added
- **`supabase/baseline.sql`** — the complete current schema (tables, functions, triggers, RLS policies, Storage bucket + policies) for a brand-new Supabase project, generated by concatenating `0001`, `0002`, `0003`, `0004`, `0005`, `0006`, and `0008` from `supabase/migrations/` — `0007` (the reverted edit-token model) and `0009` (only relevant to a project that ran `0007`) are deliberately excluded, since a fresh project needs neither. One paste into the Supabase SQL Editor, one run, instead of working through 7 separate files and the historical "do I need 0007/0009?" question.
- **Verified against a real Postgres server, not just assembled.** Installed and ran a local Postgres 16 (`service postgresql start`), stubbed the minimal `auth`/`storage` schemas and `anon`/`authenticated` roles the SQL assumes exist (Supabase-specific, not present in vanilla Postgres), then ran the generated file twice in a row with `ON_ERROR_STOP=1` — zero errors either time. This confirms both that the concatenation is syntactically sound (no cross-file dollar-quote or statement-boundary mistakes from the merge) and that the whole file is genuinely idempotent end-to-end, not just each source migration individually.
- The numbered migrations in `supabase/migrations/` remain the source of truth and the path for existing deployments picking up one new feature at a time; `baseline.sql` is regenerated from them, not maintained by hand.
- Fixed a stale comment in `0006_admin_dashboard_improvements.sql` pointing at the since-reverted `0007_room_edit_tokens.sql` for server-side quarantine enforcement — it now correctly points at `0008_quarantine_enforcement.sql`, which is what actually implements that (a `BEFORE UPDATE` trigger, added after `0006` was originally written). Comment-only change to an already-idempotent migration; no schema impact.
- `DEPLOYMENT.md`'s Step 2 restructured around this: a "brand-new project? run one file" path leading with `baseline.sql`, and an "existing project? use the numbered migrations" path for incremental updates.

### Phase 30 — Fix Live/Split surface: tables, GFM alerts, and footnotes weren't rendering

Branch: `claude/codebase-review-testing-fjicqa`

#### Fixed
- **Diagnosed the reported "markdown rendering is broken" issue on Live/Split/Preview mode.** Root cause: `live-editor.js`'s CM6 WYSIWYG surface is a *separate* rendering path from `markdown.js`'s static `renderMarkdown()` — it decorates the plain-markdown source directly rather than producing HTML — and three features had no decoration logic there at all, so they rendered as literal, unstyled markdown syntax instead of the formatted output the static export/PDF/copy-as-HTML paths already produced correctly:
  - **GFM tables** (`| a | b |`) showed as plain pipe-delimited text lines with no grid, borders, or column alignment.
  - **GitHub-style alerts** (`> [!NOTE]`/`[!TIP]`/`[!IMPORTANT]`/`[!WARNING]`/`[!CAUTION]`) showed as a plain blockquote with the literal `[!NOTE]` marker text visible, no colour, icon, or label.
  - **Footnotes** (`[^1]`) showed as literal bracket-caret text, no superscript, no visual distinction from the surrounding sentence.
  - Confirmed via a byte-for-byte diff against a prior "golden" HTML export of the project's own markdown feature-test document (matched almost exactly, save for two checkbox states explained by manual toggle-testing) — proving the *static* renderer (`markdown.js`) was already correct, and isolating the bug entirely to the CM6 live surface most users actually see day-to-day (Preview/Split mode mount the live surface whenever it mounts successfully, which is virtually always).
- **Tables** now render as a real `<table>` — a `_tableField` `StateField` (block-replace decorations can only come from a StateField, not the existing `_seamless` `ViewPlugin` — "Block decorations may not be specified via plugins") walks the `Table`/`TableHeader`/`TableRow`/`TableCell`/`TableDelimiter` nodes `markdownLanguage` was already parsing (the same GFM extension task lists and strikethrough come from) and swaps the whole block for a built `<table>` with correct column alignment, following the same "reveal raw markdown while the selection touches it" pattern already used for images/horizontal rules. Recomputed on every transaction (not just doc changes) since whether a table shows as a widget or its raw syntax depends on the selection.
- **GFM alerts** now render as a coloured, icon-labelled box matching the static renderer's `.md-alert` styling exactly (same icons/colours per kind) — detected by matching a blockquote's first line against the five alert kinds; the `[!NOTE]` marker (which parses as an ordinary unresolved shortcut-reference `Link` node, since GFM alerts aren't part of the base grammar either) is replaced with an icon+label widget.
- **Footnotes** get a superscript reference marker inline and a small bold label on the definition line — not a full relocated "Footnotes" section (this is an editable surface; moving text out of document order would fight the person editing it, unlike the read-only static export, which already does exactly that).
- **Reference-style link labels** (`[text][ref1]`, including the collapsed `[text][]` form) now fold away in Live/Split the same way inline `[text](url)` links already did — found during a full visual pass over the feature-test document after the fixes above. `LinkLabel` (the `[ref1]` part of a reference *usage*) wasn't in the existing generic mark-hiding case, which only knew about `LinkMark`/`URL`; added it there rather than as a new special case, since the same "walk up to find the enclosing Link/Image, hide if not" logic already applies correctly — a reference *definition* line's own `[id]:` uses the same `LinkLabel` node type but under `LinkReference`, not `Link`, so that walk naturally leaves it alone and its label stays visible.
- New `tests/live-editor-rendering.spec.js` covers all four fixes plus the click-to-reveal-raw-source interaction.

### Phase 29 — Slash-command quick-insert menu, emoji quick-react on cursor chat

Branch: `claude/codebase-review-testing-fjicqa`

#### Added
- **Slash-command quick-insert menu.** Typing `/` at the start of a line in Write mode (start of the doc, or right after a newline/space/tab — so `and/or` mid-word never triggers it) opens a small filterable popup anchored at the caret, listing every block-level formatting action already reachable via the toolbar/context menu (headings, bold/italic/strikethrough/highlight/code, code block, link, quote, bullet/numbered/checklist list, divider, table of contents) plus Insert timestamp and Insert template. Typing after the `/` filters the list by label or keyword; Up/Down moves the selection, Enter or Tab confirms, Escape or a space in the query closes it. Selecting an item deletes the `/query` text and reuses the existing `_applyMarkdownFormat()` action registry (or `insertTimestamp()` / the templates modal for the two non-formatting entries) — no new insertion logic, just a faster way to reach what already existed. New `checklist` action (`- [ ] `) added to that registry as part of this, since it didn't have a toolbar/menu entry before. Positioning reuses `UI.getCaretViewportCoords()`, the same mirror-div caret measurement cursor chat and comment margin dots already rely on. Scoped to Write mode for now — Live/Split would need the CM6 coordinate equivalent wired up separately.
- **Emoji quick-react on cursor-chat bubbles.** Hovering (or focusing) any visible cursor-chat bubble — yours or a remote one — reveals a small 👍 ❤️ 😂 🎉 👀 row; clicking one broadcasts a reaction tied to that message's id over the same ephemeral Broadcast channel cursor chat itself uses (`cursor_chat_reaction`, never persisted). The reacted-to bubble shows the emoji as a small fading badge, both for the reactor (optimistic local echo — Realtime's `self:false` means a reactor never receives its own broadcast back) and for anyone else still looking at that bubble when the reaction arrives; a bubble that already faded locally simply has nothing to attach the badge to, consistent with cursor chat's existing "ephemeral, best-effort" design. `broadcastCursorChat()` now returns the message id it generated so the sender's own local bubble echo can be reacted to the same way a received one can. No permission gate, matching cursor chat itself — neither writes to the note.

### Phase 28 — Recent rooms list on landing

Branch: `claude/codebase-review-testing-fjicqa`

#### Added
- **Recent rooms list on the landing page.** The last 8 rooms visited on this device now appear below the join box (room name or, if unnamed, the room id, plus a relative visit timestamp), letting a returning visitor jump back into a room without remembering or retyping its id/link. Backed by a plain `localStorage` array (`syncpad_recent_rooms`) written on every `joinRoom()` regardless of read-only/editable status — this is safe to persist unconditionally now that `room_id` alone is a write credential again (Phase 26), so there's no token to leak by keeping more local history than before. Each entry has an inline "×" remove button; the whole section is hidden when the list is empty. This is a local, this-device-only convenience, distinct from the existing single-slot PWA "last room" resume feature.

### Phase 27 — Floating cursor chat, inline comment margin dots, footer/tools decluttering

Branch: `claude/codebase-review-testing-fjicqa`

#### Added
- **Comment margin dots.** A small marker now appears in the editor's margin at each comment's anchor line, so comments are visible while scrolling instead of only discoverable by opening the side panel. Reuses the exact offset-to-pixel machinery already built for cursor chat — `UI.getCaretViewportCoords()` (mirror-div, Write mode) and `LiveEditor.coordsAtPos()` (CM6, Preview/Split) — converted to `.editor-wrap`-relative coordinates so the dots live inside the card and get naturally clipped when their anchor scrolls out of view. Recomputed on comment load, mode switch, editor scroll/input (debounced), CM6 scroller scroll, and window resize. Clicking a dot reuses the existing `_jumpToComment()` jump-to-anchor logic the side panel's own "jump" button already had.
- **Cursor chat is now a floating action button** anchored to the bottom-right of the editor pane (`#btn-cursor-chat-fab`) instead of a footer button — spatially close to whatever's on screen regardless of scroll position, and visually distinct as a live-collaboration action rather than a generic utility button. `Ctrl+Shift+/` is unaffected.

#### Removed
- **"Copy Note" removed from the footer.** The action itself is unchanged and still reachable via the command palette and `Ctrl+Shift+C` — `_copyNoteToClipboard()` extracted as a shared function so both call sites use the same logic instead of one delegating to a footer button click.
- **"Copy Link" and "Paste" removed from the Tools panel.** Paste mostly duplicated native Ctrl+V/long-press paste, which already works the moment the editor is focused, and `navigator.clipboard.readText()`'s permission prompt could be more friction than just pasting normally. Copy Link is redundant now that the Share modal and clicking the room title in the header both already copy the same URL. Removed their command-palette entries too (`copy-link`, `paste`).

The footer now holds a single utility button (Insert Timestamp); the Tools panel's Clipboard section is gone entirely (its remaining content moved up).

### Phase 26 — Revert edit-token write gating: room_id is a write credential again

Branch: `claude/codebase-review-testing-fjicqa`

#### Changed
- **Reverted the Phase 21 edit-token model.** `room_id` + the anon key is sufficient to write to a room again — a plain link (typed, bookmarked, or shared) is directly editable, same as the app's original design, and matches the create-on-visit behavior restored in Phase 24. `?mode=read` and `/share/:token` remain read-only in the app's own UI, but that's a UI/UX convention again, not a server-enforced boundary: a read-only visitor necessarily learns `room_id` from viewing the room's content, so a technical visitor could still call the write path directly. Room lock (`editing_locked`) remains the one control that's genuinely server-enforced regardless of how the write is attempted, and is the right tool for a room that actually needs to be uneditable.
  - The reasoning, in short: the edit-token model closed a real gap (a "read-only" link's read-only status wasn't previously enforced server-side), but its cost — permanent lockout on a lost token with no recovery path, no cross-device/cross-browser persistence, and a migration dependency that broke a live deployment on its first real use (`gen_random_bytes` schema issue, fixed and then reverted in the same day) — outweighed that benefit for a project that was never meant to hold sensitive data to begin with. Reported directly: "what happens if they lose the token… can we just have `/roomname` be editable without needing the token, and rely on locking to restrict it if needed."
  - `src/rooms.js`: `createRoom()`, `saveContent()`, `updateRoomDisplayName()`, `updateRoomSettings()`, `updateRoom()`, and `clearRoomContent()` all revert to direct `.from('syncpad_rooms')` insert/update calls instead of routing through the `rpc_update_room()`/`create_room_with_edit_token()` RPCs. `settings.js`'s `consumeViewOnce()` reverts to a plain `updateRoom()` call too, since a view-once reader no longer needs a narrow RPC to bypass a token check that doesn't exist anymore.
  - `src/app.js`: `joinRoom()` drops all edit-token verification — editability is now purely `forcedReadOnly` (whether the route was `?mode=read`/`/share/:token`), independent of any URL parameter. The Share modal's "editable" link is the room's plain URL again. PWA last-room resume no longer needs to persist a token alongside the room id.
  - **`supabase/migrations/0009_revert_edit_token_write_gating.sql`** (new) restores the four anon/authenticated INSERT/UPDATE policies on `syncpad_rooms` that `0007` had dropped. Only needed by projects that already applied `0007`; a fresh project never needs to run `0007` or `0009` — `0001` alone is sufficient now. `0007`'s table and RPCs are left in place, inert, rather than dropped.
  - **`supabase/migrations/0008_quarantine_enforcement.sql` rewritten** from an `rpc_update_room()` redefinition to an independent `BEFORE UPDATE` trigger (`enforce_syncpad_rooms_quarantine`), the same technique `0001`'s room-lock trigger already uses. It had to change: its original form only fired when the client called `rpc_update_room()`, which the client no longer does after this revert — the trigger form works regardless of which write path is used, and doesn't depend on `0007` at all anymore (only `0006`, for the `quarantined_at` column).
  - Docs updated throughout (`README.md`, `CLAUDE.md`, `DEPLOYMENT.md`, `docs/security.md`) to move "read-only links" back to frontend-only/UX-convention framing, and room lock forward as the one real server-enforced guarantee.

### Phase 24 — Fix production RPC failure, restore create-on-visit for unclaimed room URLs

Branch: `claude/codebase-review-testing-fjicqa`

#### Fixed
- **`create_room_with_edit_token()` failed on every real deployment with `function gen_random_bytes(integer) does not exist` (Postgres `42883`)**, confirmed against a live site's browser console after all 8 migrations were applied cleanly. Root cause: Supabase installs `pgcrypto` into an `extensions` schema by default, not `public`; the function pinned `search_path = public` only (correct hardening for a `SECURITY DEFINER` function), which hid `gen_random_bytes()` from it. Fixed by adding `extensions` to that one function's search_path — Supabase's own documented pattern for this exact situation, and safe here since only privileged roles can create objects in `extensions`, so it doesn't reopen the hijacking risk the `public`-only pinning was guarding against. Scoped: grepped every migration and confirmed no other function calls a non-core pgcrypto function (everything else uses `gen_random_uuid()`, native to Postgres 13+).
- **Visiting a URL for a room that doesn't exist yet went back to showing "Room not found" instead of creating it.** Phase 21's edit-token redesign disabled auto-create-on-visit everywhere except the landing page's Create Room button, out of excess caution — but that wasn't actually load-bearing for the security fix, and it broke the app's original "join by name" behavior (typing/following a URL for an unclaimed name creates and opens it, same as always). Two existing landing-page tests (`"Join room" input + button navigate to the typed room"`, its Enter-key variant) already asserted this and would have caught the regression if they could run against live Supabase in this sandbox. Restored in `joinRoom()`: a not-found room now falls through to `createRoom()` exactly like the Create Room button, *unless* the route is forced-read-only (`?mode=read`, `/share/:token`) — those still show "not found" rather than ever creating anything, since a stale/expired read-only link must never be usable to claim a fresh room. Also fixed a related gap the user's report specifically called out: a 6-character short code typed directly into the URL bar (not just the landing page's join box) is now resolved via `resolveRoomCode()` before falling back to treating it as a literal room name to create — previously only the join box did this resolution, so the same code in the URL path would have (after this fix) tried to create a room literally named after the code instead of finding the room it points to. `SHORT_CODE_RE` hoisted from a local closure to module scope so both entry points share one definition. New test: `"navigating directly to a URL for a room that does not exist creates and opens it"` in `tests/landing.spec.js`.

### Phase 23 — Cursor chat now works in Write mode too

Branch: `claude/codebase-review-testing-fjicqa`

#### Changed
- **Cursor chat works on every editing surface, not just Preview/Split.** Phase 22 disabled the footer button outside Live/Split because Write mode's plain `<textarea>` has no native API for "give me the screen pixel position of character offset N" the way CM6's `coordsAtPos()` does for the live surface. That measurement already existed for a different feature, though: Focus Mode and Typewriter Mode both position themselves via a mirror-div technique in `ui.js` (`_measureCaretPixelY`) that clones the textarea's computed font/padding/border onto an offscreen div and reads a marker's offset. Generalized it to `_measureCaretOffset()` (returns `{x, y}`, not just `y`) and added `getCaretViewportCoords(pos)`, which converts that into real viewport coordinates via `getBoundingClientRect()` — the Write-mode counterpart to `LiveEditor.coordsAtPos()`. `_openCursorChatComposer()` and the remote `onRemoteCursorChat` handler both now branch on which surface is actually visible instead of assuming CM6; `broadcastCursorChat` already sent a plain text offset rather than surface-specific coordinates, so this fixes sending *and* receiving in Write mode from a single change, with no wire-format changes. The footer button's `disabled` state, `setCursorChatButtonEnabled()`, and the associated CSS are removed as dead code now that it's always usable. Mode switches still clear any open composer/bubble (now unconditionally, not just when switching *to* Write) since a position measured on one surface doesn't carry over to another.

### Phase 22 — Selection context menu, focus indicator refinement, admin dashboard overhaul

Branch: `claude/codebase-review-testing-fjicqa`

#### Added
- **Right-click context menu on text selection.** Selecting text in the editor (Source, Live, or Split) and right-clicking now opens a small menu at the cursor — Add comment, Bold, Italic, Strikethrough, Highlight, Code, Link — instead of requiring a trip to the sidebar for every formatting action or comment. Only appears for a non-empty selection and only when the room is editable; closes on Escape, outside click, scroll, or resize. Shares the same `_applyMarkdownFormat` path as the toolbar and correctly targets whichever surface (Source textarea or the CodeMirror-backed Live/Split view) currently has the selection. Covered by `tests/editor-context-menu.spec.js`.
- **Room creation activity chart on the admin dashboard** — a 14-day bar chart of new-room counts (`_renderActivityChart()` in `admin.js`), single accent-colored series with a total-count header and a per-bar hover tooltip, no charting library. Two new stat cards: "Active today" (rooms updated in the last 24h, clickable — filters the Rooms tab the same way "Expired rooms" already did) and "Storage used" (sum of `syncpad_files.file_size`, summed client-side since PostgREST has no `SUM()` without a DB function). Every stat card now carries a small icon for faster scanning.
- **Comprehensive Markdown feature test document**, covering every Basic, Extended, and Hacks-page feature the renderer supports, generated for manually spot-checking rendering after future `markdown.js` changes.

#### Changed
- **Editor focus indicator narrowed to the top edge only.** Phase 19 gave the Live/Split surface a focus outline to match Source, but both used a full-ring `outline`, which reads as more prominent than intended for a "subtle" indicator. Replaced with `box-shadow: inset 0 2px 0 0 var(--accent)` on `#note-editor:focus-visible` and `.note-live:focus-within` — an accent line along the top edge only, on all three surfaces.
- **Cursor-chat footer button is now disabled outside Live/Split mode**, with its title explaining why, instead of staying clickable but silently inert in Source mode (`UI.setCursorChatButtonEnabled()`, called from `_applyMarkdownMode()`).
- **Footer "Copy" button relabeled "Copy Note"** to disambiguate from the per-file copy-link action and the Share modal's "Copy" buttons.

### Phase 21 — Real server-side read-only enforcement (edit tokens), SQL migration reorganization

Branch: `claude/codebase-review-testing-fjicqa`

#### Added
- **Room writes now require a separate edit token, not just `room_id`.** Previously, an editable and a read-only link for the same room resolved to the same `room_id`, and `room_id` alone was sufficient to write via the anon key — read-only was enforced only by a client-side flag (documented honestly in `docs/security.md`, but still bypassable by anyone calling the API directly). Closing this required breaking `room_id`'s dual role as both "what to view" and "what lets you write": `supabase/migrations/0007_room_edit_tokens.sql` adds a `syncpad_room_edit_tokens` table (issued once, at room creation, never re-readable afterward — deliberately its own table rather than a `syncpad_rooms` column, since Realtime's `postgres_changes` payloads bypass column-level grants entirely) plus `create_room_with_edit_token()`, `verify_edit_token()`, and `rpc_update_room()` — the one write path every room mutation now goes through. Direct anon/authenticated `UPDATE`/`INSERT` on `syncpad_rooms` is revoked.
  - The editable link is now `/SyncPad/<roomId>?et=<token>`; the plain link, `?mode=read`, `/share/:token`, and short codes are all read-only by construction. Losing the `?et=` link means permanently losing edit access — no recovery path, by design (the whole point).
  - View-once consumption gets its own narrow bypass RPC (`rpc_consume_view_once`) since a view-once *reader* is by definition not the creator and never holds an edit token — the entire feature depends on a non-token-holder being able to trigger the clear.
  - A follow-on migration (`0008_quarantine_enforcement.sql`) layers the same real-enforcement treatment onto the admin dashboard's quarantine feature, which had an identical "frontend-only" gap for the same underlying reason — closeable now that every write funnels through one RPC.
  - `rooms.js` holds the session's edit token as module-level state (mirroring `permissions.js`'s context pattern) so every other module's call sites (`sync.js`, `settings.js`) needed zero changes — only `rooms.js`'s internals and `app.js`'s URL/routing/Share-modal code changed.
  - Verified end-to-end against a stubbed Supabase backend in a real browser: create → editable + URL gets `?et=`; content persists via the RPC; the same room without `?et=` is read-only but still shows saved content; a wrong `?et=` falls back to read-only with an explanatory toast; visiting a nonexistent room directly no longer silently auto-creates it (only the "Create Room" button does); `?mode=read` still forces read-only even alongside a *valid* `?et=` — this last case caught a real ordering bug where `joinRoom()`'s own `teardownRealtimeSession()` reset `_isReadOnly` to `false` before it was read, silently defeating `?mode=read`/`/share/:token` on every navigation. Fixed by capturing the forced-read-only flag before teardown runs.

#### Changed
- **SQL migrations reorganized into `supabase/migrations/`, numbered by run order** (`0001_base_schema.sql` … `0008_quarantine_enforcement.sql`), replacing root-level `supabase-setup.sql` + `docs/migrations/*.sql`. Kept as separate files rather than merged into one — independently reviewable, keeps individual git history, and the number makes run-order unambiguous without a tracking table (the standard layout for a project without one, and the same path the Supabase CLI would use). `DEPLOYMENT.md` now documents `0001` and `0007` as both required (the app's frontend unconditionally calls RPCs `0007` creates) rather than lumping every migration under "optional."
- `docs/security.md`, `README.md`, `DEPLOYMENT.md`, `CLAUDE.md`: read-only links moved from "frontend-only" to "backend-enforced" throughout; added the edit-token-loss trade-off as a new, explicit Known Limitation.

### Phase 20 — Server-side lock enforcement, presence accuracy, Supabase setup docs, command palette

Branch: `claude/codebase-review-testing-fjicqa`

#### Fixed
- **Room lock was frontend-only, despite being the one permission control that could actually be enforced server-side.** Every other write-permission control (read-only links, `?mode=read`) is necessarily UX-only, because an editable and a read-only link for the same room share the same `room_id` and anon key — there's no separate credential to check. `editing_locked` is different: it's server-stored room state, not a property of which link someone followed. Added `enforce_syncpad_rooms_lock()`, a `BEFORE UPDATE` trigger on `syncpad_rooms` (in `supabase/migrations/0001_base_schema.sql`) that rejects any content change to a locked room regardless of what calls the API — exempting the backend expiry-cleanup job and signed-in admins, both of which need to override a lock. `docs/security.md`, `README.md`, and `DEPLOYMENT.md` updated to stop describing room lock as frontend-only.
- **The connected-devices panel misattributed its own "editor"/"viewer" badge when the same device had two tabs open on a room** (e.g. testing by opening the main link in one tab and its read-only link in another) — `presence.js`'s device-merge logic picked whichever tab's presence entry tracked *most recently* to decide the merged device's `read_only` flag, so opening a read-only tab could flip your own editable tab's badge to "viewer" in the panel. Changed to an AND-reduce across a device's tabs (can edit if *any* tab can), verified with an isolated presence-state simulation covering single-tab, same-device-two-tabs, and multi-device scenarios.
- **`tool-find` (Find in Tools panel) opened and then immediately closed the search panel in the same tick** — its handler ran through `toolActions`' blanket `closeAllPanels()` after every action, which undid the `openPanel('search-panel')` it had just called. The exact same bug the code's own comment already flagged as fixed for `tool-history`/`tool-comments`, just never applied to `tool-find` itself. Moved it out of `toolActions`, matching those two.
- **`shortcuts.js` had two leftover direct `editor.value`/`selectionStart`/`selectionEnd` writes** (`_wrapSelection`, `_insertLink`) that the Phase 18 editor-DOM-boundary migration missed because it was scoped to `app.js` only. Migrated both to `UI.replaceEditorRange()`.
- **DEPLOYMENT.md's setup steps never mentioned four of five optional feature migrations** (`short-room-codes.sql`, `room-comments.sql`, `version-history.sql`, `device-limit.sql`, `admin-dashboard-improvements.sql`) — a fresh Supabase project set up by following the docs literally would have short codes, comments, version history, device-limit rooms, and admin quarantine/audit-log all silently non-functional. Added a table listing every optional migration, what it enables, and the symptom if it's skipped. The Share modal's short-code error message now points directly at the migration file instead of a generic "check Supabase setup."
- **Two UI label-wrapping inconsistencies**: the Export modal's "Copy as HTML" row wrapped to two lines while every other row (including longer labels) stayed on one line — its sibling description text ("Copy rendered HTML to clipboard", the longest in the list) was crowding the label column in that row only, with no per-row consistency. Labels are now `flex-shrink: 0` in their own `.export-label` span; descriptions wrap instead, since they're secondary text. The new Command Palette's More-menu entry had the same issue, fixed by letting `#more-dropdown` size to its widest row instead of a fixed `min-width`.

#### Added
- **Command palette** (`Ctrl/⌘+K` outside the editor, or More menu → Command Palette): a searchable, keyboard-navigable list of ~30 app-wide actions — view modes, every panel, sharing, room lock, clear/export/import, and all 7 themes. Filtering is a plain token-substring match (`filterCommands()` in `utils.js`, deliberately not fuzzy-scored, for predictable results); rendering lives in `ui.js` (`renderCommandPaletteResults()`); the action registry lives in `app.js` and, where a guarded button already exists for an action (permission checks, confirm dialogs, toasts), runs it via the same button rather than re-implementing the guard. `Ctrl/⌘+K` stays "insert markdown link" inside the editor — same key, contextual, mirroring how `Ctrl+F` already splits behavior on focus. Covered by `tests/command-palette.spec.js`.

#### Changed
- Re-verified all ~38 Markdown Guide features against the renderer directly (no changes needed — output matched the Phase 19 audit exactly, confirming no regressions).

### Phase 19 — Live/Split focus indicator, Markdown Guide compliance pass

Branch: `claude/codebase-review-testing-fjicqa`

#### Fixed
- **The Live/Split editing surface had no focus indicator at all.** The Source textarea's subtle accent-line-on-focus (a `2px` `outline` that `.editor-wrap`'s `overflow:hidden` + rounded corners clip down to a thin sliver along the card's inner edge, not a full ring) only applied to `#note-editor`. `.note-live` — CodeMirror's mount point, occupying the identical grid cell — had no equivalent, and CM6's own default focus outline was separately suppressed in `live-editor.js`'s theme, so focusing Live or the right pane of Split showed no visual feedback whatsoever. Added `.note-live:focus-within` (not `:focus-visible` — the real focus target is CM6's nested contenteditable `.cm-content`, not `.note-live` itself) to the same shared rule `#note-editor:focus-visible` uses. Verified via cropped pixel-region screenshots that the line now appears correctly scoped to whichever pane has focus.
- **Titled links and images were completely broken, not just missing title support**: `[text](url "title")` and `![alt](url "title")` — standard CommonMark syntax — failed to match the link/image regex at all (which required the URL capture to contain no whitespace) and fell through as raw, partially-mangled literal text. Now parses and renders the optional title as a `title` attribute.
- **Reference-style links (`[text][id]` / collapsed `[text][]` + `[id]: url "title"`) were entirely unimplemented** — core CommonMark/basic-syntax, silently missing. Added a definition-collection pre-pass mirroring the existing footnote-definition pattern (single-line definitions only, pulled out of the normal block stream, resolved at first use). An id that's defined but never referenced renders nothing, which doubles as support for the common `[comment]: <> (text)` invisible-comment convention — verified working for both the `<>` -style and `[//]:` -style variants.
- **Angle-bracket autolinks (`<https://…>`, `<mailto:…>`, bare `<user@host>`) were unsupported** — CommonMark's explicit autolink syntax fell through as escaped literal text (`&lt;https://…&gt;`) since nothing recognized the wrapped form. Bare `https://…` autolinking already covered most real usage; this closes the gap for the explicit-bracket form.

All four fixes verified against SyncPad's actual renderer output (not just inspecting the source) for every feature on the Markdown Guide's basic, extended, and hacks pages, plus every existing regression test in `tests/markdown.spec.js` re-checked directly against the modified renderer — zero regressions across ~38 feature checks + 12 existing regression cases. `docs/markdown-feature-audit.md` updated to match, including a newly-identified (and deliberately deferred) gap: Setext-style headings (`Text\n===`) aren't supported — ATX (`#`) already covers headings and is what the toolbar inserts, and the `---` underline form is genuinely ambiguous with horizontal rules in a single-pass block scanner.

### Phase 18 — Full-repo review: test infra, editor DOM boundary, admin error handling

Branch: `claude/codebase-review-testing-fjicqa`

Every file in `src/`, `styles/`, `index.html`, and the service worker read in full, cross-checked against 3 independent agent passes over `app.js`/`ui.js`/`admin.js`, a live 291-test Playwright run, and a visual pass across all 7 themes and desktop/mobile layouts.

#### Fixed
- **The entire Playwright suite failed to start**: `package.json` had no `"type": "module"` while every test file uses ES import/export; under Playwright's parallel file loading, Node's per-file CJS-then-ESM reparse fallback could misattribute a CommonJS parse error to the wrong spec file. The actual offender was `tests/spa-server.js`'s three `require()` calls, the only CommonJS left in the repo. Added `"type": "module"`, converted `spa-server.js` to ES module imports.
- **View-once "already viewed" overlay could be visually hidden by an open side panel**: `.view-once-consumed-panel`'s `z-index: 55` carried a stale comment claiming it was "above side-panels (50)" — side panels were later bumped to `140`/`135` to fix a different overlap bug, and this one was never updated to match. Bumped to `150`.
- **Double-escaped filename in the single-file delete confirm**: `app.js` passed `escapeHtml(file.filename)` into `UI.showConfirm()`, which already escapes via `textContent` — a filename with `&` showed literal `&amp;` in the dialog.
- **Comment delete had no handler-level permission check**: unlike comment submit, `_deleteCommentClick()` relied entirely on the delete button being UI-gated by `canEdit()`, not a check inside the handler itself — the same shape as the Phase 14 paste-permission bug, closed before it could become reachable.
- **Admin "delete all expired rooms now" skipped the report-cleanup step** that `_deleteRoomAndStorage()` already does for every other delete path (marking related `'new'` reports `'reviewed'` so they don't keep pointing at a deleted room) — added the same step, batched to match the rest of the function's batching.
- **Typing indicator could bleed into the next room**: `teardownRealtimeSession()` reset nearly every other piece of room-scoped UI state but never cleared a still-showing "X is typing…" banner or its auto-hide timer.
- **`BODY_MAX` (50,000 chars) was unenforced** on text-file import, template append, template insert, and native paste — only custom-template saves respected it. Enforced centrally in the editor's single `input` listener (the one choke point every edit path already dispatches through) rather than at each write site.
- **Admin mutation errors leaked raw Postgres/PostgREST messages**: only the tab-load paths translated a PGRST301/permission failure into "You do not have admin access." (per `docs/security.md`); every delete/lock/quarantine/cleanup action showed the raw error instead. All ~15 mutation error paths now share the same translation.

#### Changed
- **`app.js` no longer writes `editor.value`/`selectionStart`/`selectionEnd` directly** (23 call sites: auto-pair, smart punctuation, indent/list-continue, search replace, paste sanitization, toolbar formatting). Added `UI.replaceEditorRange()` and `UI.setEditorSelection()` to `ui.js` as the general-purpose siblings of the existing `UI.insertAtCursor()`/`UI.setEditorValue()`, so `ui.js` is now actually the single DOM touchpoint the module boundary in `CLAUDE.md`/`docs/architecture.md` describes, not just for whole-document replacement.
- Consolidated the passcode/encryption error-field show/clear helpers in `ui.js` into one generic implementation (4 public functions unchanged, same call sites).
- Unified the Settings-panel and keyboard-shortcut monospace toggles into one `_toggleMonospace()` — the keyboard-shortcut path previously left the Settings panel's button showing stale state until the panel was closed and reopened.
- Wired up `UI.setCommentLoading()` (already-built plumbing, never called) to the Comments panel's open path, matching Version History's existing loading-state pattern.
- Removed an unreachable `{ filter }` param from admin's `_renderRoomsTab()` / `switchTab()` — no caller ever populated it; the real filter path is the stat-card click handler setting `_roomsFilter` directly.
- Renamed the export modal's `#export-copy-md` button id to `#export-copy-html` — it copies rendered HTML, not Markdown, and has since the feature was last changed.
- Merged two CSS rules each fully overridden by a later "polish" declaration (`.share-room-title`, `.report-room-modal`), removed the entirely-unused `.share-card-title`.
- Added `src/comments.js` to the service worker's precache list (only recently-added module missing from it); bumped cache to `syncpad-v37`.
- Corrected doc drift: `CLAUDE.md`/`README.md`'s "4 browser projects" claim now notes only `chromium` runs by default (`playwright.config.js`), README's Export description now says "HTML" not "Markdown", `spa-server.js`'s usage comment now matches its actual `PORT` env var (not a positional arg it never read).

### Phase 17 — UI bug-fix pass, CSS modularization, Markdown feature audit

Branch: `claude/repo-review-refactor-kba1k5`

#### Fixed
- **Side panels rendered behind the app header**: `.side-panel`/`.panel-backdrop` z-index was below `.app-header`, hiding every panel's header (including its close button) at the top of the viewport. All 7 panels already had a close button in their markup — it was just invisible.
- **Write/Live/Split editor surfaces had mismatched typography**: `.note-live` and `.note-preview` were missing the `letter-spacing` and a `768px` `font-size` bump that `#note-editor` picked up only through a disconnected "UI modernization pass" override block.
- **Custom auto-expire had an undocumented 5-minute floor**: dropped to "greater than 0" per product decision.
- **Editor lost focus/selection when clicking a settings toggle**: the 6 on/off toggle buttons now use `mousedown` `preventDefault()` so they don't steal focus from the editor mid-edit.
- **`[TOC]` silently rendered as nothing in the HTML-export/print path**: `renderMarkdownWithToc()`'s top-level detection was tied to the same internal flag as blockquote recursion, so its own [TOC] pre-pass never ran. Introduced an explicit `_isRecursiveCall` marker instead of overloading "was a ctx passed in at all" to mean two different things.
- **GFM table alignment markers (`:---`, `---:`, `:---:`) were parsed and silently discarded** — every table rendered left-aligned regardless of what the separator row said.

#### Added
- Backslash-escaped punctuation (`\*`, `\_`, `\[`, etc.) — standard CommonMark escaping, previously unsupported.
- Footnotes: `text[^id]` + `[^id]: note text`, numbered by first appearance, rendered in a references section with backlinks.
- GitHub-style alerts: `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` render as labeled callouts instead of plain blockquotes.
- Removed 4 Tools-panel entries (Copy Note, Timestamp, Share, Select All) that duplicated always-visible footer/header controls or native browser behavior (Ctrl+A).
- Renamed the Write/Preview/Split mode labels to Source/Live/Split — "Preview" wrongly implied a read-only view when it's actually an editable Typora-style live-rendered surface.
- `docs/markdown-feature-audit.md` — full audit of SyncPad's Markdown support against the Markdown Guide's basic/extended/hacks feature set, with rationale for what's intentionally out of scope (raw HTML, center/color, definition lists, subscript/superscript, etc.).

#### Changed
- **Split `styles/style.css` (3,059 lines) into 9 files** under `styles/` (`base.css`, `landing.css`, `app-shell.css`, `editor.css`, `panels.css`, `modals.css`, `file-preview.css`, `room-tools.css`, plus the already-separate `admin.css`), loaded via ordered `<link>` tags that preserve the original cascade exactly. `admin.css` is lazy-loaded by `admin.js` only on the `/admin` route — regular room pages no longer fetch or parse it. Verified byte-for-byte against the pre-split file (every rule reconstructs in order; only blank-line spacing and two intentional header-comment edits differ).
- Resolved a real merge conflict between this branch and `main` (both had independently implemented the same live-surface gap fixes) via a merge commit rather than a rebase, to resolve the overlapping content exactly once.
- Bumped the service worker cache version several times across this phase (currently `syncpad-v36`) to match the precache-asset changes above.

### Phase 16 — Responsive text wrapping in modals and toasts

Branch: `claude/repo-review-refactor-kba1k5`

#### Fixed
- **Confirm/prompt modal message overflowed instead of wrapping**: a long unbroken token (a filename with no spaces, e.g. `Delete "AVD-Instructions.pdf"?` with a much longer real-world filename) ran past the modal's bounds at every viewport size, including desktop — `overflow-wrap`/`word-break` were never set on `.confirm-modal-message`. Also hardened `.modal-actions` (`flex-wrap` + `min-width: 0` on buttons) against longer confirm/cancel labels overflowing the row.
- **Admin dashboard's separate dialog system had the identical bug**: `.admin-dialog-msg`/`.admin-dialog-title` (used for messages like `Delete file "..."?` and `Delete room "..."?`) had no wrap protection either.
- **Toast messages could be almost entirely cut off**: `.toast` used `white-space: nowrap` with only a `max-width` cap and no overflow handling — a longer message (several existing error toasts run a full sentence) rendered at roughly double its visible width, silently hiding most of the text. Toasts now wrap normally, capped at a reasonable width.
- Bumped service worker cache to `syncpad-v19`.

### Phase 15 — Codex review follow-ups (PWA resume, image/autolink corruption)

Branch: `claude/repo-review-refactor-kba1k5`

Automated review on the merged PR surfaced three real bugs; all confirmed with a reproduction before fixing.

#### Fixed
- **PWA resume suppression missed every root-navigation link except the header logo**: the view-once panel's "Go home" button, and every plain `<a href="/SyncPad/">` "Back to SyncPad" link on the contact/privacy/terms/info screens (including the one a quarantined-room viewer lands on), bypassed the one-shot suppression flag — clicking them in a standalone PWA just bounced straight back into the same room. Replaced the single `.header-logo`-specific listener with one delegated `click` listener that catches any anchor navigating to the app root, plus a new `onGoHome` callback for the view-once panel's button (not a real anchor).
- **Markdown images could be corrupted by the emphasis rules that ran after them**: `![alt](url)` was rendered to real `<img>` markup before the bold/italic/strikethrough regexes ran, so a `*`/`_` character inside the URL or alt text got rewritten into a literal `<em>`/`<strong>` tag sitting inside the `src=`/`alt=` attribute (e.g. `![alt](https://x.com/a*b*.png)` corrupted the `src`). Images are now rendered into an opaque placeholder first and restored at the very end, mirroring the existing code-span/anchor protection.
- **Autolink trimming could strip a legitimate closing parenthesis**: the trailing-punctuation trim matched a whole run of punctuation at once (e.g. `).`), so a balanced URL like `.../Function_(mathematics).` had its real closing `)` stripped along with the sentence period, corrupting the link target. Rewrote the trim to walk backwards one character at a time, evaluating each `)` on its own merits (only trimmed when unmatched by an earlier `(` in the URL).

### Phase 14 — Security/permission fixes, quarantine enforcement, admin bugs

Branch: `claude/repo-review-refactor-kba1k5`

Follow-up pass after a full-repo review (`app.js`, `ui.js`, `admin.js`, `index.html`/`service-worker.js`/`style.css` each read in full) surfaced several real bugs beyond the Phase 13 feature work.

#### Security
- **XSS via Presence `cursor_line`**: `renderDevicesList()` in `ui.js` interpolated `device.cursor_line` into `innerHTML` unescaped. `cursor_line` comes from Supabase Presence, settable by any connected peer with no server-side validation — a malicious peer could inject arbitrary HTML that rendered on every other connected device. Fixed with a `Number.isFinite()` type guard (its only legitimate shape) plus `escapeHtml()` as defense in depth.
- **Permission bypass on paste**: the strip-paste-formatting feature's `paste` listener on `#note-editor` mutated `editor.value` directly without checking `canPaste()`/`canEdit()`, so a read-only/locked/encrypted-without-key user with that preference enabled could still visibly paste and mutate the editor locally (the save itself was already blocked, but the UI wrongly behaved as editable).
- **Quarantine had no effect outside the admin dashboard**: `admin.js` fully implements room quarantine (RPCs, audit log, UI), but nothing in the regular app checked `room.quarantined_at`/`downloads_disabled` — a quarantined room stayed fully visible and editable to normal users. `joinRoom()` and the live room-state-transition handler now block/kick out of quarantined rooms with an info screen (before any passcode prompt, decryption attempt, or editor init); `downloads_disabled` now hides file preview/download actions.

#### Fixed
- **Toasts invisible behind the admin dashboard**: `#toast-container` (z-index 500) rendered behind `.auth-screen`/`#admin-screen` (z-index 900) — every toast shown while the admin dashboard was open (most admin actions, via `admin.js`'s own `_showToast` sharing the same container) was invisible. Bumped to z-index 1100.
- **Admin: deleting a room from the Reports tab didn't persist report status** — only an in-memory mutation, never a DB write. Reports stayed `status:'new'` forever, pointing at a deleted room, reappearing in the "New" filter/stat card. Moved the fix into `_deleteRoomAndStorage()` itself so all four delete call sites (bulk, drawer, Reports tab) are covered.
- **Admin: Reports tab "Load more" used a stale total** after switching filter chips (captured once in a closure param instead of a reassignable module-level variable, unlike the Rooms tab). Now mirrors the Rooms tab's `_roomsTotal` pattern via a new `_reportsTotal`.
- **Admin: Files tab "Load more" silently dropped an active search filter**, always re-rendering the full unfiltered set. Now re-applies the filter and does a full re-render after loading more.
- **Admin: quarantine RPC fallback allowed an empty reason** the RPC itself intentionally rejects server-side. Both paths now agree on a non-empty default.
- **`_expPreset` DOM desync across room navigation**: picking "Custom" expiry in one room left the settings panel visually showing Custom (with inputs open) in the next room, even though the underlying preset had reset to the default. Teardown now resyncs the DOM, not just the variable.
- **Dead code**: `ui.js`'s `setMonospace()` referenced a `#tool-monospace` element that doesn't exist anywhere in `index.html` (the real toggle, `#setting-monospace-btn`, is already handled separately in `app.js`) — removed the no-op branch.
- **Duplicate SW-update-bar/install-bar click handlers**: used `addEventListener(..., {once:true})`, which can still stack duplicate listeners if `showUpdateBar()`/`showInstallBar()` are called again before the first fires (`updatefound` can legitimately fire more than once per session). Switched to idempotent `.onclick` assignment.
- **Hardcoded hex colors bypassing the theme system**: admin dashboard badges/buttons/device-dot and the contact-form status colors used raw hex instead of `var(--green)/--yellow/--red)`, so they didn't adapt across all 7 themes.
- Stale docs: README/CLAUDE.md said "5 themes" (actual: 7, matching `theme.js`); README's release checklist referenced an old service-worker cache version.
- Minor markup cleanup: redundant inline `style="display:none"` alongside `class="hidden"`; an inline style moved to a CSS class.

#### Changed
- Service worker cache bumped to `syncpad-v18`.

---

### Phase 13 — Multi-file uploads, download filenames, PWA resume, Markdown features

Branch: `claude/repo-review-refactor-kba1k5`

#### Fixed
- **Download filename correctness**: `getForceDownloadUrl()` added to `files.js`, requesting the signed URL with Supabase Storage's `download: <filename>` option so the response carries a `Content-Disposition` header with the real uploaded filename. Previously the anchor `download` attribute was silently ignored by modern browsers for cross-origin URLs, so saved files were named after the internal `${timestamp}_${sanitizedName}` Storage path instead of what the uploader actually named them. Preview signed URLs (images, PDFs/SVGs opened in a new tab, fetched text/CSV/Markdown) are unaffected and remain inline.
- **Landing join input treated as a credential field**: `#landing-join-input` now sets `type="text"`, a non-generic `name`, `autocapitalize="off"`, `autocorrect="off"`, and `data-lpignore`/`data-1p-ignore`/`data-bwignore`/`data-form-type="other"` so password managers (LastPass, 1Password, Bitwarden, Dashlane) stop offering to save/autofill it and the browser stops remembering prior entries.

#### Added
- **Multi-file upload**: the file picker, upload-zone drop, panel-wide drop, and editor-area drop all now accept multiple files at once (`setFileHandlers` passes a `File[]` instead of a single `File`). Files upload sequentially with a "Uploading N of M…" progress indicator; a failure on one file doesn't abort the rest, and the final toast reports a success/failure summary.
- **PWA last-room resume**: launching the installed/standalone PWA now reopens the last editable room visited (tracked in `localStorage` as `syncpad_last_room_id`) instead of showing the landing screen. Deliberately navigating Home via the header logo sets a one-shot `sessionStorage` suppression flag so users can still reach the landing screen; a later fresh launch resumes normally. Regular browser tabs are unaffected — the landing screen still shows by default.
- **Markdown images**: `![alt](https://…)` renders an `<img>` in the preview, restricted to the same http/https-only scheme allowlist used for links (never `data:`/`javascript:`).
- **Markdown autolinking**: bare `https://…`/`http://…` URLs in prose are automatically turned into links, without touching URLs already inside code spans, existing `[text](url)` links, or `href`/`src` attribute values.
- **Markdown nested lists**: indented bullet/numbered sub-items now render as properly nested `<ul>`/`<ol>` elements (previously all indentation levels were flattened into one list).
- `tests/files.spec.js` — multi-file upload, bulk select/delete, and download-filename coverage.
- `tests/markdown.spec.js` — coverage for images, autolinking (including a regression test that plain tokens like "L2" are never corrupted), and nested lists.

#### Changed
- Service worker cache bumped to `syncpad-v17` (precached assets changed).

---

### Phase 12 — Stabilization: admin polish, retry button, new Playwright tests

Branch: `claude/festive-wright-sqhOL`

#### Fixed
- **Room load retry button**: `joinRoom()` now uses `UI.showLoadingError()` instead of a plain text message on failure. Shows a "Try again" button that re-triggers `joinRoom()` without a page reload. The loading spinner is hidden during error state and restored on retry.
- **Admin `confirm()` / `alert()` replaced**: all `window.confirm()` and `window.alert()` calls in `admin.js` removed. Replaced with async `_adminConfirm()` and `_adminAlert()` helpers that use themed modal dialogs consistent with the admin UI (inline CSS, no dependency on `ui.js`).
- **Admin delete: typed confirmation**: permanent room deletion now requires the user to type the room ID before the Delete button is enabled, preventing accidental mass deletion.
- **Admin reports: reviewed state**: the "Dismiss" button now sets `status = 'reviewed'` (was `dismissed`) and the action label is "✓ Review". The status badge mapping now distinguishes `reviewed` (green) from `dismissed` (muted).

#### Added
- **Admin refresh button**: a `↺` button in the admin header reloads both the stats row and the current tab without requiring a full page refresh.
- **Admin loading skeletons**: tab content now shows animated shimmer skeleton rows while data loads, replacing the plain "Loading…" text.
- **Admin access-denied Retry**: the access-denied error state now includes a "Retry" button that reloads the page.
- **`UI.showLoadingError(msg, onRetry)`**: new export in `ui.js`. Hides the loading spinner, shows the error message, and reveals a "Try again" button wired to the given callback.
- **Loading screen retry button**: `#loading-retry-btn` added to `index.html`; styled in `styles/style.css`.
- **New Playwright test files**:
  - `tests/admin.spec.js` — 6 tests for admin route rendering, login form validation, wrong-credential error, back button, and keyboard navigation
  - `tests/room-errors.spec.js` — 8 tests for room creation, direct-URL navigation, loading transition, join via ID input, multi-room nav, editor mode reset
  - `tests/read-only.spec.js` — 5 tests for read-only mode: editor disabled, input rejected, upload absent, indicator present, invalid token info screen
  - `tests/editor-modes.spec.js` — 7 tests for mode classes (`mode-write`, `mode-preview`, `mode-split`), pane visibility, aria-pressed correctness, preview rendering
  - `tests/export.spec.js` — 5 tests for empty-note export warning, txt download, and copy-to-clipboard empty warning

#### Changed
- **Admin badge**: added `admin-badge--reviewed` (green) variant to `styles/style.css`.
- **Admin skeleton CSS**: `@keyframes admin-shimmer`, `.admin-skeleton`, `.admin-skeleton-bar`, `.admin-skeleton-row` added to `styles/style.css`.
- **Admin refresh icon button**: `.admin-icon-btn` style added to `styles/style.css`.

---

### Phase 11 — Editor mode-class fix, authenticated RLS baseline, docs update

Branch: `claude/festive-wright-sqhOL`

#### Fixed
- **Editor layout bug**: `.editor-wrap` now uses an explicit `grid-template-columns: 1fr` default (single-pane) instead of `repeat(auto-fit, ...)`. The `auto-fit` approach could produce an unwanted second column on wide screens even when only one pane is visible, causing a phantom vertical divider in Write mode.
- **Mode class hygiene**: `setMarkdownMode()` in `ui.js` now removes all stale mode classes (`mode-write`, `mode-preview`, `mode-split`, `split-mode`) before adding the correct one, preventing any class leaking across navigation.
- **Teardown DOM reset**: `teardownRealtimeSession()` now calls `UI.setMarkdownMode('write', null)` immediately so the editor card has no stale `mode-split` class during the loading screen of the next room.
- **Admin sign-in breaks room creation**: after visiting `/admin` and signing in, the Supabase client holds an `authenticated` session. The existing policies only covered `anon`, causing `loadRoom` / `createRoom` / file operations to fail. Added idempotent `authenticated` baseline policies for `syncpad_rooms`, `syncpad_files`, and `storage.objects` that mirror the anon permissions.
- **`joinRoom` silent errors**: actual Supabase/RLS errors are now logged to the console via `console.error()` while the user-facing message stays simple.

#### Changed
- **Editor card max-width**: Write/Preview mode card capped at `900px` (was 1400px); Split mode expands to 1400px. This eliminates the "large empty box" feeling on wide desktops.
- **Split-mode CSS**: divider selector updated to `.editor-wrap.mode-split #note-editor`; old `.split-mode` kept as a fallback alias.
- **README roadmap**: completed items marked ✅; realistic near-term and future roadmap added.
- **DEPLOYMENT.md**: troubleshooting row added for the admin-session RLS bug; admin session/role section added to Security reminder.
- **docs/security.md**: new "Admin session and Supabase role" section explaining the `anon` → `authenticated` role transition and the baseline policy fix.

---

### Phase 10 — Missing test coverage (Phase 8 & 9 gaps)

Branch: `claude/festive-wright-sqhOL` · Commit: `test(phase-10): fill accessibility and file-sort test gaps`

#### Added
- `accessibility.spec.js`: 3 new tests — `#encryption-input` has `aria-label`, `#exp-custom-value` has `aria-label`, `#exp-custom-unit` has `aria-label`
- `settings.spec.js`: 3 new tests in a `File sort` describe block — sort dropdown visible, expected options present, default value is `"newest"`

---

### Sidequest — Editor UI Modernization

Branch: `claude/festive-wright-sqhOL` · Commit: `refactor(editor): floating card layout, height fix, split divider, readable max-width`

#### Fixed
- **Outer gap**: `.editor-wrap` now uses `margin-block: 1rem` (all-around margins) instead of `margin-block-start: 1.5rem`, giving the card space to breathe on all sides including the bottom
- **Inner gap**: `#note-editor` now has `height: 100%` and `overflow-y: auto`, filling the full grid cell so clicking anywhere inside the empty area focuses the editor
- **`.remote-notice` not clipped**: moved out of `.editor-wrap` to be a sibling in `.editor-area`; `overflow: hidden` on the card now correctly clips only the textarea/preview to the rounded corners without affecting the conflict notice

#### Changed
- **Floating page card**: `.editor-wrap` gains `background: var(--bg-surface)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-md)`, `overflow: hidden`; `gap` reduced from `2rem` to `0`; padding removed (inner panes own their own padding)
- **Split view divider**: replaced heavy gap between panes with a single `border-right: 1px solid var(--border)` on `#note-editor` in `.split-mode`
- **Typography & padding**: `#note-editor` and `.note-preview` use `padding: 1.25rem 1rem` on mobile; on desktop (`≥ 768px`) `padding: 2rem max(5%, calc((100% - 800px) / 2))` — the `max()` formula keeps readable text at ≤ 800px width on very wide panes while falling back to 5% on narrower ones
- All new colors use existing CSS variables (`--bg-surface`, `--border`, `--shadow-md`, `--radius-lg`) — no hardcoded values

---

### Phase 8 — Bug Fix: view-once teardown + accessibility labels

Branch: `claude/phase1-stability` · Commit: `fix(phase-8): view-once teardown bug + accessibility labels on auth/landing inputs`

#### Fixed
- `teardownRealtimeSession()`: reset `_consumingViewOnce` to `false` so the flag from a previous room never silently swallows view-once clear events in the next room

#### Changed
- `#landing-join-input`: added `aria-label="Room link or ID to join"`
- `#passcode-input`: added `aria-label="Room passcode"`
- `#encryption-input`: added `aria-label="Encryption passphrase"`
- `#passcode-error`: added `role="alert" aria-live="assertive"` so screen readers announce failed login attempts
- `#encryption-error`: same `role="alert"` treatment
- `#exp-custom-value` / `#exp-custom-unit`: added `aria-label` for expiration amount and unit inputs

#### Added
- `accessibility.spec.js`: 4 new tests covering the above `aria-label` and `role` attributes

---

### Phase 7 — Find & Replace Polish + Paste Sanitization

Branch: `claude/phase1-stability` · Commit: `feat(phase-7): case-sensitive search toggle + paste sanitization setting`

#### Added
- **Case-sensitive search (`Aa` button)**: toggle inside the search bar; `_caseSensitive` flag resets to `false` on room navigation; hint updated to "Aa = case-sensitive"
- **Replace All**: now uses `'g'` flag (not `'gi'`) when case-sensitive mode is active; uses the unmodified raw search term for the `RegExp` pattern
- **Strip formatting on paste**: new **Editor** section in Settings panel; persists to `localStorage` key `syncpad_strip_paste`; intercepts `paste` events on the editor and substitutes `text/plain` data only
- `search.spec.js`: 3 new tests — Aa button visible, case-sensitive toggle (3→1→3 matches), Replace All respects case mode
- `settings.spec.js`: 2 new tests — strip-paste button visible, On/Off toggle

#### Changed
- Search hint text from "Case-insensitive · Replace requires edit access." → "Replace requires edit access. Aa = case-sensitive."

---

### Phase 6 — Documentation

#### Added
- `CLAUDE.md`: AI agent development guide for working with the SyncPad codebase
- `CHANGELOG.md`: this file, covering all phases in Keep a Changelog format
- `docs/architecture.md`: system architecture overview
- `docs/security.md`: security model documentation
- `docs/playwright.md`: Playwright test suite guide
- `README.md`: updated to reflect all completed phases

---

### Phase 5 — Playwright Test Suite

Branch: `claude/phase1-stability` · Commit: `feat(phase-5): Playwright test suite — 6 spec files, ~60 scenarios`

#### Added
- `playwright.config.js`: static file server on port 5555, 4 browser projects (Chromium, Firefox, WebKit, Mobile Chrome), 2 CI retries, `fullyParallel` enabled
- `tests/helpers.js`: shared test utilities — `createRoom`, `goToLanding`, `typeInEditor`, `getEditorContent`, `openPanel`, `waitForToast`, `closePanels`, `roomIdFromUrl`
- `tests/landing.spec.js`: 6 tests covering the landing page
- `tests/editor.spec.js`: 8 tests covering core editor behaviour
- `tests/markdown.spec.js`: 12 tests covering Markdown rendering
- `tests/search.spec.js`: 10 tests covering Find & Replace
- `tests/settings.spec.js`: 6 tests covering settings panel
- `tests/routing.spec.js`: 8 tests covering client-side routing
- `tests/accessibility.spec.js`: 8 tests covering ARIA and keyboard navigation
- `tests/utils.spec.js`: 16 unit tests executed via an `inBrowser()` helper
- `package.json` scripts: `test`, `test:ui`, `test:headed`, `test:report`, `test:chrome`, `serve`
- `.gitignore` entries: `playwright-report/`, `test-results/`, `playwright/.cache/`, `node_modules/`

---

### Phase 4 — Admin Dashboard

Branch: `claude/phase1-stability` · Commit: `feat(phase-4): admin dashboard — auth gate, rooms, reports, cleanup`

#### Added
- `src/admin.js`: complete admin dashboard implementation (~567 lines)
- `/admin` route now renders a full dashboard instead of a placeholder
- Supabase Auth gate requiring email and password before any dashboard data loads
- `is_syncpad_admin()` RLS function gates all Supabase queries so non-admins receive no data
- **Rooms tab**: displays the 50 latest rooms with client-side search and flag badges (`ENC`, `PASS`, `1×`, `EXP`); per-room Clear and Delete actions
- **Reports tab**: displays the 100 latest reports; "show only new" checkbox filter; per-report Dismiss and Delete-room actions
- **Cleanup tab**: one-click invocation of `run_cleanup_expired_syncpad_rooms_as_admin()` RPC with manual-delete fallback and result display
- Stat cards showing total rooms, active rooms, total files, and pending reports
- Human-readable error message for Supabase `PGRST301` (insufficient privileges)

---

### Phase 3 — Templates Library v2

Branch: `claude/phase1-stability` · Commit: `feat(phase-3): Templates Library v2`

#### Added
- 6 new built-in templates: `standup`, `bug-report`, `code-review`, `weekly-review`, `shopping-list`, `project-brief` (total now 13, up from ~7)
- Each template exposes `label`, `desc` (subtitle), and `body` fields
- Templates modal v2: searchable input, two-column layout with list pane and live preview pane
- Export custom templates as a JSON file
- Import custom templates from a JSON file via `importCustomTemplates(json)`, which returns the count of imported templates or `-1` on invalid input
- `QUOTA_EXCEEDED` storage error is now surfaced to the user (was previously silent)
- `BODY_MAX = 50,000` character limit enforced for custom template bodies

#### Changed
- `saveCustomTemplate()` now returns `{ key, truncated }` instead of just `key`, so callers can detect when the body was silently trimmed

---

### Phase 2 — Accessibility & Polish

Branch: `claude/phase1-stability` · Commit: `feat(phase-2): accessibility, theme transitions, expiration validation, confirm modal`

#### Added
- `role="list"` on `#files-list` and `#devices-list`; `role="listitem"` on their child elements
- `aria-label="Preview {filename}"`, `aria-label="Download {filename}"`, and `aria-label="Delete {filename}"` on file list action buttons
- `aria-hidden="true"` on decorative emoji inside file list items
- CSS theme transitions: `background-color`, `border-color`, and `color` transition over `0.22s ease` on `body`, panels, and modals (buttons are excluded to avoid sluggish click feedback)
- Custom `showConfirm(message, { confirmLabel, cancelLabel, danger })` modal returning `Promise<boolean>`
  - Injected lazily into the DOM with `role="dialog"` and `aria-modal="true"`
  - `danger: true` moves default focus to the Cancel button
  - Escape key closes the modal and resolves `false`

#### Changed
- Minimum expiration duration enforced at 5 minutes (300 seconds) inside `_buildExpirationDuration()`
- All `window.confirm()` calls replaced with the new `showConfirm()` modal

#### Fixed
- Shortcuts modal legal links were rendered outside the `.modal` dialog element; they are now correctly placed inside it

---

### Phase 1 — Stability

Branch: `claude/phase1-stability` · Commit: `fix(phase-1): stability, focus, loading states, URL cache, CSV hardening`

#### Fixed
- `_relativeTime()` was producing `"Invalid Date"` in the conflict banner due to missing timestamp coercion; sync timestamps are now coerced to numbers before use
- PWA install bar dismiss state was not persisted across page loads
- `formatTimestamp()` cross-day context bug caused incorrect date labels when the current day and the document's last-modified day differed
- `wireEvents()` was appending new DOM event listeners on every room navigation without removing the previous ones, causing a memory leak; listeners are now torn down before re-attachment
- Markdown renderer was double-escaping URLs (e.g. `%2520` instead of `%20`)
- Markdown italic regex was matching underscores inside `snake_case` words; word-boundary guards added
- Find & Replace search state was not reset when navigating to a different room
- `copyToClipboard()` in the share modal was broken and now functions correctly
- Stale `_expTimer` from a previous room was firing in the context of the newly loaded room
- `_encKey` and `_encSalt` were not cleared on room navigation, causing encryption state to leak across rooms
- `_markdownMode`, `_showPreview`, and `_expPreset` were not reset on room navigation

#### Removed
- Dead `_getPresenceDevices()` function (unreachable code)
- Dead `broadcastExpired()` function (unreachable code)

#### Added
- Signed URL cache in `files.js`: a `Map` with a 55-minute TTL, automatically evicted when a file is deleted, eliminating redundant Supabase Storage signing requests
- CSV table rendering hardened against malformed input

---

### Phase 0 — CSS Grid & Find/Replace Focus

Branch: `claude/phase1-stability` · Commit: `refactor: CSS Grid editor layout + Find & Replace focus preservation`

#### Changed
- `.editor-wrap` layout migrated from flexbox to CSS Grid using `repeat(auto-fit, minmax(min(100%, 400px), 1fr))` for responsive multi-pane behaviour

#### Fixed
- Find & Replace inputs lost focus after each keystroke during live search; focus is now preserved correctly throughout search operations

---

[Unreleased]: https://github.com/saihanswissle/SyncPad/compare/HEAD...HEAD
