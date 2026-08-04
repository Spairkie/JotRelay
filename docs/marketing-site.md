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
| Hero | `.lp-hero` | Headline, CTA buttons (`.lp-btn-primary`/`.lp-btn-secondary`) linking to `/app/`, video slot |
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

The hero already plays a real (silent, screen-captured) `presskit/video/demo.mp4`
— see [`presskit/video/README.md`](../presskit/video/README.md) for how it
was made, `presskit/video/narration-script.md` for a script sized to hand
off to a voiceover/editing tool, and the "Upgrading to a produced/narrated
cut" section there for the swap-in steps. Replacing the file (same name) is
enough — nothing in `index.html` needs to change unless you rename it.

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
