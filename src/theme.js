// JotRelay – theme.js
// CSS-variable-based theme system. Themes override :root variables
// via a data-theme attribute on <html>.

const THEME_KEY = 'syncpad_theme';

// `dark` drives the picker's Dark/Light grouping (src/ui/panels.js's
// renderThemePicker()) and `elevated` is the picker's 3-tone swatch preview
// (bg/elevated/accent) — both purely presentational, no effect on the
// theme itself (that's entirely the [data-theme="..."] CSS block in
// styles/base.css; this array just has to describe it accurately).
export const THEMES = [
  { id: 'charcoal-amber',  label: 'Charcoal Amber', swatch: '#f5a623', bg: '#1c1c1e', elevated: '#222228', dark: true },
  { id: 'midnight-blue',   label: 'Midnight Blue',  swatch: '#60a5fa', bg: '#0f172a', elevated: '#1a1f35', dark: true },
  { id: 'forest-green',    label: 'Forest Green',   swatch: '#4ade80', bg: '#0f1a0f', elevated: '#162118', dark: true },
  { id: 'terminal',        label: 'Terminal',       swatch: '#00ff41', bg: '#0a0a0a', elevated: '#0f0f0f', dark: true },
  { id: 'mocha-dark',      label: 'Mocha Dark',     swatch: '#d4956a', bg: '#1e1410', elevated: '#2d1e14', dark: true },
  { id: 'crimson-night',   label: 'Crimson Night',  swatch: '#f43f5e', bg: '#150808', elevated: '#271212', dark: true },
  { id: 'paper-light',     label: 'Paper Light',    swatch: '#905e23', bg: '#f5f0e8', elevated: '#eeecea', dark: false },
  { id: 'lavender-light',  label: 'Lavender Light', swatch: '#7c5cbf', bg: '#f5f3ff', elevated: '#ede9fe', dark: false },
  { id: 'arctic',          label: 'Arctic',         swatch: '#0b756c', bg: '#f0f7f9', elevated: '#e2f0f4', dark: false },
  { id: 'rose',            label: 'Rose',           swatch: '#db2777', bg: '#fdf2f6', elevated: '#fbe4ec', dark: false },
];

/**
 * Apply a theme by setting data-theme on <html>.
 * 'midnight-blue' is the default and removes the attribute.
 */
export function applyTheme(id) {
  const root = document.documentElement;
  if (!id || id === 'midnight-blue') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', id);
  }
  try { localStorage.setItem(THEME_KEY, id); } catch {}
  _updateFaviconForTheme(id);
}

// ── Theme-matched favicon ────────────────────────────────────────────────────
// The browser-tab favicon is the same two-card mark as assets/favicon.svg
// (see presskit/icon/icon.svg), but recolored to the active theme's own
// tile background and accent — so switching themes re-tints the tab icon
// along with the rest of the app instead of it staying a fixed amber
// regardless of theme. Built inline as a data: URI rather than shipping 10
// pre-rendered SVG files, since the only thing that ever changes between
// them is the tile and card colors.
function _faviconSvg(bg, accent) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`
    + `<rect width="512" height="512" rx="112" fill="${bg}"/>`
    + `<rect x="96" y="88" width="240" height="240" rx="46" fill="none" stroke="${accent}" stroke-opacity="0.4" stroke-width="16"/>`
    + `<rect x="176" y="184" width="240" height="240" rx="46" fill="${accent}"/>`
    + `<rect x="214" y="264" width="150" height="20" rx="10" fill="#1c1305" fill-opacity="0.4"/>`
    + `<rect x="214" y="308" width="150" height="20" rx="10" fill="#1c1305" fill-opacity="0.4"/>`
    + `<rect x="214" y="352" width="100" height="20" rx="10" fill="#1c1305" fill-opacity="0.4"/>`
    + `</svg>`;
}

// Rasterize the themed SVG to a PNG data: URI at the given size, via an
// offscreen <canvas> — browsers that don't support SVG favicons (this repo
// still ships the 32/16px PNG <link> fallbacks for them) never look at the
// SVG link at all, so recoloring only that one leaves them stuck on the
// static amber PNG regardless of the active theme. Async by nature (image
// decode), so this is fire-and-forget from applyTheme() rather than
// blocking it — the SVG link (synchronous) already updates instantly for
// every browser that reads it, this only extends the same recolor to the
// ones that don't.
function _rasterizeFaviconPng(svgMarkup, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = `data:image/svg+xml,${encodeURIComponent(svgMarkup)}`;
  });
}

// Bumped on every call below and captured per in-flight rasterization —
// image decode is async, so rapidly switching themes starts several
// overlapping _rasterizeFaviconPng() promises with no guaranteed
// completion order. Without this, an older theme's rasterization finishing
// after a newer one's would win the last write to link.href and leave the
// PNG favicon candidates (what browsers without SVG-favicon support
// actually display) stuck on a stale theme's colors even though the page
// and the SVG candidate already moved on.
let _faviconGen = 0;

function _updateFaviconForTheme(id) {
  try {
    const gen = ++_faviconGen;
    const theme = THEMES.find((t) => t.id === id) || THEMES[0];
    const svg = _faviconSvg(theme.bg, theme.swatch);

    const svgLink = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
    if (svgLink) svgLink.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;

    document.querySelectorAll('link[rel="icon"][type="image/png"]').forEach((link) => {
      const size = Number(link.sizes?.value?.split('x')[0]) || 32;
      _rasterizeFaviconPng(svg, size).then((dataUrl) => {
        if (gen === _faviconGen) link.href = dataUrl;
      }).catch(() => {});
    });

    // apple-touch-icon: what iOS Safari's "Add to Home Screen" snapshots at
    // the moment the user taps it — recoloring this too means a fresh
    // install captures whichever theme was active, not always the static
    // amber default. This does NOT reach an already-installed icon (iOS
    // bakes the bitmap in at install time with no live-update API — same
    // platform limitation the manifest.json icons below run into), only
    // future installs from this point on.
    const appleLink = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleLink) {
      const size = Number(appleLink.sizes?.value?.split('x')[0]) || 180;
      _rasterizeFaviconPng(svg, size).then((dataUrl) => {
        if (gen === _faviconGen) appleLink.href = dataUrl;
      }).catch(() => {});
    }
  } catch {}
}

/** Load and apply the saved theme from localStorage. */
export function loadSavedTheme() {
  let saved;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  applyTheme(saved || 'midnight-blue');
}

/** Return the currently active theme ID. */
export function getSavedTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'midnight-blue'; } catch {}
  return 'midnight-blue';
}
