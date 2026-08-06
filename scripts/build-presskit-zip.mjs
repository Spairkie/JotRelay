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
import { existsSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const presskitDir = path.join(__dirname, '..', 'presskit');
const outputName = 'SyncPad-Presskit.zip';
const outputPath = path.join(presskitDir, outputName);
const tmpPath = `${outputPath}.tmp`;

// Explicit member list (not "zip -r . ") so the archive can live inside
// presskit/ itself without ever trying to include its own previous copy.
const members = ['README.md', 'icon', 'screenshot', 'video'];

for (const member of members) {
  if (!existsSync(path.join(presskitDir, member))) {
    throw new Error(`presskit/${member} not found — run this from a clean checkout`);
  }
}

// Resolve to git's tracked file list rather than letting `zip -r` walk the
// directories directly — a raw directory walk would silently sweep in any
// untracked local cruft (.DS_Store, a stray export, a symlink) sitting under
// icon/screenshot/video into a binary that then gets committed and
// redistributed publicly.
const trackedFiles = execFileSync('git', ['ls-files', ...members], {
  cwd: presskitDir,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

if (trackedFiles.length === 0) {
  throw new Error('git ls-files returned no tracked files under presskit/ — check the checkout');
}

if (existsSync(tmpPath)) unlinkSync(tmpPath);

try {
  // No -r: trackedFiles is already a flat file list, not directories.
  execFileSync('zip', ['-X', '-q', tmpPath, ...trackedFiles], {
    cwd: presskitDir,
    stdio: 'inherit',
  });
} catch (err) {
  if (existsSync(tmpPath)) unlinkSync(tmpPath);
  if (err.code === 'ENOENT') {
    throw new Error('The `zip` CLI is required (apt install zip / brew install zip) but was not found on PATH.');
  }
  throw err;
}

// Atomic replace — build into a temp file and rename it into place only
// once `zip` has actually succeeded, so a missing/failing `zip` binary can
// never leave the working tree without the last good, already-committed
// archive.
renameSync(tmpPath, outputPath);

console.log(`Wrote presskit/${outputName} (${trackedFiles.length} files)`);
