// SyncPad – service-worker.js
//
// Bumps cache version any time a precached asset changes. Every fetch handler
// path either returns a real Response (via event.respondWith) or passes
// through without calling respondWith. All Supabase traffic is bypassed.
//
// IMPORTANT: do NOT cache Supabase REST, Realtime, Auth, or Storage URLs.
// Cross-origin API requests pass through directly.

const CACHE_VERSION = 'syncpad-v54';
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');

const PRECACHE_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.json`,
  `${BASE}/styles/base.css`,
  `${BASE}/styles/landing.css`,
  `${BASE}/styles/landing-demo.css`,
  `${BASE}/styles/app-shell.css`,
  `${BASE}/styles/editor.css`,
  `${BASE}/styles/panels.css`,
  `${BASE}/styles/modals.css`,
  `${BASE}/styles/file-preview.css`,
  `${BASE}/styles/room-tools.css`,
  `${BASE}/styles/onboarding.css`,
  `${BASE}/styles/admin.css`,
  `${BASE}/src/app.js`,
  `${BASE}/src/keyboard-viewport.js`,
  `${BASE}/src/app/state.js`,
  `${BASE}/src/app/routing.js`,
  `${BASE}/src/app/room-lifecycle.js`,
  `${BASE}/src/app/landing.js`,
  `${BASE}/src/app/landing-demo.js`,
  `${BASE}/src/app/files-panel.js`,
  `${BASE}/src/app/editor-behavior.js`,
  `${BASE}/src/app/comments-preview.js`,
  `${BASE}/src/app/panels.js`,
  `${BASE}/src/app/header.js`,
  `${BASE}/src/app/tools-and-modals.js`,
  `${BASE}/src/app/export.js`,
  `${BASE}/src/app/command-palette.js`,
  `${BASE}/src/app/wiring.js`,
  `${BASE}/src/app/pwa.js`,
  `${BASE}/src/ui.js`,
  `${BASE}/src/ui/core.js`,
  `${BASE}/src/ui/dialogs.js`,
  `${BASE}/src/ui/panels.js`,
  `${BASE}/src/ui/editor.js`,
  `${BASE}/src/ui/collab.js`,
  `${BASE}/src/ui/feature-modals.js`,
  `${BASE}/src/ui/onboarding.js`,
  `${BASE}/src/sync.js`,
  `${BASE}/src/rooms.js`,
  `${BASE}/src/live-broadcast.js`,
  `${BASE}/src/presence.js`,
  `${BASE}/src/files.js`,
  `${BASE}/src/file-preview.js`,
  `${BASE}/src/settings.js`,
  `${BASE}/src/encryption.js`,
  `${BASE}/src/admin.js`,
  `${BASE}/src/admin/state.js`,
  `${BASE}/src/admin/shared.js`,
  `${BASE}/src/admin/stats.js`,
  `${BASE}/src/admin/room-drawer.js`,
  `${BASE}/src/admin/rooms-tab.js`,
  `${BASE}/src/admin/reports-tab.js`,
  `${BASE}/src/admin/files-tab.js`,
  `${BASE}/src/admin/audit-tab.js`,
  `${BASE}/src/admin/cleanup-tab.js`,
  `${BASE}/src/admin/dashboard-shell.js`,
  `${BASE}/src/offline.js`,
  `${BASE}/src/supabase.js`,
  `${BASE}/src/utils.js`,
  `${BASE}/src/markdown.js`,
  `${BASE}/src/markdown-highlight-extension.js`,
  `${BASE}/src/markdown-table-utils.js`,
  `${BASE}/src/templates.js`,
  `${BASE}/src/permissions.js`,
  `${BASE}/src/theme.js`,
  `${BASE}/src/icons.js`,
  `${BASE}/src/shortcuts.js`,
  `${BASE}/src/revisions.js`,
  `${BASE}/src/comments.js`,
  `${BASE}/src/live-editor.js`,
  `${BASE}/src/footnote-popover.js`,
  `${BASE}/vendor/codemirror.js`,
  `${BASE}/assets/icon-192.png`,
  `${BASE}/assets/icon-512.png`,
  `${BASE}/assets/apple-touch-icon.png`,
  `${BASE}/assets/favicon.svg`,
  `${BASE}/assets/favicon-32.png`,
  `${BASE}/assets/favicon-16.png`,
];

// Fast membership lookup for the fetch handler below — only these paths
// ever go through this worker's cache.
const PRECACHED_PATHS = new Set(PRECACHE_ASSETS);

// ── Install: precache core assets (must ALL succeed to activate) ───────────
//
// An earlier version tolerated individual cache.add() failures so one flaky
// asset wouldn't block install. That directly conflicts with treating a
// CACHE_VERSION's cache as immutable once populated (see the fetch handler
// below): the fetch handler has no way to repair a slot a tolerated failure
// left empty, so that one asset would stay offline-broken until another
// deploy — not what "immutable" is supposed to buy. Not catching per-asset
// failures here lets a single miss reject the whole Promise.all, which
// rejects this install event's waitUntil() promise, which the browser
// treats as a failed install: this worker is discarded without ever
// activating, any previously-active worker keeps controlling pages
// unaffected, and the browser retries installation on its own next
// opportunity. A transient blip self-heals across visits; a generation
// only ever activates once every one of these has actually succeeded.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(
      PRECACHE_ASSETS.map((url) =>
        // cache: 'reload' bypasses the browser's own HTTP cache for this
        // fetch. Without it, a returning client whose HTTP cache still has
        // a fresh (not-yet-expired) response from the PREVIOUS deploy would
        // have cache.add() reuse those stale bytes instead of fetching the
        // new ones — silently freezing part of a "new" generation as old
        // content from the moment it's created.
        cache.add(new Request(url, { cache: 'reload' }))
      )
    );
  })());
});

// ── Activate: prune old caches, take control ───────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ── Fetch: bypass Supabase + cross-origin, cache-first for same-origin ────

function _isSupabase(urlString) {
  try {
    const u = new URL(urlString);
    return u.hostname.endsWith('.supabase.co')
        || u.hostname.endsWith('.supabase.in')
        || u.hostname.endsWith('.supabase.io');
  } catch { return false; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET. POST/PUT/PATCH/DELETE/OPTIONS pass through to the network
  // by NOT calling respondWith.
  if (req.method !== 'GET') return;

  const url = req.url;

  // Skip Supabase entirely (REST, Realtime/WebSocket, Storage, Auth).
  if (_isSupabase(url)) return;

  // Skip all cross-origin requests (CDN scripts, fonts, third-party APIs).
  // We don't cache them; let the browser/CDN handle it.
  if (!url.startsWith(self.location.origin)) return;

  // SPA-route navigations (no file extension in the path — an in-app route
  // like /SyncPad/<room-id> or /SyncPad/admin) map to the cached shell.
  // Navigations to an actual same-origin file — e.g. the landing page's
  // "Watch recorded demo" link opening presskit/video/demo.mp4 in a new
  // tab — are also `mode: 'navigate'` requests, but must serve their own
  // real content, never the app shell, even while this worker is in
  // control and even while fully online.
  const pathname = new URL(url).pathname;
  const isSpaRoute = req.mode === 'navigate' && !/\.[a-zA-Z0-9]+$/.test(pathname);
  const cachePath = isSpaRoute ? `${BASE}/index.html` : pathname;
  const cacheKey = isSpaRoute ? `${BASE}/index.html` : req;

  // Only PRECACHE_ASSETS entries go through this worker's cache at all —
  // e.g. NOT the landing page's presskit screenshots/demo video. Those are
  // unversioned (no entry here, no CACHE_VERSION bump when they change) and
  // large/streamed, which combine badly with "cache once, never revisit":
  // caching one on first request would (a) permanently serve stale bytes to
  // existing clients if a deploy ever replaces that file without also
  // touching a precached asset, since nothing here would ever revalidate or
  // evict it, and (b) break byte-range requests — a cached whole-file 200
  // response matches a later Range request too, and gets returned in full,
  // which video loaders can abort on. Plain pass-through (no respondWith
  // call) leaves these to ordinary browser/HTTP caching instead.
  if (!PRECACHED_PATHS.has(cachePath)) return;

  // Cache-first, read-only at request time — scoped to the SAME open
  // CACHE_VERSION cache, and NEVER written to here. The only thing that
  // ever populates a given generation's cache is the install handler's
  // one-shot PRECACHE_ASSETS pass above; this handler only ever reads it.
  //
  // An earlier version of this handler self-healed a genuine cache MISS by
  // writing the network response back in — meant to recover from the
  // install handler's per-asset tolerance of a transient cache.add()
  // failure, so that one file wasn't permanently offline-broken for the
  // rest of this generation's lifetime. That traded one bug for a worse
  // one: a currently-active worker instance keeps answering every fetch for
  // pages it already controls for as long as it takes a newer worker to
  // take over (see app/pwa.js's controllerchange reload) — often much
  // longer than a single page load, since nothing forces a reload on its
  // own. If that missing slot were requested for the first time only AFTER
  // a *subsequent* deploy went out (this worker's generation still hasn't
  // been superseded on this client, but the server now serves newer bytes
  // for that URL), the self-heal write would pull those newer bytes into
  // the OLDER generation's cache — reintroducing the exact split-version
  // problem the immutable-cache design exists to prevent, just via a
  // different path. There's no way to verify a network response actually
  // belongs to this generation without content-addressed URLs, which this
  // project deliberately doesn't have (no build step). Read-only avoids the
  // whole class of bug: the tradeoff is that a rare transient install
  // failure leaves that one asset unavailable OFFLINE until the next
  // deploy — every ONLINE load still succeeds regardless, since a cache
  // miss always falls through to the network below.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});

// ── Messages: SKIP_WAITING for clean update transitions ────────────────────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
