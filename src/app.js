// SyncPad – app.js
// Thin entry point: wires the file-image resolver and the passcode/
// encryption auth-gate forms (the only top-level DOM listeners that exist
// before a room is ever joined), pulls in the PWA/service-worker wiring for
// its side effects, and starts the router.
//
// Everything else — routing, the room join flow, startApp(), event wiring,
// and every feature area (editor behavior, comments, files, panels,
// export, command palette, etc.) — lives in src/app/*.js. See that
// directory's module list in CLAUDE.md for the per-file breakdown.

import { getDownloadUrl } from './files.js';
import * as LiveEditor from './live-editor.js';
import * as UI from './ui.js';
import { onPasscodeSubmit, onEncryptionSubmit, boot } from './app/room-lifecycle.js';
import './app/pwa.js';

// Pasted/dropped images reference a private-bucket file path (markdown.js's
// syncpad-file: scheme) rather than a baked-in URL, since a real signed URL
// expires in ~1h and can't just be stored in the note text. This resolver is
// stateless with respect to the current room, so it's wired once here rather
// than re-wired on every room join.
UI.setFileImageResolver(getDownloadUrl);
LiveEditor.setFileImageResolver(getDownloadUrl);

// ── Auth event binding (top-level, before boot) ───────────────────────────────

document.getElementById('passcode-submit-btn')
  ?.addEventListener('click', onPasscodeSubmit);
document.getElementById('passcode-input')
  ?.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPasscodeSubmit(); });

document.getElementById('encryption-submit-btn')
  ?.addEventListener('click', onEncryptionSubmit);
document.getElementById('encryption-input')
  ?.addEventListener('keydown', (e) => { if (e.key === 'Enter') onEncryptionSubmit(); });

// ── Start ─────────────────────────────────────────────────────────────────────

boot();
