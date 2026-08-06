// SyncPad — icon PNG exporter.
//
// Renders the two source SVGs (presskit/icon/icon.svg — the full two-card
// mark — and icon-simple.svg — a bold single-card variant tuned for
// legibility at favicon/small sizes) to every PNG size the project actually
// ships, using a headless Chromium page as the rasterizer instead of a
// system SVG tool (none is assumed to be installed). Re-run this after
// editing either source SVG — presskit assets, the PWA install icons, and
// the browser-tab favicons all come from these same two files, so there is
// one source of truth for the whole icon set.
//
// Usage:  node scripts/generate-icon-pngs.mjs
import { chromium } from '@playwright/test';
import { readFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const iconDir = path.join(root, 'presskit', 'icon');
const assetsDir = path.join(root, 'assets');

const targets = [
  // Presskit — full mark, every size the press kit documents. Transparent
  // corners are correct here: a press-kit/marketing asset needs to drop
  // onto whatever background a page/deck already has, not assume one.
  { svg: 'icon.svg',        dir: iconDir,    out: 'icon-512.png',   size: 512 },
  { svg: 'icon.svg',        dir: iconDir,    out: 'icon-256.png',   size: 256 },
  { svg: 'icon.svg',        dir: iconDir,    out: 'icon-128.png',   size: 128 },
  { svg: 'icon-simple.svg', dir: iconDir,    out: 'favicon.png',    size: 64  },
  { svg: 'icon-simple.svg', dir: iconDir,    out: 'favicon-32.png', size: 32  },

  // Shipped app assets (referenced by index.html / manifest.json).
  // PWA install icons render large (home screen, app switcher) — the full
  // two-card mark reads fine at these sizes. opaque:true — manifest.json
  // declares these "maskable", and Apple's home-screen icon handling
  // similarly expects a full-bleed square: both apply their own corner
  // rounding/clipping and assume there's real pixel data under it, not
  // transparency the platform has to backfill (or worse, doesn't).
  { svg: 'icon.svg',        dir: assetsDir,  out: 'icon-192.png',         size: 192, opaque: true },
  { svg: 'icon.svg',        dir: assetsDir,  out: 'icon-512.png',         size: 512, opaque: true },
  { svg: 'icon.svg',        dir: assetsDir,  out: 'apple-touch-icon.png', size: 180, opaque: true },
  // Browser-tab favicons render tiny (16–32px) — two overlapping cards plus
  // a small ring badge blur into an illegible smudge at that size, so these
  // use the bold single-card variant instead. favicon.svg is the primary
  // reference (crisp at any size in browsers that support SVG favicons);
  // the PNGs are the fallback for the ones that don't. Transparent, like
  // the presskit favicons above — a browser tab already has its own
  // background, favicons aren't expected to bring their own.
  { svg: 'icon-simple.svg', dir: assetsDir,  out: 'favicon-32.png',       size: 32  },
  { svg: 'icon-simple.svg', dir: assetsDir,  out: 'favicon-16.png',       size: 16  },
];

// Both source SVGs' outermost shape is a rounded-rect tile filled with this
// same diagonal gradient (see icon.svg/icon-simple.svg's #bgGrad) — an
// opaque render fills the full square with an unrounded rect of the
// identical gradient *underneath* that tile, so the corners the rounded
// rect doesn't cover are seamlessly the same fill rather than transparent,
// with no visible seam at the rounded edge.
const BG_GRADIENT_CSS = 'linear-gradient(135deg, #1c1c22, #0a0a0c)';

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { svg, dir, out, size, opaque } of targets) {
  const svgMarkup = readFileSync(path.join(iconDir, svg), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><head><style>
       html,body{margin:0;padding:0;background:${opaque ? BG_GRADIENT_CSS : 'transparent'};}
       svg{display:block;width:${size}px;height:${size}px;}
     </style></head><body>${svgMarkup}</body></html>`,
  );
  await page.locator('svg').screenshot({ path: path.join(dir, out), omitBackground: !opaque });
  console.log(`wrote ${path.relative(root, path.join(dir, out))} (${size}x${size}${opaque ? ', opaque' : ''})`);
}

await browser.close();

// favicon.svg is a straight copy of the small-size-tuned source — modern
// browsers use it directly for the tab icon at whatever size they need,
// no rasterization required.
copyFileSync(path.join(iconDir, 'icon-simple.svg'), path.join(assetsDir, 'favicon.svg'));
console.log(`wrote ${path.relative(root, path.join(assetsDir, 'favicon.svg'))} (copied from icon-simple.svg)`);
