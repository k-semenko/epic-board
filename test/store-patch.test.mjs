import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');
store.createEpic({ id: '1', title: 'E' });
store.patchEpic('1', { repos: { app: { path: '/tmp/app', base: 'main', provider: 'gitlab', project: 'gitlab.example.com/acme/app' } } });

test('tasks and steps merge by id', () => {
  store.patchEpic('1', { tasks: [{ id: '10', title: 'T', role: 'main', steps: [{ id: 's1', title: 'A', state: 'todo' }] }] });
  const { epic, changes } = store.patchEpic('1', { tasks: [{ id: '10', steps: [{ id: 's1', state: 'done' }, { id: 's2', title: 'B', state: 'active' }] }] });
  const steps = epic.tasks[0].steps;
  assert.deepEqual(steps.map((s) => [s.id, s.state]), [['s1', 'done'], ['s2', 'active']]);
  assert.equal(steps[0].title, 'A');
  assert.ok(changes.some((c) => c.path === 'tasks[10].steps[s1].state' && c.before === 'todo' && c.after === 'done'));
  assert.ok(store.readHistory('1').some((e) => e.op === 'add' && e.path === 'tasks[10].steps[s2]'));
});

test('branches merge by repo+name and $delete removes', () => {
  store.patchEpic('1', { tasks: [{ id: '10', branches: [{ repo: 'app', name: 'feat/x', mr: { iid: 1 } }] }] });
  let epic = store.patchEpic('1', { tasks: [{ id: '10', branches: [{ repo: 'app', name: 'feat/x', worktree: '/w' }] }] }).epic;
  assert.deepEqual(epic.tasks[0].branches, [{ repo: 'app', name: 'feat/x', mr: { iid: 1 }, worktree: '/w' }]);
  epic = store.patchEpic('1', { tasks: [{ id: '10', branches: [{ repo: 'app', name: 'feat/x', $delete: true }] }] }).epic;
  assert.deepEqual(epic.tasks[0].branches, []);
});

test('decisions get id and at, are append-only', () => {
  const { epic } = store.patchEpic('1', { decisions: [{ task: '10', text: 'Cards before wallets', by: 'reviewer' }] });
  const [d] = epic.decisions;
  assert.equal(d.id, 'd1');
  assert.ok(d.at);
  assert.throws(() => store.patchEpic('1', { decisions: [{ id: 'd1', $delete: true }] }), { status: 400 });
  assert.throws(() => store.patchEpic('1', { decisions: [{ id: 'd1', text: 'x' }] }), { status: 400 });
});

test('mergeOrder is replaced whole', () => {
  store.patchEpic('1', { mergeOrder: [{ id: 'm1', text: 'a' }, { id: 'm2', text: 'b' }] });
  const { epic } = store.patchEpic('1', { mergeOrder: [{ id: 'm3', text: 'c' }] });
  assert.deepEqual(epic.mergeOrder.map((m) => m.id), ['m3']);
});

test('null removes a field', () => {
  const { epic } = store.patchEpic('1', { tasks: [{ id: '10', steps: [{ id: 's2', note: 'n' }] }] });
  assert.equal(epic.tasks[0].steps[1].note, 'n');
  const next = store.patchEpic('1', { tasks: [{ id: '10', steps: [{ id: 's2', note: null }] }] }).epic;
  assert.equal('note' in next.tasks[0].steps[1], false);
});

test('rejections', () => {
  assert.throws(() => store.patchEpic('1', { facts: {} }), { status: 400, code: 'facts-readonly' });
  assert.throws(() => store.patchEpic('1', { id: '2' }), { status: 400 });
  assert.throws(() => store.patchEpic('1', { tasks: [{ id: '10', steps: [{ id: 's3', title: 'C', after: ['10/nope'] }] }] }), { status: 400, code: 'bad-after' });
  assert.throws(() => store.patchEpic('1', { tasks: [{ id: '10', branches: [{ repo: 'nope', name: 'x' }] }] }), { status: 400, code: 'bad-repo' });
  for (const name of ['--output=/tmp/x', 'a..b', 'with space', 'x.lock', 'a~1']) {
    assert.throws(() => store.patchEpic('1', { tasks: [{ id: '10', branches: [{ repo: 'app', name }] }] }), { status: 400, code: 'bad-branch' }, name);
  }
  assert.throws(() => store.patchEpic('1', { tasks: [{ title: 'no id' }] }), { status: 400, code: 'no-key' });
});

test('no-op patch writes no history', () => {
  const before = store.readHistory('1', { limit: 1000 }).length;
  store.patchEpic('1', { tasks: [{ id: '10', title: 'T' }] });
  assert.equal(store.readHistory('1', { limit: 1000 }).length, before);
});
