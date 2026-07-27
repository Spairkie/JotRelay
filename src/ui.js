// SyncPad – ui.js
// All DOM manipulation lives here. No business logic.
//
// This file is a barrel: the actual implementation lives in src/ui/, split
// by domain (see each file's own header comment for what it covers). Every
// existing `import { x } from './ui.js'` and `import * as UI from './ui.js'`
// across the app keeps working unchanged — re-exporting under the original
// names is the whole point of the split, not just a refactor detail.
//
//   ui/core.js            – screens, status, toasts, header, small indicators
//   ui/dialogs.js         – Confirm/Alert/Prompt modal primitives
//   ui/panels.js          – side-panel framework, Settings, Devices, Files
//                            list, Version history, Expiration, Theme picker
//   ui/editor.js          – editor surface: modes, Focus/Typewriter mode,
//                            scroll sync, TOC, slash menu, upload zone
//   ui/collab.js          – Cursor chat, Comments, remote-update notice,
//                            typing indicator
//   ui/feature-modals.js  – Command palette, Share modal, Templates modal
//
// Adding a new UI function: put it in whichever of the above it belongs to
// (or add a new src/ui/*.js file and re-export it below) — don't add it
// here directly.

export * from './ui/core.js';
export * from './ui/dialogs.js';
export * from './ui/panels.js';
export * from './ui/editor.js';
export * from './ui/collab.js';
export * from './ui/feature-modals.js';
