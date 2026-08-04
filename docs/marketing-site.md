# Marketing site & presskit

How the landing page and `presskit/` are built, where their content lives,
and how to maintain both. This is a companion to the root
[`CLAUDE.md`](../CLAUDE.md) and [`docs/architecture.md`](architecture.md) —
read those first for how the app itself is structured.

---

## Where the landing page lives

There's no separate marketing site — `/SyncPad/` (the app root) **is** the
landing page. It's the existing `#landing-screen` element in `index.html`,
shown by `src/app/routing.js`'s `_parseRoute()` when the URL has no room
segment. This was a deliberate choice over a separate `/SyncPad/app/` or
similar subpath: the landing route already existed, so reusing it avoids
adding a second routing scheme on top of the room-ID catch-all `_parseRoute()`
already does, and it means the marketing page and the "Create/Join a room"
action live in exactly the place a visitor already expects them.

### Section map

All of it lives inside `<div id="landing-screen">` in `index.html`:

| Section | Class | Notes |
|---|---|---|
| Sticky nav | `.lp-nav` | Logo, anchor links, mobile hamburger |
| Hero | `.lp-hero` | Headline, CTAs, the Create/Join form, video slot |
| Feature tour | `.lp-features` | Six tabs (`.lp-feature-tab`) + panels (`.lp-feature-panel`) |
| How it works | `.lp-how` | Four-step flow |
| Trust / benefits | `.lp-trust` | Six-card grid |
| Final CTA | `.lp-cta` | Closing call-to-action band |
| Footer | `.lp-footer` | Link columns, presskit link, legal links |

Everything prefixed `lp-` is page chrome specific to the marketing layout.
Everything prefixed `landing-` (`landing-create-btn`, `landing-join-input`,
`landing-recent`, etc.) is structural — those ids/classes are read directly
by `src/app/landing.js`'s `wireLandingEvents()`, so don't rename them
without updating that file too.

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

### Multiple "Create a Room" buttons

The nav, hero, and closing CTA band each have their own Create-a-Room
button (three different entry points on one long page). Rather than three
separate click handlers, they all share one: `wireLandingEvents()` queries
`#landing-create-btn, .landing-create-trigger` and attaches the same
handler to every match. Add a new CTA anywhere on the page by giving it
the `landing-create-trigger` class — no JS changes needed. The same pattern
exists for "Join a room" via `.landing-join-trigger`, which just scrolls to
and focuses the real join input rather than duplicating the join form.

---

## Scripts

Three small Node scripts (`@playwright/test`'s bundled Chromium, no other
dependencies) generate presskit assets. None of them touch the network or
Supabase — everything is rendered from local HTML/SVG/CSS.

| Script | What it does |
|---|---|
| `scripts/generate-icon-pngs.mjs` | Rasterizes `presskit/icon/icon.svg` and `icon-simple.svg` to the PNG sizes listed in `presskit/README.md#icon` |
| `scripts/build-mockups.mjs` | Pulls real screens (header, editor, side panels, share modal, encryption gate) out of `index.html` by id (via `scripts/lib/extract-fragment.mjs`) and writes six standalone HTML files to `scripts/mockups/`, populated with realistic placeholder content |
| `scripts/generate-screenshots.mjs` | Serves the repo with `tests/spa-server.js` and screenshots each `scripts/mockups/*.html` into `presskit/screenshot/` |

Regenerate everything after a visual change to the app shell, editor, or
any panel/modal touched by the mockups:

```bash
npm run presskit:screenshots
```

Regenerate icons after editing either source SVG:

```bash
npm run presskit:icons
```

The same script (with the size list edited) also produced the app's own
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

### Real demo video

See [`presskit/video/README.md`](../presskit/video/README.md) — drop
`demo.mp4` into `presskit/video/` and swap the empty `<video>` element in
the hero (search `index.html` for `lp-demo-video`) for the version in that
file's comment, which re-adds `autoplay` and the `<source>` tag.

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
