// SyncPad – icons.js
// Stroke-based SVG icons (24x24 viewBox, currentColor).
// Used in dynamic DOM rendering (ui.js).  Static HTML uses inline SVGs.

const STROKE = `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

const DEFS = {
  share:    `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 13v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><line x1="12" y1="14" x2="12" y2="3"/><line x1="7" y1="8" x2="12" y2="3"/><line x1="17" y1="8" x2="12" y2="3"/></svg>`,
  copy:     `<svg viewBox="0 0 24 24" ${STROKE}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M15 9V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5"/></svg>`,
  eye:      `<svg viewBox="0 0 24 24" ${STROKE}><path d="M2 12s4.5-8 10-8 10 8 10 8-4.5 8-10 8-10-8-10-8z"/><circle cx="12" cy="12" r="3.25"/></svg>`,
  admin:    `<svg viewBox="0 0 24 24" ${STROKE}><path d="M12 2l8 3.2v5.8c0 5.6-3.4 9.7-8 11-4.6-1.3-8-5.4-8-11V5.2L12 2z"/><path d="M8.5 12.4l2.4 2.4 4.9-5.3"/></svg>`,
  edit:     `<svg viewBox="0 0 24 24" ${STROKE}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  files:    `<svg viewBox="0 0 24 24" ${STROKE}><path d="M20.5 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3l7.5-7.5"/></svg>`,
  users:    `<svg viewBox="0 0 24 24" ${STROKE}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a3.5 3.5 0 0 0-2.5-3.4"/><path d="M16.5 3.1a4 4 0 0 1 0 7.8"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.75"/><rect x="10.5" y="1.5" width="3" height="3.4" rx="1"/><rect x="10.5" y="1.5" width="3" height="3.4" rx="1" transform="rotate(45 12 12)"/><rect x="10.5" y="1.5" width="3" height="3.4" rx="1" transform="rotate(90 12 12)"/><rect x="10.5" y="1.5" width="3" height="3.4" rx="1" transform="rotate(135 12 12)"/><rect x="10.5" y="1.5" width="3" height="3.4" rx="1" transform="rotate(180 12 12)"/><rect x="10.5" y="1.5" width="3" height="3.4" rx="1" transform="rotate(225 12 12)"/><rect x="10.5" y="1.5" width="3" height="3.4" rx="1" transform="rotate(270 12 12)"/><rect x="10.5" y="1.5" width="3" height="3.4" rx="1" transform="rotate(315 12 12)"/></svg>`,
  tools:    `<svg viewBox="0 0 24 24" ${STROKE}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  lock:     `<svg viewBox="0 0 24 24" ${STROKE}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11"/></svg>`,
  unlock:   `<svg viewBox="0 0 24 24" ${STROKE}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M7.5 11V7.5a4.5 4.5 0 0 1 8.5-2"/></svg>`,
  clock:    `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>`,
  restore:  `<svg viewBox="0 0 24 24" ${STROKE}><path d="M3 4v6h6"/><path d="M4.5 15a8.5 8.5 0 1 0 2-9.5L3 9"/></svg>`,
  download: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/><line x1="12" y1="3" x2="12" y2="15"/><line x1="7" y1="10" x2="12" y2="15"/><line x1="17" y1="10" x2="12" y2="15"/></svg>`,
  trash:    `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 7h16"/><path d="M18.5 7l-.9 12.1a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 7"/><path d="M9.5 7V4.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7"/><line x1="10" y1="11" x2="10" y2="16"/><line x1="14" y1="11" x2="14" y2="16"/></svg>`,
  more:     `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/><circle cx="5" cy="12" r="1.3"/></svg>`,
  close:    `<svg viewBox="0 0 24 24" ${STROKE}><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>`,
  check:    `<svg viewBox="0 0 24 24" ${STROKE}><path d="M20 6L9 17l-5-5"/></svg>`,
  plus:     `<svg viewBox="0 0 24 24" ${STROKE}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  search:   `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  split:    `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3" y="4" width="8" height="16" rx="2"/><rect x="13" y="4" width="8" height="16" rx="2"/></svg>`,
  template: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M15 2v5h5"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`,
  paste:    `<svg viewBox="0 0 24 24" ${STROKE}><path d="M15 4h2.5A1.5 1.5 0 0 1 19 5.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20.5v-15A1.5 1.5 0 0 1 6.5 4H9"/><rect x="8.5" y="2" width="7" height="4" rx="1"/></svg>`,
  monospace:`<svg viewBox="0 0 24 24" ${STROKE}><path d="M5 6V4h14v2"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="9" y1="20" x2="15" y2="20"/></svg>`,
  select:   `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="8" x2="12" y2="16"/></svg>`,
  qr:       `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3" rx="1"/><rect x="19" y="14" width="2" height="2" rx="0.5"/><rect x="14" y="19" width="2" height="2" rx="0.5"/><rect x="19" y="19" width="2" height="2" rx="0.5"/></svg>`,
  phone:    `<svg viewBox="0 0 24 24" ${STROKE}><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
  warning:  `<svg viewBox="0 0 24 24" ${STROKE}><path d="M10.4 3.5a2 2 0 0 1 3.2 0l8.5 13.9a2 2 0 0 1-1.7 3.1H3.6a2 2 0 0 1-1.7-3.1l8.5-13.9z"/><line x1="12" y1="9.5" x2="12" y2="13.5"/><circle cx="12" cy="17" r="1"/></svg>`,
  link:     `<svg viewBox="0 0 24 24" ${STROKE}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>`,
  upload:   `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="7" y1="8" x2="12" y2="3"/><line x1="17" y1="8" x2="12" y2="3"/></svg>`,
};

/**
 * Return a sized SVG string for the given icon name.
 * @param {string} name  – key in DEFS
 * @param {number} [size=18]
 */
export function getIcon(name, size = 18) {
  const raw = DEFS[name];
  if (!raw) return '';
  return raw.replace('<svg ', `<svg width="${size}" height="${size}" `);
}

export default DEFS;
