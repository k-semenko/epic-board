import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');
store.createEpic({ id: 'decisions', title: 'Decisions' });
const get = (id) => store.readEpic('decisions').waiting.find((w) => w.id === id);
const add = (id, fields = {}) => {
  store.patchEpic('decisions', { waiting: [{ id, title: 'Choose', ...fields }] });
  return get(id);
};
const submit = (id, fields = {}) => store.submitWaiting('decisions', id, { version: get(id).version, submissionId: `${id}-answer`, confirmed: true, ...fields });

test('new requests default to open confirmation with a version', () => {
  const w = add('default');
  assert.deepEqual(w.input, { type: 'confirm' });
  assert.equal(w.status, 'open');
  assert.equal(w.revision, 1);
  assert.equal(typeof w.version, 'string');
  assert.deepEqual(w.rounds, []);
});

test('human submission stays unresolved; closing a stale or empty-outcome answer is refused', () => {
  const initial = add('cycle', { checklist: [{ id: 'c1', text: 'Checked' }] });
  assert.throws(() => submit('cycle'), { code: 'checklist' });
  assert.throws(() => submit('cycle', { checked: ['c1'], confirmed: false }), { status: 400 });
  submit('cycle', { checked: ['c1'], comment: '  Approved  ' });
  let w = get('cycle');
  assert.equal(w.status, 'answered');
  assert.equal(w.doneAt, undefined);
  assert.notEqual(w.version, initial.version);
  assert.equal(w.rounds[0].response.comment, 'Approved');
  assert.equal(w.rounds[0].request.title, 'Choose');
  assert.throws(() => store.resolveWaiting('decisions', 'cycle', { version: initial.version, submissionId: 'cycle-answer', resolution: 'Applied' }), { status: 409 });
  assert.throws(() => store.resolveWaiting('decisions', 'cycle', { version: w.version, submissionId: 'cycle-answer', resolution: ' ' }), { status: 400 });
  store.resolveWaiting('decisions', 'cycle', { version: w.version, submissionId: 'cycle-answer', resolution: 'Applied to the plan' });
  w = get('cycle');
  assert.equal(w.status, 'closed');
  assert.ok(w.doneAt);
  assert.equal(w.rounds[0].review.outcome, 'accepted');
});

test('the agent closes an open request with an outcome and no human answer', () => {
  add('chat');
  store.resolveWaiting('decisions', 'chat', { resolution: 'Agreed in chat: hub 8006' });
  const w = get('chat');
  assert.equal(w.status, 'closed');
  assert.equal(w.resolution, 'Agreed in chat: hub 8006');
  assert.ok(w.doneAt);
  assert.deepEqual(w.rounds, []);
  assert.equal(w.checked, undefined);
});

test('resolve without version or submission id closes the current answer', () => {
  add('loose', { checklist: [{ id: 'c1', text: 'ok' }] });
  submit('loose', { checked: ['c1'] });
  store.resolveWaiting('decisions', 'loose', { resolution: 'done' });
  const w = get('loose');
  assert.equal(w.rounds.at(-1).review.outcome, 'accepted');
  assert.deepEqual(w.checked, ['c1']);
});

test('resolve still checks a given version and submission id, and needs an outcome', () => {
  add('strict');
  submit('strict');
  assert.throws(() => store.resolveWaiting('decisions', 'strict', { resolution: 'x', version: 'stale' }), { code: 'waiting-changed' });
  assert.throws(() => store.resolveWaiting('decisions', 'strict', { resolution: 'x', submissionId: 'other' }), { code: 'waiting-state' });
  assert.throws(() => store.resolveWaiting('decisions', 'strict', { resolution: '  ' }), { status: 400 });
  store.resolveWaiting('decisions', 'strict', { resolution: 'x' });
  assert.throws(() => store.resolveWaiting('decisions', 'strict', { resolution: 'y' }), { code: 'waiting-state' });
});

test('choice formats validate cardinality, IDs and all required checklist items', () => {
  const options = [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }];
  add('single', { input: { type: 'single', options } });
  for (const selected of [[], ['a', 'b'], ['missing'], ['a', 'a'], 'a']) assert.throws(() => submit('single', { selected }), { status: 400 });
  submit('single', { selected: ['b'] });
  assert.deepEqual(get('single').rounds[0].response.selected, ['b']);
  add('multi', { input: { type: 'multi', options }, checklist: [{ id: 'legal', text: 'Legal checked' }] });
  assert.throws(() => submit('multi', { selected: ['a'], checked: ['other'] }), { status: 400 });
  assert.throws(() => submit('multi', { selected: [], checked: ['legal'] }), { status: 400 });
  submit('multi', { selected: ['b', 'a'], checked: ['legal'] });
  assert.deepEqual(get('multi').rounds[0].response.selected, ['a', 'b']);
  for (const input of [{ type: 'wat' }, { type: 'single', options: [options[0]] }, { type: 'multi', options: [options[0], options[0]] }]) assert.throws(() => add('bad-input', { input }), { status: 400 });
});

test('clarification records only the comment and still waits for the agent', () => {
  add('ask', { checklist: [{ id: 'c1', text: 'Checked' }], input: { type: 'single', options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }] } });
  const version = get('ask').version;
  assert.throws(() => store.clarifyWaiting('decisions', 'ask', { version, submissionId: 'ask-1', comment: '  ' }), { code: 'comment' });
  store.clarifyWaiting('decisions', 'ask', { version, submissionId: 'ask-1', comment: '  What changed?  ' });
  const answered = get('ask');
  assert.equal(answered.status, 'answered');
  assert.equal(answered.revision, 1);
  assert.equal(answered.rounds[0].response.clarification, true);
  assert.equal(answered.rounds[0].response.confirmed, false);
  assert.deepEqual(answered.rounds[0].response.checked, []);
  assert.deepEqual(answered.rounds[0].response.selected, []);
  assert.equal(answered.rounds[0].response.comment, 'What changed?');
  const history = store.readHistory('decisions', { limit: 500 }).length;
  store.clarifyWaiting('decisions', 'ask', { version, submissionId: 'ask-1', comment: 'What changed?' });
  assert.equal(store.readHistory('decisions', { limit: 500 }).length, history);
  assert.equal(get('ask').version, answered.version);
  assert.throws(() => store.clarifyWaiting('decisions', 'ask', { version, submissionId: 'ask-1', comment: 'Different' }), { status: 409, code: 'submission-conflict' });
  assert.throws(() => store.submitWaiting('decisions', 'ask', { version: answered.version, submissionId: 'ask-2', confirmed: true, selected: ['a'], checked: ['c1'] }), { status: 409 });
});

test('return preserves answered prompt/labels, advances revision and rejects competing review', () => {
  add('return', { input: { type: 'single', options: [{ id: 'a', text: 'Old Alpha' }, { id: 'b', text: 'Beta' }] } });
  submit('return', { selected: ['a'] });
  const answered = get('return');
  store.reviseWaiting('decisions', 'return', { version: answered.version, reason: 'Please clarify', patch: { title: 'Choose again', input: { type: 'single', options: [{ id: 'a', text: 'New Alpha' }, { id: 'b', text: 'Beta' }] } } });
  const revised = get('return');
  assert.equal(revised.status, 'open');
  assert.equal(revised.revision, 2);
  assert.equal(revised.revisionReason, 'Please clarify');
  assert.equal(revised.rounds[0].request.input.options[0].text, 'Old Alpha');
  assert.equal(revised.rounds[0].review.outcome, 'revised');
  assert.throws(() => store.resolveWaiting('decisions', 'return', { version: answered.version, submissionId: 'return-answer', resolution: 'ok' }), { status: 409 });
  assert.throws(() => store.submitWaiting('decisions', 'return', { version: answered.version, submissionId: 'new-answer', selected: ['b'] }), { status: 409 });
});

test('lost-response replay is idempotent before and after revision and closure', () => {
  const initial = add('retry');
  const body = { version: initial.version, submissionId: 'retry-id', confirmed: true, comment: 'Yes' };
  store.submitWaiting('decisions', 'retry', body);
  const answered = get('retry');
  const history = store.readHistory('decisions', { limit: 500 }).length;
  store.submitWaiting('decisions', 'retry', body);
  assert.equal(store.readHistory('decisions', { limit: 500 }).length, history);
  assert.throws(() => store.submitWaiting('decisions', 'retry', { ...body, comment: 'Changed' }), { status: 409 });
  assert.throws(() => store.submitWaiting('decisions', 'retry', { ...body, confirmed: false }), { status: 409, code: 'submission-conflict' });
  assert.throws(() => store.submitWaiting('decisions', 'retry', { ...body, selected: ['unknown'] }), { status: 409, code: 'submission-conflict' });
  store.resolveWaiting('decisions', 'retry', { version: answered.version, submissionId: 'retry-id', resolution: 'Recorded' });
  store.submitWaiting('decisions', 'retry', body);
  assert.equal(get('retry').status, 'closed');
  store.reviseWaiting('decisions', 'retry', { version: get('retry').version, reason: 'New information' });
  store.submitWaiting('decisions', 'retry', body);
  assert.equal(get('retry').status, 'open');
  assert.equal(get('retry').rounds[0].review.outcome, 'accepted');
});

test('public PATCH cannot fabricate state, edit request, remove or null waiting', () => {
  add('protected');
  for (const patch of [{ waiting: null }, { waiting: {} }, { waiting: [{ id: 'protected', doneAt: 'now' }] }, { waiting: [{ id: 'protected', title: 'Changed' }] }, { waiting: [{ id: 'protected', $delete: true }] }, { waiting: [{ id: 'forged', title: 'Forged', status: 'closed' }] }, { waiting: [{ id: 'protected', rounds: [] }] }]) assert.throws(() => store.patchEpic('decisions', patch), { status: 400 });
  assert.equal(get('protected').status, 'open');
});

test('checklist ids and labels must be usable by the submitted form', () => {
  for (const checklist of [[{ id: 42, text: 'Checked' }], [{ id: 'check', text: 42 }]]) assert.throws(() => add('bad-checklist', { checklist }), { status: 400, code: 'bad-checklist' });
});

test('concurrent submissions and competing agent reviews each have one winner', async () => {
  const run = promisify(execFile);
  const initial = add('race');
  const invoke = async (action, body) => {
    const script = `import * as store from ${JSON.stringify(new URL('../server/store.mjs', import.meta.url).href)}; try { store[process.argv[1]]('decisions','race',JSON.parse(process.argv[2])); console.log(200); } catch(e) { console.log(e.status); }`;
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script, action, JSON.stringify(body)]);
    return Number(stdout.trim());
  };
  const results = await Promise.all(['a', 'b'].map((submissionId) => invoke('submitWaiting', { version: initial.version, submissionId, confirmed: true })));
  assert.deepEqual(results.sort(), [200, 409]);
  const answered = get('race');
  assert.equal(answered.rounds.length, 1);
  const competing = await Promise.all([
    invoke('resolveWaiting', { version: answered.version, submissionId: answered.rounds[0].response.submissionId, resolution: 'Applied' }),
    invoke('reviseWaiting', { version: answered.version, reason: 'Clarify' }),
  ]);
  assert.deepEqual(competing.sort(), [200, 409]);
  assert.equal(get('race').rounds.length, 1);
  assert.ok(get('race').rounds[0].review);
});

test('deleted and recreated IDs reject the previous form', () => {
  const previous = add('reuse');
  store.removeWaiting('decisions', 'reuse', { version: previous.version });
  const next = add('reuse');
  assert.notEqual(next.version, previous.version);
  assert.throws(() => store.submitWaiting('decisions', 'reuse', { version: previous.version, submissionId: 'old-tab', confirmed: true }), { status: 409 });
  submit('reuse');
  assert.throws(() => store.removeWaiting('decisions', 'reuse', { version: get('reuse').version }), { status: 409 });
});

test('schema 2 migration is stable across reads and preserves legacy closure after reopening', () => {
  const old = { schema: 2, id: 'legacy', title: 'Legacy', repos: {}, tasks: [], waiting: [{ id: 'old', title: 'Previously closed', doneAt: '2026-10-01T10:00:00Z', resolution: 'Old outcome', checked: ['c1'] }] };
  writeFileSync(store.epicPath('legacy'), JSON.stringify(old));
  const first = store.readEpic('legacy');
  const second = store.readEpic('legacy');
  assert.equal(first.schema, 3);
  assert.equal(first.waiting[0].version, second.waiting[0].version);
  assert.equal(first.waiting[0].status, 'closed');
  assert.deepEqual(first.waiting[0].rounds, []);
  store.reviseWaiting('legacy', 'old', { version: first.waiting[0].version, reason: 'Reconsider' });
  const revised = store.readEpic('legacy').waiting[0];
  assert.equal(revised.doneAt, undefined);
  assert.equal(revised.legacyClosure.resolution, 'Old outcome');
  assert.equal(revised.rounds.length, 0);
});

test('legacy request and checklist IDs remain usable after schema migration', () => {
  const old = { schema: 2, id: 'legacy-ids', title: 'Legacy', repos: {}, tasks: [], waiting: [{ id: 'approval request', title: 'Review', checklist: [{ id: 'legal review', text: 'Legal checked' }] }] };
  writeFileSync(store.epicPath(old.id), JSON.stringify(old));
  store.patchEpic(old.id, { goal: 'Still editable' });
  const item = store.readEpic(old.id).waiting[0];
  const epic = store.submitWaiting(old.id, item.id, { version: item.version, submissionId: 'legacy-answer', confirmed: true, checked: ['legal review'] });
  assert.equal(epic.waiting[0].status, 'answered');
  assert.deepEqual(epic.waiting[0].rounds[0].response.checked, ['legal review']);
});
