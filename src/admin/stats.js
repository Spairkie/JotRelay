// JotRelay – admin/stats.js
// Dashboard stat cards + the "rooms created per day" activity chart.

import { state } from './state.js';
import { formatFileSize, escapeHtml } from '../utils.js';

const ACTIVITY_DAYS = 14;

export async function _loadStats() {
  ['stat-rooms', 'stat-active', 'stat-files', 'stat-storage', 'stat-reports', 'stat-expired'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('admin-skeleton');
  });

  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const activitySinceIso = new Date(Date.now() - ACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [roomsRes, filesRes, reportsRes, expiredRes, activeRes, storageRes, activityRes] = await Promise.allSettled([
    state.sb.from('syncpad_rooms').select('*', { count: 'exact', head: true }),
    state.sb.from('syncpad_files').select('*', { count: 'exact', head: true }),
    state.sb.from('syncpad_room_reports').select('*', { count: 'exact', head: true }).eq('status', 'new'),
    state.sb.from('syncpad_rooms').select('*', { count: 'exact', head: true })
      .lt('expires_at', new Date().toISOString()).not('expires_at', 'is', null),
    state.sb.from('syncpad_rooms').select('*', { count: 'exact', head: true }).gte('updated_at', dayAgoIso),
    // No SUM() over PostgREST without a DB function — for a personal-project-scale
    // table this is a small enough row set to sum client-side.
    state.sb.from('syncpad_files').select('file_size'),
    state.sb.from('syncpad_rooms').select('created_at').gte('created_at', activitySinceIso),
  ]);

  const get = (res) => res.status === 'fulfilled' ? (res.value.count ?? '—') : '—';

  const update = (id, val) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = val; el.classList.remove('admin-skeleton'); }
  };
  update('stat-rooms',   get(roomsRes));
  update('stat-active',  get(activeRes));
  update('stat-files',   get(filesRes));
  update('stat-reports', get(reportsRes));
  update('stat-expired', get(expiredRes));

  const totalBytes = storageRes.status === 'fulfilled'
    ? (storageRes.value.data || []).reduce((sum, r) => sum + (r.file_size || 0), 0)
    : null;
  update('stat-storage', totalBytes == null ? '—' : formatFileSize(totalBytes));

  const reportCount = reportsRes.status === 'fulfilled' ? (reportsRes.value.count ?? 0) : 0;
  const card = document.getElementById('stat-card-reports');
  if (card) card.classList.toggle('admin-stat-card--has-alerts', reportCount > 0);

  const createdAts = activityRes.status === 'fulfilled' ? (activityRes.value.data || []).map(r => r.created_at) : [];
  _renderActivityChart(createdAts);
}

// ── Activity chart (rooms created per day, last N days) ────────────────────
// Dependency-free inline SVG — no charting library, matching the rest of the
// app's "no build step" approach. Single series (room creations), so per the
// project's chart conventions this needs no legend, just the title above it
// and a hover tooltip per bar.

function _renderActivityChart(createdAtIsoStrings) {
  const container = document.getElementById('admin-activity-chart');
  const totalEl = document.getElementById('admin-activity-total');
  if (!container) return;

  // Bucket by local calendar day, oldest first.
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({ date: d, count: 0 });
  }
  const dayIndex = new Map(days.map((d, i) => [d.date.toDateString(), i]));
  for (const iso of createdAtIsoStrings) {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    const idx = dayIndex.get(d.toDateString());
    if (idx != null) days[idx].count++;
  }

  const total = days.reduce((s, d) => s + d.count, 0);
  if (totalEl) totalEl.textContent = `${total} new room${total === 1 ? '' : 's'}`;

  if (total === 0) {
    container.innerHTML = `<div class="admin-activity-empty">No rooms created in the last ${ACTIVITY_DAYS} days.</div>`;
    return;
  }

  const max = Math.max(...days.map(d => d.count), 1);
  const barWidth = 100 / days.length;
  const bars = days.map((d, i) => {
    const heightPct = (d.count / max) * 100;
    const label = d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `
      <div class="admin-activity-bar-wrap" style="width:${barWidth}%" tabindex="0"
           title="${escapeHtml(label)}: ${d.count} room${d.count === 1 ? '' : 's'}">
        <div class="admin-activity-bar" style="height:${Math.max(heightPct, d.count > 0 ? 4 : 0)}%"></div>
        <span class="admin-activity-bar-label">${i % 2 === 0 || days.length <= 7 ? escapeHtml(d.date.getDate().toString()) : ''}</span>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="admin-activity-bars">${bars}</div>`;
}
