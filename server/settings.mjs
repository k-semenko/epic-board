import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.mjs';
import { BoardError } from './errors.mjs';
import { writeAtomic } from './store.mjs';
import { DEFAULT_SECTION_ORDER, normalizeSectionOrder } from './page/section-order.mjs';

const settingsPath = () => join(dataDir(), 'settings.json');

export function readSettings() {
  const file = settingsPath();
  try {
    const settings = JSON.parse(readFileSync(file, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('settings must be an object');
    return { epicSectionOrder: normalizeSectionOrder(settings.epicSectionOrder) };
  } catch (e) {
    if (e.code === 'ENOENT') return { epicSectionOrder: [...DEFAULT_SECTION_ORDER] };
    throw new BoardError(500, 'broken-settings', `cannot read settings file ${file} (${e.message})`);
  }
}

export function writeSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'epicSectionOrder')) {
    throw new BoardError(400, 'bad-settings', 'settings must be an object containing only epicSectionOrder');
  }
  const order = body.epicSectionOrder;
  if (!Array.isArray(order) || order.length !== DEFAULT_SECTION_ORDER.length || DEFAULT_SECTION_ORDER.some((id) => !order.includes(id))) {
    throw new BoardError(400, 'bad-settings', 'epicSectionOrder must contain every section exactly once');
  }
  readSettings();
  const settings = { epicSectionOrder: [...order] };
  mkdirSync(dataDir(), { recursive: true });
  writeAtomic(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}
