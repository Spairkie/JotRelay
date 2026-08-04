// SyncPad – service-worker.js
//
// Bumps cache version any time a precached asset changes. Every fetch handler
// path either returns a real Response (via event.respondWith) or passes
// through without calling respondWith. All Supabase traffic is bypassed.
//
// IMPORTANT: do NOT cache Supabase REST, Realtime, Auth, or Storage URLs.
// Cross-origin API requests pass through directly.

const CACHE_VERSION = 'syncpad-v41';
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');

const PRECACHE_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.json`,
  `${BASE}/styles/base.css`,
  `${BASE}/styles/landing.css`,
  `${BASE}/styles/app-shell.css`,
  `${BASE}/styles/editor.css`,
  `${BASE}/styles/panels.css`,
  `${BASE}/styles/modals.css`,
  `${BASE}/styles/file-preview.css`,
  `${BASE}/styles/room-tools.css`,
  `${BASE}/styles/admin.css`,
  `${BASE}/src/app.js`,
  `${BASE}/src/app/state.js`,
  `${BASE}/src/app/routing.js`,
  `${BASE}/src/app/room-lifecycle.js`,
  `${BASE}/src/app/landing.js`,
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
];

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

// ── Fetch: bypass Supabase + cross-origin, network-first for same-origin ──

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

  // SPA navigation fallback: serve index.html if offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cached = await caches.match(`${BASE}/index.html`);
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Same-origin assets: network-first with cache fallback.
  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(req);
      if (networkResponse && networkResponse.ok) {
        const clone = networkResponse.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone)).catch(() => {});
      }
      return networkResponse;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
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
