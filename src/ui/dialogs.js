// SyncPad – ui/dialogs.js
// Split from the former monolithic ui.js — see src/ui.js for the barrel.

// ── Modals ────────────────────────────────────────────────────────────────────

export function openModal(id)  { document.getElementById(id)?.classList.add('visible'); }
export function closeModal(id) { document.getElementById(id)?.classList.remove('visible'); }
export function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('visible'));
  // File preview uses .open (different backdrop class); close it here too
  document.getElementById('file-preview-modal')?.classList.remove('open');
}

// ── Confirm modal ─────────────────────────────────────────────────────────────

/**
 * Show a themed confirm dialog. Returns a Promise<boolean> that resolves when
 * the user clicks Confirm (true) or Cancel/backdrop (false).
 *
 * @param {string} message
 * @param {object} [opts]
 * @param {string} [opts.confirmLabel='Confirm']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {boolean} [opts.danger=false]  – uses red confirm button
 */
export function showConfirm(message, { confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    _ensureConfirmModal();
    const modal      = document.getElementById('sp-confirm-modal');
    const msgEl      = document.getElementById('sp-confirm-message');
    const okBtn      = document.getElementById('sp-confirm-ok');
    const cancelBtn  = document.getElementById('sp-confirm-cancel');
    if (!modal || !msgEl || !okBtn || !cancelBtn) { resolve(false); return; }

    msgEl.textContent = message;
    okBtn.textContent = confirmLabel;
    okBtn.className   = `modal-actions-btn${danger ? ' modal-btn-danger' : ' modal-btn-confirm'}`;
    cancelBtn.textContent = cancelLabel;

    const cleanup = (result) => {
      modal.classList.remove('visible');
      okBtn.onclick     = null;
      cancelBtn.onclick = null;
      modal.onclick     = null;
      document.removeEventListener('keydown', _onConfirmKey);
      resolve(result);
    };

    const _onConfirmKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      if (e.key === 'Enter'  && document.activeElement === okBtn) cleanup(true);
      // Focus trap — keep Tab cycling within the two modal buttons.
      if (e.key === 'Tab') {
        const focusables = [cancelBtn, okBtn].filter(btn => !btn.disabled);
        const first = focusables[0];
        const last  = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    };

    okBtn.onclick     = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    modal.onclick     = (e) => { if (e.target === modal) cleanup(false); };
    document.addEventListener('keydown', _onConfirmKey);

    modal.classList.add('visible');
    // Focus the safer button by default (Cancel for danger, Confirm otherwise).
    requestAnimationFrame(() => (danger ? cancelBtn : okBtn).focus());
  });
}

function _ensureConfirmModal() {
  if (document.getElementById('sp-confirm-modal')) return;
  const el = document.createElement('div');
  el.id        = 'sp-confirm-modal';
  el.className = 'modal-backdrop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'sp-confirm-message');
  el.innerHTML = `
    <div class="modal confirm-modal-inner">
      <p id="sp-confirm-message" class="confirm-modal-message"></p>
      <div class="modal-actions">
        <button id="sp-confirm-cancel" class="modal-actions-btn modal-btn-cancel"></button>
        <button id="sp-confirm-ok"     class="modal-actions-btn modal-btn-confirm"></button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

// ── Alert modal ───────────────────────────────────────────────────────────────

/**
 * Show a themed single-button alert dialog. Returns a Promise<void> that
 * resolves once the user dismisses it (OK, Escape, or backdrop click).
 *
 * @param {string} message
 * @param {object} [opts]
 * @param {string} [opts.okLabel='OK']
 */
export function showAlert(message, { okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    _ensureAlertModal();
    const modal = document.getElementById('sp-alert-modal');
    const msgEl = document.getElementById('sp-alert-message');
    const okBtn = document.getElementById('sp-alert-ok');
    if (!modal || !msgEl || !okBtn) { resolve(); return; }

    msgEl.textContent = message;
    okBtn.textContent = okLabel;

    const cleanup = () => {
      modal.classList.remove('visible');
      okBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', _onAlertKey);
      resolve();
    };

    const _onAlertKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); cleanup(); }
    };

    okBtn.onclick = cleanup;
    modal.onclick = (e) => { if (e.target === modal) cleanup(); };
    document.addEventListener('keydown', _onAlertKey);

    modal.classList.add('visible');
    requestAnimationFrame(() => okBtn.focus());
  });
}

function _ensureAlertModal() {
  if (document.getElementById('sp-alert-modal')) return;
  const el = document.createElement('div');
  el.id        = 'sp-alert-modal';
  el.className = 'modal-backdrop';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'sp-alert-message');
  el.innerHTML = `
    <div class="modal confirm-modal-inner">
      <p id="sp-alert-message" class="confirm-modal-message"></p>
      <div class="modal-actions">
        <button id="sp-alert-ok" class="modal-actions-btn modal-btn-confirm"></button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

// ── Prompt modal ──────────────────────────────────────────────────────────────

/**
 * Show a themed single-input prompt dialog.
 * Returns a Promise<string|null> — the raw (untrimmed) input value, or null if cancelled/empty.
 *
 * @param {string} message
 * @param {object} [opts]
 * @param {string} [opts.defaultValue='']
 * @param {string} [opts.placeholder='']
 * @param {string} [opts.confirmLabel='OK']
 * @param {string} [opts.cancelLabel='Cancel']
 */
export function showPrompt(message, { defaultValue = '', placeholder = '', confirmLabel = 'OK', cancelLabel = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    _ensurePromptModal();
    const modal     = document.getElementById('sp-prompt-modal');
    const msgEl     = document.getElementById('sp-prompt-message');
    const inputEl   = document.getElementById('sp-prompt-input');
    const okBtn     = document.getElementById('sp-prompt-ok');
    const cancelBtn = document.getElementById('sp-prompt-cancel');
    if (!modal || !msgEl || !inputEl || !okBtn || !cancelBtn) { resolve(null); return; }

    msgEl.textContent      = message;
    inputEl.value          = defaultValue;
    inputEl.placeholder    = placeholder || '';
    okBtn.textContent      = confirmLabel;
    cancelBtn.textContent  = cancelLabel;

    const cleanup = (result) => {
      modal.classList.remove('visible');
      okBtn.onclick        = null;
      cancelBtn.onclick    = null;
      modal.onclick        = null;
      inputEl.onkeydown    = null;
      document.removeEventListener('keydown', _onKey);
      resolve(result);
    };

    const _onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
      // Focus trap — Tab cycles: input → cancelBtn → okBtn → input.
      if (e.key === 'Tab') {
        const focusables = [inputEl, cancelBtn, okBtn].filter(el => !el.disabled);
        const first = focusables[0];
        const last  = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    };

    inputEl.onkeydown = (e) => {
      // Return the RAW (untrimmed) value so callers that use the result as a
      // passphrase or password receive exactly what the user typed. Callers
      // that want trimmed input (template names, passcodes) call .trim() at
      // the point of use. Resolves null only when the field is truly empty.
      if (e.key === 'Enter') { e.preventDefault(); cleanup(inputEl.value || null); }
    };

    okBtn.onclick     = () => { cleanup(inputEl.value || null); };
    cancelBtn.onclick = () => cleanup(null);
    modal.onclick     = (e) => { if (e.target === modal) cleanup(null); };
    document.addEventListener('keydown', _onKey);

    modal.classList.add('visible');
    requestAnimationFrame(() => { inputEl.focus(); inputEl.select(); });
  });
}

function _ensurePromptModal() {
  if (document.getElementById('sp-prompt-modal')) return;
  const el = document.createElement('div');
  el.id        = 'sp-prompt-modal';
  el.className = 'modal-backdrop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'sp-prompt-message');
  el.innerHTML = `
    <div class="modal confirm-modal-inner">
      <p id="sp-prompt-message" class="confirm-modal-message"></p>
      <input id="sp-prompt-input" class="auth-input prompt-modal-input" />
      <div class="modal-actions">
        <button id="sp-prompt-cancel" class="modal-actions-btn modal-btn-cancel"></button>
        <button id="sp-prompt-ok"     class="modal-actions-btn modal-btn-confirm"></button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

