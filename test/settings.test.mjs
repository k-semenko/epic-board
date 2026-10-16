import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';

const home = tmpHome();
const file = join(home, 'settings.json');
const { readSettings, writeSettings } = await import('../server/settings.mjs');

test.beforeEach(() => rmSync(file, { force: true }));

test('missing settings use the default section order without writing a file', () => {
  assert.deepEqual(readSettings(), { epicSectionOrder: ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history'] });
  assert.equal(existsSync(file), false);
});

test('saved order survives subsequent reads and the latest save replaces it', () => {
  const first = { epicSectionOrder: ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'] };
  const latest = { epicSectionOrder: ['history', 'decisions', 'sessions', 'branches', 'map', 'waiting'] };
  assert.deepEqual(writeSettings(first), first);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), first);
  assert.deepEqual(readSettings(), first);
  assert.deepEqual(writeSettings(latest), latest);
  assert.deepEqual(readSettings(), latest);
});

test('saving settings creates a missing data directory', (t) => {
  const nestedHome = join(home, 'new-data');
  process.env.EPIC_BOARD_HOME = nestedHome;
  t.after(() => { process.env.EPIC_BOARD_HOME = home; });
  const settings = { epicSectionOrder: ['branches', 'waiting', 'map', 'sessions', 'decisions', 'history'] };
  assert.deepEqual(writeSettings(settings), settings);
  assert.deepEqual(JSON.parse(readFileSync(join(nestedHome, 'settings.json'), 'utf8')), settings);
});

test('older partial orders retain known positions and append missing sections', () => {
  writeFileSync(file, JSON.stringify({ epicSectionOrder: ['history', 'map', 'history', 'removed'] }));
  assert.deepEqual(readSettings(), { epicSectionOrder: ['history', 'map', 'waiting', 'branches', 'sessions', 'decisions'] });
  writeFileSync(file, '{}');
  assert.deepEqual(readSettings(), { epicSectionOrder: ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history'] });
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
    { ...valid, host: 'other.test' },
  ];
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
  assert.equal(existsSync(absentHome), false);
});

test('malformed stored JSON returns an error and cannot be overwritten by saving', () => {
  writeFileSync(file, '{broken');
  assert.throws(() => readSettings(), { status: 500, code: 'broken-settings' });
  assert.throws(() => writeSettings({ epicSectionOrder: ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'] }), { status: 500, code: 'broken-settings' });
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});

test('stored settings must be an object', () => {
  for (const value of [null, [], 'text']) {
    writeFileSync(file, JSON.stringify(value));
    assert.throws(() => readSettings(), { status: 500, code: 'broken-settings' });
  }
});
