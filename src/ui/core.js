// SyncPad – ui/core.js
// Split from the former monolithic ui.js — see src/ui.js for the barrel.
import { countWords, countChars, estimateReadingTime } from '../utils.js';

// ── Screen management ─────────────────────────────────────────────────────────

export function showScreen(name) {
  document.getElementById('landing-screen')?.classList.toggle('hidden',    name !== 'landing');
  document.getElementById('loading-screen')?.classList.toggle('hidden',    name !== 'loading');
  document.getElementById('passcode-screen')?.classList.toggle('hidden',   name !== 'passcode');
  document.getElementById('encryption-screen')?.classList.toggle('hidden', name !== 'encryption');
  document.getElementById('app-screen')?.classList.toggle('hidden',        name !== 'app');
  document.getElementById('info-screen')?.classList.toggle('hidden',       name !== 'info');
  document.getElementById('contact-screen')?.classList.toggle('hidden',    name !== 'contact');
  document.getElementById('privacy-screen')?.classList.toggle('hidden',    name !== 'privacy');
  document.getElementById('terms-screen')?.classList.toggle('hidden',      name !== 'terms');
  document.getElementById('admin-screen')?.classList.toggle('hidden',      name !== 'admin');
}

export function setInfoScreen({ title = '', message = '' } = {}) {
  const t = document.getElementById('info-title');
  const m = document.getElementById('info-message');
  if (t) t.textContent = title;
  if (m) m.textContent = message;
}

export function setLoadingMessage(msg) {
  const el = document.getElementById('loading-message');
  if (el) el.textContent = msg;
  // Hide any stale retry button when we're loading normally.
  const retryBtn = document.getElementById('loading-retry-btn');
  const spinner  = document.getElementById('loading-spinner');
  if (retryBtn) retryBtn.classList.add('hidden');
  if (spinner)  spinner.style.display = '';
}

/**
 * Switch the loading screen into an error state.
 * Shows the message, hides the spinner, and reveals the retry button.
 * @param {string} msg — error message to display
 * @param {() => void} onRetry — called when the user clicks "Try again"
 */
export function showLoadingError(msg, onRetry) {
  const msgEl    = document.getElementById('loading-message');
  const retryBtn = document.getElementById('loading-retry-btn');
  const spinner  = document.getElementById('loading-spinner');
  if (msgEl)    msgEl.textContent = msg;
  if (spinner)  spinner.style.display = 'none';
  if (retryBtn) {
    retryBtn.classList.remove('hidden');
    // Replace the old listener before adding the new one.
    retryBtn.onclick = () => {
      retryBtn.classList.add('hidden');
      if (spinner) spinner.style.display = '';
      if (onRetry) onRetry();
    };
  }
}

// ── Status indicator ──────────────────────────────────────────────────────────

const STATUS_MAP = {
  connected:    { dot: 'connected',    label: 'Connected' },
  saving:       { dot: 'saving',       label: 'Saving…' },
  saved:        { dot: 'saved',        label: 'Saved' },
  offline:      { dot: 'offline',      label: 'Offline — edits saved locally' },
  reconnecting: { dot: 'reconnecting', label: 'Reconnecting…' },
  error:        { dot: 'error',        label: 'Save failed' },
};

export function setStatus(key) {
  const s   = STATUS_MAP[key] || STATUS_MAP.connected;
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (dot)  dot.className  = `status-dot ${s.dot}`;
  if (text) text.textContent = s.label;
}

// ── Toast notifications ───────────────────────────────────────────────────────

export function showToast(message, type = '', duration = 2800) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className  = `toast${type ? ` ${type}` : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 260);
  }, duration);
}

// ── Word / char count ─────────────────────────────────────────────────────────

export function updateWordCount(text) {
  const w = countWords(text);
  const c = countChars(text);
  const mins = estimateReadingTime(text);
  const readingLabel = mins > 0 ? ` · ${mins} min read` : '';
  const label = `${w} word${w !== 1 ? 's' : ''} · ${c} char${c !== 1 ? 's' : ''}${readingLabel}`;
  const el = document.getElementById('word-count');
  if (el) el.textContent = label;
}

// ── Device count ──────────────────────────────────────────────────────────────

export function updateDeviceCount(n) {
  const el = document.getElementById('device-count');
  if (el) el.textContent = `${n} connected`;
}

let _footerClockTimer = null;
const _footerTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function updateFooterClock() {
  const btn = document.getElementById('btn-insert-ts');
  const timeEl = document.getElementById('footer-current-time');
  if (!btn || !timeEl) return;
  const currentTime = _footerTimeFormatter.format(new Date());
  timeEl.textContent = currentTime;
  const label = `Insert timestamp, current time ${currentTime}`;
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

export function initFooterClock() {
  updateFooterClock();
  if (_footerClockTimer) return;
  _footerClockTimer = window.setInterval(updateFooterClock, 60_000);
}

// ── Header / room info ────────────────────────────────────────────────────────

export function setRoomName({ roomId, roomName = '', canEditTitle = false } = {}) {
  const titleEl = document.getElementById('room-name');
  const pathEl = document.getElementById('room-path-label');
  const editBtn = document.getElementById('room-title-edit-btn');
  const normalizedName = (roomName || '').trim();
  const displayName = normalizedName || roomId || '';
  if (titleEl) titleEl.textContent = displayName;
  if (pathEl) {
    const showPath = !!roomId && !!normalizedName && normalizedName !== roomId;
    pathEl.textContent = `Room path: /${roomId || ''}`;
    pathEl.classList.toggle('hidden', !showPath);
  }
  if (editBtn) editBtn.classList.toggle('hidden', !canEditTitle);
}

export function setRoomTitleEditMode(editing, initialValue = '') {
  const display = document.getElementById('room-name-display');
  const editor = document.getElementById('room-title-editor');
  const input = document.getElementById('room-title-input');
  display?.classList.toggle('hidden', !!editing);
  editor?.classList.toggle('hidden', !editing);
  if (editing && input) {
    input.value = initialValue || '';
    input.focus();
    input.select();
  }
}

// ── Read-only / lock indicators ──────────────────────────────────────────────

export function setReadOnlyMode(on) {
  document.body.classList.toggle('read-only-mode', !!on);
  document.getElementById('readonly-badge')?.classList.toggle('hidden', !on);
  // Hide all action buttons that have no place in read-only mode.
  document.querySelectorAll('[data-readonly-hide]').forEach((el) => {
    el.classList.toggle('hidden', !!on);
  });
}

export function setLockedMode(on) {
  document.body.classList.toggle('lock-mode', !!on);
  document.getElementById('locked-badge')?.classList.toggle('hidden', !on);
}

export function showEncryptionLockedBanner(visible, onReload) {
  const bar = document.getElementById('enc-locked-bar');
  if (!bar) return;
  bar.classList.toggle('hidden', !visible);
  const btn = bar.querySelector('.enc-locked-reload-btn');
  if (btn && onReload) btn.onclick = onReload;
}

// ── Offline banner ────────────────────────────────────────────────────────────

export function showOfflineBanner() {
  document.getElementById('offline-banner')?.classList.add('visible');
}
export function hideOfflineBanner() {
  document.getElementById('offline-banner')?.classList.remove('visible');
}

// ── SW update bar ─────────────────────────────────────────────────────────────

export function showUpdateBar(onUpdate) {
  const bar = document.getElementById('sw-update-bar');
  if (!bar) return;
  bar.classList.add('visible');
  // Use .onclick (idempotent re-assignment) rather than addEventListener,
  // even with {once:true} — 'updatefound' can legitimately fire more than
  // once per session, and addEventListener would stack a new listener (each
  // closing over a different `worker`) before the first ever fires.
  const btn = bar.querySelector('.sw-update-btn');
  if (btn) btn.onclick = onUpdate;
}

// ── PWA install bar ───────────────────────────────────────────────────────────

export function showInstallBar(onInstall, onDismiss) {
  const bar = document.getElementById('pwa-install-bar');
  if (!bar) return;
  bar.classList.add('visible');
  const installBtn = bar.querySelector('.install');
  if (installBtn) installBtn.onclick = onInstall;
  const dismissBtn = bar.querySelector('.dismiss');
  if (dismissBtn) {
    dismissBtn.onclick = () => { bar.classList.remove('visible'); onDismiss?.(); };
  }
}

// ── Auth error helpers ────────────────────────────────────────────────────────

// Shared by every auth-screen error field (passcode, encryption): show a
// message and mark the input invalid, self-clearing on the field's next
// input. Uses .oninput (not addEventListener) so repeated calls never
// accumulate listeners — the handler clears itself after firing once.
function _showFieldError(inputId, errorId, msg) {
  const el    = document.getElementById(errorId);
  const input = document.getElementById(inputId);
  if (el) el.textContent = msg;
  if (input) { input.classList.add('error'); input.oninput = () => { _clearFieldError(inputId, errorId); input.oninput = null; }; }
}
function _clearFieldError(inputId, errorId) {
  const el    = document.getElementById(errorId);
  const input = document.getElementById(inputId);
  if (el) el.textContent = '';
  if (input) { input.classList.remove('error'); input.oninput = null; }
}

export function showPasscodeError(msg)  { _showFieldError('passcode-input', 'passcode-error', msg); }
export function clearPasscodeError()    { _clearFieldError('passcode-input', 'passcode-error'); }
export function showEncryptionError(msg) { _showFieldError('encryption-input', 'encryption-error', msg); }
export function clearEncryptionError()   { _clearFieldError('encryption-input', 'encryption-error'); }

