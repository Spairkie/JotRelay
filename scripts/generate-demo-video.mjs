// SyncPad — hero demo video generator.
//
// Drives the app's *real* markup/CSS/transitions (same technique as
// scripts/build-mockups.mjs) through a scripted ~26s sequence — typing,
// a simulated second device joining and adding a line, the Share modal,
// and a file landing in the Files panel. No Supabase/network calls are
// made; every state change is driven directly via page.evaluate() toggling
// the same classes the real app's JS would, so the real CSS transitions
// (.side-panel's slide-in, .modal-backdrop's fade+scale, etc.) animate
// exactly as they would for a live user.
//
// Playwright's built-in `recordVideo` renders blank/white frames in this
// sandbox's headless environment (a compositor/screencast limitation —
// regular page.screenshot() is unaffected, tested and confirmed separately)
// even with software-GL launch flags, so this captures a screenshot at
// every meaningful animation beat instead — dense sampling during CSS
// transitions and per-character during typing, sparser on static holds —
// and assembles the variable-duration frame sequence into an MP4 with
// ffmpeg's concat demuxer, which accepts an explicit per-frame duration
// rather than assuming a fixed frame rate.
//
// Usage:  node scripts/generate-demo-video.mjs
// Requires ffmpeg on PATH (for the frame-sequence -> MP4 assembly + poster).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractElementById } from './lib/extract-fragment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const videoDir = path.join(root, 'presskit', 'video');
// Nested two directories deep (scripts/.tmp-*/), matching scripts/mockups/
// — the STYLES block below uses ../../styles/... relative paths, which
// only resolve correctly served from that depth.
const scratchDir = path.join(root, 'scripts', '.tmp-video-capture');
const framesDir = path.join(root, 'scripts', '.tmp-video-frames');
rmSync(scratchDir, { recursive: true, force: true });
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(videoDir, { recursive: true });
mkdirSync(scratchDir, { recursive: true });
mkdirSync(framesDir, { recursive: true });

const appScreen  = extractElementById(html, 'app-screen');
const filesPanel = extractElementById(html, 'files-panel');
const shareModal = extractElementById(html, 'share-modal');

const STYLES = `
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&display=swap" />
  <link rel="stylesheet" href="../../styles/base.css" />
  <link rel="stylesheet" href="../../styles/landing.css" />
  <link rel="stylesheet" href="../../styles/app-shell.css" />
  <link rel="stylesheet" href="../../styles/editor.css" />
  <link rel="stylesheet" href="../../styles/panels.css" />
  <link rel="stylesheet" href="../../styles/modals.css" />
  <link rel="stylesheet" href="../../styles/file-preview.css" />
  <link rel="stylesheet" href="../../styles/room-tools.css" />
`;

function replaceText(fragment, id, text) {
  const re = new RegExp(`(id="${id}"[^>]*>)([^<]*)(<)`);
  return fragment.replace(re, (_, open) => `${open}${text}<`);
}

let page1 = replaceText(appScreen, 'room-name', 'Product Launch Checklist');

const pageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>SyncPad demo capture</title>
${STYLES}
<style>
  body { overflow: visible !important; }
  #app-screen { position: static !important; display: flex !important; }
  .demo-flash { animation: demo-flash-in 1.6s ease-out; }
  @keyframes demo-flash-in {
    0%   { background: var(--accent-dim); }
    100% { background: transparent; }
  }
  .demo-endcard {
    position: fixed; inset: 0; z-index: 999;
    background: var(--bg-base);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.8s ease;
  }
  .demo-endcard.in { opacity: 1; }
  .demo-endcard-inner { text-align: center; }
  .demo-endcard-logo { font-size: 56px; font-weight: 700; letter-spacing: -1.5px; color: var(--text-primary); }
  .demo-endcard-logo span { color: var(--accent); }
  .demo-endcard-tag { margin-top: 10px; font-size: 16px; color: var(--text-secondary); }
</style>
</head>
<body class="mockup-body">
${page1}
${filesPanel}
<div class="panel-backdrop" id="panel-backdrop-demo"></div>
${shareModal}
</body>
</html>`;

writeFileSync(path.join(scratchDir, 'demo-capture.html'), pageHtml);

const PORT = 5601;
const { spawn } = await import('node:child_process');
const server = spawn('node', ['tests/spa-server.js'], {
  cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe',
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('spa-server did not start in time')), 8000);
  server.stdout.on('data', (d) => { if (String(d).includes('http://')) { clearTimeout(t); resolve(); } });
  server.stderr.on('data', (d) => process.stderr.write(d));
});

const WIDTH = 1600, HEIGHT = 1000;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

// ── Frame capture bookkeeping ────────────────────────────────────────────────
// Each entry: { file, durationMs } — the concat demuxer plays `file` for
// exactly `durationMs`, so real (variable) wait times map 1:1 onto the
// timeline instead of forcing everything onto a fixed frame rate.
let frameIndex = 0;
const manifest = [];

async function capture(holdMs) {
  const file = `f${String(frameIndex).padStart(5, '0')}.png`;
  await page.screenshot({ path: path.join(framesDir, file) });
  manifest.push({ file, durationMs: holdMs });
  frameIndex++;
}

/** One held frame — the state doesn't change for `ms`. */
async function hold(ms) {
  await capture(ms);
}

/** Sample a CSS transition in progress: `count` frames, `stepMs` apart. */
async function sampleTransition(count, stepMs) {
  for (let i = 0; i < count; i++) {
    await capture(stepMs);
    await page.waitForTimeout(stepMs);
  }
}

// Logs the cumulative manifest duration at the moment each visual beat
// *starts* — i.e. before that beat's own frames are captured. Run this
// script and copy these numbers into presskit/video/narration-script.md
// instead of hand-guessing timestamps; they drift every time a hold()/
// sampleTransition() call above changes.
function logBeat(label) {
  const elapsedMs = manifest.reduce((sum, m) => sum + m.durationMs, 0);
  console.log(`[beat] ${(elapsedMs / 1000).toFixed(2)}s — ${label}`);
}

await page.goto(`http://localhost:${PORT}/scripts/.tmp-video-capture/demo-capture.html`, { waitUntil: 'load' });
await page.waitForTimeout(400);
// Footer metadata starts blank/stale in the extracted fragment — drive it
// with the app's real formatting logic so it reads correctly on screen
// throughout the capture instead of showing placeholder text.
await page.evaluate(async () => {
  const { updateWordCount, updateFooterClock } = await import('/SyncPad/src/ui/core.js');
  updateWordCount(document.getElementById('note-editor').value);
  updateFooterClock();
});
logBeat('Empty note, cursor blinking');
await hold(800);

// ── Beat 1: type into Write mode, one real keystroke per frame ─────────────
async function typeLine(text, charDelayMs) {
  await page.locator('#note-editor').click();
  for (const ch of text) {
    await page.keyboard.type(ch);
    await capture(charDelayMs);
  }
}
logBeat('Typing the checklist');
await typeLine('# Product Launch Checklist\n\n', 40);
await typeLine('- [ ] Finalize pricing page\n', 34);
await typeLine('- [ ] QA the onboarding flow\n', 34);
await page.evaluate(async () => {
  const { updateWordCount } = await import('/SyncPad/src/ui/core.js');
  updateWordCount(document.getElementById('note-editor').value);
});
await hold(1000);

// ── Beat 2: switch to Live — reveal the rendered version ───────────────────
logBeat('Switches to Live, rendered checklist');
await page.evaluate(async () => {
  const { renderMarkdown } = await import('/SyncPad/src/markdown.js');
  const src = document.getElementById('note-editor').value;
  const preview = document.getElementById('note-preview');
  preview.innerHTML = renderMarkdown(src);
  preview.classList.remove('hidden');
  document.getElementById('note-editor').classList.add('hidden');
  document.getElementById('md-toolbar').classList.add('hidden');
  document.querySelectorAll('.md-seg-btn').forEach((b) => {
    const isPreview = b.dataset.mode === 'preview';
    b.classList.toggle('active', isPreview);
    b.setAttribute('aria-pressed', String(isPreview));
  });
});
await hold(1600);

// ── Beat 3: a second device joins and adds a line ───────────────────────────
logBeat("Second device joins, typing indicator");
await page.evaluate(() => {
  document.getElementById('device-count').textContent = '2 connected';
  const t = document.getElementById('typing-indicator');
  t.textContent = "Priya's iPad is typing…";
  t.classList.remove('hidden');
});
await hold(1800);
logBeat('Remote line arrives, flashes in');
await page.evaluate(async () => {
  const { renderMarkdown } = await import('/SyncPad/src/markdown.js');
  const { updateWordCount } = await import('/SyncPad/src/ui/core.js');
  const src = document.getElementById('note-editor').value + '- [ ] Confirm launch date with marketing\n';
  document.getElementById('note-editor').value = src;
  const preview = document.getElementById('note-preview');
  preview.innerHTML = renderMarkdown(src);
  preview.classList.add('demo-flash');
  document.getElementById('typing-indicator').classList.add('hidden');
  updateWordCount(src);
});
await sampleTransition(6, 250); // flash fading out over ~1.5s
await page.evaluate(() => document.getElementById('note-preview').classList.remove('demo-flash'));
await hold(1100);

// ── Beat 4: Share modal ──────────────────────────────────────────────────────
logBeat('Share modal opens');
await page.evaluate(() => {
  document.getElementById('share-modal-title').textContent = 'Share "Product Launch Checklist"';
  document.getElementById('share-editable-text').setAttribute('value', 'syncpad.app/product-launch-checklist');
  document.getElementById('share-readonly-text').setAttribute('value', 'syncpad.app/share/9c4f1e7b2a');
  document.getElementById('share-code-text').setAttribute('value', '4KQXM9');
  document.getElementById('share-modal').classList.add('visible');
});
await sampleTransition(7, 45); // fade + scale-in, ~0.3s
await hold(3200);
await page.evaluate(() => document.getElementById('share-modal').classList.remove('visible'));
await sampleTransition(5, 45);
await hold(600);

// ── Beat 5: Files panel — a file lands ───────────────────────────────────────
logBeat('Files panel, upload, file lands');
await page.evaluate(() => {
  document.getElementById('panel-backdrop-demo').classList.add('visible');
  document.getElementById('files-panel').classList.add('open');
});
await sampleTransition(7, 45); // slide-in, ~0.25s + settle
await hold(800);
await page.evaluate(() => {
  const ind = document.getElementById('uploading-indicator');
  document.getElementById('uploading-indicator-text').textContent = 'Uploading press-release-final.pdf…';
  ind.classList.remove('hidden');
});
await sampleTransition(8, 150); // ~1.2s, catches the spinner mid-rotation
await page.evaluate(() => {
  document.getElementById('uploading-indicator').classList.add('hidden');
  const list = document.getElementById('files-list');
  const item = document.createElement('div');
  item.className = 'file-item demo-flash';
  item.innerHTML = `
    <div class="file-emoji" aria-hidden="true">📄</div>
    <div class="file-info">
      <div class="file-name">press-release-final.pdf</div>
      <div class="file-meta">840 KB · just now</div>
    </div>
    <div class="file-actions">
      <button class="file-action-btn download" aria-label="Download">⬇</button>
      <button class="file-action-btn delete" aria-label="Delete">✕</button>
    </div>`;
  list.appendChild(item);
});
await hold(2300);
await page.evaluate(() => {
  document.getElementById('panel-backdrop-demo').classList.remove('visible');
  document.getElementById('files-panel').classList.remove('open');
});
await sampleTransition(6, 45);
await hold(1300);

// ── Beat 6: end card ──────────────────────────────────────────────────────────
logBeat('End card');
await page.evaluate(() => {
  const card = document.createElement('div');
  card.className = 'demo-endcard';
  card.innerHTML = `<div class="demo-endcard-inner">
    <div class="demo-endcard-logo">Sync<span>Pad</span></div>
    <div class="demo-endcard-tag">Real-time sync. No account needed.</div>
  </div>`;
  document.body.appendChild(card);
  card.offsetHeight; // force layout before the opacity transition starts
  card.classList.add('in');
});
await sampleTransition(10, 90); // fade-in, ~0.8s
await hold(2300);

await browser.close();
server.kill();

// ── Assemble the frame sequence into an MP4 via ffmpeg's concat demuxer ─────
// (variable per-frame duration — not a fixed frame rate).
const listPath = path.join(framesDir, 'list.txt');
const listLines = manifest.map((m) => `file '${m.file}'\nduration ${(m.durationMs / 1000).toFixed(3)}`);
// The concat demuxer ignores the final entry's `duration` — repeating the
// last file once more (undurated) is the documented workaround.
listLines.push(`file '${manifest[manifest.length - 1].file}'`);
writeFileSync(listPath, listLines.join('\n') + '\n');

const outMp4 = path.join(videoDir, 'demo.mp4');
const outPoster = path.join(root, 'presskit', 'screenshot', 'demo-video-poster.png');
execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath,
  '-vf', 'fps=30,scale=1600:1000:flags=lanczos',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', '-an', outMp4], { stdio: 'inherit' });
execFileSync('ffmpeg', ['-y', '-i', outMp4, '-ss', '00:00:07', '-frames:v', '1', '-update', '1', outPoster], { stdio: 'inherit' });

rmSync(scratchDir, { recursive: true, force: true });
rmSync(framesDir, { recursive: true, force: true });

const totalMs = manifest.reduce((sum, m) => sum + m.durationMs, 0);
console.log(`\n${manifest.length} frames, ${(totalMs / 1000).toFixed(1)}s timeline`);
console.log(`Wrote ${path.relative(root, outMp4)}`);
console.log(`Wrote ${path.relative(root, outPoster)}`);
