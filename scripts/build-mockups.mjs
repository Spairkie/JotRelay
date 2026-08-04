// SyncPad — presskit screenshot mockup builder.
//
// Pulls real screens (app shell, side panels, share modal, encryption
// gate) out of the live index.html by id and drops them into small,
// self-contained HTML documents under scripts/mockups/, wired up with
// realistic placeholder content and the app's *actual* stylesheets. This
// keeps presskit screenshots visually identical to the real product
// without touching Supabase or any network service — the app's real JS
// never runs, we just set the same classes/DOM state its JS would.
//
// Run this, then scripts/generate-screenshots.mjs to rasterize each one.
// Re-run both after any visual change to header/editor/panels/share-modal
// so the presskit stays in sync with the app.
//
// Usage:  node scripts/build-mockups.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractElementById } from './lib/extract-fragment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const outDir = path.join(root, 'scripts', 'mockups');
mkdirSync(outDir, { recursive: true });

const appScreen      = extractElementById(html, 'app-screen');
const filesPanel      = extractElementById(html, 'files-panel');
const presencePanel   = extractElementById(html, 'presence-panel');
const shareModal      = extractElementById(html, 'share-modal');
const encryptionScreen = extractElementById(html, 'encryption-screen');

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

function page(title, theme, bodyHtml, extraStyle = '') {
  return `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ''}>
<head>
<meta charset="UTF-8" />
<title>${title}</title>
${STYLES}
<style>
  body { overflow: visible !important; }
  #app-screen { position: static !important; display: flex !important; }
  .mockup-cursor {
    position: absolute; display: flex; align-items: center; gap: 6px;
    pointer-events: none; z-index: 50; transform: translateY(-2px);
  }
  .mockup-cursor .flag {
    font-size: 11px; font-weight: 600; color: #0f0f11; padding: 2px 8px;
    border-radius: 20px; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.35);
  }
  .mockup-cursor .bar { width: 2px; height: 20px; border-radius: 2px; }
  ${extraStyle}
</style>
</head>
<body class="mockup-body">
${bodyHtml}
</body>
</html>`;
}

function replaceText(fragment, id, text) {
  const re = new RegExp(`(id="${id}"[^>]*>)([^<]*)(<)`);
  return fragment.replace(re, (_, open, _old, close) => `${open}${text}${close}`);
}

// Attribute order in the real markup isn't consistent (some elements have
// class before id, some after) — locate the whole opening tag for `id`
// first, then only ever touch its class="..." within those bounds.
function openTagRange(fragment, id) {
  const idAttr = `id="${id}"`;
  const idIdx = fragment.indexOf(idAttr);
  if (idIdx === -1) throw new Error(`openTagRange: no element with id="${id}"`);
  const start = fragment.lastIndexOf('<', idIdx);
  const end = fragment.indexOf('>', idIdx);
  return [start, end];
}
function unhide(fragment, id) {
  const [start, end] = openTagRange(fragment, id);
  const tag = fragment.slice(start, end + 1).replace(/\bhidden\b\s*/, '');
  return fragment.slice(0, start) + tag + fragment.slice(end + 1);
}
function addClass(fragment, id, cls) {
  const [start, end] = openTagRange(fragment, id);
  const tag = fragment.slice(start, end + 1).replace(/class="([^"]*)"/, (_, existing) => `class="${existing} ${cls}"`);
  return fragment.slice(0, start) + tag + fragment.slice(end + 1);
}
function setInner(fragment, id, inner) {
  const idAttr = `id="${id}"`;
  const idIdx = fragment.indexOf(idAttr);
  if (idIdx === -1) throw new Error(`setInner: no element with id="${id}"`);
  const openEnd = fragment.indexOf('>', idIdx) + 1;
  const tagMatch = /^<([a-zA-Z0-9-]+)/.exec(fragment.slice(fragment.lastIndexOf('<', idIdx)));
  const tag = tagMatch[1];
  const closeIdx = fragment.indexOf(`</${tag}>`, openEnd);
  return fragment.slice(0, openEnd) + inner + fragment.slice(closeIdx);
}

const PREVIEW_CONTENT = `
  <h1>Q3 Product Roadmap</h1>
  <p>Shared with the team ahead of Thursday's planning call. Comments welcome — this is a living draft.</p>
  <h2>Launch checklist</h2>
  <div class="md-checklist-progress">3/5 done</div>
  <ul>
    <li class="md-task"><label><input type="checkbox" checked disabled />Finalize onboarding flow copy</label></li>
    <li class="md-task"><label><input type="checkbox" checked disabled />Ship encrypted-room passphrase UI</label></li>
    <li class="md-task"><label><input type="checkbox" checked disabled />Design review with Priya</label></li>
    <li class="md-task"><label><input type="checkbox" disabled />Load-test realtime broadcast at 50 devices/room</label></li>
    <li class="md-task"><label><input type="checkbox" disabled />Write release notes</label></li>
  </ul>
  <h2>Notes</h2>
  <p>Realtime sync is holding steady at <strong>~230&nbsp;ms</strong> broadcast latency in staging. File handoff is the one area still needing polish — see thread below.</p>
  <pre><code>POST /rooms/:id/files
&lt;10MB, signed URL, 1h TTL</code></pre>
  <p>— <em>Jordan</em>, 9:41&nbsp;AM</p>
`;

// ── 1. Desktop editor ────────────────────────────────────────────────────
{
  let s = appScreen;
  s = replaceText(s, 'room-name', 'Q3 Product Roadmap');
  s = replaceText(s, 'status-text', 'Connected');
  s = replaceText(s, 'device-count', '3 connected');
  s = s.replace('<div id="note-preview" class="note-preview hidden"', '<div id="note-preview" class="note-preview"');
  s = s.replace('<textarea id="note-editor"', '<textarea id="note-editor" class="hidden"');
  s = s.replace('id="md-toolbar" class="md-toolbar"', 'id="md-toolbar" class="md-toolbar hidden"');
  s = s.replace('data-mode="write"   aria-pressed="true"', 'data-mode="write"   aria-pressed="false"');
  s = s.replace('class="md-seg-btn active" data-mode="write"', 'class="md-seg-btn" data-mode="write"');
  s = s.replace('class="md-seg-btn"        data-mode="preview" aria-pressed="false"', 'class="md-seg-btn active" data-mode="preview" aria-pressed="true"');
  s = setInner(s, 'note-preview', PREVIEW_CONTENT);
  s = s.replace('>0 words · 0 chars<', '>142 words · 918 chars<');
  writeFileSync(path.join(outDir, 'desktop-editor.html'), page('Desktop editor', null, s));
}

// ── 2. Live collaboration (presence panel open, mid-edit) ───────────────
{
  let s = appScreen;
  s = replaceText(s, 'room-name', 'Launch Retro — Live Notes');
  s = replaceText(s, 'status-text', 'Connected');
  s = replaceText(s, 'device-count', '4 connected');
  s = addClass(s, 'typing-indicator', '');
  s = s.replace('<div class="typing-indicator hidden" id="typing-indicator"></div>',
    '<div class="typing-indicator" id="typing-indicator">Priya is typing…</div>');
  const devices = [
    { name: "Priya's MacBook Pro", role: 'editor', activity: 'Typing…', typingClass: ' typing', me: false },
    { name: "Jordan — iPad", role: 'editor', activity: 'Near line 18', typingClass: '', me: false },
    { name: 'Alex — Pixel 8', role: 'viewer', activity: 'Viewing', typingClass: '', me: false },
    { name: 'This device', role: 'editor', activity: '', typingClass: '', me: true },
  ];
  const devicesHtml = devices.map((d) => `
    <div class="device-item${d.me ? ' me' : ''}${d.typingClass}" role="listitem">
      <div class="device-info">
        <span class="device-name">${d.name}${d.me ? ' (you)' : ''}</span>
        <span class="device-role">${d.role}</span>
      </div>
      ${d.activity ? `<span class="device-activity${d.typingClass ? ' typing' : ''}">${d.activity}</span>` : ''}
    </div>`).join('');
  let panel = presencePanel.replace('<div id="devices-list"></div>', `<div id="devices-list">${devicesHtml}</div>`);
  panel = addClass(panel, 'presence-panel', 'open');
  s = s.replace('<textarea id="note-editor"', '<textarea id="note-editor"');
  s = s.replace(/(<textarea id="note-editor"[^>]*>)([\s\S]*?)(<\/textarea>)/,
    `$1## Launch Retro — Live Notes\n\nWhat went well:\n- Realtime sync held up under load\n- Read-only links made stakeholder review painless\n\nWhat to improve:\n- File handoff needs a progress indicator\n- $3`);
  s = s.replace('>0 words · 0 chars<', '>38 words · 231 chars<');
  s = s.replace('>Time<', '>9:52 AM<');
  writeFileSync(path.join(outDir, 'live-collaboration.html'), page('Live collaboration', 'midnight-blue', s + '<div class="panel-backdrop visible"></div>' + panel));
}

// ── 3. Encrypted note (passphrase gate) ──────────────────────────────────
{
  let s = encryptionScreen;
  s = s.replace('class="auth-screen hidden"', 'class="auth-screen"');
  s = s.replace('<div class="room-badge" id="encryption-room-badge"></div>',
    '<div class="room-badge" id="encryption-room-badge">quiet-harbor-42</div>');
  // Cropped out of this press image: .auth-screen lays legal-links out as a
  // flex row sibling of .auth-card (a pre-existing app quirk, not something
  // to silently "fix" here), which reads as an overlap at this crop size.
  s = s.replace(/<div class="legal-links"[\s\S]*?<\/div>\s*$/, '');
  writeFileSync(path.join(outDir, 'encrypted-note.html'), page('Encrypted note', null, s));
}

// ── 4. File handoff (files panel open) ───────────────────────────────────
{
  let s = appScreen;
  s = replaceText(s, 'room-name', 'Client Handoff — Meridian');
  s = replaceText(s, 'status-text', 'Connected');
  s = replaceText(s, 'device-count', '2 connected');
  const files = [
    { emoji: '🖼️', name: 'homepage-hero-v3.png', meta: '2.4 MB · 4 min ago' },
    { emoji: '📄', name: 'meridian-brand-brief.pdf', meta: '810 KB · 1 hr ago' },
    { emoji: '📊', name: 'q3-budget.xlsx', meta: '96 KB · 2 hr ago' },
    { emoji: '🎬', name: 'walkthrough-recording.mp4', meta: '18.2 MB · yesterday' },
    { emoji: '📝', name: 'contract-redline.docx', meta: '54 KB · yesterday' },
  ];
  const filesHtml = files.map((f) => `
    <div class="file-item" role="listitem">
      <div class="file-emoji" aria-hidden="true">${f.emoji}</div>
      <div class="file-info">
        <div class="file-name">${f.name}</div>
        <div class="file-meta">${f.meta}</div>
      </div>
      <div class="file-actions">
        <button class="file-action-btn download" aria-label="Download">⬇</button>
        <button class="file-action-btn delete" aria-label="Delete">✕</button>
      </div>
    </div>`).join('');
  let panel = filesPanel.replace('<div id="files-list"></div>', `<div id="files-list">${filesHtml}</div>`);
  panel = addClass(panel, 'files-panel', 'open');
  writeFileSync(path.join(outDir, 'file-handoff.html'), page('File handoff', 'forest-green', s + '<div class="panel-backdrop visible"></div>' + panel));
}

// ── 5. Room sharing / read-only (share modal open) ───────────────────────
{
  let s = appScreen;
  s = replaceText(s, 'room-name', 'Design Crit — Sprint 14');
  s = replaceText(s, 'status-text', 'Connected');
  s = replaceText(s, 'device-count', '5 connected');
  let modal = shareModal;
  modal = modal.replace('id="share-modal-title">Share room<', 'id="share-modal-title">Share "Design Crit — Sprint 14"<');
  modal = modal.replace('id="share-editable-text" type="text" readonly',
    'id="share-editable-text" type="text" readonly value="syncpad.app/design-crit-sprint-14"');
  modal = modal.replace('id="share-readonly-text" type="text" readonly',
    'id="share-readonly-text" type="text" readonly value="syncpad.app/share/8f2c1a9e5d"');
  modal = modal.replace('id="share-code-text" type="text" readonly',
    'id="share-code-text" type="text" readonly value="7QK9M2"');
  modal = addClass(modal, 'share-modal', 'visible');
  writeFileSync(path.join(outDir, 'room-sharing.html'), page('Room sharing', 'lavender-light', s + modal));
}

// ── 6. Mobile responsive view ─────────────────────────────────────────────
{
  let s = appScreen;
  s = replaceText(s, 'room-name', 'Grocery List 🛒');
  s = replaceText(s, 'status-text', 'Connected');
  s = replaceText(s, 'device-count', '2 connected');
  s = s.replace(/(<textarea id="note-editor"[^>]*>)([\s\S]*?)(<\/textarea>)/,
    `$1# Grocery List\n\n- [x] Oat milk\n- [x] Sourdough\n- [ ] Basil\n- [ ] Parmesan\n- [ ] Coffee beans (the good ones)\n\nAdding as I think of them — synced to Sam's phone already.$3`);
  s = s.replace('>0 words · 0 chars<', '>27 words · 156 chars<');
  s = s.replace('>Time<', '>6:14 PM<');
  writeFileSync(path.join(outDir, 'mobile-responsive.html'), page('Mobile responsive', 'mocha-dark', s));
}

console.log(`Wrote 6 mockups to ${path.relative(root, outDir)}/`);
