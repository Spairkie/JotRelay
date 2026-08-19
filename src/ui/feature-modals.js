// JotRelay – ui/feature-modals.js
// Split from the former monolithic ui.js — see src/ui.js for the barrel.
import { escapeHtml, copyToClipboard } from '../utils.js';
import { TEMPLATE_CATEGORY_ORDER } from '../templates.js';
import { showToast } from './core.js';
import { openModal, closeModal, showConfirm, showPrompt } from './dialogs.js';
import { BRAND_NAME } from '../brand.js';

// ── Command palette ─────────────────────────────────────────────────────────

/**
 * Render the palette's filtered results. `items` is already filtered/sorted
 * by the caller (see utils.js's filterCommands); this just draws the list
 * and highlights `activeIndex` for keyboard navigation. `onRun` fires on
 * click with the command's id.
 */
export function renderCommandPaletteResults(items, activeIndex, onRun) {
  const list = document.getElementById('command-palette-list');
  if (!list) return;
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="command-palette-empty">No matching commands</div>';
    return;
  }
  items.forEach((cmd, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `command-palette-item${i === activeIndex ? ' active' : ''}`;
    row.id = `command-palette-item-${i}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(i === activeIndex));
    row.innerHTML = `
      <span class="command-palette-item-label">${escapeHtml(cmd.label)}</span>
      ${cmd.group ? `<span class="command-palette-item-group">${escapeHtml(cmd.group)}</span>` : ''}
      ${cmd.shortcut ? `<kbd class="command-palette-item-shortcut">${escapeHtml(cmd.shortcut)}</kbd>` : ''}`;
    row.addEventListener('click', () => onRun(cmd.id));
    list.appendChild(row);
  });
  if (activeIndex >= 0) {
    list.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }
}

// ── Share modal ───────────────────────────────────────────────────────────────

/** "Expires in 3h" / "Expires in 2d" — a coarse, static label for the share
 *  modal's security chips (not a live countdown like ui/panels.js's
 *  showExpirationBar(), which re-renders every second for the in-editor
 *  bar). Returns '' when there's nothing to show. */
function _formatExpiresIn(expiresAt) {
  if (!expiresAt) return '';
  const remaining = new Date(expiresAt) - Date.now();
  if (!isFinite(remaining) || remaining <= 0) return 'Expired';
  const days = Math.floor(remaining / 86_400_000);
  if (days >= 1) return `Expires in ${days}d`;
  const hours = Math.floor(remaining / 3_600_000);
  if (hours >= 1) return `Expires in ${hours}h`;
  const minutes = Math.max(1, Math.floor(remaining / 60_000));
  return `Expires in ${minutes}m`;
}

export function populateShareModal({
  editableUrl, readOnlyUrl, readOnlyError = false, hasPasscode, hasEncryption,
  roomPath = '', roomDisplayTitle = '', hasReadOnlyLink = false, isEditingLocked = false,
  hasViewOnce = false, expiresAt = null, roomCode = '', roomCodeError = false, showRoomCode = true,
} = {}) {
  const roomPathEl = document.getElementById('share-room-path');
  const titleEl = document.getElementById('share-modal-title');
  const displayTitle = (roomDisplayTitle || '').trim() || (roomPath || '').replace(/^\//, '') || 'room';
  if (titleEl) titleEl.textContent = `Share "${displayTitle}"`;
  if (roomPathEl) {
    const normalizedPath = (roomPath || '').replace(/^\//, '');
    roomPathEl.textContent = normalizedPath && normalizedPath !== displayTitle ? `Path: /${normalizedPath}` : '';
  }
  const securityNotesEl = document.getElementById('share-security-notes');
  if (securityNotesEl) {
    const chips = [];
    if (hasPasscode) chips.push('<span class="share-security-chip">Passcode required</span>');
    if (hasEncryption) chips.push('<span class="share-security-chip">Encryption passphrase required</span>');
    if (hasViewOnce) chips.push('<span class="share-security-chip">Clears after first view</span>');
    if (isEditingLocked) chips.push('<span class="share-security-chip">Editing locked</span>');
    const expiresIn = _formatExpiresIn(expiresAt);
    if (expiresIn) chips.push(`<span class="share-security-chip">${escapeHtml(expiresIn)}</span>`);
    securityNotesEl.innerHTML = chips.join('');
    securityNotesEl.classList.toggle('hidden', chips.length === 0);
  }

  _wireShareRow({ fieldId: 'share-editable-text', copyBtnId: 'share-editable-copy', openId: 'share-editable-open', nativeBtnId: 'share-editable-native-btn', errorId: 'share-editable-error', url: editableUrl });
  _renderQr('share-editable-qr', editableUrl);
  _wireQrToggle('share-editable-qr-toggle', 'share-editable-qr-wrap', !!editableUrl);

  const readOnlyDisplay = readOnlyUrl || (readOnlyError ? 'Could not create read-only link. Check Supabase setup.' : 'Generating read-only link…');
  _wireShareRow({ fieldId: 'share-readonly-text', copyBtnId: 'share-readonly-copy', openId: 'share-readonly-open', nativeBtnId: 'share-readonly-native-btn', errorId: 'share-readonly-error', url: readOnlyUrl, displayValue: readOnlyDisplay });
  _renderQr('share-readonly-qr', readOnlyUrl);
  _wireQrToggle('share-readonly-qr-toggle', 'share-readonly-qr-wrap', !!readOnlyUrl);
  _wireQrDownload('share-editable-qr-download', 'share-editable-qr', 'jotrelay-editable-qr.png');
  _wireQrDownload('share-readonly-qr-download', 'share-readonly-qr', 'jotrelay-readonly-qr.png', !readOnlyUrl);

  // A read-only viewer session has no room-owning identity to generate a
  // code from (same reason it gets an empty editableUrl above) — the
  // section is hidden entirely rather than shown disabled.
  const codeSection = document.getElementById('share-code-section');
  if (codeSection) codeSection.classList.toggle('hidden', !showRoomCode);
  if (showRoomCode) {
    const codeDisplay = roomCode || (roomCodeError ? 'Short codes need one more setup step — see supabase/migrations/0002_short_room_codes.sql.' : 'Generating short code…');
    _wireShareRow({ fieldId: 'share-code-text', copyBtnId: 'share-code-copy', openId: null, nativeBtnId: null, errorId: 'share-code-error', url: roomCode, displayValue: codeDisplay });
  }
}

function _wireShareRow({ fieldId, copyBtnId, openId, nativeBtnId, errorId, url, displayValue = url }) {
  const fieldEl = document.getElementById(fieldId);
  if (fieldEl) { fieldEl.value = displayValue || ''; fieldEl.title = displayValue || ''; }
  const errorEl = document.getElementById(errorId);
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }

  const openEl = document.getElementById(openId);
  if (openEl) {
    openEl.href = url || '#';
    openEl.classList.toggle('is-disabled', !url);
    openEl.setAttribute('aria-disabled', url ? 'false' : 'true');
    openEl.tabIndex = url ? 0 : -1;
  }

  const copyBtn = document.getElementById(copyBtnId);
  if (copyBtn) {
    copyBtn.disabled = !url;
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = async () => {
      if (!url) return;
      const ok = await copyToClipboard(url);
      if (ok) {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      } else if (errorEl) {
        errorEl.textContent = 'Copy failed. Select the URL and copy manually.';
        errorEl.classList.remove('hidden');
      }
    };
  }

  _wireNativeShare(nativeBtnId, url, 'Share link');
}

function _wireQrToggle(toggleId, wrapId, enabled) {
  const toggleBtn = document.getElementById(toggleId);
  const wrap = document.getElementById(wrapId);
  if (!toggleBtn || !wrap) return;
  const allToggles = ['share-editable-qr-toggle', 'share-readonly-qr-toggle'];
  const allWraps = ['share-editable-qr-wrap', 'share-readonly-qr-wrap'];
  if (!enabled) {
    toggleBtn.classList.add('hidden');
    wrap.classList.add('hidden');
    toggleBtn.classList.remove('is-active');
    toggleBtn.setAttribute('aria-expanded', 'false');
    return;
  }
  toggleBtn.classList.remove('hidden');
  toggleBtn.classList.remove('is-active');
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.title = 'Show QR code';
  toggleBtn.setAttribute('aria-label', toggleBtn.id.includes('editable') ? 'Show QR for editable link' : 'Show QR for read-only link');
  wrap.classList.add('hidden');
  toggleBtn.onclick = () => {
    const willShow = wrap.classList.contains('hidden');
    if (willShow) {
      allWraps.forEach((id) => document.getElementById(id)?.classList.add('hidden'));
      allToggles.forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.remove('is-active');
        btn.setAttribute('aria-expanded', 'false');
        btn.title = id.includes('editable') ? 'Show QR for editable link' : 'Show QR for read-only link';
        btn.setAttribute('aria-label', btn.title);
      });
    }
    wrap.classList.toggle('hidden', !willShow);
    toggleBtn.classList.toggle('is-active', willShow);
    toggleBtn.title = willShow
      ? (toggleBtn.id.includes('editable') ? 'Hide QR for editable link' : 'Hide QR for read-only link')
      : (toggleBtn.id.includes('editable') ? 'Show QR for editable link' : 'Show QR for read-only link');
    toggleBtn.setAttribute('aria-label', toggleBtn.title);
    toggleBtn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
  };
}

function _renderQr(containerId, url, _isRetry = false) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  if (!url) return;
  if (!window.QRCode) {
    // The QR CDN script (index.html) is deferred and may still be loading
    // when the share modal opens. Retry once it's ready instead of leaving
    // the container permanently empty — populateShareModal() is only ever
    // called again on a fresh modal open, not on every render, so without
    // this a share opened just after page load could show no QR code for
    // the rest of that session. Guarded to at most one retry (_isRetry):
    // window.__qrReady also resolves on the script's error event (so a
    // blocked/failed CDN load doesn't hang callers forever) without ever
    // defining window.QRCode — without this guard, retrying unconditionally
    // would immediately re-check, still find it missing, and re-attach to
    // the already-resolved promise again, looping forever in microtasks.
    if (!_isRetry) window.__qrReady?.then(() => _renderQr(containerId, url, true));
    return;
  }
  try {
    // Read QR colours from the active theme's CSS variables so the code adapts
    // to every theme rather than always using the Charcoal Amber palette.
    const cs = getComputedStyle(document.documentElement);
    const colorDark  = cs.getPropertyValue('--accent').trim()  || '#f5a623';
    const colorLight = cs.getPropertyValue('--bg-base').trim() || '#18181c';
    new window.QRCode(el, {
      text: url,
      width: 144,
      height: 144,
      colorDark,
      colorLight,
    });
  } catch {}
}

function _wireQrDownload(btnId, qrContainerId, filename, disabled = false) {
  const btn = document.getElementById(btnId);
  const container = document.getElementById(qrContainerId);
  if (!btn || !container) return;
  btn.disabled = !!disabled;
  btn.onclick = () => {
    if (disabled) return;
    const img = container.querySelector('img');
    const canvas = container.querySelector('canvas');
    const src = img?.src || canvas?.toDataURL?.('image/png');
    if (!src) { showToast('QR code is not ready yet.', 'warning'); return; }
    const a = document.createElement('a');
    a.href = src;
    a.download = filename || 'jotrelay-qr.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };
}

function _wireNativeShare(btnId, url, label) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const hasNativeShare = !!navigator.share;
  const canShare = !!(hasNativeShare && url);
  btn.classList.toggle('hidden', !hasNativeShare);
  btn.disabled = !canShare;
  btn.setAttribute('aria-label', label);
  btn.title = hasNativeShare ? '' : 'Native share is not available on this device.';
  btn.onclick = () => {
    if (!canShare) return;
    navigator.share({ title: BRAND_NAME, text: label, url }).catch(() => {});
  };
}

// ── Templates modal ──────────────────────────────────────────────────────────

/**
 * Open the templates modal.
 * @param {object}   builtins   – TEMPLATES constant
 * @param {object}   customs    – result of getCustomTemplates()
 * @param {Function} onChoose   – (key, mode) => void
 * @param {Function} onDelete   – (key) => void
 * @param {Function} onRename   – (key, newLabel) => void
 * @param {object}   [io={}]    – optional { onExport, onImport } callbacks
 */
export function openTemplatesModal(builtins, customs, onChoose, onDelete, onRename, { onExport, onImport } = {}) {
  const modal = document.getElementById('templates-modal');
  if (!modal) return;

  let _activeTab = 'insert';

  const _render = () => {
    const body = modal.querySelector('.templates-body');
    if (!body) return;
    body.innerHTML = '';

    if (_activeTab === 'insert') {
      _renderInsertTab(body, builtins, customs, onChoose);
    } else {
      _renderCustomTab(body, customs, onDelete, onRename, _render, { onExport, onImport });
    }
  };

  // Tab wiring
  modal.querySelectorAll('.tmpl-tab').forEach(tab => {
    tab.onclick = () => {
      modal.querySelectorAll('.tmpl-tab').forEach(t => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      _activeTab = tab.dataset.tab;
      _render();
    };
  });

  // Close buttons
  modal.querySelectorAll('.templates-close').forEach(btn => {
    btn.onclick = () => closeModal('templates-modal');
  });

  _render();
  openModal('templates-modal');
}

function _renderInsertTab(body, builtins, customs, onChoose) {
  // ── Search bar ───────────────────────────────────────────────
  const searchWrap = document.createElement('div');
  searchWrap.className = 'tmpl-search-wrap';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search templates…';
  searchInput.className = 'tmpl-search-input';
  searchInput.autocomplete = 'off';
  searchInput.setAttribute('aria-label', 'Search templates');
  searchWrap.appendChild(searchInput);
  body.appendChild(searchWrap);

  // ── Two-column layout: list + preview ────────────────────────
  const twoCol = document.createElement('div');
  twoCol.className = 'tmpl-two-col';

  const listCol = document.createElement('div');
  listCol.className = 'tmpl-list-col';

  const previewCol = document.createElement('div');
  previewCol.className = 'tmpl-preview-col';

  const previewHdr = document.createElement('div');
  previewHdr.className = 'tmpl-preview-hdr';
  previewHdr.textContent = 'Preview';

  const previewEl = document.createElement('pre');
  previewEl.className = 'tmpl-preview-body';
  previewEl.textContent = 'Select a template to preview its content.';

  previewCol.appendChild(previewHdr);
  previewCol.appendChild(previewEl);

  const showPreview = (t) => {
    const lines = (t.body || '').trimEnd();
    const LIMIT = 1200;
    previewHdr.textContent = t.label || 'Preview';
    previewEl.textContent = lines.length
      ? (lines.length > LIMIT ? lines.slice(0, LIMIT) + '\n…' : lines)
      : `(${t.desc || 'Empty template'})`;
  };

  // ── Template list with category group headers ────────────────
  const list = document.createElement('div');
  list.className = 'templates-list';
  list.setAttribute('role', 'list');

  const buildList = (filter) => {
    list.innerHTML = '';
    const f = filter.toLowerCase().trim();

    // Match against label, description, and body for deeper search
    const matchFn = (t) => !f
      || t.label.toLowerCase().includes(f)
      || (t.desc  || '').toLowerCase().includes(f)
      || (t.body  || '').toLowerCase().includes(f);

    // ── Custom templates ──────────────────────────────────────
    const customEntries = Object.entries(customs).filter(([, t]) => matchFn(t));
    if (customEntries.length) {
      const hdr = document.createElement('div');
      hdr.className = 'templates-group-label';
      hdr.textContent = 'My Templates';
      list.appendChild(hdr);
      customEntries.forEach(([key, t]) => list.appendChild(_makeTemplateBtn(key, t, onChoose, showPreview)));
    }

    // ── Built-in templates grouped by category ────────────────
    const builtinEntries = Object.entries(builtins).filter(([, t]) => matchFn(t));

    if (f) {
      // While searching, show all matches flat (no category headers) for speed
      if (builtinEntries.length) {
        if (customEntries.length) {
          const sep = document.createElement('div');
          sep.className = 'templates-group-label';
          sep.textContent = 'Built-in';
          list.appendChild(sep);
        }
        builtinEntries.forEach(([key, t]) => list.appendChild(_makeTemplateBtn(key, t, onChoose, showPreview)));
      }
    } else {
      // No filter — group by category in preferred order
      const byCategory = new Map();
      builtinEntries.forEach(([key, t]) => {
        const cat = t.category || 'Other';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push([key, t]);
      });

      const categoryOrder = [...TEMPLATE_CATEGORY_ORDER];
      // Add any categories not in the preferred order at the end
      for (const cat of byCategory.keys()) {
        if (!categoryOrder.includes(cat)) categoryOrder.push(cat);
      }

      for (const cat of categoryOrder) {
        const entries = byCategory.get(cat);
        if (!entries?.length) continue;
        const hdr = document.createElement('div');
        hdr.className = 'templates-group-label';
        hdr.textContent = cat;
        list.appendChild(hdr);
        entries.forEach(([key, t]) => list.appendChild(_makeTemplateBtn(key, t, onChoose, showPreview)));
      }
    }

    if (!customEntries.length && !builtinEntries.length) {
      const none = document.createElement('div');
      none.className = 'tmpl-no-results';
      none.textContent = 'No templates match your search.';
      list.appendChild(none);
    }
  };

  buildList('');
  searchInput.addEventListener('input', () => buildList(searchInput.value));

  listCol.appendChild(list);
  twoCol.appendChild(listCol);
  twoCol.appendChild(previewCol);
  body.appendChild(twoCol);

  // Focus search on open
  requestAnimationFrame(() => searchInput.focus());
}

function _renderCustomTab(body, customs, onDelete, onRename, rerender, { onExport, onImport } = {}) {
  // ── Export / Import bar ──────────────────────────────────────
  if (onExport || onImport) {
    const ioBar = document.createElement('div');
    ioBar.className = 'tmpl-io-bar';
    if (onExport) {
      const expBtn = document.createElement('button');
      expBtn.className = 'tmpl-io-btn';
      expBtn.title = 'Export all custom templates as JSON';
      expBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export JSON`;
      expBtn.disabled = Object.keys(customs).length === 0;
      expBtn.addEventListener('click', onExport);
      ioBar.appendChild(expBtn);
    }
    if (onImport) {
      const impBtn = document.createElement('button');
      impBtn.className = 'tmpl-io-btn';
      impBtn.title = 'Import templates from a JSON file';
      impBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Import JSON`;
      impBtn.addEventListener('click', onImport);
      ioBar.appendChild(impBtn);
    }
    body.appendChild(ioBar);
  }

  // ── Template list ─────────────────────────────────────────────
  const keys = Object.keys(customs);

  if (!keys.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-state-title">No custom templates yet</div>
      <div class="empty-state-sub">Use "Save current note as template" below to create one.</div>`;
    body.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'templates-list custom-templates-list';
  list.setAttribute('role', 'list');
  keys.forEach(key => {
    const t    = customs[key];
    const item = document.createElement('div');
    item.className = 'custom-template-item';
    item.setAttribute('role', 'listitem');

    const label = document.createElement('span');
    label.className = 'custom-template-label';
    label.textContent = t.label;

    const actions = document.createElement('div');
    actions.className = 'custom-template-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'custom-tmpl-btn';
    renameBtn.title = 'Rename';
    renameBtn.setAttribute('aria-label', `Rename template "${t.label}"`);
    renameBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    renameBtn.addEventListener('click', async () => {
      const newName = await showPrompt('Rename template:', { defaultValue: t.label, confirmLabel: 'Rename' });
      if (newName?.trim()) { onRename(key, newName.trim()); rerender(); }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'custom-tmpl-btn danger';
    delBtn.title = 'Delete';
    delBtn.setAttribute('aria-label', `Delete template "${t.label}"`);
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    delBtn.addEventListener('click', async () => {
      const ok = await showConfirm(`Delete template "${t.label}"?`, { confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      onDelete(key);
      rerender();
    });

    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    item.appendChild(label);
    item.appendChild(actions);
    list.appendChild(item);
  });

  body.appendChild(list);
}

function _makeTemplateBtn(key, t, onChoose, onHover) {
  const btn = document.createElement('button');
  btn.className = 'template-btn';
  btn.dataset.key = key;
  btn.setAttribute('role', 'listitem');
  btn.innerHTML = `
    <span class="template-label">${escapeHtml(t.label)}</span>
    ${t.desc ? `<span class="template-desc">${escapeHtml(t.desc)}</span>` : ''}`;
  btn.addEventListener('click', () => _confirmTemplateInsert(key, t.label, onChoose));
  if (onHover) {
    btn.addEventListener('mouseenter', () => onHover(t));
    btn.addEventListener('focus',      () => onHover(t));
  }
  return btn;
}

function _confirmTemplateInsert(key, label, onChoose) {
  const editor = document.getElementById('note-editor');
  const hasContent = !!editor && editor.value.trim().length > 0;
  if (!hasContent) {
    closeModal('templates-modal');
    onChoose(key, 'replace');
    return;
  }
  _showInlineChoice(`Apply "${escapeHtml(label)}"`, [
    { label: 'Insert at cursor', value: 'insert',  kind: 'primary',   desc: 'Add at the cursor position' },
    { label: 'Append to note',   value: 'append',  kind: '',          desc: 'Add at the end of the note' },
    { label: 'Replace note',     value: 'replace', kind: 'danger',    desc: 'Overwrite all current content' },
    { label: 'Cancel',           value: null,       kind: 'cancel',   desc: null },
  ], (choice) => { if (choice) onChoose(key, choice); });
}

function _showInlineChoice(message, choices, onPick) {
  const modal = document.getElementById('templates-modal');
  if (!modal) return;
  const body = modal.querySelector('.templates-body');
  if (!body) return;
  body.innerHTML = `
    <p class="template-choice-msg">${message}</p>
    <div class="template-choice-actions"></div>
  `;
  const actions = body.querySelector('.template-choice-actions');
  choices.forEach((c) => {
    const b = document.createElement('button');
    b.className = `template-choice-btn ${c.kind || ''}`;
    const labelSpan = document.createElement('span');
    labelSpan.className = 'template-choice-btn-label';
    labelSpan.textContent = c.label;
    b.appendChild(labelSpan);
    if (c.desc) {
      const descSpan = document.createElement('span');
      descSpan.className = 'template-choice-btn-desc';
      descSpan.textContent = c.desc;
      b.appendChild(descSpan);
    }
    b.addEventListener('click', () => { closeModal('templates-modal'); onPick(c.value); }, { once: true });
    actions.appendChild(b);
  });
}

