import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.mjs';
import { BoardError } from './errors.mjs';
import { ID, writeAtomic } from './store.mjs';
import { DEFAULT_SECTION_ORDER, normalizeSectionOrder } from './page/section-order.mjs';

const settingsPath = () => join(dataDir(), 'settings.json');
const DEFAULT_PAGE_SIZES = Object.freeze({ waiting: 5, decisions: 5, history: 5 });
const PAGE_SIZES = [5, 10, 15];
const MAP_HEIGHTS = ['s', 'm', 'l'];
const SETTING_KEYS = ['epicSectionOrder', 'epicPageSizes', 'mapHeight', 'pinnedEpics'];

function normalizePageSizes(value) {
  const sizes = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_PAGE_SIZES).map(([id, fallback]) => [id, PAGE_SIZES.includes(sizes[id]) ? sizes[id] : fallback]));
}

function normalizeMapHeight(value) {
  return MAP_HEIGHTS.includes(value) ? value : null;
}

function normalizePinnedEpics(value) {
  return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && ID.test(id)))] : [];
}

export function readSettings() {
  const file = settingsPath();
  try {
    const settings = JSON.parse(readFileSync(file, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('settings must be an object');
    return {
      epicSectionOrder: normalizeSectionOrder(settings.epicSectionOrder),
      epicPageSizes: normalizePageSizes(settings.epicPageSizes),
      mapHeight: normalizeMapHeight(settings.mapHeight),
      pinnedEpics: normalizePinnedEpics(settings.pinnedEpics),
    };
  } catch (e) {
    if (e.code === 'ENOENT') return { epicSectionOrder: [...DEFAULT_SECTION_ORDER], epicPageSizes: { ...DEFAULT_PAGE_SIZES }, mapHeight: null, pinnedEpics: [] };
    throw new BoardError(500, 'broken-settings', `cannot read settings file ${file} (${e.message})`);
  }
}

export function writeSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some((key) => !SETTING_KEYS.includes(key))) {
    throw new BoardError(400, 'bad-settings', 'settings must contain only epicSectionOrder, epicPageSizes, mapHeight, or pinnedEpics updates');
  }
  const order = body.epicSectionOrder;
  if (Object.hasOwn(body, 'epicSectionOrder') && (!Array.isArray(order) || order.length !== DEFAULT_SECTION_ORDER.length || DEFAULT_SECTION_ORDER.some((id) => !order.includes(id)))) {
    throw new BoardError(400, 'bad-settings', 'epicSectionOrder must contain every section exactly once');
  }
  const sizes = body.epicPageSizes;
  if (Object.hasOwn(body, 'epicPageSizes') && (!sizes || typeof sizes !== 'object' || Array.isArray(sizes) || !Object.keys(sizes).length || Object.keys(sizes).some((id) => !Object.hasOwn(DEFAULT_PAGE_SIZES, id) || !PAGE_SIZES.includes(sizes[id])))) {
    throw new BoardError(400, 'bad-settings', 'epicPageSizes must update waiting, decisions, or history with 5, 10, or 15');
  }
  if (Object.hasOwn(body, 'mapHeight') && !MAP_HEIGHTS.includes(body.mapHeight)) {
    throw new BoardError(400, 'bad-settings', 'mapHeight must be s, m, or l');
  }
  const pins = body.pinnedEpics;
  if (Object.hasOwn(body, 'pinnedEpics') && (!Array.isArray(pins) || normalizePinnedEpics(pins).length !== pins.length)) {
    throw new BoardError(400, 'bad-settings', 'pinnedEpics must contain unique valid epic IDs');
  }
  const settings = readSettings();
  if (Object.hasOwn(body, 'epicSectionOrder')) settings.epicSectionOrder = [...order];
  if (Object.hasOwn(body, 'epicPageSizes')) settings.epicPageSizes = { ...settings.epicPageSizes, ...sizes };
  if (Object.hasOwn(body, 'mapHeight')) settings.mapHeight = body.mapHeight;
  if (Object.hasOwn(body, 'pinnedEpics')) settings.pinnedEpics = [...pins];
  mkdirSync(dataDir(), { recursive: true });
  writeAtomic(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}
