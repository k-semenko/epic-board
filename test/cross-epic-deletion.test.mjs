import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { planDeletion } from '../server/deletion.mjs';
import * as store from '../server/store.mjs';
import { tmpHome } from './helpers.mjs';

async function fixture(t) {
  const home = tmpHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  store.createEpic({ id: 'source', title: 'Consumer' });
  store.createEpic({ id: 'target', title: 'Contract' });
  store.patchEpic('target', { tasks: [{ id: 'api', steps: [{ id: 'contract', title: 'Contract', state: 'active' }] }] });
  store.patchEpic('source', { tasks: [{ id: 'plugin', steps: [{ id: 'mcp', title: 'MCP', state: 'active', after: ['target/api/contract'] }] }] });
  const { readBoardSnapshot, linksForEpic } = await import('../server/links.mjs');
  const view = (id) => linksForEpic(readBoardSnapshot(), id);
  const snapshot = (id) => [readFileSync(store.epicPath(id), 'utf8'), store.readHistory(id, { limit: Infinity })];
  return { view, snapshot };
}

function epic(after) {
  return {
    id: 'shop',
    tasks: [
      { id: 'TARGET', steps: [{ id: 'first', state: 'done' }] },
      { id: 'KEEP', steps: [{ id: 'consumer', state: 'active', after }] },
    ],
  };
}

test('deleting a local task ignores a foreign epic with the same ID', () => {
  const result = planDeletion(epic(['TARGET/foreign/step']), 'TARGET');
  assert.deepEqual(result.references, []);
  assert.deepEqual(result.patch.tasks, [{ id: 'TARGET', $delete: true }]);
});

test('deletion cleanup removes local references while retaining external addresses', () => {
  const result = planDeletion(epic(['TARGET/first', 'other/TARGET/first', 'TARGET/foreign/step']), 'TARGET');
  assert.deepEqual(result.references, ['tasks[KEEP].steps[consumer].after -> TARGET/first']);
  assert.deepEqual(result.patch.tasks[1], {
    id: 'KEEP', steps: [{ id: 'consumer', after: ['other/TARGET/first', 'TARGET/foreign/step'] }],
  });
});

test('stored fully qualified local references block and clean up local step deletion', () => {
  const result = planDeletion(epic(['shop/TARGET/first', 'other/TARGET/first']), 'TARGET', 'first');
  assert.deepEqual(result.references, ['tasks[KEEP].steps[consumer].after -> shop/TARGET/first']);
  assert.deepEqual(result.patch.tasks[1], {
    id: 'KEEP', steps: [{ id: 'consumer', after: ['other/TARGET/first'] }],
  });
});

test('legacy numeric task IDs retain local deletion cleanup', () => {
  const source = epic(['42/first']);
  source.tasks[0].id = 42;
  const result = planDeletion(source, 42);
  assert.deepEqual(result.references, ['tasks[KEEP].steps[consumer].after -> 42/first']);
  assert.deepEqual(result.patch.tasks[1], { id: 'KEEP', steps: [{ id: 'consumer', after: [] }] });
});

test('waiting reference aliases retain their existing local deletion semantics', () => {
  const source = epic(['other/TARGET/first']);
  source.waiting = [{ id: 'review', refs: ['step:TARGET/first/legacy', 'step:KEEP/consumer'] }];
  const result = planDeletion(source, 'TARGET', 'first');
  assert.deepEqual(result.waiting, [{ id: 'review', refs: ['step:KEEP/consumer'] }]);
  assert.deepEqual(result.references, ['waiting[review].refs -> step:TARGET/first/legacy']);
});

for (const wholeTask of [false, true]) {
  test(`deleting a foreign ${wholeTask ? 'task' : 'step'} retains source bytes, state and history`, async (t) => {
    const { view, snapshot } = await fixture(t);
    const before = snapshot('source');
    if (wholeTask) store.deleteTask('target', 'api');
    else store.deleteStep('target', 'api', 'contract');
    assert.deepEqual(snapshot('source'), before);
    assert.equal(view('source').outgoing[0].status, wholeTask ? 'missing-task' : 'missing-step');
    store.patchEpic('source', { tasks: [{ id: 'plugin', steps: [{ id: 'mcp', state: 'done' }] }] });
    assert.equal(store.readEpic('source').tasks[0].steps[0].state, 'done');
    store.patchEpic('target', { tasks: [{ id: 'api', steps: [{ id: 'contract', title: 'Restored contract', state: 'done' }] }] });
    assert.equal(view('source').outgoing[0].status, 'resolved');
    assert.equal(view('source').outgoing[0].target.state, 'done');
  });

  test(`deleting the source ${wholeTask ? 'task' : 'step'} removes backlinks without writing the target`, async (t) => {
    const { view, snapshot } = await fixture(t);
    assert.equal(view('target').incoming.length, 1);
    const before = snapshot('target');
    if (wholeTask) store.deleteTask('source', 'plugin');
    else store.deleteStep('source', 'plugin', 'mcp');
    assert.equal(view('target').incoming.length, 0);
    assert.deepEqual(snapshot('target'), before);
  });
}

test('store task deletion preserves a missing foreign link whose epic ID collides with the local task', async (t) => {
  const { view } = await fixture(t);
  store.patchEpic('source', { tasks: [
    { id: 'TARGET', steps: [{ id: 'first' }] },
    { id: 'plugin', steps: [{ id: 'mcp', after: ['TARGET/api/contract'] }] },
  ] });
  store.deleteTask('source', 'TARGET');
  assert.deepEqual(store.readEpic('source').tasks[0].steps[0].after, ['TARGET/api/contract']);
  assert.equal(view('source').outgoing[0].status, 'missing-epic');
});
