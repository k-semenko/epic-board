import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.mjs';
import { BoardError } from './errors.mjs';
import { ID, withFileLock, writeAtomic } from './store.mjs';
import { normalizeSectionOrder } from './page/section-order.mjs';
import {
  SETTINGS_SCHEMA,
  SETTINGS_REGISTRY,
  SETTINGS_BY_KEY,
  LEGACY_SETTING_KEYS,
  PAGE_SIZE_BLOCKS,
  PAGE_SIZES,
  MAP_HEIGHTS,
  DEFAULT_PAGE_SIZES,
  cloneValue,
  sameValue,
  parseDuration,
  registryPublic,
} from './settings-registry.mjs';

export { SETTINGS_REGISTRY, SETTINGS_BY_KEY, registryPublic, LEGACY_SETTING_KEYS };

const settingsPath = () => join(dataDir(), 'settings.json');

function defaults() {
  return Object.fromEntries(SETTINGS_REGISTRY.map((entry) => [entry.key, cloneValue(entry.default)]));
}

function normalizeStored(key, value) {
  const entry = SETTINGS_BY_KEY[key];
  if (!entry) return undefined;
  if (entry.type === 'order') return normalizeSectionOrder(value);
  if (entry.type === 'record' && key === 'epic.pageSizes') {
    const sizes = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(PAGE_SIZE_BLOCKS.map((id) => [id, PAGE_SIZES.includes(sizes[id]) ? sizes[id] : DEFAULT_PAGE_SIZES[id]]));
  }
  if (entry.type === 'enum' && key === 'epic.mapHeight') return MAP_HEIGHTS.includes(value) ? value : null;
  if (entry.type === 'list' && key === 'epic.pinned') {
    return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && ID.test(id)))] : [];
  }
  if (entry.type === 'bool') return typeof value === 'boolean' ? value : entry.default;
  if (entry.type === 'int') {
    return Number.isInteger(value) && value >= (entry.constraints?.min ?? -Infinity) && value <= (entry.constraints?.max ?? Infinity)
      ? value
      : entry.default;
  }
  if (entry.type === 'duration') {
    const parsed = parseDuration(value);
    return parsed === null ? entry.default : parsed;
  }
  if (entry.type === 'string') return typeof value === 'string' ? value : entry.default;
  if (entry.type === 'enum') return entry.constraints?.values?.includes(value) ? value : entry.default;
  return cloneValue(entry.default);
}

function migrateRaw(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('settings must be an object');
  const schema = raw.schema ?? 1;
  const rev = Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0;
  const stored = {};
  if (schema < SETTINGS_SCHEMA) {
    for (const [legacy, key] of Object.entries(LEGACY_SETTING_KEYS)) {
      if (Object.hasOwn(raw, legacy)) stored[key] = raw[legacy];
    }
  } else {
    for (const entry of SETTINGS_REGISTRY) {
      if (Object.hasOwn(raw, entry.key)) stored[entry.key] = raw[entry.key];
    }
  }
  return { schema, rev, stored };
}

function readFileState() {
  const file = settingsPath();
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return migrateRaw(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return { schema: SETTINGS_SCHEMA, rev: 0, stored: {} };
    throw new BoardError(500, 'broken-settings', `cannot read settings file ${file} (${e.message})`);
  }
}

function resolveValues(stored) {
  const values = defaults();
  for (const entry of SETTINGS_REGISTRY) {
    if (Object.hasOwn(stored, entry.key)) values[entry.key] = normalizeStored(entry.key, stored[entry.key]);
  }
  return values;
}

function persist(rev, values) {
  const body = { schema: SETTINGS_SCHEMA, rev };
  for (const entry of SETTINGS_REGISTRY) {
    if (!sameValue(values[entry.key], entry.default)) body[entry.key] = cloneValue(values[entry.key]);
  }
  mkdirSync(dataDir(), { recursive: true });
  writeAtomic(settingsPath(), `${JSON.stringify(body, null, 2)}\n`);
}

export function readSettingsState() {
  const { rev, stored } = readFileState();
  return { rev, values: resolveValues(stored) };
}

/** Resolved settings values for every registry key. */
export function readSettings() {
  return readSettingsState().values;
}

export function epicSettingsSnapshot() {
  const values = readSettings();
  return Object.fromEntries(SETTINGS_REGISTRY.filter((entry) => entry.group === 'epic').map((entry) => [entry.key, cloneValue(values[entry.key])]));
}

export function translateLegacyPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BoardError(400, 'bad-settings', 'settings patch must be an object');
  }
  const unknown = Object.keys(body).filter((key) => !Object.hasOwn(LEGACY_SETTING_KEYS, key));
  if (unknown.length) {
    throw new BoardError(400, 'bad-settings', `unknown settings keys: ${unknown.join(', ')}; allowed: ${Object.keys(LEGACY_SETTING_KEYS).join(', ')}`);
  }
  if (!Object.keys(body).length) throw new BoardError(400, 'bad-settings', 'settings patch must not be empty');
  return Object.fromEntries(Object.entries(body).map(([legacy, value]) => [LEGACY_SETTING_KEYS[legacy], value]));
}

function validateWrite(entry, value, current) {
  if (value === null) return cloneValue(entry.default);
  if (entry.type === 'order') {
    const items = entry.constraints?.items || [];
    if (!Array.isArray(value) || value.length !== items.length || items.some((id) => !value.includes(id))) {
      throw new BoardError(400, 'bad-settings', `${entry.key} must contain every item exactly once`);
    }
    return [...value];
  }
  if (entry.type === 'record') {
    const fields = entry.constraints?.fields || {};
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
      throw new BoardError(400, 'bad-settings', `${entry.key} must be a non-empty object`);
    }
    const unknown = Object.keys(value).filter((id) => !Object.hasOwn(fields, id));
    if (unknown.length) throw new BoardError(400, 'bad-settings', `${entry.key} has unknown fields: ${unknown.join(', ')}`);
    const merged = { ...current, ...value };
    for (const [id, field] of Object.entries(fields)) {
      if (!field.values.includes(merged[id])) {
        throw new BoardError(400, 'bad-settings', `${entry.key}.${id} must be one of ${field.values.join(', ')}`);
      }
    }
    return merged;
  }
  if (entry.type === 'enum') {
    if (!entry.constraints?.values?.includes(value)) {
      throw new BoardError(400, 'bad-settings', `${entry.key} must be one of ${entry.constraints.values.join(', ')}`);
    }
    return value;
  }
  if (entry.type === 'list') {
    if (!Array.isArray(value)) throw new BoardError(400, 'bad-settings', `${entry.key} must be an array`);
    const pattern = entry.constraints?.itemPattern ? new RegExp(entry.constraints.itemPattern) : null;
    const normalized = [...new Set(value.filter((item) => typeof item === 'string' && (!pattern || pattern.test(item))))];
    if (normalized.length !== value.length) throw new BoardError(400, 'bad-settings', `${entry.key} must contain unique valid items`);
    return normalized;
  }
  if (entry.type === 'bool') {
    if (typeof value !== 'boolean') throw new BoardError(400, 'bad-settings', `${entry.key} must be a boolean`);
    return value;
  }
  if (entry.type === 'int') {
    if (!Number.isInteger(value)) throw new BoardError(400, 'bad-settings', `${entry.key} must be an integer`);
    if (value < (entry.constraints?.min ?? -Infinity) || value > (entry.constraints?.max ?? Infinity)) {
      throw new BoardError(400, 'bad-settings', `${entry.key} is out of range`);
    }
    return value;
  }
  if (entry.type === 'duration') {
    const parsed = parseDuration(value);
    if (parsed === null) throw new BoardError(400, 'bad-settings', `${entry.key} must be 0 or <n>m|h|d`);
    return parsed;
  }
  if (entry.type === 'string') {
    if (typeof value !== 'string') throw new BoardError(400, 'bad-settings', `${entry.key} must be a string`);
    return value;
  }
  throw new BoardError(400, 'bad-settings', `unsupported settings type ${entry.type}`);
}

export function writeSettings(patch, { rev } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) {
    throw new BoardError(400, 'bad-settings', 'settings patch must be a non-empty object');
  }
  const unknown = Object.keys(patch).filter((key) => !SETTINGS_BY_KEY[key]);
  if (unknown.length) {
    throw new BoardError(400, 'bad-settings', `unknown settings keys: ${unknown.join(', ')}; allowed: ${SETTINGS_REGISTRY.map((e) => e.key).join(', ')}`);
  }

  return withFileLock(settingsPath(), () => {
    const state = readSettingsState();
    if (rev !== undefined && rev !== state.rev) {
      throw new BoardError(409, 'settings-conflict', `settings rev is ${state.rev}, got ${rev}`);
    }
    const values = cloneValue(state.values);
    for (const [key, value] of Object.entries(patch)) {
      values[key] = validateWrite(SETTINGS_BY_KEY[key], value, values[key]);
    }
    const nextRev = state.rev + 1;
    persist(nextRev, values);
    return { rev: nextRev, values };
  });
}

export function parseConfigValue(entry, text) {
  if (text === 'null') return null;
  if (entry.type === 'bool') {
    if (text === 'true') return true;
    if (text === 'false') return false;
    throw new BoardError(400, 'bad-settings', `${entry.key} expects true or false`);
  }
  if (entry.type === 'int') {
    if (!/^-?\d+$/.test(text)) throw new BoardError(400, 'bad-settings', `${entry.key} expects an integer`);
    return Number(text);
  }
  if (entry.type === 'duration') {
    const parsed = parseDuration(text);
    if (parsed === null) throw new BoardError(400, 'bad-settings', `${entry.key} expects 0 or <n>m|h|d`);
    return parsed;
  }
  if (entry.type === 'enum' || entry.type === 'string') return text;
  if (entry.type === 'order' || entry.type === 'list' || entry.type === 'record') {
    try {
      return JSON.parse(text);
    } catch {
      throw new BoardError(400, 'bad-settings', `${entry.key} expects JSON`);
    }
  }
  throw new BoardError(400, 'bad-settings', `unsupported settings type ${entry.type}`);
}
