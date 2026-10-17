import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';

const home = tmpHome();
const store = await import('../server/store.mjs');

test('create, read, list, history', () => {
  const epic = store.createEpic({ id: 'E-1', title: 'Meta', goal: 'Отбор' }, { by: 'cli' });
  assert.equal(epic.schema, 3);
  assert.deepEqual(epic.tasks, []);
  assert.equal(store.readEpic('E-1').title, 'Meta');
  assert.equal(store.listEpics().length, 1);
  const [event] = store.readHistory('E-1');
  assert.equal(event.op, 'add');
  assert.equal(event.path, 'epic');
  assert.equal(event.by, 'cli');
});

test('duplicate id is 409', () => {
  assert.throws(() => store.createEpic({ id: 'E-1', title: 'x' }), { status: 409 });
});

test('bad ids are rejected', () => {
  for (const id of ['../x', '', '.hidden', '1/2']) assert.throws(() => store.checkId(id), { status: 400 });
});

test('missing epic is 404', () => {
  assert.throws(() => store.readEpic('1'), { status: 404 });
});

test('broken json: read is 500, list skips it', () => {
  writeFileSync(join(home, 'epics', '999.json'), '{oops');
  assert.throws(() => store.readEpic('999'), { status: 500, code: 'broken-epic' });
  assert.deepEqual(store.listEpics().map((e) => e.id), ['E-1']);
});

test('atomic write leaves no tmp files', () => {
  store.writeAtomic(join(home, 'epics', 'x.txt'), 'hello');
  assert.equal(readdirSync(join(home, 'epics')).filter((n) => n.endsWith('.tmp')).length, 0);
});

test('a broken history line is skipped, not fatal', () => {
  store.appendHistory('E-1', [{ at: 'ok1', by: 'cli', op: 'set', path: 'x' }]);
  writeFileSync(join(home, 'epics', 'E-1.history.ndjson'), '{broken\n', { flag: 'a' });
  assert.equal(store.readHistory('E-1', { limit: 2 })[0].at, 'ok1');
});

test('history is newest first and limited', () => {
  store.appendHistory('E-1', [1, 2, 3].map((n) => ({ at: `t${n}`, by: 'cli', op: 'set', path: `p${n}` })));
  const events = store.readHistory('E-1', { limit: 2 });
  assert.deepEqual(events.map((e) => e.path), ['p3', 'p2']);
});
