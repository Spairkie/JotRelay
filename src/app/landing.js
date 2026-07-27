// SyncPad – app/landing.js
// The landing screen (create/join room, recent rooms) and the static
// contact-form page.

import {
  generateRoomId, sanitizeRoomId, escapeHtml, formatTimestamp,
  buildRoomUrl, buildReadOnlyUrl,
} from '../utils.js';
import { getOrCreateReadOnlyShareLink, getOrCreateRoomCode, resolveRoomCode } from '../rooms.js';
import * as UI from '../ui.js';
import { state, BASE, _stripBasePath } from './state.js';
import { RESERVED_ROOM_PATHS, SHORT_CODE_RE, _loadRecentRooms, _forgetRecentRoom } from './routing.js';
import { joinRoom } from './room-lifecycle.js';

// ── Share modal ────────────────────────────────────────────────────────────────

export async function _openShareModal() {
  if (state.isReadOnly) {
    const currentReadOnlyUrl = location.origin + location.pathname + location.search + location.hash;
    UI.populateShareModal({
      editableUrl: '',
      readOnlyUrl: currentReadOnlyUrl,
      readOnlyError: false,
      roomPath: '',
      roomDisplayTitle: (state.room?.room_name || '').trim() || state.roomId,
      hasPasscode: !!state.room?.passcode_hash,
      hasEncryption: !!state.room?.encryption_enabled,
      hasReadOnlyLink: !!currentReadOnlyUrl,
      isEditingLocked: !!state.room?.editing_locked,
      hasViewOnce: !!state.room?.view_once,
      expiresAt: state.room?.expires_at || null,
      showRoomCode: false, // no room-owning identity in a read-only session to generate one from
    });
    UI.openModal('share-modal');
    return;
  }

  let readOnlyUrl = '';
  let readOnlyError = false;
  try {
    const share = await getOrCreateReadOnlyShareLink(state.roomId);
    readOnlyUrl = buildReadOnlyUrl(BASE, share?.token || '');
    if (!share?.token) readOnlyError = true;
  } catch {
    readOnlyError = true;
    UI.showToast('Could not create read-only link.', 'error');
  }
  let roomCode = '';
  let roomCodeError = false;
  try {
    roomCode = await getOrCreateRoomCode(state.roomId) || '';
    if (!roomCode) roomCodeError = true;
  } catch {
    roomCodeError = true;
  }
  UI.populateShareModal({
    editableUrl: buildRoomUrl(BASE, state.roomId),
    readOnlyUrl,
    readOnlyError,
    roomPath: `/${state.roomId}` ,
    roomDisplayTitle: (state.room?.room_name || '').trim() || state.roomId,
    hasPasscode: !!state.room?.passcode_hash,
    hasEncryption: !!state.room?.encryption_enabled,
    hasReadOnlyLink: !!readOnlyUrl,
    isEditingLocked: !!state.room?.editing_locked,
    hasViewOnce: !!state.room?.view_once,
    expiresAt: state.room?.expires_at || null,
    roomCode,
    roomCodeError,
  });
  UI.openModal('share-modal');
}

// ── Landing screen ────────────────────────────────────────────────────────────

export function wireLandingEvents() {
  const createBtn = document.getElementById('landing-create-btn');
  const joinInput = document.getElementById('landing-join-input');
  const joinBtn   = document.getElementById('landing-join-btn');

  const handleCreateRoomClick = () => {
    const roomId = generateRoomId();
    history.pushState(null, '', `${BASE}/${roomId}`);
    UI.showScreen('loading');
    joinRoom(roomId, { isNewRoom: true });
  };

  const joinRoom_ = async () => {
    const raw = joinInput?.value?.trim();
    if (!raw) return;

    if (SHORT_CODE_RE.test(raw)) {
      try {
        const resolvedId = await resolveRoomCode(raw);
        if (resolvedId) {
          history.pushState(null, '', `${BASE}/${resolvedId}`);
          UI.showScreen('loading');
          joinRoom(resolvedId);
          return;
        }
      } catch { /* fall through to the literal-room-id path below */ }
    }

    // Accept full URL (preserving ?mode= so a pasted read-only link keeps
    // working) or a bare ID.
    let id, qs = '';
    try {
      const url = new URL(raw);
      id = _stripBasePath(url.pathname).replace(/^\/+|\/+$/g, '');
      qs = url.search || '';
    } catch {
      id = raw;
    }
    id = sanitizeRoomId(id);
    if (!id) { joinInput.focus(); return; }
    if (RESERVED_ROOM_PATHS.has(id.toLowerCase())) {
      UI.showToast('That room name is reserved. Choose a different room ID.', 'warning');
      joinInput.focus();
      return;
    }
    history.pushState(null, '', `${BASE}/${id}${qs}`);
    UI.showScreen('loading');
    joinRoom(id);
  };

  createBtn?.addEventListener('click', handleCreateRoomClick);
  joinBtn?.addEventListener('click', joinRoom_);
  joinInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom_(); });

  _renderRecentRooms();
}

function _renderRecentRooms() {
  const container = document.getElementById('landing-recent');
  const list = document.getElementById('landing-recent-list');
  if (!container || !list) return;
  const rooms = _loadRecentRooms();
  if (!rooms.length) { container.classList.add('hidden'); list.innerHTML = ''; return; }
  container.classList.remove('hidden');
  list.innerHTML = rooms.map((r) => `
    <div class="landing-recent-item">
      <button class="landing-recent-item-btn" data-room-id="${escapeHtml(r.id)}">
        <span class="landing-recent-name">${escapeHtml(r.name)}</span>
        <span class="landing-recent-time">${escapeHtml(formatTimestamp(r.visitedAt))}</span>
      </button>
      <button class="landing-recent-remove" data-remove-id="${escapeHtml(r.id)}" title="Remove from recent rooms" aria-label="Remove ${escapeHtml(r.name)} from recent rooms">×</button>
    </div>`).join('');
  list.querySelectorAll('.landing-recent-item-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const roomId = btn.dataset.roomId;
      history.pushState(null, '', `${BASE}/${roomId}`);
      UI.showScreen('loading');
      joinRoom(roomId);
    });
  });
  list.querySelectorAll('.landing-recent-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      _forgetRecentRoom(btn.dataset.removeId);
      _renderRecentRooms();
    });
  });
}

// ── Contact form ──────────────────────────────────────────────────────────────

let _contactEventsWired = false;

function _getWeb3FormsKey() {
  return (window.SYNCPAD_CONFIG?.web3FormsAccessKey || '').trim();
}

function _isPlaceholderWeb3Key(key) {
  const normalized = (key || '').toLowerCase();
  return !normalized || normalized.includes('replace') || normalized.includes('placeholder') || normalized.includes('your_');
}

export function wireContactEvents() {
  if (_contactEventsWired) return;
  _contactEventsWired = true;

  const form = document.getElementById('contact-form');
  const status = document.getElementById('contact-status');
  const submit = document.getElementById('contact-submit');
  if (!form || !status || !submit) return;

  const key = _getWeb3FormsKey();
  const configured = !_isPlaceholderWeb3Key(key);

  if (!configured) {
    submit.disabled = true;
    status.textContent = 'Contact form is not configured yet.';
    status.className = 'contact-status warning';
    return;
  }

  const sentFlag = new URLSearchParams(location.search).get('sent');
  if (sentFlag === '1') {
    status.textContent = 'Thanks! Your message was sent successfully.';
    status.className = 'contact-status success';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    status.textContent = 'Sending message…';
    status.className = 'contact-status';

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.access_key = key;

    try {
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.message || 'Submit failed');
      status.textContent = 'Message sent successfully.';
      status.className = 'contact-status success';
      form.reset();
      history.replaceState(null, '', `${BASE}/contact?sent=1`);
    } catch (err) {
      status.textContent = 'Could not send message right now. Please try again later.';
      status.className = 'contact-status error';
      submit.disabled = false;
    }
  });
}
