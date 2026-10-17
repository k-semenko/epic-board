import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';

const home = tmpHome();
const file = join(home, 'settings.json');
const { readSettings, writeSettings } = await import('../server/settings.mjs');

test.beforeEach(() => rmSync(file, { force: true }));

test('missing settings use default section order and page sizes without writing a file', () => {
  assert.deepEqual(readSettings(), {
    epicSectionOrder: ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history'],
    epicPageSizes: { waiting: 5, decisions: 5, history: 5 },
    mapHeight: null,
  });
  assert.equal(existsSync(file), false);
});

test('saved order survives subsequent reads and the latest save replaces it', () => {
  const first = { epicSectionOrder: ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'] };
  const latest = { epicSectionOrder: ['history', 'decisions', 'sessions', 'branches', 'map', 'waiting'] };
  const firstSaved = { ...first, epicPageSizes: { waiting: 5, decisions: 5, history: 5 }, mapHeight: null };
  const latestSaved = { ...latest, epicPageSizes: { waiting: 5, decisions: 5, history: 5 }, mapHeight: null };
  assert.deepEqual(writeSettings(first), firstSaved);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), firstSaved);
  assert.deepEqual(readSettings(), firstSaved);
  assert.deepEqual(writeSettings(latest), latestSaved);
  assert.deepEqual(readSettings(), latestSaved);
});

test('saving only page sizes creates default section order and persists globally', () => {
  const settings = {
    epicSectionOrder: ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history'],
    epicPageSizes: { waiting: 10, decisions: 15, history: 5 },
    mapHeight: null,
  };
  assert.deepEqual(writeSettings({ epicPageSizes: { waiting: 10, decisions: 15 } }), settings);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), settings);
  assert.deepEqual(readSettings(), settings);
});

test('partial settings updates preserve unmentioned fields and page sizes', () => {
  const first = {
    epicSectionOrder: ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'],
    epicPageSizes: { waiting: 10, decisions: 15, history: 10 },
  };
  const stored = { ...first, mapHeight: null };
  assert.deepEqual(writeSettings(first), stored);
  const resized = { ...stored, epicPageSizes: { waiting: 15, decisions: 15, history: 10 } };
  assert.deepEqual(writeSettings({ epicPageSizes: { waiting: 15 } }), resized);
  assert.deepEqual(readSettings(), resized);
  const reordered = { ...resized, epicSectionOrder: ['history', 'decisions', 'sessions', 'branches', 'map', 'waiting'] };
  assert.deepEqual(writeSettings({ epicSectionOrder: reordered.epicSectionOrder }), reordered);
  assert.deepEqual(readSettings(), reordered);
  const latest = { ...reordered, epicPageSizes: { waiting: 15, decisions: 5, history: 15 } };
  assert.deepEqual(writeSettings({ epicPageSizes: { decisions: 5, history: 15 } }), latest);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), latest);
  assert.deepEqual(readSettings(), latest);
});

test('saving settings creates a missing data directory', (t) => {
  const nestedHome = join(home, 'new-data');
  process.env.EPIC_BOARD_HOME = nestedHome;
  t.after(() => { process.env.EPIC_BOARD_HOME = home; });
  const settings = { epicSectionOrder: ['branches', 'waiting', 'map', 'sessions', 'decisions', 'history'] };
  const saved = { ...settings, epicPageSizes: { waiting: 5, decisions: 5, history: 5 }, mapHeight: null };
  assert.deepEqual(writeSettings(settings), saved);
  assert.deepEqual(JSON.parse(readFileSync(join(nestedHome, 'settings.json'), 'utf8')), saved);
});

test('older partial orders retain known positions and append missing sections', () => {
  writeFileSync(file, JSON.stringify({ epicSectionOrder: ['history', 'map', 'history', 'removed'] }));
  assert.deepEqual(readSettings(), {
    epicSectionOrder: ['history', 'map', 'waiting', 'branches', 'sessions', 'decisions'],
    epicPageSizes: { waiting: 5, decisions: 5, history: 5 },
    mapHeight: null,
  });
  writeFileSync(file, '{}');
  assert.deepEqual(readSettings(), {
    epicSectionOrder: ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history'],
    epicPageSizes: { waiting: 5, decisions: 5, history: 5 },
    mapHeight: null,
  });
});

test('stored page sizes retain valid blocks and default missing or malformed values', () => {
  for (const epicPageSizes of [null, [], '10', 10]) {
    writeFileSync(file, JSON.stringify({ epicPageSizes }));
    assert.deepEqual(readSettings().epicPageSizes, { waiting: 5, decisions: 5, history: 5 });
  }
  writeFileSync(file, JSON.stringify({ epicPageSizes: { waiting: 10, history: 15, removed: 10 } }));
  assert.deepEqual(readSettings().epicPageSizes, { waiting: 10, decisions: 5, history: 15 });
  writeFileSync(file, JSON.stringify({ epicPageSizes: { waiting: '10', decisions: 15, history: 20 } }));
  assert.deepEqual(readSettings().epicPageSizes, { waiting: 5, decisions: 15, history: 5 });
});

test('invalid saves preserve existing settings', () => {
  const valid = { epicSectionOrder: ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'] };
  writeSettings(valid);
  const before = readFileSync(file, 'utf8');
  const invalid = [
    null,
    [],
    'settings',
    {},
    { epicSectionOrder: null },
    { epicSectionOrder: 'map' },
    { epicSectionOrder: [] },
    { epicSectionOrder: ['map', 'waiting', 'branches', 'sessions', 'decisions'] },
    { epicSectionOrder: ['map', 'map', 'branches', 'sessions', 'decisions', 'history'] },
    { epicSectionOrder: ['unknown', 'waiting', 'branches', 'sessions', 'decisions', 'history'] },
    { epicSectionOrder: [42, 'waiting', 'branches', 'sessions', 'decisions', 'history'] },
    { epicSectionOrder: [, 'waiting', 'branches', 'sessions', 'decisions', 'history'] },
    { epicSectionOrder: undefined },
    { epicPageSizes: undefined },
    { epicPageSizes: null },
    { epicPageSizes: [] },
    { epicPageSizes: '10' },
    { epicPageSizes: {} },
    { epicPageSizes: { map: 10 } },
    { epicPageSizes: { waiting: 10, removed: 5 } },
    { epicSectionOrder: [], epicPageSizes: { waiting: 10 } },
    { ...valid, host: 'other.test' },
    { mapHeight: null },
    { mapHeight: 'xl' },
    { mapHeight: 400 },
  ];
  for (const block of ['waiting', 'decisions', 'history']) {
    for (const size of [undefined, null, 0, 1, 6, 20, -5, 10.5, '5', true, [], {}, NaN, Infinity]) {
      invalid.push({ epicPageSizes: { [block]: size } });
    }
  }
  for (const body of invalid) {
    assert.throws(() => writeSettings(body), { status: 400 }, JSON.stringify(body));
    assert.equal(readFileSync(file, 'utf8'), before);
  }
});

test('invalid saves do not create storage', (t) => {
  const absentHome = join(home, 'invalid-data');
  process.env.EPIC_BOARD_HOME = absentHome;
  t.after(() => { process.env.EPIC_BOARD_HOME = home; });
  assert.throws(() => writeSettings({ epicSectionOrder: [] }), { status: 400 });
  assert.throws(() => writeSettings({ epicPageSizes: { waiting: 20 } }), { status: 400 });
  assert.equal(existsSync(absentHome), false);
});

test('malformed stored JSON returns an error and cannot be overwritten by saving', () => {
  writeFileSync(file, '{broken');
  assert.throws(() => readSettings(), { status: 500, code: 'broken-settings' });
  assert.throws(() => writeSettings({ epicSectionOrder: ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'] }), { status: 500, code: 'broken-settings' });
  assert.throws(() => writeSettings({ epicPageSizes: { waiting: 10 } }), { status: 500, code: 'broken-settings' });
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});

test('map height is saved globally and a bad value falls back', () => {
  writeFileSync(file, JSON.stringify({ mapHeight: 'tall' }));
  assert.equal(readSettings().mapHeight, null);
  const saved = writeSettings({ mapHeight: 'l' });
  assert.equal(saved.mapHeight, 'l');
  assert.equal(readSettings().mapHeight, 'l');
  assert.equal(writeSettings({ mapHeight: 's' }).mapHeight, 's');
  assert.equal(readSettings().epicPageSizes.waiting, 5);
});

test('stored settings must be an object', () => {
  for (const value of [null, [], 'text']) {
    writeFileSync(file, JSON.stringify(value));
    assert.throws(() => readSettings(), { status: 500, code: 'broken-settings' });
  }
});
