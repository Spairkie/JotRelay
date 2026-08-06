// SyncPad – app/landing-demo.js
//
// Coded, interactive hero demo for the marketing page (replaces the old
// autoplaying MP4). A small explicit state machine over five scenes —
// write, collaborate, review, share, handoff — told through one continuous
// fictional scenario (room "Product launch plan", collaborator "Hans",
// file "launch-assets.zip"). Markup lives in index.html (search "Coded,
// interactive product demo"); styles in styles/landing-demo.css.
//
// This module never touches Supabase, CodeMirror, realtime, uploads, room
// creation, comments, or sharing APIs — every scene is inert, hard-coded
// markup toggled by class/attribute. See docs/marketing-site.md#coded-hero-demo
// for the full writeup (timings, accessibility model, why no backend calls).
//
// ── Stale-timer safety ──────────────────────────────────────────────────
// Only one timer is ever pending at a time (`_timer`), and every scheduled
// callback closes over the `_gen` value active when it was scheduled. If
// `_gen` has moved on by the time the callback fires (a manual scene click,
// a stop, or a fresh loop happened first), the callback is a no-op — this
// is what "old scene callbacks must not modify later scenes" means in
// practice, without needing a queue or a full animation library.

import { wireTabListKeyboardNav, syncTabListFocus } from '../utils.js';

const SCENES = ['write', 'collaborate', 'review', 'share', 'handoff'];
const SCENE_LABELS = {
  write: 'Write — typing a checklist',
  collaborate: 'Collaborate — Hans joins and adds a line live',
  review: 'Review — an anchored comment on the launch date',
  share: 'Share — permissions and a share link',
  handoff: 'Handoff — sending a file to mobile',
};
// Active scene-to-scene pacing sums to ~13s (spec: 12–16s); handoff then
// holds its completed state for ~4s before the loop restarts (spec: a
// 3–5s pause at the end).
const DURATIONS = { write: 3200, collaborate: 2800, review: 2600, share: 2400, handoff: 2200 };
const HANDOFF_HOLD_MS = 4000;
const TYPE_CHAR_MS = 26;

let els = null;
let sceneIndex = 0;
let playing = true;
let gen = 0;
let _timer = null;
let _flightAnim = null;
let reducedMotion = false;
let visible = true;
let tabHidden = false;
let initialized = false;

function q(id) { return document.getElementById(id); }

function cacheEls() {
  els = {
    root: q('lp-demo'),
    tabs: Array.from(document.querySelectorAll('.lp-demo-tab')),
    playpause: q('lp-demo-playpause'),
    pauseIcon: document.querySelector('.lp-demo-icon-pause'),
    playIcon: document.querySelector('.lp-demo-icon-play'),
    text1: q('lp-demo-text-1'),
    text2: q('lp-demo-text-2'),
    text3: q('lp-demo-text-3'),
    remoteCursor: q('lp-demo-remote-cursor'),
    perms: q('lp-demo-perms'),
    permExplain: q('lp-demo-perm-explain'),
    copyBtn: q('lp-demo-copy-btn'),
    fileChip: q('lp-demo-file-chip'),
    fileStatus: q('lp-demo-file-status'),
    flyingFile: q('lp-demo-flying-file'),
    mobileBody: q('lp-demo-mobile-body'),
    srStatus: q('lp-demo-sr-status'),
  };
}

const FULL_TEXT = { 1: 'Finalize pricing page', 2: 'QA the onboarding flow', 3: 'Confirm launch date with marketing' };
const PERM_EXPLAIN = {
  edit: 'Anyone with this link can edit the room.',
  comment: 'Anyone with this link can comment, but not edit.',
  view: 'Anyone with this link can view, but not edit or comment.',
};
const MOBILE_IDLE_HTML = '<span class="lp-demo-mobile-hint">Hans&rsquo;s iPhone</span>';
const MOBILE_RECEIVED_HTML = '<div><div class="lp-demo-mobile-file">&#128230;</div>'
  + '<div class="lp-demo-mobile-file-name">launch-assets.zip</div>'
  + '<div class="lp-demo-mobile-file-check">&#10003; Received</div></div>';

// ── Typewriter (decorative — the whole stage is aria-hidden, so per-
// character DOM churn is never announced to assistive tech) ────────────
function typeInto(el, fullText, myGen, onDone) {
  if (!el) { onDone?.(); return; }
  el.textContent = '';
  let i = 0;
  const step = () => {
    if (myGen !== gen) return; // stale — a later scene/stop/loop already happened
    el.textContent = fullText.slice(0, i);
    i++;
    if (i <= fullText.length) {
      _timer = setTimeout(step, TYPE_CHAR_MS);
    } else {
      _timer = null;
      onDone?.();
    }
  };
  step();
}

function setInstant(el, text) { if (el) el.textContent = text; }

// ── Per-scene enter functions ────────────────────────────────────────────
// `animate` is true only for autoplay-driven transitions (sequential
// advance, or the loop restart); manual tab clicks always render instantly.

function enterWrite(myGen, animate, onSettled) {
  if (els.copyBtn) els.copyBtn.classList.remove('copied');
  if (!animate || reducedMotion) {
    setInstant(els.text1, FULL_TEXT[1]);
    setInstant(els.text2, FULL_TEXT[2]);
    onSettled?.();
    return;
  }
  setInstant(els.text1, '');
  setInstant(els.text2, '');
  typeInto(els.text1, FULL_TEXT[1], myGen, () => {
    if (myGen !== gen) return;
    typeInto(els.text2, FULL_TEXT[2], myGen, onSettled);
  });
}

function enterCollaborate(myGen, animate, onSettled) {
  if (!animate || reducedMotion) {
    setInstant(els.text3, FULL_TEXT[3]);
    onSettled?.();
    return;
  }
  setInstant(els.text3, '');
  typeInto(els.text3, FULL_TEXT[3], myGen, onSettled);
}

function enterReview(myGen, animate, onSettled) {
  onSettled?.();
}

function enterShare(myGen, animate, onSettled) {
  setPerm('edit');
  onSettled?.();
}

// Cancels any in-flight WAAPI animation and resets its visuals — the
// animation runs in the compositor independently of `_timer`/`gen`, so
// pausing, hiding the tab, or scrolling offscreen mid-flight (or a scene
// change interrupting it) has to explicitly stop it, not just stop
// scheduling further scene advances.
function cancelFlightAnimation() {
  if (_flightAnim) {
    try { _flightAnim.cancel(); } catch {}
    _flightAnim = null;
  }
  els.flyingFile?.classList.remove('flying');
  els.flyingFile?.classList.add('hidden');
  els.root?.classList.remove('lp-demo-sending');
}

function settleHandoff() {
  if (els.fileStatus) els.fileStatus.textContent = 'Sent ✓';
  if (els.mobileBody) els.mobileBody.innerHTML = MOBILE_RECEIVED_HTML;
}

function enterHandoff(myGen, animate, onSettled) {
  if (els.fileStatus) els.fileStatus.textContent = "Ready to send to Hans’s iPhone";
  if (els.mobileBody) els.mobileBody.innerHTML = MOBILE_IDLE_HTML;
  cancelFlightAnimation(); // clean up anything left over from an interrupted prior run

  if (!animate || reducedMotion) {
    settleHandoff(); // stable completed state, no flight animation
    onSettled?.();
    return;
  }

  _timer = setTimeout(() => {
    if (myGen !== gen) return;
    flyFileToMobile(myGen, onSettled);
  }, 500);
}

function flyFileToMobile(myGen, onSettled) {
  const { root, fileChip, flyingFile, mobileBody } = els;
  if (!root || !fileChip || !flyingFile || !mobileBody) { settleHandoff(); onSettled?.(); return; }
  const rootRect = root.getBoundingClientRect();
  const fromRect = fileChip.getBoundingClientRect();
  const toRect = mobileBody.getBoundingClientRect();
  if (!fromRect.width || !toRect.width) {
    // .lp-demo-mobile is display:none on narrow screens, so there's no
    // flight path to animate — but the scene still has to reach its
    // completed state rather than sit on "Ready to send…" forever.
    settleHandoff();
    onSettled?.();
    return;
  }

  const fromX = fromRect.left - rootRect.left + fromRect.width / 2;
  const fromY = fromRect.top - rootRect.top + fromRect.height / 2;
  const toX = toRect.left - rootRect.left + toRect.width / 2;
  const toY = toRect.top - rootRect.top + toRect.height / 2;

  root.classList.add('lp-demo-sending');
  flyingFile.style.left = `${fromX}px`;
  flyingFile.style.top = `${fromY}px`;
  flyingFile.classList.remove('hidden');
  flyingFile.classList.add('flying');

  const dx = toX - fromX, dy = toY - fromY;
  _flightAnim = flyingFile.animate(
    [
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) translate(-50%,-50%) scale(0.45)`, opacity: 0.9, offset: 0.85 },
      { transform: `translate(${dx}px, ${dy}px) translate(-50%,-50%) scale(0.3)`, opacity: 0 },
    ],
    { duration: 900, easing: 'cubic-bezier(.3,.6,.3,1)' },
  );
  _flightAnim.onfinish = () => {
    const wasCurrent = myGen === gen;
    cancelFlightAnimation(); // always clean up the visual, whether this scene is still current or not
    if (wasCurrent) {
      settleHandoff();
      onSettled?.();
    }
  };
}

const ENTER = { write: enterWrite, collaborate: enterCollaborate, review: enterReview, share: enterShare, handoff: enterHandoff };

function setPerm(perm) {
  els.perms?.querySelectorAll('.lp-demo-perm').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.perm === perm);
  });
  if (els.permExplain) els.permExplain.textContent = PERM_EXPLAIN[perm] || PERM_EXPLAIN.edit;
}

// ── Scene transition ─────────────────────────────────────────────────────

function announce(scene) {
  if (els.srStatus) els.srStatus.textContent = SCENE_LABELS[scene] || scene;
}

function updateTabs(scene) {
  let activeTab = null;
  els.tabs.forEach((tab) => {
    const active = tab.dataset.scene === scene;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) activeTab = tab;
  });
  // Keeps Tab-into-the-tablist landing on whichever scene is current even
  // when autoplay — not a keyboard event — is what changed it.
  syncTabListFocus(els.tabs, activeTab);
}

// Thin fill under the active tab, reinforcing that autoplay is a running
// timer and not a static illustration — purely decorative (the stage is
// aria-hidden already) so it only needs to track *whether* an advance timer
// is currently armed, not resume with perfectly accurate elapsed time.
function startTabProgress(scene, ms) {
  const tab = els.tabs.find((t) => t.dataset.scene === scene);
  if (!tab) return;
  tab.style.setProperty('--lp-tab-progress-ms', `${ms}ms`);
  tab.classList.add('lp-demo-tab-progress');
}

function resetTabProgress() {
  els.tabs.forEach((tab) => {
    tab.classList.remove('lp-demo-tab-progress');
    tab.style.removeProperty('--lp-tab-progress-ms');
  });
}

function goToScene(scene, { animate = false, thenAutoAdvance = false } = {}) {
  if (!els?.root) return;
  gen += 1;
  const myGen = gen;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  resetTabProgress();

  sceneIndex = SCENES.indexOf(scene);
  els.root.dataset.scene = scene;
  updateTabs(scene);
  announce(scene);

  const enter = ENTER[scene];
  const settle = () => {
    if (myGen !== gen) return;
    if (thenAutoAdvance) scheduleAdvance(scene, myGen);
  };
  enter?.(myGen, animate, settle);
}

function scheduleAdvance(scene, myGen) {
  const base = DURATIONS[scene] ?? 2500;
  const wait = scene === 'handoff' ? base + HANDOFF_HOLD_MS : base;
  startTabProgress(scene, wait);
  _timer = setTimeout(() => {
    if (myGen !== gen || !playing) return;
    const next = SCENES[(sceneIndex + 1) % SCENES.length];
    goToScene(next, { animate: true, thenAutoAdvance: true });
  }, wait);
}

// ── Autoplay start/stop, gated by visibility + tab focus + reduced motion ──

function canAutoplay() { return playing && visible && !tabHidden && !reducedMotion; }

function startAutoplay() {
  if (_timer) return; // already running
  const scene = SCENES[sceneIndex];
  scheduleAdvance(scene, gen);
}

// Pausing (Play/Pause button, tab hidden, or scrolled offscreen) has to do
// more than stop the *next* scene transition from being scheduled — if the
// current scene's own typing effect or the handoff flight animation was
// still in progress, clearing just `_timer` would leave it visibly stuck
// mid-animation (a half-typed line, or a package frozen mid-flight) with
// nothing left to ever finish it, since resuming only re-arms the *next*
// scene's timer. Snapping the current scene to its settled state on pause
// sidesteps that entirely — there's never a "resume this half-finished
// animation" case to handle, because pausing never leaves one.
function settleCurrentScene() {
  gen += 1;
  const myGen = gen;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  resetTabProgress();
  cancelFlightAnimation();
  ENTER[SCENES[sceneIndex]]?.(myGen, false, null);
}

function stopAutoplayTimer() {
  if (_timer || _flightAnim) settleCurrentScene();
}

function syncAutoplayToConditions() {
  if (canAutoplay()) startAutoplay();
  else stopAutoplayTimer();
}

function setPlayPauseUI() {
  const isPlaying = playing && !reducedMotion;
  els.pauseIcon?.classList.toggle('hidden', !isPlaying);
  els.playIcon?.classList.toggle('hidden', isPlaying);
  els.playpause?.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
  els.playpause?.setAttribute('aria-label', isPlaying ? 'Pause demo animation' : 'Play demo animation');
}

// ── Public entry point ───────────────────────────────────────────────────

export function initLandingDemo() {
  if (initialized) return;
  initialized = true;
  cacheEls();
  if (!els.root) return; // defensive — hero markup not present

  reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.addEventListener?.('change', (e) => {
    reducedMotion = e.matches;
    setPlayPauseUI();
    syncAutoplayToConditions();
  });

  wireTabListKeyboardNav(els.tabs);
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      playing = false;
      setPlayPauseUI();
      stopAutoplayTimer();
      goToScene(tab.dataset.scene, { animate: false, thenAutoAdvance: false });
    });
  });

  els.playpause?.addEventListener('click', () => {
    playing = !playing;
    setPlayPauseUI();
    syncAutoplayToConditions();
  });

  els.perms?.querySelectorAll('.lp-demo-perm').forEach((btn) => {
    btn.addEventListener('click', () => setPerm(btn.dataset.perm));
  });

  els.copyBtn?.addEventListener('click', async () => {
    try { await navigator.clipboard?.writeText('syncpad.app/product-launch-plan'); } catch { /* clipboard permission denied — still show feedback */ }
    els.copyBtn.textContent = 'Copied!';
    els.copyBtn.classList.add('copied');
    setTimeout(() => {
      if (!els.copyBtn) return;
      els.copyBtn.textContent = 'Copy';
      els.copyBtn.classList.remove('copied');
    }, 1500);
  });

  wirePointerTilt();

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { visible = entry.isIntersecting; });
      syncAutoplayToConditions();
    }, { threshold: 0.3 });
    io.observe(els.root);
  }
  document.addEventListener('visibilitychange', () => {
    tabHidden = document.hidden;
    syncAutoplayToConditions();
  });

  // Static HTML already renders the Write scene fully populated (the
  // no-JS/reduced-motion fallback); this just brings the JS-side state
  // (tabs, sr-status, perms) into sync with that same starting scene.
  goToScene('write', { animate: false, thenAutoAdvance: false });
  setPlayPauseUI();
  syncAutoplayToConditions();
}

function wirePointerTilt() {
  const desktop = document.querySelector('.lp-demo-desktop');
  if (!desktop || !window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches) return;
  els.root.addEventListener('mousemove', (e) => {
    if (reducedMotion) return;
    const rect = els.root.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    desktop.style.setProperty('--lp-tilt-x', `${px * 3}deg`);
    desktop.style.setProperty('--lp-tilt-y', `${py * -3}deg`);
  });
  els.root.addEventListener('mouseleave', () => {
    desktop.style.setProperty('--lp-tilt-x', '0deg');
    desktop.style.setProperty('--lp-tilt-y', '0deg');
  });
}
