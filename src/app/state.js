// JotRelay – app/state.js
// Shared mutable state for the app/* modules — one object, imported by
// reference everywhere (mutate its properties, never reassign the binding),
// mirroring the pattern used by src/admin/state.js. Also home to the
// module-level constants every other app/* file needs (BASE, editor
// preference localStorage keys, the slash-menu item list).

// ── State ─────────────────────────────────────────────────────────────────────

// Room/session/editor-UI state, grouped into one mutable object rather than
// scattered module-level `let`s — every property below is reset on room
// navigation except the user-global editor prefs (stripPaste..hidePresence,
// filesSort), which persist across rooms by design.
export const state = {
  room: null,
  roomId: null,
  encKey: null, // CryptoKey | null
  encSalt: null,
  unsubRoom: null,
  unsubFiles: null,
  unsubComments: null,
  expTimer: null,
  revealTimer: null, // one-shot timer that re-runs joinRoom() once a timed-reveal room's reveal_at passes while the reveal-screen is showing
  scrollSaveTimer: null, // periodic persisted-scroll-position save — see scroll-memory.js
  onlineCleanup: null, // v1: teardown fn returned by onOnlineChange()
  monospace: false,
  eventsWired: false, // v1: guard against double-wiring
  consumingViewOnce: false, // v1: short-circuit own view-once clear echo
  viewOnceConsumedByThisSession: false, // session-local allowlist for first consumer view
  deviceLimitClearedByThisSession: false, // this device's own join is what hit the device-limit clear — content stays visible locally even though the server copy is already wiped
  isReadOnly: false, // ?mode=read or /share/:token (UI/UX convention, not server-enforced — see joinRoom())
  shareToken: null,
  markdownMode: 'write', // 'write' | 'preview' | 'split'
  showPreview: false, // derived: state.markdownMode !== 'write'
  previewObserverWired: false,
  expPreset: '10m',
  revealPreset: '10m',
  // Which remote device_id (if any) the local view auto-scrolls to follow.
  followedDeviceId: null,
  // Raw (not-yet-decrypted-for-display) comments from the last _refreshComments()
  // call — re-applied to the live surface whenever it (re)mounts, since
  // setCommentAnchors() silently no-ops while unmounted (e.g. the room loaded
  // straight into Write mode, where nothing is mounted yet to receive them).
  lastComments: [],
  // Which comment (if any) has its floating bubble expanded — see
  // _refreshFloatingComments()/_navigateComment().
  activeCommentId: null,
  slashOpen: false,
  slashStart: null, // editor offset of the triggering '/'
  slashCoords: null, // viewport coords, cached at open (the '/' doesn't move as the query grows)
  slashFiltered: [],
  slashActiveIndex: 0,
  searchMatches: [], // [{start,end}]
  searchIndex: -1,
  searchTerm: '',
  caseSensitive: false, // toggled by Aa button in F&R panel; reset on nav
  stripPaste: false, // set below, once its localStorage key const is in scope
  smartPunct: false, // set below, once its localStorage key const is in scope
  focusMode: false, // set below, once its localStorage key const is in scope
  typewriterMode: false, // set below, once its localStorage key const is in scope
  hidePresence: false, // set below, once its localStorage key const is in scope
  syncScroll: true, // set below, once its localStorage key const is in scope
  codeLineNumbers: false, // set below, once its localStorage key const is in scope
  filesSelectMode: false,
  selectedFiles: new Set(), // Set<file.id>
  filesSort: 'newest', // sort order for the files panel (not room-scoped)
  paletteFiltered: [],
  paletteActiveIndex: 0,
};

// ── Slash-command quick-insert menu items (Write mode only) ───────────────────

export const SLASH_MENU_ITEMS = [
  { id: 'h1',            label: 'Heading 1',         hint: '#',        keywords: 'h1 heading title' },
  { id: 'h2',            label: 'Heading 2',         hint: '##',       keywords: 'h2 heading subtitle' },
  { id: 'h3',            label: 'Heading 3',         hint: '###',      keywords: 'h3 heading' },
  { id: 'bold',          label: 'Bold',              hint: '**text**', keywords: 'bold strong' },
  { id: 'italic',        label: 'Italic',            hint: '_text_',   keywords: 'italic emphasis' },
  { id: 'strikethrough', label: 'Strikethrough',     hint: '~~text~~', keywords: 'strikethrough strike' },
  { id: 'highlight',     label: 'Highlight',         hint: '==text==', keywords: 'highlight mark' },
  { id: 'code',          label: 'Inline code',       hint: '`code`',   keywords: 'code inline' },
  { id: 'codeblock',     label: 'Code block',        hint: '```',      keywords: 'code block fence' },
  { id: 'link',          label: 'Link',              hint: '[text](url)', keywords: 'link url hyperlink' },
  { id: 'quote',         label: 'Quote',             hint: '>',        keywords: 'quote blockquote' },
  { id: 'ul',            label: 'Bullet list',       hint: '-',        keywords: 'bullet list unordered' },
  { id: 'ol',            label: 'Numbered list',     hint: '1.',       keywords: 'numbered list ordered' },
  { id: 'checklist',     label: 'Checklist',         hint: '- [ ]',    keywords: 'checklist todo task checkbox' },
  { id: 'hr',            label: 'Divider',           hint: '---',      keywords: 'divider horizontal rule line' },
  { id: 'toc',           label: 'Table of contents', hint: '[TOC]',    keywords: 'toc table contents outline' },
  { id: 'timestamp',     label: 'Insert timestamp',  hint: '',         keywords: 'timestamp time date now' },
  { id: 'template',      label: 'Insert template',   hint: '',         keywords: 'template' },
];

// ── Editor preferences (user-global, persisted to localStorage) ───────────────
export const _STRIP_PASTE_KEY = 'syncpad_strip_paste';
state.stripPaste = localStorage.getItem(_STRIP_PASTE_KEY) === 'true';
// Off by default — it rewrites what you actually typed, which is a bigger
// surprise than a purely visual preference, and some notes (code, URLs)
// need literal straight quotes/hyphens preserved.
export const _SMART_PUNCT_KEY = 'syncpad_smart_punct';
state.smartPunct = localStorage.getItem(_SMART_PUNCT_KEY) === 'true';
export const _FOCUS_MODE_KEY = 'syncpad_focus_mode';
state.focusMode = localStorage.getItem(_FOCUS_MODE_KEY) === 'true';
export const _TYPEWRITER_MODE_KEY = 'syncpad_typewriter_mode';
state.typewriterMode = localStorage.getItem(_TYPEWRITER_MODE_KEY) === 'true';
export const _HIDE_PRESENCE_KEY = 'syncpad_hide_presence';
state.hidePresence = localStorage.getItem(_HIDE_PRESENCE_KEY) === 'true';
// On by default — matches the always-on behavior this setting replaces.
export const _SYNC_SCROLL_KEY = 'syncpad_sync_scroll';
state.syncScroll = localStorage.getItem(_SYNC_SCROLL_KEY) !== 'false';
// Off by default — most snippets in a notes app are a handful of lines,
// where a gutter is just visual noise; opt in for longer/reference-y code.
export const _CODE_LINE_NUMBERS_KEY = 'syncpad_code_line_numbers';
state.codeLineNumbers = localStorage.getItem(_CODE_LINE_NUMBERS_KEY) === 'true';
// Which editor mode a room opens into. Defaults to Live (Preview) rather
// than Source — most reading/reviewing happens rendered, and Write is one
// segmented-control click away for anyone who wants raw markdown. Once a
// user picks a mode it's remembered like the other preferences above,
// including Write for anyone who prefers it. See _applyMarkdownMode(),
// which persists on every switch, and _resolveInitialEditorMode() below.
export const _EDITOR_MODE_KEY = 'syncpad_editor_mode';
export function _resolveInitialEditorMode() {
  const stored = localStorage.getItem(_EDITOR_MODE_KEY);
  return (stored === 'write' || stored === 'preview' || stored === 'split') ? stored : 'preview';
}

function _normalizeBasePath(basePath) {
  const raw = String(basePath || '').trim();
  if (!raw || raw === '/') return '';
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}

export const BASE = _normalizeBasePath(window.SYNCPAD_CONFIG?.basePath ?? '/JotRelay');
export const EXPIRATION_TIMER_MAX_DELAY_MS = 2147483647;

export function _stripBasePath(pathname) {
  if (!BASE) return pathname;
  return pathname === BASE || pathname.startsWith(`${BASE}/`)
    ? pathname.slice(BASE.length) || '/'
    : pathname;
}
