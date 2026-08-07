// SyncPad – ui/onboarding.js
// First-time product tour: a small coachmark sequence spotlighting the
// editor, mode toggle, share button, and more-menu the first time anyone
// ever creates a room in this browser. Shown once, ever — gated by a
// localStorage flag, not room state (same category as the other
// user-global preferences in src/app/state.js).

const SEEN_KEY = 'syncpad_onboarding_seen';

const STEPS = [
  {
    selector: '.editor-area',
    title: 'Your note',
    text: 'Start typing here — every keystroke saves automatically and syncs live to anyone else viewing this room.',
  },
  {
    selector: '.editor-toolbar .md-segmented',
    title: 'Source, Live, or Split',
    text: 'Switch between raw Markdown, a live rendered view you can edit directly, or both side by side.',
  },
  {
    selector: '#btn-share',
    title: 'Share this room',
    text: 'Anyone with the link can view and edit. Need a read-only link, a passcode, or a hard guarantee nobody else can edit? They’re all in here.',
  },
  {
    selector: '#btn-more',
    title: 'Everything else',
    text: 'Files, Settings, Templates, keyboard shortcuts, and more all live behind this menu.',
  },
];

let _stepIndex = 0;
let _resizeHandler = null;

export function hasSeenOnboarding() {
  try { return localStorage.getItem(SEEN_KEY) === 'true'; }
  catch { return true; } // storage unavailable — don't force the tour on every load
}

function _markOnboardingSeen() {
  try { localStorage.setItem(SEEN_KEY, 'true'); } catch {}
}

export function startOnboardingTour() {
  _markOnboardingSeen(); // once offered, never auto-shown again — even if dismissed mid-tour
  _ensureOnboardingDom();
  _stepIndex = 0;
  document.getElementById('sp-onboarding-overlay')?.classList.add('visible');
  document.addEventListener('keydown', _onOnboardingKey);
  _resizeHandler = () => _positionStep();
  window.addEventListener('resize', _resizeHandler);
  _showStep(0);
}

export function endOnboardingTour() {
  const overlay = document.getElementById('sp-onboarding-overlay');
  if (!overlay?.classList.contains('visible')) return;
  overlay.classList.remove('visible');
  document.removeEventListener('keydown', _onOnboardingKey);
  if (_resizeHandler) { window.removeEventListener('resize', _resizeHandler); _resizeHandler = null; }
}

function _onOnboardingKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); endOnboardingTour(); }
}

function _showStep(index) {
  if (index >= STEPS.length) { endOnboardingTour(); return; }
  const step = STEPS[index];
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
  document.getElementById('sp-onboarding-title').textContent = step.title;
  document.getElementById('sp-onboarding-text').textContent  = step.text;
  document.getElementById('sp-onboarding-count').textContent = `${index + 1} of ${STEPS.length}`;
  document.getElementById('sp-onboarding-back').disabled = index === 0;
  document.getElementById('sp-onboarding-next').textContent = index === STEPS.length - 1 ? 'Done' : 'Next';
  _positionStep();
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
  el.setAttribute('aria-label', 'Quick tour');
  el.innerHTML = `
    <div id="sp-onboarding-highlight" class="onboarding-highlight"></div>
    <div id="sp-onboarding-tooltip" class="onboarding-tooltip">
      <div class="onboarding-tooltip-count" id="sp-onboarding-count"></div>
      <h3 class="onboarding-tooltip-title" id="sp-onboarding-title"></h3>
      <p class="onboarding-tooltip-text" id="sp-onboarding-text"></p>
      <div class="onboarding-tooltip-actions">
        <button type="button" class="onboarding-skip" id="sp-onboarding-skip">Skip tour</button>
        <div class="onboarding-tooltip-nav">
          <button type="button" class="onboarding-nav-btn" id="sp-onboarding-back">Back</button>
          <button type="button" class="onboarding-nav-btn onboarding-nav-btn--primary" id="sp-onboarding-next">Next</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);

  document.getElementById('sp-onboarding-skip').onclick = () => endOnboardingTour();
  document.getElementById('sp-onboarding-back').onclick = () => _showStep(_stepIndex - 1);
  document.getElementById('sp-onboarding-next').onclick = () => _showStep(_stepIndex + 1);
}
