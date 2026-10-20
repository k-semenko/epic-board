import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';
import { DICT } from '../server/page/i18n.mjs';
import { SETTINGS_REGISTRY } from '../server/settings-registry.mjs';

const home = tmpHome();
const file = join(home, 'settings.json');
const { readSettings, readSettingsState, writeSettings } = await import('../server/settings.mjs');

const defaults = {
  'epic.sectionOrder': ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history'],
  'epic.pageSizes': { waiting: 5, decisions: 5, history: 5 },
  'epic.mapHeight': null,
  'epic.pinned': [],
  'feed.retention.unmarked': '14d',
  'feed.retention.noise': '7d',
  'feed.retention.unimportant': '30d',
  'feed.retention.important': '180d',
  'feed.retention.keepLinked': true,
  'feed.sourceSilentAfter': '24h',
  'feed.notify.enabled': true,
  'feed.notify.minLevel': 'normal',
  'feed.notify.sound.fire': 'board:alarm',
  'feed.notify.sound.important': 'board:chime',
  'feed.notify.sound.normal': 'board:pop',
  'feed.notify.volume': 70,
  'feed.notify.banner': true,
  'feed.notify.quietHours': '',
};
const mapFirst = ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'];

test.beforeEach(() => rmSync(file, { force: true }));

test('registry label and hint keys exist in both dictionaries', () => {
  for (const entry of SETTINGS_REGISTRY) {
    for (const key of [entry.label, entry.hint]) {
      assert.ok(DICT.en[key], `missing en ${key}`);
      assert.ok(DICT.ru[key], `missing ru ${key}`);
    }
  }
});

test('missing settings use defaults without writing a file', () => {
  assert.deepEqual(readSettings(), defaults);
  assert.deepEqual(readSettingsState(), { rev: 0, values: defaults });
  assert.equal(existsSync(file), false);
});

test('saved values persist with schema 2 and only non-default keys', () => {
  const saved = writeSettings({ 'epic.sectionOrder': mapFirst });
  assert.equal(saved.rev, 1);
  assert.deepEqual(saved.values['epic.sectionOrder'], mapFirst);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    schema: 2,
    rev: 1,
    'epic.sectionOrder': mapFirst,
  });
  assert.deepEqual(readSettings()['epic.sectionOrder'], mapFirst);
});

test('page size patches merge into the current record', () => {
  assert.deepEqual(writeSettings({ 'epic.pageSizes': { waiting: 10, decisions: 15 } }).values['epic.pageSizes'], {
    waiting: 10, decisions: 15, history: 5,
  });
  assert.deepEqual(writeSettings({ 'epic.pageSizes': { waiting: 15 } }).values['epic.pageSizes'], {
    waiting: 15, decisions: 15, history: 5,
  });
});

test('null resets a key to its default', () => {
  writeSettings({ 'epic.mapHeight': 'l' });
  assert.equal(writeSettings({ 'epic.mapHeight': null }).values['epic.mapHeight'], null);
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(file, 'utf8')), 'epic.mapHeight'), false);
});

test('rev mismatch returns 409 and keeps the file', () => {
  writeSettings({ 'epic.mapHeight': 's' });
  const before = readFileSync(file, 'utf8');
  assert.throws(() => writeSettings({ 'epic.mapHeight': 'l' }, { rev: 0 }), { status: 409, code: 'settings-conflict' });
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.deepEqual(writeSettings({ 'epic.mapHeight': 'l' }, { rev: 1 }).values['epic.mapHeight'], 'l');
});

test('schema 1 keys migrate on read and rewrite on save', () => {
  writeFileSync(file, JSON.stringify({
    epicSectionOrder: mapFirst,
    epicPageSizes: { waiting: 10 },
    mapHeight: 'l',
    pinnedEpics: ['42'],
  }));
  assert.deepEqual(readSettings(), {
    ...defaults,
    'epic.sectionOrder': mapFirst,
    'epic.pageSizes': { waiting: 10, decisions: 5, history: 5 },
    'epic.mapHeight': 'l',
    'epic.pinned': ['42'],
  });
  writeSettings({ 'epic.mapHeight': 's' });
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(stored.schema, 2);
  assert.deepEqual(stored['epic.sectionOrder'], mapFirst);
  assert.equal(stored['epic.mapHeight'], 's');
  assert.equal(Object.hasOwn(stored, 'epicSectionOrder'), false);
});

test('pinned epics accept unique valid ids', () => {
  const pinned = ['42', 'PROJ-12', 'gh.341', 'A'.repeat(64)];
  assert.deepEqual(writeSettings({ 'epic.pinned': pinned }).values['epic.pinned'], pinned);
  assert.deepEqual(writeSettings({ 'epic.pinned': [] }).values['epic.pinned'], []);
});

test('invalid saves preserve existing settings', () => {
  writeSettings({ 'epic.sectionOrder': mapFirst });
  const before = readFileSync(file, 'utf8');
  const invalid = [
    null, [], 'settings', {},
    { 'epic.sectionOrder': 'map' },
    { 'epic.sectionOrder': [] },
    { 'epic.sectionOrder': ['map', 'waiting'] },
    { 'epic.pageSizes': {} },
    { 'epic.pageSizes': { waiting: 20 } },
    { 'epic.mapHeight': 'xl' },
    { 'epic.pinned': ['../bad'] },
    { 'epic.pinned': ['5', '5'] },
    { host: 'other.test' },
  ];
  for (const body of invalid) {
    assert.throws(() => writeSettings(body), { status: 400 }, JSON.stringify(body));
    assert.equal(readFileSync(file, 'utf8'), before);
  }
});

test('malformed stored JSON returns an error and cannot be overwritten', () => {
  writeFileSync(file, '{broken');
  assert.throws(() => readSettings(), { status: 500, code: 'broken-settings' });
  assert.throws(() => writeSettings({ 'epic.mapHeight': 'l' }), { status: 500, code: 'broken-settings' });
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});

test('saving settings creates a missing data directory', (t) => {
  const nestedHome = join(home, 'new-data');
  process.env.EPIC_BOARD_HOME = nestedHome;
  t.after(() => { process.env.EPIC_BOARD_HOME = home; });
  writeSettings({ 'epic.sectionOrder': ['branches', 'waiting', 'map', 'sessions', 'decisions', 'history'] });
  assert.ok(existsSync(join(nestedHome, 'settings.json')));
});

test('quiet hours accept a time window or nothing, and reject anything else', () => {
  assert.equal(writeSettings({ 'feed.notify.quietHours': '22:00-08:00' }).values['feed.notify.quietHours'], '22:00-08:00');
  assert.equal(writeSettings({ 'feed.notify.quietHours': '' }).values['feed.notify.quietHours'], '');
  assert.throws(() => writeSettings({ 'feed.notify.quietHours': 'night' }), { status: 400 });
  assert.throws(() => writeSettings({ 'feed.notify.sound.fire': 'board:nope' }), { status: 400 });
});
