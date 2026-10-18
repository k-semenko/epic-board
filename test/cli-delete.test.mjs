import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from '../server/store.mjs';
import * as docs from '../server/docs.mjs';
import { migrateWaiting } from '../server/waiting.mjs';

function fixture(t, { references = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'eb-cli-delete-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const atHome = (fn) => {
    const previous = process.env.EPIC_BOARD_HOME;
    process.env.EPIC_BOARD_HOME = home;
    try { return fn(); }
    finally {
      if (previous === undefined) delete process.env.EPIC_BOARD_HOME;
      else process.env.EPIC_BOARD_HOME = previous;
    }
  };
  const epicFile = join(home, 'epics', 'shop.json');
  const historyFile = join(home, 'epics', 'shop.history.ndjson');
  const read = () => JSON.parse(readFileSync(epicFile, 'utf8'));
  const history = () => readFileSync(historyFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const snapshot = () => [readFileSync(epicFile, 'utf8'), readFileSync(historyFile, 'utf8')];
  const patch = (body) => atHome(() => store.patchEpic('shop', body));
  const run = (args) => spawnSync(process.execPath, ['cli/epic.mjs', ...args], {
    encoding: 'utf8', env: { ...process.env, EPIC_BOARD_HOME: home },
  });
  const ok = (args) => {
    const result = run(args);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    return result;
  };
  const reject = (args, pattern) => {
    const before = snapshot();
    const result = run(args);
    assert.equal(result.status, 1, `${args.join(' ')} unexpectedly succeeded`);
    if (pattern) assert.match(result.stderr, pattern);
    assert.deepEqual(snapshot(), before, 'rejected deletion changes neither epic nor history');
    return result;
  };
  mkdirSync(join(home, 'repo'), { recursive: true });
  atHome(() => store.createEpic({ id: 'shop', title: 'Deletion fixture' }));
  patch({
    repos: { web: { path: join(home, 'repo'), base: 'main' } },
    tasks: [
      { id: 'TARGET', title: 'Remove this task', steps: [
        { id: 'first', title: 'First', state: 'done' },
        { id: 'second', title: 'Second', after: ['TARGET/first', 'KEEP/stay'] },
      ], branches: [{ repo: 'web', name: 'feat/unique' }, { repo: 'web', name: 'feat/shared' }] },
      { id: 'KEEP', title: 'Keep this task', steps: [
        { id: 'stay', title: 'Stay', state: 'done' },
        { id: 'consumer', title: 'Consumer', after: ['KEEP/stay'] },
      ], branches: [{ repo: 'web', name: 'feat/shared' }] },
    ],
  });
  const files = [];
  if (references) {
    const ownedDir = join(home, 'epics', 'shop', 'docs', 'TARGET', 'first');
    mkdirSync(ownedDir, { recursive: true });
    const owned = join(ownedDir, 'plan.md');
    const linked = join(home, 'repo', 'notes.md');
    writeFileSync(owned, '# Owned plan\nKeep this file.\n');
    writeFileSync(linked, '# Linked notes\nKeep this file too.\n');
    files.push(owned, linked);
    patch({
      tasks: [{ id: 'KEEP', steps: [{ id: 'consumer', after: ['TARGET/first', 'TARGET/second', 'KEEP/stay'] }] }],
      docs: [
        { id: 'doc-step', task: 'TARGET', step: 'first', kind: 'plan', title: 'Step document', path: owned, owned: true },
        { id: 'doc-task', task: 'TARGET', kind: 'note', title: 'Task document', path: linked, owned: false },
        { id: 'doc-keep', task: 'KEEP', step: 'stay', kind: 'note', title: 'Unrelated document', path: linked, owned: false },
      ],
      waiting: [
        { id: 'linked', title: 'Linked request', task: 'TARGET', refs: [
          'task:TARGET', 'step:TARGET/first', 'step:TARGET/second', 'branch:web:feat/unique',
          'branch:web:feat/shared', 'step:KEEP/stay', 'doc:doc-step', 'https://example.com/review',
        ] },
        { id: 'unrelated', title: 'Unrelated request', task: 'KEEP', refs: ['branch:web:feat/shared', 'step:KEEP/stay'] },
      ],
      decisions: [{ id: 'd-target', task: 'TARGET', text: 'Historical decision' }, { id: 'd-keep', task: 'KEEP', text: 'Unrelated decision' }],
      sessions: [{ id: 'session-target', task: 'TARGET', agent: 'codex', doing: 'Review' }, { id: 'session-keep', task: 'KEEP', agent: 'codex', doing: 'Keep working' }],
    });
  }
  return { home, files, atHome, patch, read, history, snapshot, run, ok, reject };
}

const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

function worktreeDocument(f, { task, shared = false, registered = true } = {}) {
  const worktree = join(f.home, 'isolated-worktree');
  mkdirSync(worktree, { recursive: true });
  const file = join(worktree, 'plan.md');
  const text = '# Linked worktree plan\nKeep access to this document.\n';
  writeFileSync(file, text);
  if (registered) f.patch({ tasks: [
    { id: 'TARGET', branches: [{ repo: 'web', name: 'feat/unique', worktree }] },
    ...(shared ? [{ id: 'KEEP', branches: [{ repo: 'web', name: 'feat/shared', worktree }] }] : []),
  ] });
  const doc = { id: 'doc-worktree', kind: 'plan', title: 'Worktree plan', path: file, owned: false, ...(task ? { task } : {}) };
  f.patch({ docs: [doc] });
  return { doc, file, text };
}

function deletionHistory(f, before, why, removalPath) {
  const events = f.history().slice(before);
  assert.ok(events.some((event) => event.op === 'remove' && event.path === removalPath));
  assert.ok(events.every((event) => event.by === 'cli' && event.why === why));
  assert.equal(new Set(events.map((event) => event.at)).size, 1, 'cleanup and deletion share one history transaction');
  return events;
}

test('task --delete removes its subtree and records --why without treating internal dependencies as blockers', (t) => {
  const f = fixture(t);
  const before = f.read();
  const historySize = f.history().length;
  f.ok(['task', 'shop', 'TARGET', '--delete', '--why', 'Move task to its own epic']);
  assert.deepEqual(f.read().tasks, [before.tasks[1]]);
  deletionHistory(f, historySize, 'Move task to its own epic', 'tasks[TARGET]');
});

test('step --delete removes only the named step and records --why', (t) => {
  const f = fixture(t);
  const before = f.read();
  const historySize = f.history().length;
  f.ok(['step', 'shop', 'TARGET/second', '--delete', '--why', 'Stage is obsolete']);
  const expected = structuredClone(before.tasks);
  expected[0].steps.splice(1, 1);
  assert.deepEqual(f.read().tasks, expected);
  deletionHistory(f, historySize, 'Stage is obsolete', 'tasks[TARGET].steps[second]');
});

test('store.deleteStep rejects omitted and empty step IDs without deleting the task or writing history', (t) => {
  const f = fixture(t);
  const before = f.snapshot();
  for (const args of [['shop', 'TARGET'], ['shop', 'TARGET', '']]) {
    assert.throws(() => f.atHome(() => store.deleteStep(...args)), { status: 400, code: 'no-step-id' });
    assert.deepEqual(f.snapshot(), before);
  }
});

test('cleanup preserves explicit empty after when the final dependency is removed', (t) => {
  const f = fixture(t);
  f.patch({ tasks: [{ id: 'TARGET', steps: [{ id: 'second', after: ['TARGET/first'] }] }] });
  f.ok(['step', 'shop', 'TARGET/first', '--delete', '--cleanup-refs']);
  const survivingStep = f.read().tasks[0].steps[0];
  assert.equal(survivingStep.id, 'second');
  assert.ok(Object.hasOwn(survivingStep, 'after'));
  assert.deepEqual(survivingStep.after, []);
});

test('task deletion reports every incoming reference and leaves storage unchanged', (t) => {
  const f = fixture(t, { references: true });
  const result = f.reject(['task', 'shop', 'TARGET', '--delete', '--why', 'Move task'], /--cleanup-refs/);
  for (const path of [
    'tasks[KEEP].steps[consumer].after', 'docs[doc-step].task', 'docs[doc-task].task',
    'waiting[linked].task', 'waiting[linked].refs', 'sessions[session-target].task', 'decisions[d-target].task',
  ]) assert.ok(result.stderr.includes(path), `missing blocker ${path}: ${result.stderr}`);
  for (const ref of ['TARGET/first', 'TARGET/second', 'branch:web:feat/unique']) assert.ok(result.stderr.includes(ref), `missing reference ${ref}`);
  assert.ok(!result.stderr.includes('tasks[TARGET].steps[second].after'), 'dependencies inside the removed task do not block deletion');
  assert.ok(!result.stderr.includes('branch:web:feat/shared'), 'a branch owned by a surviving task remains valid');
});

test('step deletion reports dependent steps, document placement and waiting refs', (t) => {
  const f = fixture(t, { references: true });
  const result = f.reject(['step', 'shop', 'TARGET/first', '--delete'], /--cleanup-refs/);
  for (const path of [
    'tasks[TARGET].steps[second].after', 'tasks[KEEP].steps[consumer].after',
    'docs[doc-step].step', 'waiting[linked].refs',
  ]) assert.ok(result.stderr.includes(path), `missing blocker ${path}: ${result.stderr}`);
  for (const path of ['docs[doc-task]', 'waiting[linked].task', 'sessions[session-target]', 'decisions[d-target]']) {
    assert.ok(!result.stderr.includes(path), `task-scoped object does not block step deletion: ${path}`);
  }
});

test('task --cleanup-refs detaches current links, retains historical decisions and leaves document files intact', (t) => {
  const f = fixture(t, { references: true });
  const before = f.read();
  const contents = f.files.map((file) => readFileSync(file, 'utf8'));
  const historySize = f.history().length;
  f.ok(['task', 'shop', 'TARGET', '--delete', '--cleanup-refs', '--why', 'Move task and detach links']);
  const after = f.read();
  assert.deepEqual(after.tasks.map((task) => task.id), ['KEEP']);
  assert.deepEqual(after.tasks[0].steps[1].after, ['KEEP/stay']);
  assert.deepEqual(after.docs.slice(0, 2), before.docs.slice(0, 2).map((doc) => without(doc, ['task', 'step'])));
  assert.deepEqual(after.docs[2], before.docs[2]);
  assert.deepEqual(after.decisions, before.decisions, 'append-only decisions retain historical task identifiers');
  assert.deepEqual(after.sessions, [without(before.sessions[0], ['task']), before.sessions[1]]);
  assert.deepEqual(after.waiting[0].refs, ['branch:web:feat/shared', 'step:KEEP/stay', 'doc:doc-step', 'https://example.com/review']);
  assert.equal(after.waiting[0].task, undefined);
  assert.notEqual(after.waiting[0].version, before.waiting[0].version);
  assert.deepEqual(without(after.waiting[0], ['task', 'refs', 'version']), without(before.waiting[0], ['task', 'refs', 'version']));
  assert.deepEqual(after.waiting[1], before.waiting[1], 'unrelated requests keep their current version');
  assert.deepEqual(f.files.map((file) => readFileSync(file, 'utf8')), contents);
  assert.ok(f.files.every((file) => existsSync(file)));
  const events = deletionHistory(f, historySize, 'Move task and detach links', 'tasks[TARGET]');
  for (const path of ['tasks[KEEP].steps[consumer].after', 'docs[doc-step].task', 'docs[doc-step].step', 'waiting[linked].refs', 'waiting[linked].task', 'waiting[linked].version', 'sessions[session-target].task']) {
    assert.ok(events.some((event) => event.path === path), `cleanup history lacks ${path}`);
  }
  assert.ok(events.every((event) => !event.path.startsWith('decisions[')));
});

test('step --cleanup-refs preserves its task, other steps and task-scoped links', (t) => {
  const f = fixture(t, { references: true });
  const before = f.read();
  const contents = f.files.map((file) => readFileSync(file, 'utf8'));
  f.ok(['step', 'shop', 'TARGET/first', '--delete', '--cleanup-refs']);
  const after = f.read();
  assert.deepEqual(after.tasks[0].steps, [{ ...before.tasks[0].steps[1], after: ['KEEP/stay'] }]);
  assert.deepEqual(after.tasks[1].steps[1].after, ['TARGET/second', 'KEEP/stay']);
  assert.deepEqual(after.docs[0], without(before.docs[0], ['step']));
  assert.deepEqual(after.docs.slice(1), before.docs.slice(1));
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.decisions, before.decisions);
  assert.equal(after.waiting[0].task, 'TARGET');
  assert.deepEqual(after.waiting[0].refs, before.waiting[0].refs.filter((ref) => ref !== 'step:TARGET/first'));
  assert.notEqual(after.waiting[0].version, before.waiting[0].version);
  assert.deepEqual(without(after.waiting[0], ['refs', 'version']), without(before.waiting[0], ['refs', 'version']));
  assert.deepEqual(after.waiting[1], before.waiting[1]);
  assert.deepEqual(f.files.map((file) => readFileSync(file, 'utf8')), contents);
});

for (const [scope, task] of [['removed-task', 'TARGET'], ['epic', undefined], ['unrelated-task', 'KEEP']]) {
  test(`task deletion refuses loss of actual linked-document access for ${scope} scope even with cleanup`, (t) => {
    const f = fixture(t);
    const { doc, file, text } = worktreeDocument(f, { task });
    assert.equal(f.atHome(() => docs.readDoc('shop', doc.id)).text, text);
    for (const flags of [[], ['--cleanup-refs']]) {
      const result = f.reject(['task', 'shop', 'TARGET', '--delete', ...flags]);
      assert.ok(result.stderr.includes(doc.id), 'access-loss error names the document');
      assert.ok(result.stderr.includes(file), 'access-loss error identifies its linked file');
      assert.match(result.stderr, /import|relink|register/i);
      assert.equal(f.atHome(() => docs.readDoc('shop', doc.id)).text, text);
    }
  });
}

test('task cleanup preserves linked-document access through a surviving task worktree root', (t) => {
  const f = fixture(t);
  const { doc, file, text } = worktreeDocument(f, { task: 'TARGET', shared: true });
  assert.equal(f.atHome(() => docs.readDoc('shop', doc.id)).text, text);
  f.ok(['task', 'shop', 'TARGET', '--delete', '--cleanup-refs']);
  assert.deepEqual(f.read().docs[0], without(doc, ['task']));
  assert.equal(f.atHome(() => docs.readDoc('shop', doc.id)).text, text);
  assert.equal(readFileSync(file, 'utf8'), text);
});

test('an already inaccessible linked document does not block unrelated task deletion', (t) => {
  const f = fixture(t);
  const { doc, file, text } = worktreeDocument(f, { task: 'KEEP', registered: false });
  assert.throws(() => f.atHome(() => docs.readDoc('shop', doc.id)), { status: 403, code: 'outside' });
  f.ok(['task', 'shop', 'TARGET', '--delete']);
  assert.deepEqual(f.read().docs[0], doc);
  assert.throws(() => f.atHome(() => docs.readDoc('shop', doc.id)), { status: 403, code: 'outside' });
  assert.equal(readFileSync(file, 'utf8'), text);
});

test('task deletion detaches orphan merge-order branch links and preserves rows and shared branches', (t) => {
  const f = fixture(t);
  const mergeOrder = [
    { id: 'unique', text: 'Merge the removed task branch', branch: 'web:feat/unique' },
    { id: 'shared', text: 'Merge the shared branch', branch: 'web:feat/shared' },
    { id: 'manual', text: 'Perform a manual release check' },
  ];
  f.patch({ mergeOrder });
  const result = f.reject(['task', 'shop', 'TARGET', '--delete'], /--cleanup-refs/);
  assert.match(result.stderr, /mergeOrder\[/);
  assert.ok(result.stderr.includes('web:feat/unique'));
  assert.ok(!result.stderr.includes('web:feat/shared'));
  f.ok(['task', 'shop', 'TARGET', '--delete', '--cleanup-refs']);
  assert.deepEqual(f.read().mergeOrder, [without(mergeOrder[0], ['branch']), ...mergeOrder.slice(1)]);
});

test('deletion recognizes stored waiting step aliases accepted by the existing reference parser', (t) => {
  const f = fixture(t);
  f.patch({ waiting: [{ id: 'legacy-ref', title: 'Check step', refs: ['step:TARGET/second/extra', 'step:KEEP/stay/extra'] }] });
  const before = f.read().waiting[0];
  const result = f.reject(['step', 'shop', 'TARGET/second', '--delete'], /--cleanup-refs/);
  assert.ok(result.stderr.includes('waiting[legacy-ref].refs'));
  assert.ok(result.stderr.includes('step:TARGET/second/extra'));
  f.ok(['step', 'shop', 'TARGET/second', '--delete', '--cleanup-refs']);
  const after = f.read().waiting[0];
  assert.deepEqual(after.refs, ['step:KEEP/stay/extra']);
  assert.notEqual(after.version, before.version);
  assert.deepEqual(without(after, ['refs', 'version']), without(before, ['refs', 'version']));
});

test('a historical decision alone requires explicit cleanup consent and remains unchanged', (t) => {
  const f = fixture(t);
  f.patch({ decisions: [{ id: 'history', task: 'TARGET', text: 'Record the earlier choice' }] });
  const before = f.read().decisions;
  const result = f.reject(['task', 'shop', 'TARGET', '--delete']);
  assert.ok(result.stderr.includes('decisions[history].task'));
  assert.match(result.stderr, /append-only|histor/i);
  f.ok(['task', 'shop', 'TARGET', '--delete', '--cleanup-refs']);
  assert.deepEqual(f.read().decisions, before);
});

for (const state of ['answered', 'closed', 'revised', 'legacy']) {
  test(`reference cleanup preserves ${state} waiting lifecycle and immutable request history`, (t) => {
    const f = fixture(t, { references: true });
    f.atHome(() => {
      let item = store.readEpic('shop').waiting[0];
      if (state === 'legacy') {
        item = migrateWaiting({ id: item.id, title: item.title, task: item.task, refs: item.refs, doneAt: '2026-01-01T12:00:00Z', resolution: 'Earlier outcome' }, 'shop');
        const epic = store.readEpic('shop');
        epic.waiting[0] = item;
        store.saveEpic(epic);
      } else {
        store.submitWaiting('shop', item.id, { version: item.version, submissionId: 'answer-1', confirmed: true, comment: 'Reviewed' });
        item = store.readEpic('shop').waiting[0];
        if (state === 'closed') store.resolveWaiting('shop', item.id, { version: item.version, submissionId: 'answer-1', resolution: 'Accepted' });
        if (state === 'revised') store.reviseWaiting('shop', item.id, { version: item.version, reason: 'Updated requirement' });
      }
    });
    const before = f.read().waiting[0];
    f.ok(['task', 'shop', 'TARGET', '--delete', '--cleanup-refs']);
    const after = f.read().waiting[0];
    assert.notEqual(after.version, before.version);
    assert.deepEqual(without(after, ['task', 'refs', 'version']), without(before, ['task', 'refs', 'version']));
    assert.deepEqual(after.rounds, before.rounds);
    assert.deepEqual(after.legacyClosure, before.legacyClosure);
  });
}

test('a waiting form opened before reference cleanup rejects stale submit and clarify tokens', (t) => {
  const f = fixture(t, { references: true });
  const version = f.read().waiting[0].version;
  f.ok(['step', 'shop', 'TARGET/first', '--delete', '--cleanup-refs']);
  f.reject(['wait', 'shop', 'submit', 'linked', '--version', version, '--submission-id', 'old-form', '--confirmed'], /changed|reread/i);
  f.reject(['wait', 'shop', 'clarify', 'linked', '--version', version, '--submission-id', 'old-clarification', '--comment', 'Question from an old tab'], /changed|reread/i);
});

test('cleanup retains immutable submission replay while rejecting new actions with the preceding waiting token', (t) => {
  const f = fixture(t, { references: true });
  const initialVersion = f.read().waiting[0].version;
  const original = ['wait', 'shop', 'submit', 'linked', '--version', initialVersion, '--submission-id', 'recorded-answer', '--confirmed', '--comment', 'Reviewed'];
  f.ok(original);
  const answered = f.read().waiting[0];
  f.ok(['task', 'shop', 'TARGET', '--delete', '--cleanup-refs']);
  const beforeReplay = f.snapshot();
  f.ok(original);
  assert.deepEqual(f.snapshot(), beforeReplay, 'replaying a recorded response neither rewrites history nor changes the cleaned request');
  assert.deepEqual(f.read().waiting[0].rounds, answered.rounds);
  f.reject(['wait', 'shop', 'submit', 'linked', '--version', answered.version, '--submission-id', 'new-answer', '--confirmed'], /changed|reread/i);
  f.reject(['wait', 'shop', 'clarify', 'linked', '--version', answered.version, '--submission-id', 'new-clarification', '--comment', 'Old tab question'], /changed|reread/i);
});

for (const args of [
  ['task', 'shop', 'MISSING', '--delete'],
  ['task', 'shop', 'MISSING', '--delete', '--cleanup-refs'],
  ['step', 'shop', 'TARGET/missing', '--delete'],
  ['step', 'shop', 'MISSING/first', '--delete', '--cleanup-refs'],
]) {
  test(`missing deletion target fails without writing: ${args.join(' ')}`, (t) => {
    const f = fixture(t);
    f.reject(args, /no task|no step|missing|not found/i);
  });
}

for (const ref of ['TARGET', 'TARGET/', '/first', 'TARGET/first/extra']) {
  test(`malformed step deletion reference fails without writing: ${ref}`, (t) => {
    const f = fixture(t);
    f.reject(['step', 'shop', ref, '--delete'], /task.*step|step.*id|reference|ref/i);
  });
}

test('--cleanup-refs rejects commands outside task and step without applying their mutation', (t) => {
  const f = fixture(t);
  f.reject(['branch', 'shop', 'TARGET', 'web', 'feat/unique', '--delete', '--cleanup-refs'], /task or step/);
});

for (const args of [
  ['task', 'shop', 'TARGET', '--cleanup-refs'],
  ['step', 'shop', 'TARGET/first', '--cleanup-refs'],
]) {
  test(`--cleanup-refs requires --delete: ${args[0]}`, (t) => {
    const f = fixture(t);
    f.reject(args, /--delete/);
  });
}

for (const args of [
  ['task', 'shop', 'TARGET', '--delete', '--title', 'Edited'],
  ['task', 'shop', 'TARGET', '--delete', '--status', 'Done'],
  ['step', 'shop', 'TARGET/first', '--delete', '--title', 'Edited'],
  ['step', 'shop', 'TARGET/first', '--delete', '--after', 'KEEP/stay'],
  ['step', 'shop', 'TARGET/first', '--delete', '--state', 'done', '--cleanup-refs'],
]) {
  test(`deletion rejects edit flags: ${args.join(' ')}`, (t) => {
    const f = fixture(t);
    f.reject(args, /--delete|delet/i);
  });
}

test('CLI help documents task and step deletion plus explicit reference cleanup', (t) => {
  const f = fixture(t);
  const help = f.ok(['help']).stdout;
  assert.match(help, /task <epic> <task>[^\n]*--delete/);
  assert.match(help, /step <epic> <task>\/<step>[^\n]*--delete/);
  assert.match(help, /--cleanup-refs/);
});
