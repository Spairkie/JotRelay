// JotRelay – brand.js
// Single source of truth for the product name in JS-rendered strings: toasts,
// modal copy, exported-file <title>s, console log prefixes, native share-sheet
// titles. A future rename only has to change BRAND_NAME here for all of those.
//
// What this deliberately does NOT cover: static HTML (index.html's <title>/
// meta/OG tags, the wordmark markup, manifest.json, sitemap.xml), package.json,
// and every doc/presskit text file. This project has no build step — nothing
// renders that HTML from a template — so those stay plain text edited by hand.
// See CLAUDE.md's "Rebranding checklist" for the current full list.
export const BRAND_NAME = 'JotRelay';
