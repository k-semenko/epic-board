import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');

test('ids are slugs: tracker keys and plain numbers both work', () => {
  for (const id of ['42', 'PROJ-12', 'gh.341', 'a_b']) assert.equal(store.checkId(id), id);
  for (const id of ['../x', '', '1/2', '-x', 'a b', 'x'.repeat(65)]) assert.throws(() => store.checkId(id), { status: 400 }, id);
});

test('new epics are schema 2, tasks carry any id and link', () => {
  const epic = store.createEpic({ id: 'WEB-1', title: 'Checkout' });
  assert.equal(epic.schema, 2);
  store.patchEpic('WEB-1', { repos: { web: { path: '/tmp/web', base: 'main', provider: 'github', project: 'github.com/acme/web' } } });
  const { epic: next } = store.patchEpic('WEB-1', { tasks: [{ id: 'JIRA-7', title: 'Pay button', url: 'https://jira.example.com/browse/JIRA-7', tracker: 'Jira', status: 'In progress' }] });
  assert.equal(next.tasks[0].url, 'https://jira.example.com/browse/JIRA-7');
  assert.throws(() => store.patchEpic('WEB-1', { tasks: [{ id: 'a/b', title: 'x' }] }), { status: 400, code: 'bad-task-id' });
  assert.throws(() => store.patchEpic('WEB-1', { tasks: [{ id: 'T', title: 'x', url: 'javascript:alert(1)' }] }), { status: 400, code: 'bad-url' });
  assert.throws(() => store.patchEpic('WEB-1', { repos: { x: { path: '/x', provider: 'svn' } } }), { status: 400, code: 'bad-provider' });
});

test('a pending decision links to stored items and checks them', () => {
  store.patchEpic('WEB-1', { tasks: [{ id: 'JIRA-7', steps: [{ id: 'api', title: 'API', state: 'active' }] }] });
  const item = {
    id: 'pick-psp', kind: 'decision', title: 'Pick a payment provider',
    details: 'Compare **fees** and refunds API', refs: ['task:JIRA-7', 'step:JIRA-7/api', 'https://example.com/compare'],
    checklist: [{ id: 'c1', text: 'Fees compared' }, { id: 'c2', text: 'Legal ok' }],
  };
  const { epic } = store.patchEpic('WEB-1', { waiting: [item] });
  assert.equal(epic.waiting[0].title, 'Pick a payment provider');
  assert.throws(() => store.patchEpic('WEB-1', { waiting: [{ id: 'x', title: 'X', refs: ['task:NOPE'] }] }), { status: 400, code: 'bad-ref' });
  assert.throws(() => store.patchEpic('WEB-1', { waiting: [{ id: 'x', title: 'X', refs: ['ftp://x'] }] }), { status: 400, code: 'bad-ref' });
  assert.throws(() => store.patchEpic('WEB-1', { waiting: [{ id: 'x', title: 'X', kind: 'ddl' }] }), { status: 400, code: 'bad-kind' });
  assert.throws(() => store.patchEpic('WEB-1', { waiting: [{ id: 'x' }] }), { status: 400, code: 'no-title' });
});

test('done needs every checklist item ticked', () => {
  assert.throws(() => store.resolveWaiting('WEB-1', 'pick-psp', { checked: ['c1'] }), { status: 400, code: 'checklist' });
  const epic = store.resolveWaiting('WEB-1', 'pick-psp', { checked: ['c1', 'c2'], resolution: 'Stripe' }, { by: 'button' });
  const w = epic.waiting[0];
  assert.ok(w.doneAt);
  assert.equal(w.resolution, 'Stripe');
  assert.deepEqual(w.checked, ['c1', 'c2']);
  const back = store.reopenWaiting('WEB-1', 'pick-psp');
  assert.equal(back.waiting[0].doneAt, undefined);
  assert.equal(back.waiting[0].checked, undefined);
  store.patchEpic('WEB-1', { waiting: [{ id: 'plain', title: 'Ship it' }] });
  assert.ok(store.resolveWaiting('WEB-1', 'plain', {}).waiting.find((x) => x.id === 'plain').doneAt);
  assert.throws(() => store.resolveWaiting('WEB-1', 'nope', {}), { status: 404 });
});

test('schema 1 files are migrated on read', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const old = {
    schema: 1, id: '100', title: 'Old', goal: '', createdAt: at, updatedAt: at,
    repos: { app: { path: '/w/app', base: 'master', glab: 'gitlab.example.com/g/app' } },
    tasks: [{ id: '101', title: 'T', role: 'main', stage: 'Review', stageCheckedAt: at, steps: [] }],
    waiting: [{ id: 'w1', kind: 'ddl', text: 'Apply DDL', task: '101', since: at }, { id: 'w2', kind: 'approve', text: 'OK?', since: at }],
    mergeOrder: [], decisions: [{ id: 'd1', at, text: 'x', by: 'someone' }], sessions: [], facts: {},
  };
  writeFileSync(store.epicPath('100'), JSON.stringify(old));
  const epic = store.readEpic('100');
  assert.equal(epic.schema, 2);
  assert.deepEqual(epic.repos.app, { path: '/w/app', base: 'master', provider: 'gitlab', project: 'gitlab.example.com/g/app' });
  assert.equal(epic.tasks[0].status, 'Review');
  assert.equal(epic.tasks[0].statusCheckedAt, at);
  assert.equal('stage' in epic.tasks[0], false);
  assert.deepEqual(epic.waiting.map((w) => [w.kind, w.title, 'text' in w]), [['action', 'Apply DDL', false], ['approval', 'OK?', false]]);
  store.patchEpic('100', { goal: 'G' });
  assert.equal(store.readEpic('100').schema, 2);
  assert.ok(store.listEpics().some((e) => e.id === '100'));
});

test('a schema 1 item without text or with a dangling task stays writable', () => {
  const at = '2026-01-01T00:00:00.000Z';
  writeFileSync(store.epicPath('101'), JSON.stringify({ schema: 1, id: '101', title: 'Old', createdAt: at, updatedAt: at, repos: {}, tasks: [], waiting: [{ id: 'w1', kind: 'other', text: '', task: 'gone', since: at }], mergeOrder: [], decisions: [], sessions: [], facts: {} }));
  const { epic } = store.patchEpic('101', { goal: 'still writable' });
  assert.equal(epic.waiting[0].title, '(untitled)');
  assert.equal('task' in epic.waiting[0], false);
});

test('a checklist given again replaces the old one', () => {
  store.patchEpic('WEB-1', { waiting: [{ id: 'cl', title: 'C', checklist: [{ id: 'c1', text: 'a' }, { id: 'c2', text: 'b' }, { id: 'c3', text: 'c' }] }] });
  const { epic } = store.patchEpic('WEB-1', { waiting: [{ id: 'cl', checklist: [{ id: 'c1', text: 'only' }] }] });
  assert.deepEqual(epic.waiting.find((w) => w.id === 'cl').checklist, [{ id: 'c1', text: 'only' }]);
  assert.throws(() => store.patchEpic('WEB-1', { waiting: [{ id: 'cl', checklist: [{ text: 'no id' }] }] }), { status: 400, code: 'bad-checklist' });
});

test('done checks the checklist under the lock it writes with', () => {
  const calls = [];
  const { epic } = store.patchEpic('WEB-1', { goal: 'x' }, { check: (e) => calls.push(e.goal) });
  assert.equal(epic.goal, 'x');
  assert.deepEqual(calls, ['x']);
  assert.throws(() => store.patchEpic('WEB-1', { goal: 'y' }, { check: () => { throw Object.assign(new Error('no'), { status: 400 }); } }), { status: 400 });
  assert.equal(store.readEpic('WEB-1').goal, 'x');
});
