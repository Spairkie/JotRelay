// JotRelay – ui/panels.js
// Split from the former monolithic ui.js — see src/ui.js for the barrel.
import { formatFileSize, fileEmoji, formatTimestamp, relativeTimeShort, escapeHtml, colorForDevice } from '../utils.js';
import { getIcon } from '../icons.js';

/** Return a human-readable "in X" string for an ISO expiry date. */
function _expiresIn(isoDate) {
  const ms = new Date(isoDate) - Date.now();
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  if (s < 120)  return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 120)  return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48)   return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

// ── Panels ────────────────────────────────────────────────────────────────────

const PANEL_IDS = ['tools-panel', 'files-panel', 'presence-panel', 'settings-panel', 'search-panel', 'history-panel', 'comments-panel'];
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Unlike every modal dialog, side panels didn't move focus into themselves
// or trap Tab within them — a keyboard/screen-reader user opening Files or
// Settings stayed focused on whatever button they just clicked, with no
// indication focus had moved anywhere. Tracks the trap's cleanup + the
// triggering element so closeAllPanels() can tear it down and hand focus back.
let _panelFocusTrap = null;

function _panelFocusables(panel) {
  return Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter(el => el.offsetParent !== null);
}

// dimBackdrop: false for Find & Replace — it floats as a compact card over
// the editor rather than a full-height drawer (see #search-panel in
// modals.css), and the whole point is watching matches highlighted in the
// actual document while navigating them, which a dimmed, click-to-close
// backdrop would defeat.
export function openPanel(id, { dimBackdrop = true } = {}) {
  const trigger = document.activeElement;
  closeAllPanels();
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.classList.add('open');
  if (dimBackdrop) document.getElementById('panel-backdrop')?.classList.add('visible');

  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = _panelFocusables(panel);
    if (!items.length) return;
    const first = items[0];
    const last  = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  _panelFocusTrap = { trigger, onKey };

  requestAnimationFrame(() => {
    // Don't override a focus target the caller already set explicitly right
    // after calling openPanel() (e.g. the Find & Replace shortcut focusing
    // #search-input specifically, rather than whatever's first in the
    // panel's DOM order) — only fall back to focusing the first focusable
    // item when nothing in the panel has focus yet.
    if (panel.contains(document.activeElement)) return;
    const items = _panelFocusables(panel);
    (items[0] || panel).focus();
  });
}

export function closeAllPanels() {
  PANEL_IDS.forEach(p => document.getElementById(p)?.classList.remove('open'));
  document.getElementById('panel-backdrop')?.classList.remove('visible');
  if (_panelFocusTrap) {
    document.removeEventListener('keydown', _panelFocusTrap.onKey);
    const { trigger } = _panelFocusTrap;
    _panelFocusTrap = null;
    if (trigger?.focus && document.body.contains(trigger)) trigger.focus();
  }
}

export function togglePanel(id) {
  const el = document.getElementById(id);
  el?.classList.contains('open') ? closeAllPanels() : openPanel(id);
}

// ── Settings panel ────────────────────────────────────────────────────────────

export function renderSettingsPanel(room) {
  const pcStatus  = document.getElementById('setting-passcode-status');
  const encStatus = document.getElementById('setting-enc-status');
  const expStatus = document.getElementById('setting-exp-status');
  const voStatus  = document.getElementById('setting-vo-status');
  const lockStatus = document.getElementById('setting-lock-status');
  const dlStatus  = document.getElementById('setting-dl-status');

  if (pcStatus)  pcStatus.textContent  = room.passcode_hash      ? 'Protected'  : 'None';
  if (encStatus) encStatus.textContent = room.encryption_enabled ? 'Enabled for note text' : 'Off';
  if (expStatus) expStatus.textContent = room.expires_at
    ? `${new Date(room.expires_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} (${_expiresIn(room.expires_at)})`
    : 'Never';
  if (voStatus) {
    voStatus.textContent = !room.view_once ? 'Off'
      : room.viewed || room.cleared_reason === 'view_once' ? 'Used (cleared)'
      : 'Armed';
  }
  if (lockStatus) lockStatus.textContent = room.editing_locked ? 'Locked' : 'Unlocked';
  if (dlStatus) {
    dlStatus.textContent = room.cleared_reason === 'device_limit' ? 'Used (cleared)'
      : room.device_limit ? `Armed — clears after ${room.device_limit} device${room.device_limit === 1 ? '' : 's'}`
      : 'Off — clear the note after N different devices have joined';
  }

  // Action button labels
  const pcBtn   = document.getElementById('setting-passcode-btn');
  const encBtn  = document.getElementById('setting-enc-btn');
  const expBtn  = document.getElementById('setting-exp-btn');
  const voBtn   = document.getElementById('setting-vo-btn');
  const lockBtn = document.getElementById('setting-lock-btn');
  const dlBtn   = document.getElementById('setting-dl-btn');
  const dlInput = document.getElementById('setting-dl-input');

  if (pcBtn)   pcBtn.textContent   = room.passcode_hash      ? 'Remove'  : 'Set';
  if (encBtn)  encBtn.textContent  = room.encryption_enabled ? 'Disable' : 'Enable';
  // 'Modify' when an expiration is already set — the actual Remove button is
  // inside the collapsible controls section (setting-exp-remove-btn).
  if (expBtn)  expBtn.textContent  = room.expires_at         ? 'Modify'  : 'Set expiry';
  if (voBtn)   voBtn.textContent   = room.view_once          ? 'Disable' : 'Enable';
  if (lockBtn) lockBtn.textContent = room.editing_locked     ? 'Unlock'  : 'Lock';
  if (dlBtn)   dlBtn.textContent   = room.device_limit       ? 'Disable' : 'Enable';
  if (dlInput) dlInput.disabled    = !!room.device_limit;
}

// ── Devices list (presence panel) ─────────────────────────────────────────────

// Tracks other devices' state across renders so join/leave/started-typing
// transitions can be announced to screen readers. null means "not primed for
// this room yet" — the first render after joining seeds this without
// announcing anything, since devices already in the room aren't "joining"
// from this user's perspective. Reset on room navigation via resetPresenceAnnouncer().
let _prevDeviceStates = null;

/** Must be called on room navigation so a new room's first render doesn't
 *  announce its already-present devices as having just joined. */
export function resetPresenceAnnouncer() {
  _prevDeviceStates = null;
}

function _announcePresenceChanges(devices, myDeviceId) {
  const region = document.getElementById('presence-live-region');
  const others = devices.filter(d => d.device_id && d.device_id !== myDeviceId);
  const nextStates = new Map();

  if (_prevDeviceStates === null) {
    others.forEach(d => nextStates.set(d.device_id, { typing: !!d.typing, name: d.device_name || 'A device' }));
    _prevDeviceStates = nextStates;
    return;
  }

  const messages = [];
  others.forEach((d) => {
    const name = d.device_name || 'A device';
    const prev = _prevDeviceStates.get(d.device_id);
    // Per-keystroke cursor-line movement is deliberately not announced here —
    // only join/leave/started-typing, or a live region would fire constantly.
    if (!prev) messages.push(`${name} joined.`);
    else if (!prev.typing && d.typing) messages.push(`${name} started typing.`);
    nextStates.set(d.device_id, { typing: !!d.typing, name });
  });
  _prevDeviceStates.forEach((prev, id) => {
    if (!nextStates.has(id)) messages.push(`${prev.name} left.`);
  });

  _prevDeviceStates = nextStates;
  if (region && messages.length) region.textContent = messages.join(' ');
}

export function renderDevicesList(devices, myDeviceId, onNameChange, { followedDeviceId = null, onToggleFollow = null } = {}) {
  const list = document.getElementById('devices-list');
  if (!list) return;
  // This re-renders on every presence 'sync' — which fires for ANY
  // connected device's typing/cursor activity, not just changes relevant to
  // this list — so a full rebuild while the rename input is mid-edit would
  // yank focus and the caret out from under whatever the user is currently
  // typing. Skip the rebuild entirely until they blur/submit; the 'change'
  // handler below re-tracks presence itself, which triggers a fresh render
  // reflecting anything that was missed in the meantime.
  if (list.contains(document.activeElement) && document.activeElement?.classList.contains('device-name-edit')) {
    return;
  }
  _announcePresenceChanges(devices, myDeviceId);
  list.setAttribute('role', 'list');
  list.innerHTML = '';
  if (!devices.length) {
    list.innerHTML = '<div class="device-empty">No other devices connected</div>';
    return;
  }
  devices.forEach(device => {
    const isMe = device.device_id === myDeviceId;
    const isFollowed = !isMe && !!device.device_id && device.device_id === followedDeviceId;
    const item = document.createElement('div');
    item.className = `device-item${isMe ? ' me' : ''}${device.read_only ? ' viewer' : ''}${device.typing ? ' typing' : ''}`;
    item.setAttribute('role', 'listitem');
    item.dataset.deviceId = device.device_id || '';

    const roBadge = device.read_only
      ? '<span class="device-role">viewer</span>'
      : '<span class="device-role">editor</span>';

    // Activity sub-text: typing beats cursor line
    let activityHtml = '';
    if (!isMe) {
      if (device.typing) {
        activityHtml = '<span class="device-activity typing">Typing…</span>';
      } else if (Number.isFinite(device.cursor_line)) {
        // cursor_line comes from Supabase Presence, settable by any connected
        // peer with no server-side validation — type-guard it to a finite
        // number (its only legitimate shape) rather than trusting it blindly,
        // and still escape it before it reaches innerHTML.
        activityHtml = `<span class="device-activity">Near line ${escapeHtml(String(device.cursor_line))}</span>`;
      } else if (device.read_only) {
        activityHtml = '<span class="device-activity muted">Viewing</span>';
      }
    }

    // "Joined 5m ago" — a quiet, always-present anchor for how long a peer
    // has actually been here, independent of (and shown alongside) whatever
    // they're doing right now.
    const joinedHtml = !isMe && device.joined_at
      ? `<span class="device-joined" title="Joined ${new Date(device.joined_at).toLocaleTimeString()}">${escapeHtml(relativeTimeShort(device.joined_at))}</span>`
      : '';

    // Reciprocal of the follow feature below: if anyone else has this
    // device as their followed target, say so on ITS OWN row (each device
    // only ever sees this on itself, not on others — following is a local
    // choice, so device A can't tell whether device B is following device
    // C, only whether device B is following device A).
    const followedByHtml = isMe && device.followedByCount > 0
      ? `<span class="device-followed-by" title="${device.followedByCount} device${device.followedByCount === 1 ? '' : 's'} following your cursor">👀 Followed by ${device.followedByCount}</span>`
      : '';

    const followBtnHtml = !isMe
      ? `<button type="button" class="device-follow-btn${isFollowed ? ' is-active' : ''}" aria-pressed="${isFollowed}" title="${isFollowed ? 'Stop following this device' : 'Follow this device — jump your view to where they are'}" aria-label="${isFollowed ? 'Stop following' : 'Follow'} ${escapeHtml(device.device_name || 'this device')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg></button>`
      : '';

    // Same colour this device's caret/selection renders in inside the Live
    // editor surface (see live-editor.js's colorForDevice()) — lets you
    // match "who's editing near line 12 in that colour" to a name here.
    const dotColor = escapeHtml(colorForDevice(device.device_id));

    item.innerHTML = `
      <div class="device-dot" style="background:${dotColor}"></div>
      <div class="device-info">
        ${isMe
          ? `<input class="device-name device-name-edit" value="${escapeHtml(device.device_name || '')}" maxlength="32" title="Tap to rename your device" aria-label="Your device name" />`
          : `<div class="device-name device-name-text">${escapeHtml(device.device_name || 'Unknown device')}</div>`
        }
        <div class="device-meta">${roBadge}${activityHtml}${joinedHtml}${followedByHtml}</div>
      </div>
      <div class="${isMe ? 'device-you' : ''}">${isMe ? 'You' : followBtnHtml}</div>`;

    if (!isMe) {
      item.querySelector('.device-follow-btn')?.addEventListener('click', () => onToggleFollow?.(device.device_id));
    }

    if (isMe) {
      const input = item.querySelector('.device-name-edit');
      input?.addEventListener('change', () => onNameChange(input.value));
      input?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        input.blur();
      });
    }
    list.appendChild(item);
  });
}

// ── Files list ────────────────────────────────────────────────────────────────

export function renderFilesList(files, onDownload, onDelete, opts = {}) {
  const list  = document.getElementById('files-list');
  const empty = document.getElementById('files-empty');
  if (!list) return;
  list.setAttribute('role', 'list');
  list.innerHTML = '';
  if (!files?.length) { empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');
  const canDelete         = opts.canDelete         !== false;
  const canDownload       = opts.canDownload       !== false;
  const onPreview         = opts.onPreview         || null;
  const onCopyLink        = opts.onCopyLink        || null;
  const onInsert          = opts.onInsert          || null;
  const onCopyRef         = opts.onCopyRef         || null;
  const selectMode        = !!opts.selectMode;
  const selectedIds       = opts.selectedIds        || new Set();
  const onSelectionChange = opts.onSelectionChange  || null;
  files.forEach(file => {
    const item = document.createElement('div');
    item.className = 'file-item' + (selectMode ? ' file-item--selectable' : '');
    item.setAttribute('role', 'listitem');
    item.innerHTML = `
      ${selectMode ? `<input type="checkbox" class="file-select-cb" aria-label="Select ${escapeHtml(file.filename)}"${selectedIds.has(file.id) ? ' checked' : ''}>` : ''}
      <div class="file-emoji" aria-hidden="true">${fileEmoji(file.mime_type, file.filename)}</div>
      <div class="file-info">
        <div class="file-name">${file.encrypted ? `<span class="file-encrypted-icon" title="Content encrypted with the room's passphrase" aria-label="Encrypted">${getIcon('lock', 11)}</span>` : ''}${escapeHtml(file.filename)}</div>
        <div class="file-meta">${formatFileSize(file.file_size)} · ${formatTimestamp(file.uploaded_at)}${
          (!selectMode && onCopyRef && file.file_no != null)
            ? ` · <button class="file-ref-badge" type="button" title="Copy reference: syncpad-file:${file.file_no} — type this directly into the note to link this file, no need to open this panel" aria-label="Copy reference for ${escapeHtml(file.filename)}">#${file.file_no}</button>`
            : ''
        }</div>
      </div>
      <div class="file-actions">
        ${(!selectMode && onInsert) ? `<button class="file-action-btn insert" title="Insert ${escapeHtml(file.filename)} into note" aria-label="Insert ${escapeHtml(file.filename)} into note">${getIcon('paste', 15)}</button>` : ''}
        ${(!selectMode && canDownload && onPreview) ? `<button class="file-action-btn preview" title="Preview ${escapeHtml(file.filename)}" aria-label="Preview ${escapeHtml(file.filename)}">${getIcon('eye', 15)}</button>` : ''}
        ${(!selectMode && canDownload && onCopyLink) ? `<button class="file-action-btn copy-link" title="Copy link to ${escapeHtml(file.filename)}" aria-label="Copy link to ${escapeHtml(file.filename)}">${getIcon('link', 15)}</button>` : ''}
        ${(!selectMode && canDownload) ? `<button class="file-action-btn download" title="Download ${escapeHtml(file.filename)}" aria-label="Download ${escapeHtml(file.filename)}">${getIcon('download', 15)}</button>` : ''}
        ${(!selectMode && canDelete) ? `<button class="file-action-btn delete" title="Delete ${escapeHtml(file.filename)}" aria-label="Delete ${escapeHtml(file.filename)}">${getIcon('trash', 15)}</button>` : ''}
      </div>`;
    if (selectMode && onSelectionChange) {
      const cb = item.querySelector('.file-select-cb');
      cb.addEventListener('change', () => onSelectionChange(file, cb.checked));
      // Clicking the row body also toggles the checkbox
      item.addEventListener('click', (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        onSelectionChange(file, cb.checked);
      });
    }
    if (!selectMode) {
      if (onInsert) {
        const insertBtn = item.querySelector('.insert');
        // In Split mode, the default mousedown-focus-steal would move focus
        // off the CM6 Live surface before the click handler runs —
        // _insertTextAtActiveCursor() only chooses Live when
        // LiveEditor.hasFocus() is still true at that point, so without
        // this an image selected while editing the Live pane would insert
        // into the textarea's separate, stale caret instead. Same pattern
        // already used for the Settings-panel toggle buttons.
        insertBtn.addEventListener('mousedown', (e) => e.preventDefault());
        insertBtn.addEventListener('click', () => onInsert(file));
      }
      if (onCopyRef && file.file_no != null) {
        const refBtn = item.querySelector('.file-ref-badge');
        refBtn?.addEventListener('click', () => onCopyRef(file));
      }
      if (canDownload && onPreview) item.querySelector('.preview').addEventListener('click', () => onPreview(file));
      if (canDownload && onCopyLink) {
        const copyBtn = item.querySelector('.copy-link');
        copyBtn.addEventListener('click', async () => {
          copyBtn.disabled = true;
          try { await onCopyLink(file); } finally { copyBtn.disabled = false; }
        });
      }
      const dlBtn = canDownload ? item.querySelector('.download') : null;
      if (dlBtn) {
        dlBtn.addEventListener('click', async () => {
          // Briefly disable the button while the signed URL is fetched so
          // double-clicks don't fire two simultaneous download requests.
          dlBtn.disabled = true;
          try { await onDownload(file); } finally { dlBtn.disabled = false; }
        });
      }
      if (canDelete) {
        item.querySelector('.delete').addEventListener('click', () => onDelete(file));
      }
    }
    list.appendChild(item);
  });
}

export function setUploadingState(uploading, label = 'Uploading…') {
  document.getElementById('uploading-indicator')?.classList.toggle('hidden', !uploading);
  const textEl = document.getElementById('uploading-indicator-text');
  if (textEl && uploading) textEl.textContent = label;
}

// ── Version history ──────────────────────────────────────────────────────────

export function setHistoryLoading(loading) {
  document.getElementById('history-loading')?.classList.toggle('hidden', !loading);
}

/**
 * `revisions` items: { id, created_at, device_id, _preview }, where _preview
 * is the caller's already-decrypted (or plaintext) snippet — null if it
 * couldn't be decrypted (shown as a locked placeholder) — and the id is
 * passed back to onRestore untouched so the caller can look up the full
 * (still-encrypted-if-applicable) content to restore.
 */
export function renderHistoryList(revisions, onRestore, opts = {}) {
  const list  = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  if (!list) return;
  list.setAttribute('role', 'list');
  list.innerHTML = '';
  if (!revisions?.length) { empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');
  const canRestore = opts.canRestore !== false;
  const thisDeviceId = opts.deviceId || null;

  revisions.forEach((rev) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.setAttribute('role', 'listitem');
    const isThisDevice = thisDeviceId && rev.device_id === thisDeviceId;
    const preview = rev._preview == null
      ? '<span class="history-preview-locked">🔒 Encrypted — open with the passphrase to preview</span>'
      : escapeHtml((rev._preview || '').replace(/\s+/g, ' ').trim().slice(0, 140)) || '<span class="history-preview-empty">(empty note)</span>';
    item.innerHTML = `
      <div class="history-info">
        <div class="history-meta">${formatTimestamp(rev.created_at)}${isThisDevice ? ' · this device' : ''}</div>
        <div class="history-preview">${preview}</div>
      </div>
      <div class="history-actions">
        ${canRestore ? `<button class="history-restore-btn" title="Restore this version" aria-label="Restore version from ${escapeHtml(formatTimestamp(rev.created_at))}">${getIcon('restore', 15)}<span>Restore</span></button>` : ''}
      </div>`;
    if (canRestore) {
      item.querySelector('.history-restore-btn').addEventListener('click', () => onRestore(rev));
    }
    list.appendChild(item);
  });
}

/**
 * A scrubbable slider over version history (Etherpad's time-slider pattern),
 * shown above the discrete list rendered by renderHistoryList() rather than
 * replacing it. `entries` must be ordered oldest-to-newest and end with the
 * current live content as its last ("Now") entry.
 * @param {{ label: string, text: string|null, locked?: boolean, isNow?: boolean, rev?: object }[]} entries
 * @param {(entry: object) => void} onRestore — called with the scrubbed-to entry
 */
export function renderHistoryScrubber(entries, onRestore) {
  const wrap      = document.getElementById('history-scrubber');
  const slider    = document.getElementById('history-slider');
  const label     = document.getElementById('history-scrubber-label');
  const preview   = document.getElementById('history-scrubber-preview');
  const restoreBtn = document.getElementById('history-scrubber-restore-btn');
  if (!wrap || !slider || !label || !preview || !restoreBtn) return;

  // Needs at least one real revision plus the synthetic "Now" entry to be
  // worth scrubbing through — a brand-new room has nothing to slide across.
  if (!entries || entries.length < 2) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');

  const maxIndex = entries.length - 1;
  slider.min = '0';
  slider.max = String(maxIndex);
  slider.value = String(maxIndex); // start at "Now"

  const renderAt = (index) => {
    const entry = entries[index];
    if (!entry) return;
    label.textContent = entry.label;
    if (entry.locked) {
      preview.innerHTML = '<span class="history-preview-locked">🔒 Encrypted — open with the passphrase to preview</span>';
    } else {
      preview.textContent = entry.text || '';
    }
    restoreBtn.disabled = !!entry.isNow || !!entry.locked;
  };

  renderAt(maxIndex);
  slider.oninput = () => renderAt(Number(slider.value));
  restoreBtn.onclick = () => {
    const entry = entries[Number(slider.value)];
    if (entry && !entry.isNow && !entry.locked) onRestore?.(entry);
  };
}

/** Switch the History panel between its "Versions" and "Activity" tabs. */
export function setHistoryTab(tab) {
  const isActivity = tab === 'activity';
  document.getElementById('history-tab-versions')?.classList.toggle('active', !isActivity);
  document.getElementById('history-tab-versions')?.setAttribute('aria-selected', String(!isActivity));
  document.getElementById('history-tab-activity')?.classList.toggle('active', isActivity);
  document.getElementById('history-tab-activity')?.setAttribute('aria-selected', String(isActivity));
  document.getElementById('history-versions-view')?.classList.toggle('hidden', isActivity);
  document.getElementById('history-activity-view')?.classList.toggle('hidden', !isActivity);
}

const ACTIVITY_ICONS = { revision: 'restore', comment: 'comment', file: 'upload' };
const ACTIVITY_LABELS = { revision: 'Saved a version', comment: 'Added a comment', file: 'Uploaded a file' };

/**
 * A merged, chronological feed across every already-timestamped, room-scoped
 * signal the app persists — saved content versions, comments, and file
 * uploads — most recent first. Settings changes and device joins aren't
 * included: nothing in the schema persists those with a timestamp today (see
 * revisions.js/comments.js/files.js's header comments), so surfacing them
 * here would need a new event-log table, out of scope for this pass.
 * `entries` items: { type: 'revision'|'comment'|'file', created_at,
 * device_name?, detail? } — `detail` is a short plain-text fragment (comment
 * text preview, file name) already safe to escape here.
 */
export function renderActivityTimeline(entries) {
  const list  = document.getElementById('history-activity-list');
  const empty = document.getElementById('history-activity-empty');
  if (!list) return;
  list.setAttribute('role', 'list');
  list.innerHTML = '';
  if (!entries?.length) { empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');

  entries.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'history-item history-activity-item';
    item.setAttribute('role', 'listitem');
    const who = entry.device_name ? ` · ${escapeHtml(entry.device_name)}` : '';
    const detail = entry.detail ? `<div class="history-preview">${escapeHtml(entry.detail)}</div>` : '';
    item.innerHTML = `
      <div class="history-activity-icon" aria-hidden="true">${getIcon(ACTIVITY_ICONS[entry.type] || 'clock', 15)}</div>
      <div class="history-info">
        <div class="history-meta">${ACTIVITY_LABELS[entry.type] || 'Activity'} · ${formatTimestamp(entry.created_at)}${who}</div>
        ${detail}
      </div>`;
    list.appendChild(item);
  });
}

// ── Expiration bar ────────────────────────────────────────────────────────────

let _expInterval = null;

// The expiration bar is an in-flow footer element inside .editor-area, but
// .comment-fab is absolutely positioned relative to that same container's
// bottom edge — it doesn't reflow when the bar appears/disappears, so the
// two can visually collide on short mobile viewports. Measuring the bar's
// real rendered height (rather than a hardcoded constant) keeps this correct
// across font-size/zoom/locale-driven text-wrapping changes.
export function setCommentFabOffset(hasExpirationBar) {
  const editorArea = document.querySelector('.editor-area');
  if (!editorArea) return;
  if (!hasExpirationBar) {
    editorArea.style.removeProperty('--comment-fab-bottom-offset');
    return;
  }
  const bar = document.getElementById('expiration-bar');
  const height = bar && !bar.classList.contains('hidden') ? bar.getBoundingClientRect().height : 0;
  editorArea.style.setProperty('--comment-fab-bottom-offset', `${height}px`);
}

export function showExpirationBar(expiresAt, onCancel) {
  const bar = document.getElementById('expiration-bar');
  if (!bar) return;
  bar.classList.remove('hidden');
  const cancelBtn = bar.querySelector('.exp-cancel');
  if (cancelBtn) cancelBtn.onclick = onCancel;
  clearInterval(_expInterval);
  setCommentFabOffset(true);

  function update() {
    const remaining = new Date(expiresAt) - Date.now();
    const timeEl = bar.querySelector('.exp-time');
    if (!timeEl) return;
    if (remaining <= 0) { timeEl.textContent = 'Expired'; clearInterval(_expInterval); return; }
    const s = Math.floor(remaining / 1000) % 60;
    const m = Math.floor(remaining / 60000) % 60;
    const h = Math.floor(remaining / 3600000);
    timeEl.textContent = h > 0
      ? `${h}h ${m}m ${String(s).padStart(2,'0')}s`
      : m > 0
        ? `${m}m ${String(s).padStart(2,'0')}s`
        : `${s}s`;
  }
  update();
  _expInterval = setInterval(update, 1000);
}

export function hideExpirationBar() {
  document.getElementById('expiration-bar')?.classList.add('hidden');
  clearInterval(_expInterval);
  setCommentFabOffset(false);
}

// ── Encryption badge ──────────────────────────────────────────────────────────

export function setEncryptionBadge(visible) {
  document.getElementById('encryption-badge')?.classList.toggle('hidden', !visible);
}

export function setViewOnceBadge(visible) {
  document.getElementById('view-once-badge')?.classList.toggle('hidden', !visible);
}

export function setViewOnceConsumedPanel({
  visible = false,
  readOnly = false,
  onStartNew = null,
  onGoHome = null,
} = {}) {
  const panel = document.getElementById('view-once-consumed-panel');
  const title = document.getElementById('view-once-consumed-title');
  const msg = document.getElementById('view-once-consumed-message');
  const startBtn = document.getElementById('view-once-start-new-btn');
  const homeBtn = document.getElementById('view-once-go-home-btn');
  if (!panel || !title || !msg || !startBtn || !homeBtn) return;

  panel.classList.toggle('hidden', !visible);
  if (!visible) return;

  title.textContent = 'View-once note already viewed';
  msg.textContent = readOnly
    ? 'This read-only note has already been viewed. Ask the editable room holder to reset it if needed.'
    : 'This room’s view-once note has already been opened. Resetting turns this into a regular room — it will no longer be view-once.';

  startBtn.classList.toggle('hidden', !!readOnly);
  startBtn.onclick = readOnly ? null : onStartNew;
  homeBtn.onclick = () => {
    onGoHome?.();
    const raw = String(window.SYNCPAD_CONFIG?.basePath ?? '/JotRelay').trim();
    const base = (!raw || raw === '/') ? '' : `/${raw.replace(/^\/+|\/+$/g, '')}`;
    window.location.href = `${base}/`;
  };
}

// ── Theme picker ──────────────────────────────────────────────────────────────

/**
 * Render the theme picker in #theme-picker, grouped into Dark/Light sections.
 * Each option is a small mock "window" (header bar + accent button) so you
 * can read a theme's character at a glance — clicking applies it immediately.
 * There's no hover-preview: earlier versions live-applied the theme on
 * mouseenter/focus, which meant just moving the pointer across the list
 * repainted the whole app — distracting, and surprising for keyboard/
 * screen-reader users whose focus moves through the list without intending
 * to change anything yet.
 * @param {Array<{id,label,swatch,bg,elevated,dark}>} themes
 * @param {string}   currentId
 * @param {Function} onSelect  – called with theme id
 */
export function renderThemePicker(themes, currentId, onSelect) {
  const container = document.getElementById('theme-picker');
  if (!container) return;
  container.innerHTML = '';

  const groups = [
    { label: 'Dark',  items: themes.filter(t => t.dark) },
    { label: 'Light', items: themes.filter(t => !t.dark) },
  ];

  groups.forEach(group => {
    if (!group.items.length) return;

    const heading = document.createElement('div');
    heading.className = 'theme-section-title';
    heading.textContent = group.label;
    container.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'theme-picker-grid';
    group.items.forEach(t => {
      const btn = document.createElement('button');
      const isActive = t.id === currentId;
      btn.className = `theme-option${isActive ? ' active' : ''}`;
      btn.dataset.themeId = t.id;
      btn.title = t.label;
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      // Mini window mockup: base bg, a header-bar strip in the elevated
      // tone, and an accent "button" — reads like a tiny screenshot rather
      // than an abstract color chip.
      const bgColor       = escapeHtml(t.bg       || '#1c1c1e');
      const elevatedColor = escapeHtml(t.elevated || t.bg || '#222228');
      const accentColor   = escapeHtml(t.swatch   || '#f5a623');
      btn.innerHTML = `
        <span class="theme-preview" aria-hidden="true" style="background:${bgColor}">
          <span class="theme-preview-bar" style="background:${elevatedColor}"></span>
          <span class="theme-preview-accent" style="background:${accentColor}"></span>
          <span class="theme-preview-check">${getIcon('check', 12)}</span>
        </span>
        <span class="theme-option-footer">
          <span class="theme-label">${escapeHtml(t.label)}</span>
        </span>`;
      btn.addEventListener('click', () => {
        onSelect(t.id);
        renderThemePicker(themes, t.id, onSelect);
      });
      grid.appendChild(btn);
    });
    container.appendChild(grid);
  });
}

