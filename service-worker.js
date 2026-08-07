// SyncPad – service-worker.js
//
// Bumps cache version any time a precached asset changes. Every fetch handler
// path either returns a real Response (via event.respondWith) or passes
// through without calling respondWith. All Supabase traffic is bypassed.
//
// IMPORTANT: do NOT cache Supabase REST, Realtime, Auth, or Storage URLs.
// Cross-origin API requests pass through directly.

const CACHE_VERSION = 'syncpad-v50';
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

// ── Install: precache core assets (tolerant of individual misses) ──────────

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(
      PRECACHE_ASSETS.map((url) =>
        cache.add(url).catch(() => {
          // One missing asset must not block install.
          // (e.g. an optional source file that's not yet deployed)
        })
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

  // Cache-first, scoped to the SAME open CACHE_VERSION cache — deliberately,
  // not just for speed. Once a slot is populated, it is treated as
  // immutable: an earlier version of this handler wrote every cache-miss's
  // network response back into the SAME open cache at request time, which
  // sounds harmless but isn't. A currently-active worker instance keeps
  // handling every fetch for pages it already controls, including new
  // navigations, for as long as it takes a newer worker to actually take
  // over (see app/pwa.js's controllerchange reload); the network always
  // serves whatever is *currently deployed* regardless of which worker
  // generation is asking, so overwriting an ALREADY-cached entry mid-session
  // could drift the "coherent" cache entry-by-entry — e.g. picking up a
  // newly-deployed app.js while every module it imports is still the old
  // cached copy, and failing if the new module expects an export the old
  // one doesn't have.
  //
  // Writing on a genuine MISS is still safe and worth keeping: the install
  // handler above tolerates individual cache.add() failures (a transient
  // network blip while precaching one file must not block the whole
  // install), which without this would leave that one slot permanently
  // unfillable — offline-broken for that asset until the next deploy bumps
  // CACHE_VERSION — even though every later online visit succeeds. Filling
  // an empty slot once can't reintroduce the drift above: once written, that
  // slot hits on every subsequent request for the rest of this generation's
  // lifetime and is never written to again.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    let networkResponse;
    try {
      networkResponse = await fetch(req);
    } catch {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
    // Backgrounded via event.waitUntil() rather than awaited inline: this
    // worker only needs to stay alive until the *write* finishes, not until
    // the browser has the response — event.respondWith()'s own promise
    // already resolves as soon as networkResponse is returned below, and
    // awaiting the write first would have delayed that (Cache.put() only
    // resolves once it has fully read the cloned body, so an inline await
    // would hold the whole response back from the browser until the write —
    // for a large precached asset, until the entire download — completed).
    // A cache-write failure (e.g. a full storage quota) must also never
    // turn an already-successful response into a fake offline error, which
    // waitUntil()'s own catch here keeps entirely separate from the
    // response path below.
    if (networkResponse && networkResponse.ok) {
      event.waitUntil(
        cache.put(cacheKey, networkResponse.clone()).catch(() => { /* e.g. quota — non-fatal */ })
      );
    }
    return networkResponse;
  })());
});

// ── Messages: SKIP_WAITING for clean update transitions ────────────────────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
