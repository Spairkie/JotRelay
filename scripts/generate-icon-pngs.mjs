// JotRelay — icon PNG exporter.
//
// Renders the single source SVG (presskit/icon/icon.svg) to every PNG size
// the project actually ships, using a headless Chromium page as the
// rasterizer instead of a system SVG tool (none is assumed to be
// installed). Re-run this after editing the source SVG — presskit assets,
// the PWA install icons, and the browser-tab favicons all come from this
// one file, so there's a single source of truth for the whole icon set.
//
// One file, not two: an earlier version of this mark kept a separate
// "simplified" SVG for favicon/small sizes, on the assumption a detailed
// mark wouldn't hold up that small. The current mark (two offset rounded
// cards, no fussy detail) was tested down to native 16px and reads clearly
// at every size in between, so there's no small-size variant to keep in
// sync — one less place for the two to silently drift apart.
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
const SOURCE_SVG = 'icon.svg';

const targets = [
  // Presskit — every size the press kit documents. Transparent corners are
  // correct here: a press-kit/marketing asset needs to drop onto whatever
  // background a page/deck already has, not assume one.
  { dir: iconDir,    out: 'icon-512.png',   size: 512 },
  { dir: iconDir,    out: 'icon-256.png',   size: 256 },
  { dir: iconDir,    out: 'icon-128.png',   size: 128 },
  { dir: iconDir,    out: 'favicon.png',    size: 64  },
  { dir: iconDir,    out: 'favicon-32.png', size: 32  },

  // Shipped app assets (referenced by index.html / manifest.json).
  // opaque:true — manifest.json declares these "maskable", and Apple's
  // home-screen icon handling similarly expects a full-bleed square: both
  // apply their own corner rounding/clipping and assume there's real pixel
  // data under it, not transparency the platform has to backfill (or
  // worse, doesn't).
  { dir: assetsDir,  out: 'icon-192.png',         size: 192, opaque: true },
  { dir: assetsDir,  out: 'icon-512.png',         size: 512, opaque: true },
  { dir: assetsDir,  out: 'apple-touch-icon.png', size: 180, opaque: true },
  // Browser-tab favicons. favicon.svg (copied below) is the primary
  // reference — crisp at any size in browsers that support SVG favicons;
  // these PNGs are the fallback for the ones that don't. Transparent, like
  // the presskit favicons above — a browser tab already has its own
  // background, favicons aren't expected to bring their own.
  { dir: assetsDir,  out: 'favicon-32.png',       size: 32  },
  { dir: assetsDir,  out: 'favicon-16.png',       size: 16  },
];

// The source SVG's outermost shape is a rounded-rect tile filled with this
// same diagonal gradient (see icon.svg's #bgGrad) — an opaque render fills
// the full square with an unrounded rect of the identical gradient
// *underneath* that tile, so the corners the rounded rect doesn't cover
// are seamlessly the same fill rather than transparent, with no visible
// seam at the rounded edge.
const BG_GRADIENT_CSS = 'linear-gradient(135deg, #1a1f35, #0c0e1a)';

const svgMarkup = readFileSync(path.join(iconDir, SOURCE_SVG), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

for (const { dir, out, size, opaque } of targets) {
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

// favicon.svg is a straight copy of the source — modern browsers use it
// directly for the tab icon at whatever size they need, no rasterization
// required.
copyFileSync(path.join(iconDir, SOURCE_SVG), path.join(assetsDir, 'favicon.svg'));
console.log(`wrote ${path.relative(root, path.join(assetsDir, 'favicon.svg'))} (copied from ${SOURCE_SVG})`);
