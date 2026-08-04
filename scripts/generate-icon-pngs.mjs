// SyncPad — presskit icon PNG exporter.
//
// Renders presskit/icon/icon.svg (and the small-size icon-simple.svg
// variant) to PNG at the sizes the presskit needs, using a headless
// Chromium page as the rasterizer instead of a system SVG tool (none is
// assumed to be installed). Re-run this after editing either source SVG.
//
// Usage:  node scripts/generate-icon-pngs.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const iconDir = path.join(root, 'presskit', 'icon');

const targets = [
  { svg: 'icon.svg',        out: 'icon-512.png', size: 512 },
  { svg: 'icon.svg',        out: 'icon-256.png', size: 256 },
  { svg: 'icon.svg',        out: 'icon-128.png', size: 128 },
  { svg: 'icon-simple.svg', out: 'favicon.png',  size: 64  },
  { svg: 'icon-simple.svg', out: 'favicon-32.png', size: 32 },
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { svg, out, size } of targets) {
  const svgMarkup = readFileSync(path.join(iconDir, svg), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><head><style>
       html,body{margin:0;padding:0;background:transparent;}
       svg{display:block;width:${size}px;height:${size}px;}
     </style></head><body>${svgMarkup}</body></html>`,
  );
  await page.locator('svg').screenshot({ path: path.join(iconDir, out), omitBackground: true });
  console.log(`wrote ${out} (${size}x${size})`);
}

await browser.close();
