// JotRelay — social preview image generator.
//
// Renders the GitHub repo social-preview card (1280×640, GitHub's
// recommended size) from the same source icon.svg and the same Midnight
// Blue theme colors as the rest of the icon set, so a future theme-default
// change only needs updating in one place (icon.svg's gradients) to stay
// in sync here too — this script just re-reads that file rather than
// duplicating its colors.
//
// Usage:  node scripts/generate-social-preview.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const iconSvg = readFileSync(path.join(root, 'presskit', 'icon', 'icon.svg'), 'utf8');
const outPath = path.join(root, 'presskit', 'social-preview.png');

const WIDTH = 1280;
const HEIGHT = 640;

// Matches styles/base.css's :root (Midnight Blue, the default theme) —
// kept as plain values here since this is a standalone rasterizer with no
// access to the app's CSS custom properties.
const BG_BASE     = '#0c0e1a';
const BG_ELEVATED = '#1a1f35';
const ACCENT      = '#60a5fa';
const TEXT        = '#dde4f0';

const html = `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    background: linear-gradient(135deg, ${BG_ELEVATED}, ${BG_BASE});
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'DM Sans', system-ui, sans-serif;
  }
  .card {
    display: flex;
    align-items: center;
    gap: 48px;
  }
  .icon { width: 200px; height: 200px; flex-shrink: 0; }
  .icon svg { display: block; width: 100%; height: 100%; }
  .wordmark { font-size: 88px; font-weight: 600; color: ${TEXT}; letter-spacing: -1px; white-space: nowrap; line-height: 1; }
  .wordmark span { color: ${ACCENT}; }
  .tagline { margin-top: 20px; font-size: 26px; color: ${TEXT}; opacity: 0.7; }
  .text-col { display: flex; flex-direction: column; justify-content: center; }
</style></head>
<body>
  <div class="card">
    <div class="icon">${iconSvg}</div>
    <div class="text-col">
      <div class="wordmark">Jot<span>Relay</span></div>
      <div class="tagline">Real-time shared notepad — no account needed.</div>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
await page.setContent(html);
await page.screenshot({ path: outPath });
await browser.close();
console.log(`wrote ${path.relative(root, outPath)} (${WIDTH}x${HEIGHT})`);
