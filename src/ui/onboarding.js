// SyncPad – ui/onboarding.js
// First-time product tour: a small coachmark sequence spotlighting the
// editor, mode toggle, command palette, share button, and more-menu, shown
// the first time anyone ever creates a room in this browser. Auto-triggered
// once, ever — gated by a localStorage flag, not room state (same category
// as the other user-global preferences in src/app/state.js) — but also
// replayable any time afterward via the More menu's "Take the Tour" item
// (see src/app/header.js), which calls startOnboardingTour() directly and
// so bypasses that gate entirely; hasSeenOnboarding() only governs the
// automatic first-room trigger in room-lifecycle.js.

const SEEN_KEY = 'syncpad_onboarding_seen';

const STEPS = [
  {
    selector: '.editor-area',
    title: 'Your note',
    text: 'Start typing here — every keystroke saves automatically and syncs live to anyone else viewing this room.',
  },
  {
    selector: '.editor-toolbar .md-segmented',
    // Split is hidden below 640px (styles/modals.css) — the segmented
    // control itself stays visible with just Source/Live, so this step
    // still shows, but must not advertise a mode that isn't actually there.
    title: () => (window.innerWidth <= 639 ? 'Source or Live' : 'Source, Live, or Split'),
    text: () => (window.innerWidth <= 639
      ? 'Switch between raw Markdown and a live rendered view you can edit directly.'
      : 'Switch between raw Markdown, a live rendered view you can edit directly, or both side by side.'),
  },
  {
    // Lives inside the (normally closed) More dropdown — see
    // opensMoreMenu below and _setMoreMenuOpen().
    selector: '#btn-command-palette',
    opensMoreMenu: true,
    title: 'Command palette',
    text: () => `Press ${_isMac() ? 'Cmd' : 'Ctrl'} K anytime to jump straight to any feature — Templates, Find, Settings, Export, and more — without touching the mouse.`,
  },
  {
    selector: '#btn-share',
    title: 'Share this room',
    // The Share modal itself only covers the editable/read-only links and
    // the short code — passcode and the server-enforced editing lock live
    // in Settings (More → Settings), not here, so don't imply otherwise.
    text: 'Anyone with the link can view and edit. Get a read-only link or a short spoken code here — for a passcode or to lock editing entirely, look in More → Settings.',
  },
  {
    selector: '#btn-more',
    title: 'Everything else',
    text: 'Files, Settings, Templates, keyboard shortcuts, and more all live behind this menu — including this tour, any time you want to see it again.',
  },
];

function _isMac() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
}

let _stepIndex = 0;
let _rafId = null;
let _previouslyFocused = null;
// In-memory fallback for the same page session: if localStorage.setItem()
// throws (quota exceeded, private-browsing restrictions, etc.) while
// getItem() still works, hasSeenOnboarding() would otherwise keep
// returning false forever, re-triggering the tour on every single room
// created in that session. This doesn't survive a reload, but it stops
// the tour from repeating for as long as the page stays open.
let _seenThisSession = false;

export function hasSeenOnboarding() {
  if (_seenThisSession) return true;
  try { return localStorage.getItem(SEEN_KEY) === 'true'; }
  catch { return true; } // storage unavailable — don't force the tour on every load
}

function _markOnboardingSeen() {
  _seenThisSession = true;
  try { localStorage.setItem(SEEN_KEY, 'true'); } catch {}
}

// Opens/closes the real header "More" dropdown so a step whose target lives
// inside it (Command Palette) has something real, correctly positioned to
// spotlight — the dropdown's own CSS lays it out (position:absolute) even
// while visually hidden via opacity/transform, so its items already have a
// non-zero bounding rect closed, at the *wrong* scaled/shifted geometry, so
// skipping this would point the highlight ring at empty space or the wrong
// spot. Duplicated here rather than importing app/header.js's own
// closeMoreDropdown(): src/ui/* is a leaf DOM layer app/* builds on, and
// reaching back up to app/* from here would invert that dependency.
function _setMoreMenuOpen(open) {
  document.getElementById('more-dropdown')?.classList.toggle('open', open);
  document.getElementById('btn-more')?.setAttribute('aria-expanded', String(open));
}

export function startOnboardingTour() {
  _markOnboardingSeen(); // once offered, never auto-shown again — even if dismissed mid-tour
  _ensureOnboardingDom();
  _stepIndex = 0;
  const overlay = document.getElementById('sp-onboarding-overlay');
  overlay.classList.add('visible');
  overlay.removeAttribute('inert');
  // startApp() already focused the editor before this runs — capture that
  // (or whatever else had focus) so it can be restored on close, and move
  // focus into the tour itself. Without this, a keyboard user's Tab/typing
  // keeps landing on the page behind the overlay, which visually blocks
  // interaction but never claimed the actual focus.
  _previouslyFocused = document.activeElement;
  document.addEventListener('keydown', _onOnboardingKey);
  // A window resize isn't the only thing that can move the spotlighted
  // target: e.g. going offline mid-tour inserts an offline banner above
  // the header (UI.showOfflineBanner()), shifting the Share/More buttons
  // down without changing window dimensions at all, so a resize-only
  // listener would leave the highlight ring pointing at empty space until
  // the next step change. Polling every frame while the tour is open
  // catches any layout-affecting cause, not just the ones this module
  // happens to know about.
  _rafId = requestAnimationFrame(_repositionLoop);
  _showStep(0);
}

function _repositionLoop() {
  // The mode-toggle step's title/text are viewport-dependent (see STEPS
  // above) — re-applying them every frame, not just on step entry, keeps
  // them correct if the user narrows or rotates the viewport across the
  // 640px breakpoint while sitting on that step, the same way the
  // position itself already tracks any layout change live.
  _applyStepContent(STEPS[_stepIndex]);
  _positionStep();
  // _positionStep() itself calls endOnboardingTour() (clearing 'visible')
  // if the current target has vanished — check afterward rather than
  // unconditionally rescheduling, or the loop would keep re-arming itself
  // forever even after the tour has already closed.
  const overlay = document.getElementById('sp-onboarding-overlay');
  if (overlay?.classList.contains('visible')) {
    _rafId = requestAnimationFrame(_repositionLoop);
  }
}

// Restarts the tooltip's content-in and highlight-pop CSS animations on
// every real step change (called only from _showStep(), never from the
// per-frame _repositionLoop() — replaying it every frame would turn a
// one-shot "new step arrived" cue into a distracting constant flicker).
// Removing then reflowing then re-adding the class is the standard trick
// for restarting a CSS animation that's already applied from the previous
// step — just re-adding the same class name is a no-op to the browser.
function _playStepTransition() {
  const content   = document.getElementById('sp-onboarding-content');
  const highlight = document.getElementById('sp-onboarding-highlight');
  for (const el of [content, highlight]) {
    if (!el) continue;
    el.classList.remove('onboarding-pop-in');
    void el.offsetWidth;
    el.classList.add('onboarding-pop-in');
  }
}

function _applyStepContent(step) {
  if (!step) return;
  const titleEl = document.getElementById('sp-onboarding-title');
  const textEl  = document.getElementById('sp-onboarding-text');
  const newTitle = typeof step.title === 'function' ? step.title() : step.title;
  const newText  = typeof step.text  === 'function' ? step.text()  : step.text;
  // Guard against writing identical text every frame — a real change still
  // updates the aria-live region correctly, but an unconditional write
  // could read to some screen readers as the content "changing" on every
  // single frame even when the string is byte-identical.
  if (titleEl.textContent !== newTitle) titleEl.textContent = newTitle;
  if (textEl.textContent  !== newText)  textEl.textContent  = newText;
}

export function endOnboardingTour() {
  const overlay = document.getElementById('sp-onboarding-overlay');
  if (!overlay?.classList.contains('visible')) return;
  overlay.classList.remove('visible');
  // The opacity/pointer-events transition alone leaves Skip/Back/Next in
  // the tab order and accessibility tree indefinitely — inert removes the
  // whole subtree from both until the tour opens again.
  overlay.setAttribute('inert', '');
  document.removeEventListener('keydown', _onOnboardingKey);
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  // Unconditional, not just for whichever step happened to be showing:
  // cheap no-op if it was already closed, and guarantees the tour never
  // leaves the real More menu stuck open behind itself on any exit path
  // (Escape, Skip, Done, or a forced close from room navigation).
  _setMoreMenuOpen(false);
  if (_previouslyFocused && document.contains(_previouslyFocused)) _previouslyFocused.focus();
  _previouslyFocused = null;
}

function _onOnboardingKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); endOnboardingTour(); return; }
  if (e.key !== 'Tab') return;
  const focusables = ['sp-onboarding-skip', 'sp-onboarding-back', 'sp-onboarding-next']
    .map((id) => document.getElementById(id))
    .filter((btn) => btn && !btn.disabled);
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

function _showStep(index) {
  if (index >= STEPS.length) { endOnboardingTour(); return; }
  const step = STEPS[index];
  // Must happen before measuring below: the real dropdown is scaled/shifted
  // via CSS transform while closed (see _setMoreMenuOpen()'s comment), so
  // its items' bounding rects are only correct once actually opened — and
  // this unconditionally reflects *this* step's own need either way, so a
  // step that doesn't use it (including the recursive skip-ahead call
  // below) always leaves it closed rather than stuck open from a previous
  // step.
  _setMoreMenuOpen(!!step.opensMoreMenu);
  const target = document.querySelector(step.selector);
  const rect = target?.getBoundingClientRect();
  if (!target || !rect || rect.width === 0 || rect.height === 0) {
    // Target isn't present/visible at this viewport size (e.g. a narrow
    // mobile layout that hides an element) — skip straight to the next step
    // rather than spotlighting nothing.
    _showStep(index + 1);
    return;
  }
  _stepIndex = index;
  _applyStepContent(step);
  document.getElementById('sp-onboarding-count').textContent = `${index + 1} of ${STEPS.length}`;
  document.querySelectorAll('#sp-onboarding-dots .onboarding-dot').forEach((dot, i) => {
    dot.classList.toggle('is-active', i === index);
    dot.classList.toggle('is-done', i < index);
  });
  _playStepTransition();
  const backBtn = document.getElementById('sp-onboarding-back');
  const nextBtn = document.getElementById('sp-onboarding-next');
  backBtn.disabled = index === 0;
  nextBtn.textContent = index === STEPS.length - 1 ? 'Done' : 'Next';
  _positionStep();
  // Move focus to the primary action on every step change, not just once
  // on open — a screen-reader user needs focus back on updated content to
  // hear it, and a keyboard user needs a clear next control regardless of
  // which step they arrived from. Deferred a frame, matching showConfirm()
  // et al. in ui/dialogs.js — focusing an element in the same tick it
  // becomes focusable (in particular, right after the overlay's `inert`
  // attribute is removed on first open) isn't reliably honored otherwise.
  requestAnimationFrame(() => nextBtn.focus());
}

function _positionStep() {
  const step = STEPS[_stepIndex];
  const target = document.querySelector(step?.selector);
  const rect = target?.getBoundingClientRect();
  if (!target || !rect || rect.width === 0 || rect.height === 0) { endOnboardingTour(); return; }

  const highlight = document.getElementById('sp-onboarding-highlight');
  const pad = 6;
  highlight.style.top    = `${rect.top - pad}px`;
  highlight.style.left   = `${rect.left - pad}px`;
  highlight.style.width  = `${rect.width + pad * 2}px`;
  highlight.style.height = `${rect.height + pad * 2}px`;

  const tooltip = document.getElementById('sp-onboarding-tooltip');
  // Provisional placement below the target; flip above if there isn't room.
  const tooltipRect = tooltip.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeAbove = spaceBelow < tooltipRect.height + 24 && rect.top > tooltipRect.height + 24;
  let top = placeAbove ? rect.top - pad - tooltipRect.height - 12 : rect.bottom + pad + 12;
  // A target that's tall enough to leave no room on either side (e.g. the
  // full-height editor area) still needs the tooltip clamped fully inside
  // the viewport — otherwise the naive "below" fallback above pushes it
  // past the bottom edge, off-screen and unreachable.
  top = Math.max(12, Math.min(top, window.innerHeight - tooltipRect.height - 12));
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - tooltipRect.width - 12));

  tooltip.style.top  = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function _ensureOnboardingDom() {
  if (document.getElementById('sp-onboarding-overlay')) return;
  const el = document.createElement('div');
  el.id = 'sp-onboarding-overlay';
  el.className = 'onboarding-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  // aria-labelledby/describedby (pointing at the per-step title/text, kept
  // up to date by _showStep()) take precedence over this for a sighted
  // screen-reader announcement once content exists; aria-label is just the
  // fallback name for the brief window before the first step renders.
  el.setAttribute('aria-label', 'Quick tour');
  el.setAttribute('aria-labelledby', 'sp-onboarding-title');
  el.setAttribute('aria-describedby', 'sp-onboarding-text');
  el.innerHTML = `
    <div id="sp-onboarding-highlight" class="onboarding-highlight"></div>
    <div id="sp-onboarding-tooltip" class="onboarding-tooltip">
      <!-- Focus stays on Next across Back/Next clicks (see _showStep()), so
           refocusing it doesn't fire a new focus event and a screen reader
           never hears the step actually changed. aria-live announces the
           updated count/title/text on every change regardless of focus. -->
      <div id="sp-onboarding-content" aria-live="polite" aria-atomic="true">
        <div class="onboarding-tooltip-count" id="sp-onboarding-count"></div>
        <h3 class="onboarding-tooltip-title" id="sp-onboarding-title"></h3>
        <p class="onboarding-tooltip-text" id="sp-onboarding-text"></p>
      </div>
      <!-- Purely decorative echo of sp-onboarding-count above — aria-hidden
           since the aria-live text already announces progress; a screen
           reader describing "dot 2, dot 3 not selected..." on every step
           would be noise, not information. Built once here since STEPS.length
           is fixed; _showStep() only ever toggles which dot is active. -->
      <div class="onboarding-dots" id="sp-onboarding-dots" aria-hidden="true"></div>
      <div class="onboarding-tooltip-actions">
        <button type="button" class="onboarding-skip" id="sp-onboarding-skip">Skip tour</button>
        <div class="onboarding-tooltip-nav">
          <button type="button" class="onboarding-nav-btn" id="sp-onboarding-back">Back</button>
          <button type="button" class="onboarding-nav-btn onboarding-nav-btn--primary" id="sp-onboarding-next">Next</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);

  const dots = document.getElementById('sp-onboarding-dots');
  dots.innerHTML = STEPS.map(() => '<span class="onboarding-dot"></span>').join('');

  document.getElementById('sp-onboarding-skip').onclick = () => endOnboardingTour();
  document.getElementById('sp-onboarding-back').onclick = () => _showStep(_stepIndex - 1);
  document.getElementById('sp-onboarding-next').onclick = () => _showStep(_stepIndex + 1);
}
