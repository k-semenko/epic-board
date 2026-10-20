import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpHome } from './helpers.mjs';

const home = tmpHome();
after(() => rmSync(home, { recursive: true, force: true }));
const store = await import('../server/store.mjs');
const docs = await import('../server/docs.mjs');

const make = (id) => {
  store.createEpic({ id, title: id });
  store.patchEpic(id, { tasks: [{ id: 'T1', title: 'Task' }], waiting: [{ id: 'open', title: 'Open' }, { id: 'ans', title: 'Answered' }] });
  const ans = store.readEpic(id).waiting.find((w) => w.id === 'ans');
  store.submitWaiting(id, 'ans', { version: ans.version, submissionId: 's1', confirmed: true });
};

test('archiving stores the summary and closes every unresolved request', () => {
  make('a');
  const epic = store.archiveEpic('a', { summary: 'Shipped' });
  assert.equal(epic.archived.summary, 'Shipped');
  assert.equal(epic.archived.by, 'cli');
  assert.ok(epic.archived.at);
  for (const w of store.readEpic('a').waiting) {
    assert.equal(w.status, 'closed');
    assert.equal(w.resolution, 'Shipped');
    assert.ok(w.doneAt);
  }
  assert.ok(store.readHistory('a', { limit: 50 }).some((e) => e.path === 'archived'));
  assert.equal(store.isArchived(store.readEpic('a')), true);
});

test('an archived epic refuses every write', () => {
  make('b');
  const doc = docs.newDoc('b', { kind: 'note', title: 'Note' });
  const { mtimeMs } = docs.readDoc('b', doc.id);
  store.archiveEpic('b', { summary: 'Done' });
  const file = store.epicPath('b');
  const before = readFileSync(file, 'utf8');
  const refused = { status: 409, code: 'epic-archived' };
  assert.throws(() => store.patchEpic('b', { title: 'x' }), refused);
  assert.throws(() => store.deleteTask('b', 'T1'), refused);
  assert.throws(() => store.resolveWaiting('b', 'open', { resolution: 'x' }), refused);
  assert.throws(() => store.writeFacts('b', {}), refused);
  assert.throws(() => docs.writeDoc('b', doc.id, 'new', mtimeMs), refused);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('archive twice and reopen a live epic are refused', () => {
  make('c');
  assert.throws(() => store.reopenEpic('c'), { status: 409, code: 'epic-live' });
  store.archiveEpic('c', { summary: 'Done' });
  assert.throws(() => store.archiveEpic('c', { summary: 'Again' }), { status: 409, code: 'epic-archived' });
});

test('reopen removes the flag, keeps closed requests closed and records why', () => {
  make('d');
  store.archiveEpic('d', { summary: 'Done' });
  const epic = store.reopenEpic('d', { why: 'one more fix' });
  assert.equal(epic.archived, undefined);
  assert.ok(epic.waiting.every((w) => w.status === 'closed'));
  const event = store.readHistory('d', { limit: 50 }).find((e) => e.path === 'archived' && e.op === 'remove');
  assert.equal(event.why, 'one more fix');
  store.patchEpic('d', { title: 'writable again' });
});

test('the archived field cannot be patched directly', () => {
  make('e');
  assert.throws(() => store.patchEpic('e', { archived: { at: 'x', by: 'cli', summary: 's' } }), { code: 'immutable' });
  assert.throws(() => store.patchEpic('e', { archived: null }), { code: 'immutable' });
});

test('summary must be a non-empty string', () => {
  make('f');
  for (const summary of ['', '   ', undefined]) assert.throws(() => store.archiveEpic('f', { summary }), { status: 400 });
  assert.equal(store.readEpic('f').archived, undefined);
});
