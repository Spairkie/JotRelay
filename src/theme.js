// SyncPad – theme.js
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
  { id: 'paper-light',     label: 'Paper Light',    swatch: '#c17d2e', bg: '#f5f0e8', elevated: '#eeecea', dark: false },
  { id: 'lavender-light',  label: 'Lavender Light', swatch: '#7c5cbf', bg: '#f5f3ff', elevated: '#ede9fe', dark: false },
  { id: 'arctic',          label: 'Arctic',         swatch: '#0d9488', bg: '#f0f7f9', elevated: '#e2f0f4', dark: false },
  { id: 'rose',            label: 'Rose',           swatch: '#db2777', bg: '#fdf2f6', elevated: '#fbe4ec', dark: false },
];

/**
 * Apply a theme by setting data-theme on <html>.
 * 'charcoal-amber' is the default and removes the attribute.
 */
export function applyTheme(id) {
  const root = document.documentElement;
  if (!id || id === 'charcoal-amber') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', id);
  }
  try { localStorage.setItem(THEME_KEY, id); } catch {}
}

/** Load and apply the saved theme from localStorage. */
export function loadSavedTheme() {
  let saved;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  applyTheme(saved || 'charcoal-amber');
}

/** Return the currently active theme ID. */
export function getSavedTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'charcoal-amber'; } catch {}
  return 'charcoal-amber';
}
