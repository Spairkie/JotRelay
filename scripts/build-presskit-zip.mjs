// Zips the presskit's public assets into a single downloadable archive.
//
// Journalists/reviewers land on presskit/README.md and shouldn't have to
// pull individual files out of icon/, screenshot/, and video/ by hand — one
// archive next to the README covers everything in one click. Shells out to
// the `zip` CLI (same pattern as generate-demo-video.mjs shelling out to
// ffmpeg) rather than adding a JS zip dependency for a single dev script.
//
// Usage: node scripts/build-presskit-zip.mjs   (or `npm run presskit:zip`)

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const presskitDir = path.join(__dirname, '..', 'presskit');
const outputName = 'SyncPad-Presskit.zip';
const outputPath = path.join(presskitDir, outputName);

// Explicit member list (not "zip -r . ") so the archive can live inside
// presskit/ itself without ever trying to include its own previous copy.
const members = ['README.md', 'icon', 'screenshot', 'video'];

for (const member of members) {
  if (!existsSync(path.join(presskitDir, member))) {
    throw new Error(`presskit/${member} not found — run this from a clean checkout`);
  }
}

if (existsSync(outputPath)) rmSync(outputPath);

try {
  execFileSync('zip', ['-r', '-X', '-q', outputName, ...members], {
    cwd: presskitDir,
    stdio: 'inherit',
  });
} catch (err) {
  if (err.code === 'ENOENT') {
    throw new Error('The `zip` CLI is required (apt install zip / brew install zip) but was not found on PATH.');
  }
  throw err;
}

console.log(`Wrote presskit/${outputName}`);
