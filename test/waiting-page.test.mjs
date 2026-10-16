import test from 'node:test';
import assert from 'node:assert/strict';
import * as waiting from '../server/page/waiting.mjs';
import { setLang } from '../server/page/i18n.mjs';

setLang('en', { persist: false });
const question = (extra = {}) => ({ id: 'q', title: 'Choose storage', kind: 'decision', revision: 1, version: 'v1', status: 'open', input: { type: 'confirm' }, rounds: [], ...extra });
const choice = { type: 'single', options: [{ id: 'repo', text: 'Repository', recommended: true, hint: 'Tracked' }, { id: 'board', text: 'Board' }] };
const round = { revision: 1, version: 'v1', request: { title: 'Original question', input: choice, checklist: [{ id: 'c', text: 'Original prerequisite' }] }, response: { submissionId: 's', at: '2026-10-16T12:00:00Z', by: 'human', selected: ['repo'], checked: ['c'], comment: 'Keep history' }, review: { outcome: 'accepted', at: '2026-10-16T12:01:00Z', by: 'agent', text: 'Recorded in plan' } };

test('renders native choice controls without selecting a recommendation and keeps checklist separate', () => {
  const html = waiting.renderWaitingCard(question({ input: choice, checklist: [{ id: 'c', text: 'Read plan' }] }));
  assert.match(html, /<fieldset[^>]*>[\s\S]*<legend>Choose one option<\/legend>/);
  assert.equal((html.match(/type="radio"/g) || []).length, 2);
  assert.match(html, /name="checked"[^>]*value="c"/);
  assert.doesNotMatch(html, / checked/);
  assert.match(html, /Recommended/);
  assert.match(html, /name="comment"/);
  assert.match(html, /type="submit"/);
  const multi = waiting.renderWaitingCard(question({ input: { ...choice, type: 'multi' } }));
  assert.equal((multi.match(/name="selected"/g) || []).length, 2);
  assert.equal((multi.match(/type="checkbox"/g) || []).length, 2);
  assert.doesNotMatch(waiting.renderWaitingCard(question()), /name="selected"/);
});

test('saved responses and agent outcomes render immutable option labels and manual handoff', () => {
  const answered = waiting.renderWaitingCard(question({ input: { ...choice, options: [] }, status: 'answered', rounds: [{ ...round, review: undefined }] }));
  assert.match(answered, /Repository/);
  assert.match(answered, /Keep history/);
  assert.match(answered, /Write to the agent in chat/);
  assert.doesNotMatch(answered, /<form|type="submit"/);
  const closed = waiting.renderWaitingCard(question({ status: 'closed', doneAt: '2026-10-16T12:01:00Z', rounds: [round], resolution: 'Recorded in plan' }));
  assert.match(closed, /Recorded in plan/);
  assert.match(closed, /Closed/);
  assert.doesNotMatch(closed, /<form|data-undo/);
});

test('revision history preserves previous question, prerequisites, answer and legacy closure', () => {
  const html = waiting.renderWaitingCard(question({ revision: 2, version: 'v2', revisionReason: 'Clarify migration', rounds: [round], legacyClosure: { doneAt: '2026-10-15T12:00:00Z', resolution: 'Earlier outcome', request: { title: 'Legacy question', input: { type: 'confirm' } } } }));
  for (const text of ['Clarify migration', 'Original question', 'Original prerequisite', 'Repository', 'Recorded in plan', 'Closed before update', 'Earlier outcome', 'Legacy question']) assert.ok(html.includes(text), text);
  const legacy = waiting.renderWaitingCard(question({ status: 'closed', legacyClosure: { doneAt: '2026-10-15T12:00:00Z', resolution: 'Earlier outcome', request: { title: 'Old question' } } }));
  assert.doesNotMatch(legacy, /Your answer|Confirmed/);
});

test('export has no response controls while preserving all question options', () => {
  const html = waiting.renderWaitingCard(question({ input: choice }), { readOnly: true });
  assert.match(html, /Repository/);
  assert.match(html, /Board/);
  assert.doesNotMatch(html, /<form|<input|<textarea|type="submit"/);
});

test('drafts survive polling, localization and storage reload without changing their question version', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  const drafts = new waiting.DecisionDrafts('epic', storage);
  drafts.update(question({ input: choice }), { selected: ['repo'], checked: [], comment: 'Draft' });
  setLang('ru', { persist: false });
  const restored = new waiting.DecisionDrafts('epic', storage);
  const draft = restored.get(question({ input: choice, version: 'v2', revision: 2 }));
  assert.equal(draft.version, 'v1');
  assert.equal(draft.comment, 'Draft');
  assert.deepEqual(draft.selected, ['repo']);
  const html = waiting.renderWaitingCard(question({ input: choice, version: 'v2', revision: 2 }), { draft });
  assert.match(html, /Draft/);
  assert.match(html, /data-wait-refresh/);
  assert.match(html, /disabled/);
  setLang('en', { persist: false });
  assert.throws(() => restored.prepare(question({ version: 'v2' })), /changed/i);
  const fresh = restored.refresh(question({ version: 'v2', revision: 2 }));
  assert.equal(fresh.comment, '');
  assert.deepEqual(fresh.selected, []);
  assert.equal(fresh.previous[0].comment, 'Draft');
  assert.equal(fresh.previous[0].request.title, 'Choose storage');
});

test('submission validates choice and checklist, retains payload for retry, clears only its revision', () => {
  const drafts = new waiting.DecisionDrafts('epic', null);
  const item = question({ input: choice, checklist: [{ id: 'c', text: 'Read plan' }] });
  assert.throws(() => drafts.prepare(item), /one option/i);
  drafts.update(item, { selected: ['repo'], checked: [], comment: 'Accepted' });
  assert.throws(() => drafts.prepare(item), /prerequisite/i);
  drafts.update(item, { selected: ['repo'], checked: ['c'], comment: 'Accepted' });
  const payload = drafts.prepare(item);
  assert.deepEqual({ ...payload, submissionId: 'id' }, { version: 'v1', submissionId: 'id', confirmed: false, selected: ['repo'], checked: ['c'], comment: 'Accepted' });
  assert.deepEqual(drafts.prepare(item), payload);
  drafts.complete('q', 'different-version');
  assert.equal(drafts.get(item).comment, 'Accepted');
  drafts.complete('q', 'v1');
  assert.equal(drafts.get(item).comment, '');
  assert.equal(drafts.prepare(question({ id: 'confirm' })).confirmed, true);
});

test('search and counts include pending agent answers, historical choices and outcomes', () => {
  assert.deepEqual(waiting.waitingCounts([question(), question({ status: 'answered' }), question({ status: 'closed' })]), { open: 1, answered: 1, closed: 1 });
  const text = waiting.waitingSearchText(question({ rounds: [round] }));
  for (const value of ['Repository', 'Original question', 'Keep history', 'Recorded in plan']) assert.ok(text.includes(value));
});

test('a failed transport preserves a retry identity and a pending submission suppresses another click', async () => {
  const drafts = new waiting.DecisionDrafts('epic', null);
  const item = question();
  drafts.update(item, { selected: [], checked: [], comment: 'Keep me' });
  let firstPayload;
  await assert.rejects(drafts.submit(item, async (payload) => { firstPayload = payload; throw new Error('Offline'); }), /Offline/);
  assert.equal(drafts.get(item).comment, 'Keep me');
  assert.equal(drafts.get(item).error, 'Offline');
  let release;
  const pending = drafts.submit(item, (payload) => {
    assert.deepEqual(payload, firstPayload);
    return new Promise((resolve) => { release = resolve; });
  });
  let duplicateSent = false;
  assert.equal(await drafts.submit(item, async () => { duplicateSent = true; }), null);
  assert.equal(duplicateSent, false);
  release({ waiting: [{ ...item, status: 'answered' }] });
  assert.equal((await pending).waiting[0].status, 'answered');
  assert.equal(drafts.peek('q'), undefined);
});

test('choice responses display selected labels even when the optional confirmed flag is true', () => {
  for (const type of ['single', 'multi']) {
    const request = { title: 'Storage', input: { ...choice, type } };
    const html = waiting.renderWaitingCard(question({ status: 'answered', input: request.input, rounds: [{ ...round, request, response: { ...round.response, confirmed: true } }] }));
    assert.match(html, /<li>Repository<\/li>/);
    assert.doesNotMatch(html, /<p>Confirmed<\/p>/);
  }
});

test('restricted session storage falls back to in-memory drafts', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage access denied'); } });
  try {
    const drafts = new waiting.DecisionDrafts('restricted');
    drafts.update(question(), { selected: [], checked: [], comment: 'In memory' });
    assert.equal(drafts.get(question()).comment, 'In memory');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else delete globalThis.sessionStorage;
  }
});

test('all formats prepare stable retry identities without secure-context randomUUID', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const crypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: crypto.getRandomValues.bind(crypto) } });
  try {
    const tokens = [];
    for (const type of ['confirm', 'single', 'multi']) {
      const item = question({ id: type, input: type === 'confirm' ? { type } : { ...choice, type } });
      const drafts = new waiting.DecisionDrafts('nonsecure', null);
      drafts.update(item, { selected: type === 'confirm' ? [] : ['repo'], checked: [], comment: 'HTTP origin' });
      const payload = drafts.prepare(item);
      assert.match(payload.submissionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.deepEqual(drafts.prepare(item), payload);
      tokens.push(payload.submissionId);
    }
    assert.equal(new Set(tokens).size, 3);
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});

test('special valid item IDs keep drafts isolated through editing, submission, reload and refresh', () => {
  const stored = new Map();
  const storage = { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  const drafts = new waiting.DecisionDrafts('special-ids', storage);
  for (const id of ['constructor', 'toString', '__proto__']) {
    const item = question({ id, input: choice });
    const draft = drafts.get(item);
    assert.equal(draft.request?.title, 'Choose storage');
    assert.match(waiting.renderWaitingCard(item, { draft }), /Choose storage/);
    drafts.update(item, { selected: ['repo'], checked: [], comment: `Draft ${id}` });
    assert.deepEqual(drafts.prepare(item).selected, ['repo']);
  }
  const restored = new waiting.DecisionDrafts('special-ids', storage);
  for (const id of ['constructor', 'toString', '__proto__']) {
    const item = question({ id, input: choice });
    assert.equal(restored.get(item).comment, `Draft ${id}`);
    assert.equal(restored.prepare(item).submissionId, drafts.prepare(item).submissionId);
    const revised = { ...item, version: 'v2', revision: 2 };
    const draft = restored.refresh(revised);
    assert.equal(draft.version, 'v2');
    assert.equal(draft.comment, '');
    assert.equal(draft.previous[0].comment, `Draft ${id}`);
    assert.match(waiting.renderWaitingCard(revised, { draft }), new RegExp(`Draft ${id}`));
  }
});

test('malformed stored draft dictionaries fall back to empty in-memory drafts', () => {
  for (const value of ['null', '[]', '42', '"broken"', '{"q":null}']) {
    const drafts = new waiting.DecisionDrafts('malformed', { getItem: () => value });
    assert.equal(drafts.get(question()).request.title, 'Choose storage');
  }
});
