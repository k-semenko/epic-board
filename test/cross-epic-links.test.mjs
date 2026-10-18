import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpHome } from './helpers.mjs';
import * as store from '../server/store.mjs';

let home;
test.beforeEach(() => {
  home = tmpHome();
  process.env.XDG_CONFIG_HOME = path.join(home, 'config');
  process.env.EPIC_BOARD_PORT = '4747';
});

function create(id, steps = [{ id: 's', title: `Step ${id}` }]) {
  store.createEpic({ id, title: `Epic ${id}` });
  return store.patchEpic(id, { tasks: [{ id: 't', title: 'Task', steps }] }).epic;
}

function raw(id, value) {
  fs.mkdirSync(path.join(home, 'epics'), { recursive: true });
  fs.writeFileSync(path.join(home, 'epics', `${id}.json`), typeof value === 'string' ? value : JSON.stringify(value));
}

test('external after accepts a pending target without changing source state', () => {
  create('source');
  const { epic } = store.patchEpic('source', { tasks: [{ id: 't', steps: [{ id: 's', state: 'done', after: ['future/t/s'] }] }] });
  assert.equal(epic.tasks[0].steps[0].state, 'done');
  assert.deepEqual(epic.tasks[0].steps[0].after, ['future/t/s']);
  assert.equal(fs.existsSync(path.join(home, 'epics', 'future.json')), false);
});

test('explicit after patches normalize same-epic addresses and deduplicate in first-use order', () => {
  create('source', [{ id: 's' }, { id: 'next' }]);
  const values = ['source/t/s', 't/s', 'foreign/t/s', 'foreign/t/s', 't/next'];
  const { epic } = store.patchEpic('source', { tasks: [{ id: 't', steps: [{ id: 'next', after: values }] }] });
  assert.deepEqual(epic.tasks[0].steps[1].after, ['t/s', 'foreign/t/s', 't/next']);
  assert.deepEqual(values, ['source/t/s', 't/s', 'foreign/t/s', 'foreign/t/s', 't/next']);
  assert.deepEqual(store.readHistory('source')[0].after, ['t/s', 'foreign/t/s', 't/next']);
});

test('invalid after forms are bad-after and a local target must exist', () => {
  create('source');
  for (const after of ['other/t/s', {}, 7, [null], [12], ['a/b/c/d'], ['/t/s'], ['../t/s'], ['other//s'], ['other/t/s\n'], ['t/missing'], ['source/t/missing']]) {
    assert.throws(() => store.patchEpic('source', { tasks: [{ id: 't', steps: [{ id: 's', after }] }] }), { status: 400, code: 'bad-after' }, JSON.stringify(after));
  }
});

test('unrelated patches preserve historical after arrays without normalization events', () => {
  const original = create('source', [{ id: 's' }, { id: 'next', after: ['t/s'] }]);
  original.tasks[0].steps[1].after = ['source/t/s', 't/s', 'foreign/t/s', 'foreign/t/s'];
  store.saveEpic(original);
  const history = store.readHistory('source', { limit: 1000 }).length;
  const { epic, changes } = store.patchEpic('source', { tasks: [{ id: 't', steps: [{ id: 'next', state: 'active' }] }] });
  assert.deepEqual(epic.tasks[0].steps[1].after, original.tasks[0].steps[1].after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, 'tasks[t].steps[next].state');
  assert.equal(store.readHistory('source', { limit: 1000 }).length, history + 1);
});

test('step reference parser rejects unsafe identities and canonicalizes local identity', async () => {
  const { parseStepRef, normalizeAfter } = await import('../server/step-refs.mjs');
  assert.deepEqual(parseStepRef('owner/task/step', 'owner'), { epic: 'owner', task: 'task', step: 'step', address: 'owner/task/step', local: true, ref: 'task/step' });
  assert.deepEqual(parseStepRef('task/step', 'owner'), { epic: 'owner', task: 'task', step: 'step', address: 'owner/task/step', local: true, ref: 'task/step' });
  assert.deepEqual(parseStepRef('other/task/.step', 'owner'), { epic: 'other', task: 'task', step: '.step', address: 'other/task/.step', local: false, ref: 'other/task/.step' });
  for (const value of [null, 7, {}, 'x', 'a/b/c/d', 'a//s', '../t/s', 'x/.task/s', 'x/t/step\n', 'x/t/<s>', `${'a'.repeat(65)}/t/s`]) assert.equal(parseStepRef(value, 'owner'), null);
  assert.equal(parseStepRef('t/s', '../owner'), null);
  assert.deepEqual(normalizeAfter(['owner/t/s', 't/s', 'other/t/s', 'other/t/s'], 'owner'), ['t/s', 'other/t/s']);
  assert.throws(() => normalizeAfter('other/t/s', 'owner'), { status: 400, code: 'bad-after' });
});

test('snapshot resolves one-hop cycles and backlinks with complete endpoint metadata', async () => {
  create('a', [{ id: 's', title: 'Source', state: 'active', label: 'Needs contract', after: ['b/t/s', 'b/t/s'] }]);
  create('b', [{ id: 's', title: 'Target', after: ['a/t/s'] }]);
  const { readBoardSnapshot, linksForEpic } = await import('../server/links.mjs');
  const snapshot = readBoardSnapshot();
  const links = linksForEpic(snapshot, 'a');
  assert.equal(links.outgoing.length, 1);
  assert.equal(links.incoming.length, 1);
  assert.deepEqual(links.outgoing[0], {
    source: { epic: 'a', task: 't', step: 's', address: 'a/t/s', epicTitle: 'Epic a', title: 'Source', state: 'active', url: 'http://localhost:4747/e/a#t-t/s' },
    target: { epic: 'b', task: 't', step: 's', address: 'b/t/s', epicTitle: 'Epic b', title: 'Target', state: 'todo', url: 'http://localhost:4747/e/b#t-t/s' },
    label: 'Needs contract', status: 'resolved',
  });
  assert.equal(links.incoming[0].source.address, 'b/t/s');
  assert.deepEqual(links.relatedEpics, [{ id: 'b', title: 'Epic b', url: 'http://localhost:4747/e/b', status: 'resolved' }]);
  assert.equal(links.incomplete, false);
  assert.deepEqual(links.errors, []);
  assert.equal(links.readAt, snapshot.readAt);
});

test('source state remains writable through every counterpart state and target read failure', async () => {
  create('a', [{ id: 's', after: ['b/t/s'] }]);
  create('b');
  const { readBoardSnapshot, linksForEpic } = await import('../server/links.mjs');
  for (const state of ['todo', 'active', 'blocked', 'waiting', 'done']) {
    store.patchEpic('b', { tasks: [{ id: 't', steps: [{ id: 's', state }] }] });
    const { epic } = store.patchEpic('a', { tasks: [{ id: 't', steps: [{ id: 's', state: state === 'done' ? 'active' : 'done' }] }] });
    assert.equal(epic.tasks[0].steps[0].state, state === 'done' ? 'active' : 'done');
    assert.equal(linksForEpic(readBoardSnapshot(), 'a').outgoing[0].target.state, state);
  }
  raw('b', '{broken');
  const { epic } = store.patchEpic('a', { tasks: [{ id: 't', steps: [{ id: 's', state: 'done' }] }] });
  assert.equal(epic.tasks[0].steps[0].state, 'done');
  assert.equal(linksForEpic(readBoardSnapshot(), 'a').outgoing[0].status, 'unavailable');
});

test('read model excludes local aliases and orders external edges by full identities', async () => {
  const epic = create('a', [{ id: 'z', after: ['z/t/s', 'b/t/s'] }, { id: 's' }]);
  epic.tasks[0].steps[0].after.push('a/t/s', 't/s', 'b/t/s');
  store.saveEpic(epic);
  create('b', [{ id: 's', after: ['a/t/s'] }]);
  create('z');
  const { readBoardSnapshot, linksForEpic } = await import('../server/links.mjs');
  const links = linksForEpic(readBoardSnapshot(), 'a');
  assert.deepEqual(links.outgoing.map((edge) => edge.target.address), ['b/t/s', 'z/t/s']);
  assert.deepEqual(links.relatedEpics.map((epic) => epic.id), ['b', 'z']);
});

test('missing epic, task and step retain identity and restore after target recreation', async () => {
  create('a', [{ id: 's', after: ['absent/t/s', 'b/no/s', 'b/t/no', 'b/t/s'] }]);
  create('b');
  const { readBoardSnapshot, linksForEpic } = await import('../server/links.mjs');
  const sourceFile = fs.readFileSync(store.epicPath('a'), 'utf8');
  let links = linksForEpic(readBoardSnapshot(), 'a');
  assert.deepEqual(links.outgoing.map((edge) => [edge.target.address, edge.status]), [['absent/t/s', 'missing-epic'], ['b/no/s', 'missing-task'], ['b/t/no', 'missing-step'], ['b/t/s', 'resolved']]);
  assert.equal(links.outgoing[0].target.title, null);
  assert.equal(links.outgoing[0].target.state, null);
  assert.equal(links.outgoing[0].target.url, 'http://localhost:4747/e/absent#t-t/s');
  fs.unlinkSync(store.epicPath('b'));
  links = linksForEpic(readBoardSnapshot(), 'a');
  assert.equal(links.outgoing[3].status, 'missing-epic');
  raw('b', { schema: 3, id: 'b', title: 'Restored', tasks: [{ id: 't', steps: [{ id: 's', state: 'done' }] }] });
  links = linksForEpic(readBoardSnapshot(), 'a');
  assert.equal(links.outgoing[3].status, 'resolved');
  assert.equal(links.outgoing[3].target.state, 'done');
  assert.equal(fs.readFileSync(store.epicPath('a'), 'utf8'), sourceFile);
});

test('corrupt targets are unavailable and corrupt unrelated sources make backlinks incomplete', async () => {
  create('a', [{ id: 's', after: ['broken/t/s'] }]);
  create('b', [{ id: 's', after: ['a/t/s'] }]);
  raw('broken', '{bad-json');
  raw('unrelated', { schema: 3, id: 'unrelated', tasks: {} });
  const { readBoardSnapshot, linksForEpic } = await import('../server/links.mjs');
  const snapshot = readBoardSnapshot();
  const links = linksForEpic(snapshot, 'a');
  assert.equal(links.outgoing[0].status, 'unavailable');
  assert.equal(links.outgoing[0].target.title, null);
  assert.equal(links.outgoing[0].target.state, null);
  assert.equal(links.incoming.length, 1);
  assert.equal(links.incomplete, true);
  assert.deepEqual(links.errors, [{ id: 'broken', status: 'unavailable' }, { id: 'unrelated', status: 'unavailable' }]);
  assert.deepEqual(links.relatedEpics, [{ id: 'b', title: 'Epic b', url: 'http://localhost:4747/e/b', status: 'resolved' }, { id: 'broken', title: null, url: 'http://localhost:4747/e/broken', status: 'unavailable' }]);
  assert.throws(() => linksForEpic(snapshot, 'broken'), { status: 500 });
  assert.throws(() => linksForEpic(snapshot, 'absent'), { status: 404 });
  assert.throws(() => linksForEpic(snapshot, '../escape'), { status: 400 });
});

test('malformed JSON shapes are error records and never crash graph construction', async () => {
  create('a');
  const shapes = [null, [], { tasks: {} }, { tasks: [null] }, { tasks: [{ steps: [] }] }, { tasks: [{ id: null, steps: [] }] }, { tasks: [{ id: 't', steps: {} }] }, { tasks: [{ id: 't', steps: [null] }] }, { tasks: [{ id: 't', steps: [{}] }] }, { tasks: [{ id: 't', steps: [{ id: null }] }] }, { tasks: [{ id: 't', steps: [{ id: 's', after: 'x/t/s' }] }] }, { tasks: [{ id: 't', steps: [{ id: 's', after: ['../t/s'] }] }] }];
  shapes.forEach((shape, i) => raw(`bad${i}`, shape && !Array.isArray(shape) ? { schema: 3, id: `bad${i}`, ...shape } : shape));
  const { readBoardSnapshot, linksForEpic } = await import('../server/links.mjs');
  const snapshot = readBoardSnapshot();
  assert.deepEqual(snapshot.epics.map((epic) => epic.id), ['a']);
  assert.equal(snapshot.errors.length, shapes.length);
  assert.equal(linksForEpic(snapshot, 'a').incomplete, true);
});

test('malformed in-memory snapshots fail with a board error', async () => {
  const { linksForEpic } = await import('../server/links.mjs');
  for (const snapshot of [null, {}, { epics: [null], errors: [] }, { epics: [{ id: 'a', tasks: {} }], errors: [] }, { epics: [], errors: [null] }]) {
    assert.throws(() => linksForEpic(snapshot, 'a'), { status: 500, code: 'broken-snapshot' });
  }
});

test('revision ignores readAt and unrelated fields but tracks counterpart state and backlinks', async () => {
  create('a', [{ id: 's', after: ['b/t/s'] }]);
  create('b');
  const { readBoardSnapshot, linksForEpic } = await import('../server/links.mjs');
  const initial = readBoardSnapshot();
  const first = linksForEpic(initial, 'a');
  assert.equal(linksForEpic({ ...initial, readAt: '2099-01-01T00:00:00.000Z' }, 'a').revision, first.revision);
  store.patchEpic('b', { goal: 'Unrelated change' });
  assert.equal(linksForEpic(readBoardSnapshot(), 'a').revision, first.revision);
  const sourceBefore = fs.readFileSync(store.epicPath('a'), 'utf8');
  store.patchEpic('b', { tasks: [{ id: 't', steps: [{ id: 's', title: 'Renamed', state: 'done' }] }] });
  const changed = linksForEpic(readBoardSnapshot(), 'a');
  assert.notEqual(changed.revision, first.revision);
  assert.equal(changed.outgoing[0].target.title, 'Renamed');
  assert.equal(changed.outgoing[0].target.state, 'done');
  assert.equal(first.outgoing[0].target.state, 'todo');
  store.patchEpic('b', { tasks: [{ id: 't', steps: [{ id: 's', after: ['a/t/s'] }] }] });
  assert.notEqual(linksForEpic(readBoardSnapshot(), 'a').revision, changed.revision);
  assert.equal(fs.readFileSync(store.epicPath('a'), 'utf8'), sourceBefore);
});

test('snapshot reads each epic file once and graph reads never write storage', async (t) => {
  create('a', [{ id: 's', after: ['b/t/s'] }]);
  create('b', [{ id: 's', after: ['a/t/s'] }]);
  fs.writeFileSync(path.join(home, 'epics', '.unsafe.json'), '{}');
  const before = fs.readdirSync(path.join(home, 'epics')).map((name) => [name, fs.statSync(path.join(home, 'epics', name)).mtimeMs]);
  const reads = new Map();
  const originalRead = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (path.dirname(String(file)) === path.join(home, 'epics') && String(file).endsWith('.json')) reads.set(path.basename(String(file)), (reads.get(path.basename(String(file))) || 0) + 1);
    return originalRead(file, ...args);
  });
  const { readBoardSnapshot, linksForEpic } = await import('../server/links.mjs');
  const snapshot = readBoardSnapshot();
  linksForEpic(snapshot, 'a');
  linksForEpic(snapshot, 'b');
  assert.deepEqual([...reads].sort(), [['a.json', 1], ['b.json', 1]]);
  assert.deepEqual(fs.readdirSync(path.join(home, 'epics')).map((name) => [name, fs.statSync(path.join(home, 'epics', name)).mtimeMs]), before);
});

test('directory listing failure is a failed snapshot and an absent store stays empty', async (t) => {
  const { readBoardSnapshot } = await import('../server/links.mjs');
  assert.deepEqual(readBoardSnapshot().epics, []);
  assert.equal(fs.existsSync(path.join(home, 'epics')), false);
  const originalReadDir = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (dir, ...args) => {
    if (dir === path.join(home, 'epics')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return originalReadDir(dir, ...args);
  });
  assert.throws(() => readBoardSnapshot(), { status: 500 });
});
