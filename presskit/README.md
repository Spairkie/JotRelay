# SyncPad Presskit

Press and media resources for **SyncPad** — logos, product screenshots, and
the background information you need to write about it. Everything in this
folder is free to use under the terms in [Asset usage](#asset-usage) below.

If you need something that isn't here, see [Contact](#contact).

---

## What SyncPad is

**SyncPad is a real-time shared notepad you can open and use in seconds —
no account required.**

Create a room, share the link, and everyone with it is editing the same
note at the same time. No sign-up flow, no install, no workspace to
configure. It's built for the moment you need to get text or a file from
one device — or one person — to another, right now.

### Short description (one-liner)

> SyncPad is an accountless, real-time shared notepad for fast handoff
> between people and devices.

### Longer description

SyncPad solves a small, common problem: you need to move a note, a
snippet, or a file from one place to another, and every tool built for
that job wants you to sign up first. SyncPad doesn't. Open the site, hit
**Create a Room**, and you have a private, synced notepad — shareable by
link, room ID, or a short spoken code — that updates on every connected
device in well under a second.

Underneath the simplicity is a genuinely capable editor: a Typora-style
live Markdown surface with tables, checklists, code blocks, and GitHub-style
callouts; file attachments up to 10 MB with signed download links; inline
comments and version history; a command palette; and seven built-in visual
themes. Rooms can be locked down with a passcode, encrypted end-to-end with
a passphrase, capped to a device limit, or set to auto-expire — all
configurable without ever creating an account.

SyncPad is a solo-built, source-available project (see the repository for
current license terms) — a portfolio piece and a genuinely useful tool at
the same time, not a funded startup. Its target audience is anyone who
wants Typora-level writing polish and Google-Docs-level realtime sync
without the sign-up friction either usually implies.

---

## Key features

- **Real-time sync** — Supabase Realtime broadcast, ~200–300 ms latency, with a durable Postgres save a beat behind every edit
- **No account needed** — a room's link is the only credential; nothing to sign up for
- **Read-only sharing** — a separate read-only link (or QR code) lets someone view without being able to edit
- **File handoff** — drag-and-drop uploads up to 10 MB each, multiple at once, with signed download links
- **Passcode protection** — a PBKDF2-hashed passcode gate on a room
- **Encrypted notes** — AES-256-GCM encryption derived and applied entirely client-side; the passphrase is never sent or stored
- **Editing lock** — a server-enforced (Postgres-trigger) freeze on a room, not just a UI convention
- **Live Markdown editing** — a Typora-style CodeMirror 6 surface (tables, checklists, code blocks, GitHub-style alerts) alongside raw Source and side-by-side Split views
- **Presence & collaboration** — connected-device list, typing indicators, and live cursor position
- **Inline comments & version history** — anchor a comment to a text range; scrub back through past snapshots
- **Auto-expiration & device limits** — rooms that clear themselves after a set time or once too many devices have joined
- **Seven visual themes**, a command palette, keyboard shortcuts, and a full PWA install path

Full feature list: see the [project README](https://github.com/Spairkie/SyncPad#features).

---

## Product positioning

SyncPad sits between two kinds of tools people usually reach for:

| | Note apps with sign-up (Notion, Google Docs) | Ephemeral pastebins (Pastebin, plain text drops) |
|---|---|---|
| **SyncPad** | ✅ Real-time collaboration | ✅ No account, instant to open |
| | ❌ Requires an account | ❌ No live sync, no presence |

SyncPad is the option when you want the collaborative feel of a shared
document without asking the other person to make an account first — a
room link *is* the invite.

It is explicitly **not** positioned as an enterprise, encrypted-at-rest, or
compliance-grade product. It's a personal/portfolio project, and its own
in-app Terms and Privacy pages say so plainly: don't put anything sensitive
in it. Press coverage should reflect that framing rather than describing it
as a "secure" product in the compliance sense.

---

## Fact sheet

| | |
|---|---|
| **Name** | SyncPad |
| **Category** | Real-time shared notepad / accountless collaboration tool |
| **Live app** | [spairkie.github.io/SyncPad](https://spairkie.github.io/SyncPad/) |
| **Platform** | Web (any modern browser); installable as a PWA on desktop and mobile |
| **Account required** | No |
| **Pricing** | Free |
| **Built with** | Vanilla JavaScript (ES modules, no framework, no bundler), Supabase (Postgres, Realtime, Storage, Auth for the admin dashboard), CodeMirror 6 |
| **Hosting** | Static site on GitHub Pages |
| **Source code** | [github.com/Spairkie/SyncPad](https://github.com/Spairkie/SyncPad) |
| **Maintainer** | Spairkie |
| **Status** | Actively developed, personal/portfolio project |

---

## Branding notes

- The product name is **SyncPad** — one word, capital S and capital P. Not "Sync Pad" or "Syncpad."
- The wordmark styles it as **Sync** in the primary text color and **Pad** in the brand accent color (amber, `#f5a623` in the default theme) — see [`icon/`](icon/) and the landing page header for reference.
- SyncPad ships seven visual themes; the amber-on-charcoal "Charcoal Amber" theme shown in these assets is the default, not the only look. Screenshots in other themes are equally representative of the product.
- Please don't alter the icon's proportions, add drop shadows/effects beyond what's already baked in, or recolor the mark. Cropping to a square or circle for platform-specific placements (app store tiles, avatars) is fine.

---

## Assets in this folder

```text
presskit/
  README.md          — this file
  icon/               — logo/icon system (SVG source + PNG exports)
  screenshot/         — product screenshots + the demo video's poster frame
  video/              — the hero demo video + its narration script
```

### Icon

- [`icon/icon.svg`](icon/icon.svg) — full source-of-truth mark (two synced
  "pad" cards + a sync-loop badge)
- [`icon/icon-simple.svg`](icon/icon-simple.svg) — a single-card variant
  tuned for legibility at favicon/small sizes
- Pre-rendered PNGs: `icon-512.png`, `icon-256.png`, `icon-128.png`,
  `favicon.png` (64×64), `favicon-32.png`
- Regenerate the PNGs after editing either SVG with `npm run presskit:icons`
  (see [the repo's scripts documentation](../docs/marketing-site.md#scripts)
  for details and how to add more sizes)

### Screenshots

Six product screenshots covering the app's core scenarios, captured
against the app's real CSS at production-representative sizes:

| File | Shows |
|---|---|
| `desktop-editor.png` | The Live Markdown surface, rendered |
| `live-collaboration.png` | Presence panel — multiple connected devices, a typing indicator |
| `encrypted-note.png` | The passphrase gate on an encrypted room |
| `file-handoff.png` | The Files panel with several uploaded files |
| `room-sharing.png` | The Share modal — editable link, read-only link, short code |
| `mobile-responsive.png` | The mobile layout with its bottom action bar |

**These are placeholders, not marketing renders of fabricated data** — they're
the app's actual markup and stylesheets, populated with realistic sample
content (a fictional "Q3 Product Roadmap" room, sample files, etc.) rather
than a live production room, so no real user data appears in them. Replace
them with real captures once you have production screenshots you're happy
with; see
[docs/marketing-site.md](../docs/marketing-site.md#swapping-in-real-assets)
for how the current ones were generated and how to redo the process.

### Video

`video/demo.mp4` (24.6s, silent) is a genuine screen capture of the real app
(typing, live sync between two simulated devices, the Share modal, a file
landing in the Files panel), not a mockup, generated by
`scripts/generate-demo-video.mjs`. `video/narration-script.md` is a script
sized to its beats, ready to hand to a voiceover/editing tool if you want to
produce a narrated cut.

The landing page hero itself no longer autoplays this file — it's a coded,
interactive five-scene demo instead (`src/app/landing-demo.js` /
`styles/landing-demo.css`; see
[docs/marketing-site.md#coded-hero-demo](../docs/marketing-site.md#coded-hero-demo)).
`demo.mp4` remains available as a presskit/social-media asset and via the
hero's "Watch recorded demo" link, which opens it on click rather than
loading it automatically. See [`video/README.md`](video/README.md) for the
full story on the file itself and how to upgrade/regenerate it.

---

## Asset usage

You're welcome to use the assets in this folder in an article, review, or
similar piece of coverage about SyncPad, including:

- The icon/logo, unmodified except for simple resizing or cropping to a
  square/circle
- The screenshots, cropped or annotated as needed for your layout

Please don't imply SyncPad endorses your product or organization, and
please don't use the assets in a way that suggests SyncPad is more
established, funded, or "official" than a personal/portfolio project is —
see [Product positioning](#product-positioning) above.

These assets are provided as-is, without warranty, for editorial use.

---

## Contact

For interview requests, questions, or anything not covered here, use the
[contact form on the SyncPad site](https://spairkie.github.io/SyncPad/contact).

*(This section is a placeholder — swap in a direct press email once one
exists. Until then, the contact form is the reliable route.)*
