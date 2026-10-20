import { ID } from './store.mjs';
import { DEFAULT_SECTION_ORDER } from './page/section-order.mjs';
import { SOUND_IDS } from './sounds.mjs';

export const SETTINGS_SCHEMA = 2;

export const PAGE_SIZE_BLOCKS = Object.freeze(['waiting', 'decisions', 'history']);
export const PAGE_SIZES = Object.freeze([5, 10, 15]);
export const MAP_HEIGHTS = Object.freeze(['s', 'm', 'l']);
export const DEFAULT_PAGE_SIZES = Object.freeze({ waiting: 5, decisions: 5, history: 5 });

/** @type {ReadonlyArray<{
 *   key: string,
 *   type: 'enum'|'int'|'duration'|'bool'|'string'|'list'|'order'|'record',
 *   default: unknown,
 *   constraints?: Record<string, unknown>,
 *   group: string,
 *   label: string,
 *   hint: string,
 *   ui: boolean,
 *   since: string,
 * }>} */
export const SETTINGS_REGISTRY = Object.freeze([
  Object.freeze({
    key: 'epic.sectionOrder',
    type: 'order',
    default: Object.freeze([...DEFAULT_SECTION_ORDER]),
    constraints: Object.freeze({ items: Object.freeze([...DEFAULT_SECTION_ORDER]) }),
    group: 'epic',
    label: 'settings.key.epic.sectionOrder',
    hint: 'settings.hint.epic.sectionOrder',
    ui: true,
    since: '0.5.0',
  }),
  Object.freeze({
    key: 'epic.pageSizes',
    type: 'record',
    default: DEFAULT_PAGE_SIZES,
    constraints: Object.freeze({
      fields: Object.freeze(Object.fromEntries(PAGE_SIZE_BLOCKS.map((id) => [id, Object.freeze({ values: PAGE_SIZES })]))),
    }),
    group: 'epic',
    label: 'settings.key.epic.pageSizes',
    hint: 'settings.hint.epic.pageSizes',
    ui: true,
    since: '0.6.0',
  }),
  Object.freeze({
    key: 'epic.mapHeight',
    type: 'enum',
    default: null,
    constraints: Object.freeze({ values: MAP_HEIGHTS }),
    group: 'epic',
    label: 'settings.key.epic.mapHeight',
    hint: 'settings.hint.epic.mapHeight',
    ui: true,
    since: '0.7.0',
  }),
  Object.freeze({
    key: 'epic.pinned',
    type: 'list',
    default: Object.freeze([]),
    constraints: Object.freeze({ itemPattern: ID.source }),
    group: 'epic',
    label: 'settings.key.epic.pinned',
    hint: 'settings.hint.epic.pinned',
    ui: false,
    since: '0.10.0',
  }),
  Object.freeze({
    key: 'feed.retention.unmarked',
    type: 'duration',
    default: '14d',
    group: 'feed',
    label: 'settings.key.feed.retention.unmarked',
    hint: 'settings.hint.feed.retention.unmarked',
    ui: true,
    since: '0.11.0',
  }),
  Object.freeze({
    key: 'feed.retention.noise',
    type: 'duration',
    default: '7d',
    group: 'feed',
    label: 'settings.key.feed.retention.noise',
    hint: 'settings.hint.feed.retention.noise',
    ui: true,
    since: '0.11.0',
  }),
  Object.freeze({
    key: 'feed.retention.unimportant',
    type: 'duration',
    default: '30d',
    group: 'feed',
    label: 'settings.key.feed.retention.unimportant',
    hint: 'settings.hint.feed.retention.unimportant',
    ui: true,
    since: '0.11.0',
  }),
  Object.freeze({
    key: 'feed.retention.important',
    type: 'duration',
    default: '180d',
    group: 'feed',
    label: 'settings.key.feed.retention.important',
    hint: 'settings.hint.feed.retention.important',
    ui: true,
    since: '0.11.0',
  }),
  Object.freeze({
    key: 'feed.retention.keepLinked',
    type: 'bool',
    default: true,
    group: 'feed',
    label: 'settings.key.feed.retention.keepLinked',
    hint: 'settings.hint.feed.retention.keepLinked',
    ui: true,
    since: '0.11.0',
  }),
  Object.freeze({
    key: 'feed.sourceSilentAfter',
    type: 'duration',
    default: '24h',
    group: 'feed',
    label: 'settings.key.feed.sourceSilentAfter',
    hint: 'settings.hint.feed.sourceSilentAfter',
    ui: true,
    since: '0.11.0',
  }),
  ...notifySettings(),
]);

function notifySettings() {
  const entry = (key, type, def, extra = {}) => Object.freeze({
    key, type, default: def, group: 'notify', label: `settings.key.${key}`, hint: `settings.hint.${key}`, ui: true, since: '0.12.0', ...extra,
  });
  const sound = (level, def) => entry(`feed.notify.sound.${level}`, 'enum', def, { constraints: Object.freeze({ values: SOUND_IDS }), widget: 'sound' });
  return [
    entry('feed.notify.enabled', 'bool', false),
    entry('feed.notify.minLevel', 'enum', 'normal', { constraints: Object.freeze({ values: Object.freeze(['normal', 'important', 'fire']) }), widget: 'select', valueLabel: 'settings.level.' }),
    sound('fire', 'board:alarm'),
    sound('important', 'board:chime'),
    sound('normal', 'board:pop'),
    entry('feed.notify.volume', 'int', 10, { constraints: Object.freeze({ min: 0, max: 100 }), widget: 'range' }),
    entry('feed.notify.banner', 'bool', true),
    entry('feed.notify.quietHours', 'string', '', { constraints: Object.freeze({ pattern: '^$|^([01]\\d|2[0-3]):[0-5]\\d-([01]\\d|2[0-3]):[0-5]\\d$' }), widget: 'quiet' }),
  ];
}

export const LEGACY_SETTING_KEYS = Object.freeze({
  epicSectionOrder: 'epic.sectionOrder',
  epicPageSizes: 'epic.pageSizes',
  mapHeight: 'epic.mapHeight',
  pinnedEpics: 'epic.pinned',
});

export const SETTINGS_BY_KEY = Object.freeze(Object.fromEntries(SETTINGS_REGISTRY.map((entry) => [entry.key, entry])));

export function registryPublic() {
  return SETTINGS_REGISTRY.map(({ key, type, default: value, constraints, group, label, hint, ui, since, widget, valueLabel, placeholder }) => ({
    key, type, default: cloneValue(value), constraints: constraints ? structuredClone(constraints) : undefined, group, label, hint, ui, since, widget, valueLabel, placeholder,
  }));
}

export function cloneValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneValue(v)]));
  return value;
}

export function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function parseDuration(value) {
  if (value === 0 || value === '0') return 0;
  if (typeof value !== 'string' || !/^\d+[mhd]$/.test(value)) return null;
  return value;
}

/** Milliseconds for a duration setting, or null when forever (`0`). */
export function durationMs(value) {
  const parsed = parseDuration(value);
  if (parsed === null) return null;
  if (parsed === 0) return null;
  const amount = Number(parsed.slice(0, -1));
  const unit = parsed.slice(-1);
  const mult = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return amount * mult;
}
