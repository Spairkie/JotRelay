#!/usr/bin/env node
// Minimal SPA static server for Playwright tests.
// Serves the JotRelay project at /SyncPad/ with SPA fallback to index.html.
// Usage: node tests/spa-server.js (reads PORT from the environment, defaults to 5555)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5555;
const APP_ROOT = path.resolve(__dirname, '..');
const BASE = '/SyncPad';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt':  'text/plain',
  '.md':   'text/markdown',
  '.mp4':  'video/mp4',
  '.xml':  'application/xml',
};

const SPA_INDEX = path.join(APP_ROOT, 'index.html');

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const relativePath = urlPath === BASE
    ? '/'
    : urlPath.startsWith(`${BASE}/`)
      ? urlPath.slice(BASE.length)
      : urlPath;
  const filePath = path.join(APP_ROOT, relativePath);

  const tryServe = (fp) => {
    const ext = path.extname(fp).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    let stat;
    try { stat = fs.statSync(fp); } catch { return false; }
    if (!stat.isFile()) return false;

    // Range support (206 partial content) — Chromium's <video> loader sends
    // a Range request on the very first fetch (even for a small autoplay
    // loop) and aborts the whole load if the server ignores it and just
    // returns 200, so this matters for anything beyond plain text/JS/CSS.
    // Per RFC 7233: a missing start is a suffix range (bytes=-N -> last N
    // bytes, not "0 to N"), and an end past EOF is clamped to the last byte
    // rather than rejected — only a start at/past EOF is truly unsatisfiable.
    const range = req.headers.range;
    const rangeMatch = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (rangeMatch) {
      const hasStart = rangeMatch[1] !== '';
      const hasEnd = rangeMatch[2] !== '';
      let start, end;
      if (!hasStart && hasEnd) {
        const suffixLength = parseInt(rangeMatch[2], 10);
        start = Math.max(0, stat.size - suffixLength);
        end = stat.size - 1;
      } else {
        start = hasStart ? parseInt(rangeMatch[1], 10) : 0;
        end = hasEnd ? Math.min(parseInt(rangeMatch[2], 10), stat.size - 1) : stat.size - 1;
      }
      if (start >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return true;
      }
      res.writeHead(206, {
        'Content-Type': mime,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(fp, { start, end }).pipe(res);
      return true;
    }

    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    res.end(fs.readFileSync(fp));
    return true;
  };

  // Try exact file, then index.html in dir, then SPA fallback
  if (!tryServe(filePath)) {
    if (!tryServe(path.join(filePath, 'index.html'))) {
      // SPA fallback: serve /SyncPad/index.html for all /SyncPad/* routes
      if (urlPath.startsWith(`${BASE}/`) || urlPath === BASE) {
        tryServe(SPA_INDEX) || (res.writeHead(404), res.end('404'));
      } else {
        res.writeHead(404); res.end('Not Found');
      }
    }
  }
}).listen(PORT, () => console.log(`SPA server listening on http://localhost:${PORT}`));
