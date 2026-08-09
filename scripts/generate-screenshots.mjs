// JotRelay — presskit screenshot generator.
// Serves the repo with tests/spa-server.js (no network/Supabase calls
// involved) and rasterizes scripts/mockups/*.html into presskit/screenshot/.
//
// Usage:  node scripts/build-mockups.mjs && node scripts/generate-screenshots.mjs
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const PORT = 5599;

const shots = [
  { file: 'desktop-editor.html',     out: 'desktop-editor.png',     width: 1440, height: 900 },
  { file: 'live-collaboration.html', out: 'live-collaboration.png', width: 1440, height: 900 },
  { file: 'encrypted-note.html',     out: 'encrypted-note.png',     width: 1280, height: 800 },
  { file: 'file-handoff.html',       out: 'file-handoff.png',       width: 1440, height: 900 },
  { file: 'room-sharing.html',       out: 'room-sharing.png',       width: 1440, height: 900 },
  { file: 'mobile-responsive.html',  out: 'mobile-responsive.png',  width: 430,  height: 932 },
];

const server = spawn('node', ['tests/spa-server.js'], {
  cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe',
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('spa-server did not start in time')), 8000);
  server.stdout.on('data', (d) => { if (String(d).includes('http://')) { clearTimeout(t); resolve(); } });
  server.stderr.on('data', (d) => process.stderr.write(d));
});

const browser = await chromium.launch();
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
    await page.goto(`http://localhost:${PORT}/scripts/mockups/${shot.file}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(root, 'presskit', 'screenshot', shot.out) });
    await page.close();
    console.log(`wrote presskit/screenshot/${shot.out}`);
  }
} finally {
  await browser.close();
  server.kill();
}
