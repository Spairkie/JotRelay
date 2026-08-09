// JotRelay – admin.js
// Admin dashboard: auth gate, room management, reports, files, audit, cleanup.
// All data access is gated by Supabase RLS (is_syncpad_admin() function).
//
// This file is the thin entry point — auth-state routing (unavailable / login
// / dashboard) only. The dashboard itself and each tab live in src/admin/,
// split by domain (see each file's own header comment):
//
//   admin/state.js          – shared mutable dashboard state
//   admin/shared.js         – constants, path/schema/storage/audit helpers
//   admin/stats.js          – stat cards + activity chart
//   admin/room-drawer.js    – room detail drawer
//   admin/rooms-tab.js      – Rooms tab
//   admin/reports-tab.js    – Reports tab
//   admin/files-tab.js      – Files tab
//   admin/audit-tab.js      – Audit Log tab
//   admin/cleanup-tab.js    – Cleanup tab
//   admin/dashboard-shell.js – header/stats/tabs frame + tab dispatch
//
// dashboard-shell.js takes an `onLogout` callback instead of importing
// initAdmin() from this file directly, so there's no admin.js <->
// dashboard-shell.js import cycle.

import { getSupabaseClient } from './supabase.js';
import { _homePath } from './admin/shared.js';
import { _renderDashboard } from './admin/dashboard-shell.js';

// ── Entry point ───────────────────────────────────────────────────────────────

/** Lazy-load the admin-only stylesheet — regular room pages never fetch it. */
function _loadAdminStylesheet() {
  if (document.getElementById('admin-stylesheet')) return;
  const link = document.createElement('link');
  link.id = 'admin-stylesheet';
  link.rel = 'stylesheet';
  link.href = '/SyncPad/styles/admin.css';
  document.head.appendChild(link);
}

export async function initAdmin() {
  _loadAdminStylesheet();
  let sb;
  try { sb = getSupabaseClient(); }
  catch { _renderUnavailable(); return; }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await _renderDashboard(sb, session, { onLogout: initAdmin });
    else          _renderLogin(sb);
  } catch (err) {
    console.error('[admin] initAdmin failed:', err);
    _renderUnavailable();
  }
}

// ── Unavailable state ─────────────────────────────────────────────────────────

function _renderUnavailable() {
  const screen = document.getElementById('admin-screen');
  if (!screen) return;
  screen.innerHTML = `
    <div class="admin-login-wrap">
      <div class="auth-card auth-card--centered admin-login-card">
        <div class="auth-card-icon">⚠️</div>
        <h2>Admin unavailable</h2>
        <p>Could not connect to Supabase. Check your network connection and try again.</p>
        <button onclick="window.location.reload()" class="auth-btn" style="margin-top:14px">Retry</button>
        <button id="admin-unavailable-home" class="auth-btn admin-secondary-btn">Back to JotRelay</button>
      </div>
    </div>`;
  document.getElementById('admin-unavailable-home')?.addEventListener('click', () => {
    window.location.href = _homePath();
  });
}

// ── Login form ────────────────────────────────────────────────────────────────

function _renderLogin(sb) {
  const screen = document.getElementById('admin-screen');
  screen.innerHTML = `
    <div class="admin-login-wrap">
      <div class="auth-card admin-login-card">
        <div class="auth-card-icon">🔐</div>
        <h2>Admin Sign In</h2>
        <p>Sign in with your admin account to access the dashboard.</p>
        <input id="admin-email"    class="auth-input" type="email"    placeholder="Email"    autocomplete="email" />
        <input id="admin-password" class="auth-input" type="password" placeholder="Password" autocomplete="current-password" style="margin-top:10px" />
        <div id="admin-login-error" class="admin-login-error"></div>
        <button id="admin-login-btn"  class="auth-btn" style="margin-top:14px">Sign in</button>
        <button id="admin-login-home" class="auth-btn admin-secondary-btn">Back to JotRelay</button>
      </div>
    </div>`;

  const emailEl    = document.getElementById('admin-email');
  const passwordEl = document.getElementById('admin-password');
  const errorEl    = document.getElementById('admin-login-error');
  const loginBtn   = document.getElementById('admin-login-btn');

  async function doLogin() {
    const email    = emailEl.value.trim();
    const password = passwordEl.value;
    if (!email || !password) { errorEl.textContent = 'Please enter your email and password.'; return; }
    loginBtn.disabled = true; loginBtn.textContent = 'Signing in…'; errorEl.textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      errorEl.textContent = error.message || 'Sign-in failed.';
      loginBtn.disabled = false; loginBtn.textContent = 'Sign in';
      return;
    }
    await _renderDashboard(sb, data.session, { onLogout: initAdmin });
  }

  loginBtn.addEventListener('click', doLogin);
  passwordEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  emailEl.addEventListener('keydown',    (e) => { if (e.key === 'Enter') passwordEl.focus(); });
  document.getElementById('admin-login-home')?.addEventListener('click', () => {
    window.location.href = _homePath();
  });
}
