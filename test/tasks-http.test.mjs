import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const { createBoardServer } = await import('../server/http.mjs');
const { createWaiting } = await import('../server/waiting.mjs');

function fixture() {
  const home = tmpHome();
  const alpha = store.createEpic({ id: 'alpha', title: '<script>Epic</script>' });
  alpha.tasks = [
    { id: 'shared', title: '[web] <img src=x onerror=alert(1)>', status: 'Код-ревью', statusCheckedAt: '2026-10-19T08:00:00Z', steps: [
      { id: 'done', title: 'Contract', state: 'done' },
      { id: 'active', title: '<svg onload=alert(2)>', state: 'active' },
      { id: 'blocked', title: 'Live acceptance', state: 'blocked' },
    ] },
    { id: 'side', title: 'Side task', role: 'side', steps: [{ id: 'work', title: 'Side work', state: 'active' }] },
  ];
  alpha.waiting = [
    { id: 'open', title: 'Review', task: 'shared', status: 'open' },
    { id: 'answered', title: 'Check answer', task: 'shared', status: 'answered' },
    { id: 'closed', title: 'Old question', task: 'shared', status: 'closed', doneAt: '2026-10-18T08:00:00Z' },
    { id: 'unbound', title: 'Epic decision', status: 'open' },
  ].map(({ status, doneAt, ...fields }) => ({ ...createWaiting(fields, '2026-10-18T08:00:00Z'), status, ...(doneAt ? { doneAt } : {}) }));
  store.saveEpic(alpha);
  const beta = store.createEpic({ id: 'beta', title: 'Beta epic' });
  beta.tasks = [{ id: 'shared', title: 'Task without steps' }];
  store.saveEpic(beta);
  store.createEpic({ id: 'empty', title: 'Empty epic' });
  return { home, alpha, beta };
}

async function withServer(run) {
  const server = createBoardServer({ port: 0 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run((path) => fetch(`http://127.0.0.1:${server.address().port}${path}`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('task API projects every epic task with its origin and computed progress', async () => {
  fixture();
  await withServer(async (get) => {
    const response = await get('/api/tasks');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.tasks, [
      { epic: { id: 'alpha', title: '<script>Epic</script>' }, id: 'shared', title: '[web] <img src=x onerror=alert(1)>', status: 'Код-ревью', statusCheckedAt: '2026-10-19T08:00:00Z', role: 'main', progress: { done: 1, total: 3 }, current: ['<svg onload=alert(2)>'], waiting: 2, url: '/e/alpha#t-shared' },
      { epic: { id: 'alpha', title: '<script>Epic</script>' }, id: 'side', title: 'Side task', status: null, statusCheckedAt: null, role: 'side', progress: { done: 0, total: 1 }, current: ['Side work'], waiting: 0, url: '/e/alpha#t-side' },
      { epic: { id: 'beta', title: 'Beta epic' }, id: 'shared', title: 'Task without steps', status: null, statusCheckedAt: null, role: 'main', progress: { done: 0, total: 0 }, current: [], waiting: 0, url: '/e/beta#t-shared' },
    ]);
    assert.deepEqual(data.epics, [{ id: 'alpha', title: '<script>Epic</script>' }, { id: 'beta', title: 'Beta epic' }, { id: 'empty', title: 'Empty epic' }]);
    assert.equal(data.incomplete, false);
    assert.deepEqual(data.errors, []);
    assert.ok(Number.isFinite(Date.parse(data.readAt)));
    assert.match(data.revision, /^[a-f0-9]{64}$/);
  });
});

test('task API reads one snapshot and leaves epic data and history untouched', async () => {
  const { home } = fixture();
  const files = fs.readdirSync(join(home, 'epics')).map((name) => join(home, 'epics', name));
  const before = files.map((file) => fs.readFileSync(file, 'utf8'));
  await withServer(async (get) => {
    const reads = new Map();
    const read = fs.readFileSync;
    fs.readFileSync = (file, ...rest) => {
      if (files.includes(String(file)) && String(file).endsWith('.json')) reads.set(String(file), (reads.get(String(file)) || 0) + 1);
      return read(file, ...rest);
    };
    syncBuiltinESMExports();
    try {
      assert.equal((await get('/api/tasks')).status, 200);
    } finally {
      fs.readFileSync = read;
      syncBuiltinESMExports();
    }
    assert.deepEqual([...reads.values()], [1, 1, 1]);
  });
  assert.deepEqual(fs.readdirSync(join(home, 'epics')).map((name) => join(home, 'epics', name)), files);
  assert.deepEqual(files.map((file) => fs.readFileSync(file, 'utf8')), before);
});

test('task revision ignores read time and invisible changes but tracks visible fields', async () => {
  fixture();
  await withServer(async (get) => {
    const response = await get('/api/tasks');
    assert.equal(response.status, 200);
    const first = await response.json();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await (await get('/api/tasks')).json();
    assert.notEqual(second.readAt, first.readAt);
    assert.equal(second.revision, first.revision);
    store.patchEpic('alpha', { goal: 'A changed goal' });
    const unchanged = await (await get('/api/tasks')).json();
    assert.equal(unchanged.revision, first.revision);
    const revisions = new Set([first.revision]);
    for (const patch of [
      { title: 'Renamed epic' },
      { tasks: [{ id: 'shared', title: 'Renamed task' }] },
      { tasks: [{ id: 'shared', role: 'side' }] },
      { tasks: [{ id: 'shared', status: 'Отладка', statusCheckedAt: '2026-10-19T09:00:00Z' }] },
      { tasks: [{ id: 'shared', steps: [{ id: 'blocked', state: 'done' }] }] },
      { tasks: [{ id: 'shared', steps: [{ id: 'active', title: 'Renamed current step' }] }] },
    ]) {
      store.patchEpic('alpha', patch);
      const next = await (await get('/api/tasks')).json();
      assert.equal(revisions.has(next.revision), false);
      revisions.add(next.revision);
    }
    store.patchEpic('empty', { title: 'Renamed empty epic' });
    const renamedEmpty = await (await get('/api/tasks')).json();
    assert.equal(revisions.has(renamedEmpty.revision), false);
    revisions.add(renamedEmpty.revision);
    store.patchEpic('alpha', { waiting: [{ id: 'another', title: 'Another decision', task: 'shared' }] });
    const waiting = await (await get('/api/tasks')).json();
    assert.equal(revisions.has(waiting.revision), false);
  });
});

test('task API distinguishes an empty board from partial and total read failures', async (t) => {
  tmpHome();
  await withServer(async (get) => {
    const empty = await get('/api/tasks');
    assert.equal(empty.status, 200);
    const data = await empty.json();
    assert.deepEqual(data.tasks, []);
    assert.deepEqual(data.epics, []);
    assert.deepEqual(data.errors, []);
    assert.equal(data.incomplete, false);
    fixture();
    fs.writeFileSync(store.epicPath('beta'), '{bad json');
    const partial = await (await get('/api/tasks')).json();
    assert.equal(partial.tasks.length, 2);
    assert.deepEqual(partial.epics.map((epic) => epic.id), ['alpha', 'empty']);
    assert.equal(partial.incomplete, true);
    assert.deepEqual(partial.errors, [{ id: 'beta', status: 'unavailable' }]);
    tmpHome();
    fs.writeFileSync(store.epicPath('only'), '{bad json');
    t.mock.method(console, 'error', () => {});
    const unavailable = await get('/api/tasks');
    assert.equal(unavailable.status, 500);
    assert.equal((await unavailable.json()).error, 'unavailable-board');
  });
});

test('tasks page is served without accepting unknown task endpoints', async () => {
  tmpHome();
  await withServer(async (get) => {
    const page = await get('/tasks');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.equal((await get('/api/tasks/missing')).status, 404);
  });
});
