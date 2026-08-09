// SyncPad – app.js
// Thin entry point: wires the file-image resolver and the passcode/
// encryption auth-gate forms (the only top-level DOM listeners that exist
// before a room is ever joined), pulls in the PWA/service-worker wiring and
// the on-screen-keyboard viewport tracking for their side effects, and
// starts the router.
//
// Everything else — routing, the room join flow, startApp(), event wiring,
// and every feature area (editor behavior, comments, files, panels,
// export, command palette, etc.) — lives in src/app/*.js. See that
// directory's module list in CLAUDE.md for the per-file breakdown.

import { resolveFileRef } from './files.js';
import * as LiveEditor from './live-editor.js';
import * as UI from './ui.js';
import { onPasscodeSubmit, onEncryptionSubmit, boot } from './app/room-lifecycle.js';
import { state } from './app/state.js';
import './app/pwa.js';
import './keyboard-viewport.js';

// Pasted/dropped/inserted files reference a private-bucket file (markdown.js's
// syncpad-file: scheme — either a short per-room number or, for content
// written before that existed, a full legacy storage path) rather than a
// baked-in URL, since a real signed URL expires in ~1h and can't just be
// stored in the note text. resolveFileRef() needs the *current* room id
// (and, for an encrypted file, the current decryption key) which both
// change across navigations — read state.roomId/state.encKey at call time
// rather than capturing them, since this resolver is wired once here, not
// re-wired on every room join.
const _resolveRef = (ref) => resolveFileRef(state.roomId, ref, state.encKey);
UI.setFileImageResolver(_resolveRef);
LiveEditor.setFileImageResolver(_resolveRef);

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
