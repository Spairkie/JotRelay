// JotRelay – app/landing.js
// The landing screen (create/join room, recent rooms) and the static
// contact-form page.

import {
  generateRoomId, sanitizeRoomId, escapeHtml, formatTimestamp,
  buildRoomUrl, buildReadOnlyUrl, wireTabListKeyboardNav, syncTabListFocus,
} from '../utils.js';
import { getOrCreateReadOnlyShareLink, getOrCreateRoomCode, resolveRoomCode } from '../rooms.js';
import * as UI from '../ui.js';
import { state, BASE, _stripBasePath } from './state.js';
import { RESERVED_ROOM_PATHS, SHORT_CODE_RE, _loadRecentRooms, _forgetRecentRoom } from './routing.js';
import { joinRoom, recordLegalBackPath } from './room-lifecycle.js';
import { initLandingDemo } from './landing-demo.js';

// ── Share modal ────────────────────────────────────────────────────────────────

export async function _openShareModal() {
  // Blur whatever's currently focused (typically the note editor) before
  // doing anything else, so the on-screen keyboard starts closing right
  // away instead of staying open under this full-screen modal — on the iOS
  // visualViewport fallback path, the modal's own layout doesn't track
  // --kb-inset, so its lower QR/copy controls would otherwise render behind
  // a keyboard that never got a reason to dismiss.
  document.activeElement?.blur?.();

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

// ── Bare create/join screen (/app) ──────────────────────────────────────────────
// This is the original landing screen, split out to its own route so the
// marketing page at `/` can be pure marketing copy — its CTAs are plain links
// to `${BASE}/app/` rather than wiring up a second copy of this form. See
// docs/marketing-site.md for the full route/section map.

export function wireLandingEvents() {
  const joinInput = document.getElementById('landing-join-input');
  const joinBtn   = document.getElementById('landing-join-btn');
  const createBtn = document.getElementById('landing-create-btn');

  // See index.html's comment on #landing-join-input: readonly until the
  // user actually focuses it, so browsers/password managers have nothing
  // to attach an autofill suggestion or save-password prompt to.
  joinInput?.addEventListener('focus', () => joinInput.removeAttribute('readonly'), { once: true });

  // window.__supabaseReady: the /app route itself renders without waiting
  // on the Supabase CDN script (see boot() in room-lifecycle.js — a static
  // create/join screen shouldn't be held hostage by a slow/stalled CDN
  // fetch), but every action below it ultimately reaches
  // getSupabaseClient(). A click landing in that gap would otherwise call
  // it before window.supabase exists and surface as a room-load failure.
  const handleCreateRoomClick = () => {
    const roomId = generateRoomId();
    history.pushState(null, '', `${BASE}/${roomId}`);
    recordLegalBackPath();
    UI.showScreen('loading');
    window.__supabaseReady.then(() => joinRoom(roomId, { isNewRoom: true }));
  };

  const joinRoom_ = async () => {
    const raw = joinInput?.value?.trim();
    if (!raw) return;

    await window.__supabaseReady;

    if (SHORT_CODE_RE.test(raw)) {
      try {
        const resolvedId = await resolveRoomCode(raw);
        if (resolvedId) {
          history.pushState(null, '', `${BASE}/${resolvedId}`);
          recordLegalBackPath();
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
    recordLegalBackPath();
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
      recordLegalBackPath();
      UI.showScreen('loading');
      window.__supabaseReady.then(() => joinRoom(roomId));
    });
  });
  list.querySelectorAll('.landing-recent-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      _forgetRecentRoom(btn.dataset.removeId);
      _renderRecentRooms();
    });
  });
}

// ── Marketing page (nav toggle, feature tabs, scroll-reveal) ───────────────────
// Wiring for the `/` marketing page — separate from wireLandingEvents() above,
// which now only runs for the bare create/join screen at `/app`. Purely
// presentational; none of this touches room/session state, so unlike the rest
// of app/*.js it doesn't need an entry in teardownRealtimeSession(). Guarded
// the same way wireContactEvents is, in case boot() re-runs it in one session.
let _marketingPageWired = false;

// ── Brand-intro typewriter ─────────────────────────────────────────────────
// Small local implementation (no library) for the opener's tagline — types
// each line out, pauses, erases it, and moves to the next, looping forever;
// a blinking caret (CSS animation) stays in place throughout. "JotRelay"
// itself is plain static markup and never touches this; only the tagline
// text node is mutated.
const INTRO_TAGLINES = [
  '/* notes and files, synced instantly */',
  '/* no accounts, no setup, just a link */',
  '/* real-time collaboration, zero friction */',
  '/* share read-only, encrypt what matters */',
];
const INTRO_TYPE_MS  = 32;
const INTRO_ERASE_MS = 18;
const INTRO_PAUSE_MS = 2200;

function typeIntroTagline() {
  const el = document.getElementById('lp-intro-tagline-text');
  if (!el) return;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  if (reducedMotion) { el.textContent = INTRO_TAGLINES[0]; return; }

  let taglineIndex = 0;
  let charIndex = 0;
  let phase = 'typing'; // 'typing' | 'pausing' | 'erasing'

  const tick = () => {
    // offsetParent is null once #landing-screen (or any ancestor) picks up
    // the .hidden class on navigation — this is a single-page app, so the
    // element isn't torn down when the user leaves this screen, and without
    // this check the loop below would run forever in the background.
    if (el.offsetParent === null) return;

    const text = INTRO_TAGLINES[taglineIndex];
    if (phase === 'typing') {
      charIndex += 1;
      el.textContent = text.slice(0, charIndex);
      if (charIndex >= text.length) { phase = 'pausing'; setTimeout(tick, INTRO_PAUSE_MS); }
      else setTimeout(tick, INTRO_TYPE_MS);
    } else if (phase === 'pausing') {
      phase = 'erasing';
      setTimeout(tick, INTRO_ERASE_MS);
    } else { // erasing
      charIndex -= 1;
      el.textContent = text.slice(0, charIndex);
      if (charIndex <= 0) {
        taglineIndex = (taglineIndex + 1) % INTRO_TAGLINES.length;
        phase = 'typing';
        setTimeout(tick, INTRO_TYPE_MS);
      } else {
        setTimeout(tick, INTRO_ERASE_MS);
      }
    }
  };
  el.textContent = '';
  setTimeout(tick, INTRO_TYPE_MS);
}

export function wireMarketingPageEvents() {
  if (_marketingPageWired) return;
  _marketingPageWired = true;

  typeIntroTagline();

  // Mobile nav toggle
  const navToggle = document.getElementById('lp-nav-toggle');
  const navLinks  = document.getElementById('lp-nav-links');
  navToggle?.addEventListener('click', () => {
    const open = navLinks?.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  navLinks?.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle?.setAttribute('aria-expanded', 'false');
    });
  });

  // Feature tabs
  const tabsWrap = document.getElementById('lp-feature-tabs');
  const panelsWrap = document.getElementById('lp-feature-panels');
  const featureTabs = tabsWrap ? Array.from(tabsWrap.querySelectorAll('.lp-feature-tab')) : [];
  if (featureTabs.length) {
    wireTabListKeyboardNav(featureTabs);
    syncTabListFocus(featureTabs, featureTabs.find((t) => t.classList.contains('active')) || featureTabs[0]);
  }
  tabsWrap?.addEventListener('click', (e) => {
    const tab = e.target.closest('.lp-feature-tab');
    if (!tab) return;
    const key = tab.dataset.feature;
    featureTabs.forEach((t) => {
      const active = t === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    syncTabListFocus(featureTabs, tab);
    panelsWrap?.querySelectorAll('.lp-feature-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.featurePanel === key);
    });
  });

  // Coded hero demo (write/collaborate/review/share/handoff scene machine) —
  // see src/app/landing-demo.js. Self-contained; safe to call unconditionally.
  initLandingDemo();

  // Footer year
  const yearEl = document.getElementById('lp-footer-year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Scroll-reveal for section headers/cards — progressive enhancement only;
  // everything already renders visible via CSS if this observer never runs.
  const revealTargets = document.querySelectorAll(
    '.lp-section-head, .lp-step, .lp-benefit-card, .lp-feature-shell, .lp-cta',
  );
  revealTargets.forEach((el) => el.classList.add('lp-reveal'));
  if ('IntersectionObserver' in window && revealTargets.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('lp-in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealTargets.forEach((el) => io.observe(el));
  } else {
    revealTargets.forEach((el) => el.classList.add('lp-in-view'));
  }

  // Scroll spy: underline the nav link for whichever section is currently
  // in view, so a visitor scrolling through the pitch always knows where
  // they are. Only in-page anchors (#lp-features etc.) participate —
  // external links (Presskit, GitHub) never get a matching section.
  const navAnchors = navLinks
    ? Array.from(navLinks.querySelectorAll('a[href^="#"]')).filter((a) => a.getAttribute('href') !== '#lp-top')
    : [];
  const navSections = navAnchors
    .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
    .filter(Boolean);
  if ('IntersectionObserver' in window && navSections.length) {
    const setActiveNav = (id) => {
      navAnchors.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
    };
    // A thin horizontal band near the top of the viewport, rather than the
    // default "any overlap counts" — otherwise two adjacent tall sections
    // both register as intersecting for most of the scroll and the active
    // link jitters between them.
    //
    // IntersectionObserver callbacks only deliver *transitions* (targets
    // whose intersecting state changed since the last callback), not the
    // full current state of every observed target — so filtering just the
    // entries a single callback happens to receive is wrong: when section A
    // is already intersecting and stays that way while section B exits,
    // that callback's entries can contain only B's (non-intersecting) one,
    // which would wrongly clear A's still-valid active link. Track
    // intersecting state persistently across callbacks instead.
    const intersecting = new Set();
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) intersecting.add(e.target.id);
        else intersecting.delete(e.target.id);
      });
      // Scrolled back up into the intro/hero (above #lp-features) or down
      // past #lp-trust into the footer/CTA — no tracked section is in the
      // band, so nothing should stay underlined either. Document order
      // (via navSections, not entries order) keeps the choice deterministic
      // on the rare frame where the thin band spans two sections at once.
      const activeId = navSections.find((el) => intersecting.has(el.id))?.id || null;
      setActiveNav(activeId);
    }, { rootMargin: '-45% 0px -50% 0px' });
    navSections.forEach((el) => spy.observe(el));
  }
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
