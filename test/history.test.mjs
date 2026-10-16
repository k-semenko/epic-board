import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEvent } from '../server/page/history.mjs';
import { setLang, t, DICT } from '../server/page/i18n.mjs';

setLang('en', { persist: false });

test('step state change reads as task, step, field and both values', () => {
  const d = describeEvent({ op: 'set', path: 'tasks[WEB-8].steps[s3].state', before: 'todo', after: 'active', by: 'cli' });
  assert.deepEqual(d, { where: 'WEB-8 · step s3', what: 'state', change: 'set', before: 'ahead', after: 'we are here' });
});

test('added step shows its title', () => {
  const d = describeEvent({ op: 'add', path: 'tasks[WEB-8].steps[s4]', before: null, after: { id: 's4', title: 'Error states', state: 'todo' } });
  assert.deepEqual(d, { where: 'WEB-8 · step s4', what: 'step added', change: 'add', before: null, after: 'Error states' });
});

test('refresh facts read as branch and field', () => {
  const d = describeEvent({ op: 'refresh', path: 'facts.web:feat/x.head', before: 'abc', after: 'def' });
  assert.deepEqual(d, { where: 'web:feat/x', what: 'head', change: 'set', before: 'abc', after: 'def' });
  assert.equal(describeEvent({ op: 'refresh', path: 'facts.web:feat/x.mr.pipeline', before: 'running', after: 'success' }).what, 'MR pipeline');
});

test('pending items, decisions, sessions, epic creation', () => {
  assert.deepEqual(describeEvent({ op: 'add', path: 'waiting[mig]', after: { id: 'mig', title: 'Migrate staging' } }), { where: 'needs decision', what: 'item added', change: 'add', before: null, after: 'Migrate staging' });
  assert.equal(describeEvent({ op: 'set', path: 'waiting[mig].doneAt', before: null, after: '2026-10-16T10:00:00Z' }).what, 'done');
  assert.equal(describeEvent({ op: 'set', path: 'waiting[mig].resolution', before: null, after: 'ok' }).what, 'resolution');
  assert.equal(describeEvent({ op: 'add', path: 'decisions[d1]', after: { text: 'Cards first' } }).after, 'Cards first');
  assert.equal(describeEvent({ op: 'set', path: 'sessions[39493328-a9af].doing', before: 'a', after: 'b' }).where, 'session 39493328');
  assert.deepEqual(describeEvent({ op: 'add', path: 'epic', after: { title: 'Checkout' } }), { where: 'epic', what: 'created', change: 'add', before: null, after: 'Checkout' });
});

test('old schema field names still read', () => {
  assert.equal(describeEvent({ op: 'set', path: 'tasks[1].stage', before: 'a', after: 'b' }).what, 'status');
});

test('unknown paths stay readable and long values are cut', () => {
  const d = describeEvent({ op: 'set', path: 'repos.web.base', before: 'main', after: 'x'.repeat(200) });
  assert.equal(d.where, 'repo web');
  assert.equal(d.what, 'base');
  assert.ok(d.after.length <= 81);
  assert.equal(describeEvent({ op: 'remove', path: 'tasks[1].open[o1]', before: { text: 'Rebase' } }).before, 'Rebase');
});

test('timestamps, arrays and session objects read like text, not JSON', () => {
  assert.match(describeEvent({ op: 'set', path: 'waiting[x].doneAt', before: null, after: '2026-10-16T06:53:26.791Z' }).after, /^\d{2}\.\d{2} \d{2}:\d{2}$/);
  assert.equal(describeEvent({ op: 'set', path: 'mergeOrder', before: [], after: [{ id: 'm1', text: 'Release' }, { id: 'm2', text: 'web' }] }).after, 'Release, web');
  assert.equal(describeEvent({ op: 'set', path: 'mergeOrder', before: [], after: [] }).before, '—');
  const s = describeEvent({ op: 'add', path: 'sessions[codex-1]', after: { id: 'codex-1', agent: 'codex', task: 'API-7', doing: 'Check' } });
  assert.equal(s.after, 'codex · API-7 · Check');
});

test('russian reads the same events', () => {
  setLang('ru', { persist: false });
  try {
    assert.equal(describeEvent({ op: 'set', path: 'tasks[A].steps[s].state', before: 'todo', after: 'done' }).after, 'готово');
    assert.equal(describeEvent({ op: 'add', path: 'waiting[x]', after: { title: 'X' } }).where, 'ждёт решения');
    assert.equal(t('ago', { t: '5 мин' }), '5 мин назад');
  } finally {
    setLang('en', { persist: false });
  }
});

test('both dictionaries have the same keys', () => {
  assert.deepEqual(Object.keys(DICT.ru).sort(), Object.keys(DICT.en).sort());
});

test('decision lifecycle events describe human answers, agent review and new revisions', () => {
  assert.deepEqual(describeEvent({ op: 'set', path: 'waiting[q].status', before: 'open', after: 'answered' }), { where: 'needs decision', what: 'stage', change: 'set', before: 'Waiting for you', after: 'Waiting for agent' });
  const round = { revision: 1, request: { title: 'Choose storage', input: { type: 'single', options: [{ id: 'repo', text: 'Repository' }] } }, response: { selected: ['repo'], comment: 'Keep history' } };
  const submitted = describeEvent({ op: 'set', path: 'waiting[q].rounds', before: [], after: [round] });
  assert.equal(submitted.what, 'answer submitted');
  assert.equal(submitted.after, 'Choose storage · Repository · Keep history');
  const reviewed = describeEvent({ op: 'set', path: 'waiting[q].rounds', before: [round], after: [{ ...round, review: { outcome: 'accepted', text: 'Recorded in plan' } }] });
  assert.equal(reviewed.what, 'agent reviewed');
  assert.equal(reviewed.after, 'Recorded in plan');
  assert.equal(describeEvent({ op: 'set', path: 'waiting[q].revision', before: 1, after: 2 }).what, 'question revision');
});

test('history preserves choice labels when a choice response also contains confirmed true', () => {
  const event = describeEvent({ op: 'set', path: 'waiting[q].rounds', before: [], after: [{ request: { title: 'Storage', input: { type: 'single', options: [{ id: 'repo', text: 'Repository' }] } }, response: { selected: ['repo'], confirmed: true } }] });
  assert.equal(event.after, 'Storage · Repository');
});
