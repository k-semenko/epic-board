import { t } from './i18n.mjs';

// One small stroke icon set drawn in currentColor, so icons follow the theme like text does.
const PATHS = {
  check: '<path d="M3 8.5l3 3 7-7"/>',
  play: '<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
  circle: '<circle cx="8" cy="8" r="5"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.3l2.2 1.5"/>',
  block: '<circle cx="8" cy="8" r="5.5"/><path d="M4.2 4.2l7.6 7.6"/>',
  arrowRight: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  arrowLeft: '<path d="M13 8H3M7 4L3 8l4 4"/>',
  arrowDown: '<path d="M8 3v10M4 9l4 4 4-4"/>',
  arrowUp: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  dep: '<path d="M4 2.5V7a2.5 2.5 0 0 0 2.5 2.5H13M10 6.5l3 3-3 3"/>',
  branch: '<circle cx="5" cy="3.8" r="1.6"/><circle cx="5" cy="12.2" r="1.6"/><circle cx="11" cy="5.5" r="1.6"/><path d="M5 5.4v5.2M11 7.1c0 2.6-2.4 3.4-6 3.6"/>',
  merge: '<circle cx="4.5" cy="3.8" r="1.6"/><circle cx="4.5" cy="12.2" r="1.6"/><circle cx="11.5" cy="12.2" r="1.6"/><path d="M4.5 5.4v5.2M4.5 5.4c0 4 3 5.2 5.4 6.6"/>',
  flag: '<path d="M4 14V2.5M4 3h7.5l-1.8 2.7L11.5 8.5H4"/>',
  target: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none"/>',
  alert: '<path d="M8 2.5l6 11H2z"/><path d="M8 6.5v3M8 11.6v.2"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v3h-3"/>',
  zoomIn: '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14M5 7h4M7 5v4"/>',
  zoomOut: '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14M5 7h4"/>',
  fit: '<path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>',
  expand: '<path d="M9.5 2H14v4.5M6.5 14H2V9.5M14 2L9 7M2 14l5-5"/>',
  collapse: '<path d="M14 6.5H9.5V2M2 9.5h4.5V14M9.5 6.5L14 2M6.5 9.5L2 14"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  download: '<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>',
  file: '<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5M6 8.5h4.5M6 11h4.5"/>',
  edit: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/><path d="M9 4l3 3"/>',
  save: '<path d="M3 2.5h8l2.5 2.5v8.5H3z"/><path d="M5.5 2.5V6h5V2.5M5.5 13.5V9.5h5v4"/>',
  versions: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.8h2.8"/><path d="M8 5v3.2l2 1.3"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  link: '<path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.3v3.7M8 5v.1"/>',
  list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1"/>',
  layers: '<path d="m8 1.5 6.5 3.7L8 8.9 1.5 5.2zM1.5 8.2 8 11.9l6.5-3.7M1.5 11.2 8 14.9l6.5-3.7"/>',
  board: '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11M10 6h4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14"/>',
  undo: '<path d="M5.5 4L2.5 7l3 3M2.8 7H10a3.5 3.5 0 0 1 0 7H8"/>',
  bot: '<rect x="3" y="5" width="10" height="8" rx="2"/><path d="M8 2.5V5M6 9h.1M10 9h.1"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i${cls ? ` ${cls}` : ''}" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

export const STATE_ICON = { done: 'check', active: 'play', waiting: 'clock', blocked: 'block', todo: 'circle' };

// Provider marks, simplified to read at 16 px; colour comes from the brand, not the theme.
const AGENTS = {
  claude: { label: 'Claude', color: '#D97757', svg: '<g stroke-width="1.9"><path d="M8 1.8v12.4M1.8 8h12.4M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8"/></g>' },
  codex: { label: 'Codex', color: '#10A37F', svg: '<path d="M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9z"/><path d="M8 5.2l2.4 1.4v2.8L8 10.8 5.6 9.4V6.6z"/>' },
  grok: { label: 'Grok', color: 'currentColor', svg: '<circle cx="8" cy="8" r="5.6"/><path d="M3.2 12.8L12.8 3.2"/>' },
  gemini: { label: 'Gemini', color: '#4C8DF6', svg: '<path d="M8 1.5c.6 3.4 3.1 5.9 6.5 6.5-3.4.6-5.9 3.1-6.5 6.5-.6-3.4-3.1-5.9-6.5-6.5 3.4-.6 5.9-3.1 6.5-6.5z" fill="currentColor" stroke="none"/>' },
};

export function agentBadge(agent) {
  const a = AGENTS[agent];
  const label = a ? a.label : agent || t('agent.none');
  const mark = a
    ? `<svg class="i" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:${a.color}" aria-hidden="true">${a.svg}</svg>`
    : icon('bot');
  return `<span class="agent">${mark}${label}</span>`;
}

// Logo mark generated with Grok CLI: three lanes converging into one goal; the dot takes the accent.
export function logo() {
  return '<svg class="logo" viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden="true"><path d="M4 8h8l7 8H23M4 16h15M4 24h8l7-8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26.5" cy="16" r="2.5" class="logo-dot"/></svg>';
}
