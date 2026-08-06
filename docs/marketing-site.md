# Marketing site & presskit

How the landing page and `presskit/` are built, where their content lives,
and how to maintain both. This is a companion to the root
[`CLAUDE.md`](../CLAUDE.md) and [`docs/architecture.md`](architecture.md) —
read those first for how the app itself is structured.

---

## Where the landing page lives

Two routes split marketing from product:

- **`/SyncPad/`** — the marketing page. Pure copy and CTAs, no working
  create/join form. `#landing-screen` in `index.html`, shown by
  `src/app/routing.js`'s `_parseRoute()` when the URL has no room segment.
- **`/SyncPad/app/`** — the bare create/join screen (logo, tagline, Create
  Room button, Join box, recent rooms). This is the *original* landing
  screen content, split out to its own route rather than removed —
  `#app-landing-screen` in `index.html`, route type `'app-landing'` in
  `_parseRoute()` (named that, not `'app'`, because `showScreen('app')`
  already means `#app-screen`, the room editor itself).

Every "Create a Room" / "Join a room" control on the marketing page is a
plain `<a href="/SyncPad/app/">` — no click handler, just a link. The real
create/join logic (`generateRoomId()`, the join-box submit handler, recent
rooms) lives entirely in `wireLandingEvents()`, which only runs for the
`/app` route. The marketing page's own JS (`wireMarketingPageEvents()`) is
presentational only — nav toggle, feature tabs, scroll-reveal, footer year —
and never touches room state.

Why split it this way rather than keep one combined screen: it keeps the
marketing page's DOM small and copy-focused, and it means the actual
product entry point (`/app`) works identically for a first-time visitor and
someone who bookmarked it directly, without ever loading marketing-page
weight for the second case.

### Section map — marketing page (`/`)

Inside `<div id="landing-screen">` in `index.html`:

| Section | Class | Notes |
|---|---|---|
| Sticky nav | `.lp-nav` | Logo, anchor links, mobile hamburger, CTA linking to `/app/` |
| Hero | `.lp-hero` | Headline, CTA buttons (`.lp-btn-primary`/`.lp-btn-secondary`) linking to `/app/`, coded interactive demo (`.lp-demo`, see [below](#coded-hero-demo)) |
| Feature tour | `.lp-features` | Six tabs (`.lp-feature-tab`) + panels (`.lp-feature-panel`) |
| How it works | `.lp-how` | Four-step flow |
| Trust / benefits | `.lp-trust` | Six-card grid |
| Final CTA | `.lp-cta` | Closing call-to-action band, links to `/app/` |
| Footer | `.lp-footer` | Link columns, presskit link, legal links |

### Section map — app landing screen (`/app`)

Inside `<div id="app-landing-screen">` in `index.html`. This is intentionally
the old design almost unchanged: logo, tagline, `.landing-create-btn`,
`.landing-join*` (input/button), `#landing-recent` (recent-rooms list,
populated by `_renderRecentRooms()`), `.landing-chips`, and a legal-links
row. A small `.app-landing-back` link at the top returns to `/`.

Everything prefixed `lp-` is page chrome specific to the marketing layout.
Everything prefixed `landing-` (`landing-create-btn`, `landing-join-input`,
`landing-recent`, etc.) is structural — those ids/classes are read directly
by `src/app/landing.js`'s `wireLandingEvents()`, so don't rename them
without updating that file too, and don't reintroduce them on the marketing
page (they'd be dead weight — nothing on `/` wires them up anymore).

- **Copy** lives inline in `index.html` — there's no separate content/CMS
  file, consistent with the rest of the no-build-step app.
- **Styles** are in `styles/landing.css`, in the same section order as the
  HTML. The bottom of the file (from the `Auth Cards` comment down) is
  shared with the passcode/encryption/contact/privacy/terms screens — leave
  that part alone when touching marketing-page styles.
- **Interactivity** (mobile nav toggle, feature-tab switching, footer year,
  scroll-reveal) is wired in `src/app/landing.js`'s `_wireMarketingChrome()`.
  It's plain DOM wiring with no build step, matching how the rest of
  `app/*.js` works.

### Multiple "Create a Room" / "Join a room" buttons

The nav, hero, and closing CTA band each have their own Create-a-Room
button, plus the hero's own "Join a room" link. All of them are plain
`<a href="/SyncPad/app/">` — no JS involved, no click handler to keep in
sync across entry points. Add a new CTA anywhere on the marketing page by
linking it to `/SyncPad/app/` (or `${BASE}/app/` if you're generating the
href in JS) — nothing else to wire up.

### Coded hero demo

The hero's visual is a coded, interactive five-scene product demo — not the
autoplaying `presskit/video/demo.mp4` an earlier version of this page used
(that file still exists; see [Upgrading the demo video](#upgrading-the-demo-video)
below for its new role).

**Where it lives:**

| Piece | File |
|---|---|
| Markup | `index.html`, inside `.lp-hero-visual` (search "Coded, interactive product demo") |
| Styles | `styles/landing-demo.css`, loaded after `styles/landing.css` |
| Behavior | `src/app/landing-demo.js`, `initLandingDemo()` |
| Tests | `tests/landing-demo.spec.js` |

`wireMarketingPageEvents()` (`src/app/landing.js`) calls `initLandingDemo()`
once, the same place it used to wire the old video's pause button — see that
function for the full list of what else runs on the marketing route.

**The story.** One continuous fictional scenario, told across five scenes a
visitor can autoplay through or jump into directly: a room called "Product
launch plan" — **Write** (a two-item checklist typed in) → **Collaborate**
(a teammate, "Hans", joins with a live cursor and types a third line) →
**Review** (that new line gets highlighted with an anchored comment,
"Should this happen before final QA?") → **Share** (a simplified
permissions/link panel) → **Handoff** (a file, "launch-assets.zip", flies
from the desktop surface to a persistent overlapping mobile phone frame).

**Scenes and timing.** `landing-demo.js` is a small explicit state machine,
not a pile of unrelated `setTimeout()` calls: a single `_timer` is ever
pending at once, and a `gen` counter is bumped on every scene change — every
scheduled callback closes over the `gen` value active when it was scheduled
and bails out if a manual click, a stop, or a fresh loop has since moved
`gen` on. That's what keeps a stale scene's callback from reaching into a
later scene's DOM. Autoplay only ever advances *sequentially* through
`write → collaborate → review → share → handoff → (loop)`; per-scene
durations sum to roughly 13s of active playback (spec target: 12–16s), and
the Handoff scene holds its completed state for an extra ~4s before looping
back to Write. A manual click on any scene tab stops autoplay outright and
renders that scene's *settled* state instantly — the character-by-character
typing and cursor-move animations only ever play as part of autoplay's
forward progression, never on a manual jump, which sidesteps a lot of
re-animate-on-click flicker for free.

**Why it pauses.** Three independent conditions all have to hold for
autoplay to run — `playing`, `visible` (an `IntersectionObserver` at 30%
threshold), and `!tabHidden` (the `visibilitychange` event) — checked by a
single `canAutoplay()` gate before any timer is (re)armed. Scroll the demo
offscreen, switch tabs, or hit the Pause button, and the pending timer is
cleared; scrolling back / returning / hitting Play resumes it. This also
means the demo does no work (no timers, no animation) while nobody's
looking at it, which matters for a piece of the page that runs continuously
by design.

**Reduced motion.** `prefers-reduced-motion: reduce` is checked once at
init and on every `change` event. When set: autoplay never starts, the
per-character typing effect and the file's flight animation are both
skipped entirely (their JS paths short-circuit to setting final text/state
directly), the pointer-tilt listener is never attached, and
`styles/landing-demo.css`'s own `@media (prefers-reduced-motion: reduce)`
block removes the card's tilt transform and turns every scene-transition
`transition` into a fast, uniform 0.12s linear crossfade. Manual scene
navigation still works exactly as normal (it was already instant/untyped by
default) — reduced motion only removes *autoplay* and the two per-scene
animations (typing, file flight), not the feature.

**Why it makes no backend calls.** Every scene's content is hard-coded
markup toggled by class/attribute — same reasoning as the presskit
screenshots and the old demo video generator (see
[Why mockups instead of live screenshots](#why-mockups-instead-of-live-screenshots)):
this is a marketing page any visitor loads before ever creating a room, so
it must never touch Supabase, CodeMirror, realtime channels, file upload
APIs, room creation, the comments system, or the real sharing/permissions
APIs. `tests/landing-demo.spec.js` asserts this directly (no Supabase
project requests, no `demo.mp4` request, on page load). The whole demo
stage is also `aria-hidden="true"` — it's a scripted illustration, not real
content, so nothing in it needs to behave like actual app UI; the scene
tabs, Play/Pause button, and the caption below the stage are the real,
operable, accessible surface.

**Testing/maintaining both going forward:**
- Changing the coded demo's copy, timing, or scenes: edit `index.html`'s
  markup and `landing-demo.js`'s `DURATIONS`/`FULL_TEXT`/`PERM_EXPLAIN`
  constants together, then run `npx playwright test tests/landing-demo.spec.js`.
- Changing the *recorded* video: unchanged — see
  [Upgrading the demo video](#upgrading-the-demo-video) and
  `presskit/video/README.md`. `scripts/generate-demo-video.mjs` and
  `npm run presskit:video` still work exactly as before; the only thing
  that changed is that the hero no longer autoloads the file it produces.
- Both are deliberately kept independent — the coded demo doesn't read
  `demo.mp4`'s content or timing, and regenerating the video doesn't
  require touching the coded demo. Update `narration-script.md` only when
  you change the *video's* generator script, not the hero's.

---

## Scripts

Four small Node scripts (`@playwright/test`'s bundled Chromium, plus
`ffmpeg` for the video) generate presskit assets. None of them touch the
network or Supabase — everything is rendered from local HTML/SVG/CSS.

| Script | What it does |
|---|---|
| `scripts/generate-icon-pngs.mjs` | Rasterizes `presskit/icon/icon.svg` and `icon-simple.svg` to the PNG sizes listed in `presskit/README.md#icon` |
| `scripts/build-mockups.mjs` | Pulls real screens (header, editor, side panels, share modal, encryption gate) out of `index.html` by id (via `scripts/lib/extract-fragment.mjs`) and writes six standalone HTML files to `scripts/mockups/`, populated with realistic placeholder content |
| `scripts/generate-screenshots.mjs` | Serves the repo with `tests/spa-server.js` and screenshots each `scripts/mockups/*.html` into `presskit/screenshot/` |
| `scripts/generate-demo-video.mjs` | Drives the real app markup/CSS through a scripted ~25s sequence (type → live-render → simulated second device → Share modal → Files panel) and assembles it into `presskit/video/demo.mp4` + a poster frame — see `presskit/video/README.md` for why it captures frame-by-frame instead of using Playwright's `recordVideo` |

Regenerate screenshots after a visual change to the app shell, editor, or
any panel/modal touched by the mockups:

```bash
npm run presskit:screenshots
```

Regenerate icons after editing either source SVG:

```bash
npm run presskit:icons
```

Regenerate the demo video after a visual change to the header, editor,
Share modal, or Files panel (requires `ffmpeg` with `libx264` on `PATH`):

```bash
npm run presskit:video
```

The icon script (with the size list edited) also produced the app's own
`assets/icon-192.png` and `assets/icon-512.png` — those are the real PWA
icons referenced by `manifest.json`, kept in sync with the presskit mark
so the installed app and the press assets match.

### Why mockups instead of live screenshots

The obvious alternative — drive the real running app with Playwright and
screenshot an actual room — was deliberately avoided: that would mean
either hitting the production Supabase project from whatever environment
generates these assets (creating real, permanent rooms in a live database
for the sole purpose of a marketing screenshot) or standing up a disposable
Supabase project just for image generation. Reusing the app's real markup
and CSS with hand-set placeholder content gets the same visual fidelity —
these are pixel-accurate renders of the actual UI, not mockups drawn from
scratch — without either cost.

---

## Swapping in real assets

### Real product screenshots

Replace the files in `presskit/screenshot/` directly (keep the same
filenames, or update the `<img src>` references in `index.html`'s feature
panels if you rename them). No script changes needed — `scripts/build-mockups.mjs`
and `scripts/generate-screenshots.mjs` become optional once you're using
real captures; keep them around for the next time the UI changes enough to
need refreshed placeholders.

### Upgrading the demo video

The hero itself no longer plays this file automatically — see
[Coded hero demo](#coded-hero-demo) above for what replaced it. A real
(silent, screen-captured) `presskit/video/demo.mp4` still exists as a
presskit/social-media asset and via the hero's "Watch recorded demo" link —
see [`presskit/video/README.md`](../presskit/video/README.md) for how it was
made, `presskit/video/narration-script.md` for a script sized to hand off to
a voiceover/editing tool, and the "Upgrading to a produced/narrated cut"
section there for the swap-in steps. Replacing the file (same name) is
enough — nothing in `index.html` needs to change unless you rename it, in
which case update the watch-link's `href`.

### Custom domain

The landing page itself needs no changes for a custom domain — it's just
`index.html`. What does need updating is the app's base-path configuration
(`window.SYNCPAD_CONFIG.basePath`, `manifest.json`, `404.html`'s redirect
script, and the hard-coded `/SyncPad/` prefixes sprinkled through the
static HTML). That process is already documented in
[`DEPLOYMENT.md`](../DEPLOYMENT.md#base-path) — follow "To host at the
root" there. The one presskit-specific thing to update afterward: the
`https://spairkie.github.io/SyncPad/` links in `presskit/README.md`'s fact
sheet and contact section.

### `robots.txt` / `sitemap.xml`

Both live at the repo root, alongside `index.html`. `robots.txt` allow-lists
only the static marketing/app-landing routes (`/`, `/app/`, `/privacy`,
`/terms`, `/contact`, `/presskit/`) and disallows everything else, including
room paths and `/share/` links — a room URL is a live write credential (see
CLAUDE.md §5), so it should never end up indexed by a search engine.
`sitemap.xml` lists the same allow-listed routes.

One caveat: crawlers fetch `robots.txt` from the *origin* root
(`https://spairkie.github.io/robots.txt`), not from `/SyncPad/robots.txt` —
so on the current `spairkie.github.io/SyncPad/` project-page hosting, this
file only takes effect for crawlers that happen to check it relative to the
page they found (not guaranteed). It becomes fully effective automatically
if the site ever moves to root hosting or a custom domain (see above) —
both URLs in these two files hard-code `https://spairkie.github.io/SyncPad/`
and need updating at the same time as the other custom-domain changes.

### Font loading

`index.html`'s `<head>` loads Google Fonts (DM Sans/DM Mono) via
`<link rel="preconnect">` + `<link rel="stylesheet">` tags, not a CSS
`@import` — `@import` only starts downloading once the stylesheet that
contains it (`styles/base.css`) has itself finished downloading and been
parsed, adding a full extra round trip before the browser even discovers
the font request. The presskit generation scripts
(`scripts/build-mockups.mjs`, `scripts/generate-demo-video.mjs`) load the
same Google Fonts `<link>` in their own capture pages so screenshots/video
keep matching font rendering.
