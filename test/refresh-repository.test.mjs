import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';
import { makeRepo } from './fixtures/git-fixture.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const { refreshEpic, execRunner } = await import('../server/refresh.mjs');
const previousAt = '2026-01-01T00:00:00.000Z';

function fixture(t, id, location, name = 'feat/x') {
  const repo = makeRepo();
  t.after(() => rmSync(repo.root, { recursive: true, force: true }));
  store.createEpic({ id, title: 'Repository recovery' });
  store.patchEpic(id, {
    repos: { r: { ...location(repo), base: 'master', provider: 'gitlab', project: 'gitlab.example.com/q/r' } },
    tasks: [{ id: 'T', title: 'Task', branches: [{ repo: 'r', name, worktree: repo.worktree, mr: { iid: 5 } }] }],
  });
  return repo;
}

function runner(calls = []) {
  return async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'glab') {
      if (opts?.cwd && !existsSync(opts.cwd)) return { code: 1, stdout: '', stderr: 'missing cwd' };
      return { code: 0, stderr: '', stdout: JSON.stringify({ state: 'merged', sha: 'abcdef', head_pipeline: { status: 'success' } }) };
    }
    return execRunner(cmd, args, opts);
  };
}

test('a removed repository worktree refreshes through its saved common Git directory', async (t) => {
  const repo = fixture(t, 'saved-location', (r) => ({ path: r.worktree, root: r.clone, commonDir: join(r.clone, '.git') }));
  repo.git(repo.clone, 'worktree', 'remove', '--force', repo.worktree);
  const { epic } = await refreshEpic('saved-location', { run: runner() });
  const fact = epic.facts['r:feat/x'];
  assert.equal(fact.error, null);
  assert.equal(fact.ahead, 2);
  assert.equal(fact.unpushed, 1);
  assert.equal(fact.worktreeExists, false);
  assert.equal(fact.dirty, null);
  assert.equal(fact.mr.state, 'merged');
});

test('a healthy legacy record remembers its main root before the worktree disappears', async (t) => {
  const repo = fixture(t, 'legacy-location', (r) => ({ path: r.worktree }));
  const legacy = store.readEpic('legacy-location');
  delete legacy.repos.r.root;
  delete legacy.repos.r.commonDir;
  writeFileSync(store.epicPath(legacy.id), JSON.stringify(legacy));
  const first = await refreshEpic(legacy.id, { run: runner() });
  assert.equal(first.epic.repos.r.root, realpathSync(repo.clone));
  assert.equal(first.epic.repos.r.commonDir, realpathSync(join(repo.clone, '.git')));
  repo.git(repo.clone, 'worktree', 'remove', '--force', repo.worktree);
  const second = await refreshEpic(legacy.id, { run: runner() });
  assert.equal(second.epic.facts['r:feat/x'].error, null);
});

test('a surviving registered branch worktree recovers a missing repository location', async (t) => {
  const repo = fixture(t, 'surviving-location', (r) => ({ path: join(r.root, 'removed-checkout') }));
  const { epic } = await refreshEpic('surviving-location', { run: runner() });
  assert.equal(epic.facts['r:feat/x'].error, null);
  assert.equal(epic.facts['r:feat/x'].worktreeExists, true);
  assert.equal(epic.facts['r:feat/x'].dirty, true);
  assert.equal(epic.repos.r.root, realpathSync(repo.clone));
});

test('missing local Git retains the dated snapshot while refreshing the MR without its cwd', async (t) => {
  const repo = fixture(t, 'remote-only', (r) => ({ path: join(r.root, 'removed-checkout') }));
  store.patchEpic('remote-only', { tasks: [{ id: 'T', branches: [{ repo: 'r', name: 'feat/x', worktree: null }] }] });
  store.writeFacts('remote-only', { 'r:feat/x': { head: 'abcdef', ahead: 7, dirty: true, worktreeExists: true, mr: { state: 'opened' } } }, { at: previousAt });
  const calls = [];
  const events = [];
  const { epic } = await refreshEpic('remote-only', { run: runner(calls), onProgress: (event) => events.push(event) });
  const fact = epic.facts['r:feat/x'];
  assert.equal(fact.localUnavailable, true);
  assert.ok(fact.localReason);
  assert.equal(fact.error, null);
  assert.equal(fact.head, 'abcdef');
  assert.equal(fact.ahead, 7);
  assert.equal(fact.fetchedAt, previousAt);
  assert.equal(fact.dirty, null);
  assert.equal(fact.worktreeExists, false);
  assert.equal(fact.mr.state, 'merged');
  assert.notEqual(fact.mr.fetchedAt, previousAt);
  assert.equal(fact.mr.shaMatchesHead, null);
  assert.ok(calls.some((call) => call.cmd === 'glab' && !call.opts?.cwd));
  assert.ok(!calls.some((call) => call.cmd === 'git' && call.args.includes(repo.worktree)));
  assert.ok(events.some((event) => event.type === 'branch' && event.state === 'partial'));
});

test('a missing local branch does not prevent a current MR query', async (t) => {
  fixture(t, 'deleted-branch', (r) => ({ path: r.clone }), 'gone');
  store.writeFacts('deleted-branch', { 'r:gone': { head: 'oldhead', mr: { state: 'opened' } } }, { at: previousAt });
  const { epic } = await refreshEpic('deleted-branch', { run: runner() });
  const fact = epic.facts['r:gone'];
  assert.match(fact.error, /gone/);
  assert.equal(fact.fetchedAt, previousAt);
  assert.equal(fact.mr.state, 'merged');
  assert.notEqual(fact.mr.fetchedAt, previousAt);
  assert.equal(fact.mr.shaMatchesHead, null);
});

test('a reused worktree path cannot replace the saved repository identity', async (t) => {
  const repo = fixture(t, 'reused-location', (r) => ({ path: r.worktree }));
  const expectedCommonDir = realpathSync(join(repo.clone, '.git'));
  repo.git(repo.clone, 'worktree', 'remove', '--force', repo.worktree);
  const unrelated = makeRepo();
  t.after(() => rmSync(unrelated.root, { recursive: true, force: true }));
  unrelated.git(unrelated.clone, 'worktree', 'add', '-q', '--detach', repo.worktree, 'master');
  const { epic } = await refreshEpic('reused-location', { run: runner() });
  assert.equal(epic.repos.r.commonDir, expectedCommonDir);
  assert.equal(epic.facts['r:feat/x'].worktreeExists, false);
  assert.equal(epic.facts['r:feat/x'].dirty, null);
});

test('a failed forge query is counted as failed when local Git is also unavailable', async (t) => {
  fixture(t, 'missing-both-sources', (r) => ({ path: join(r.root, 'removed-checkout') }));
  store.patchEpic('missing-both-sources', { tasks: [{ id: 'T', branches: [{ repo: 'r', name: 'feat/x', worktree: null }] }] });
  const events = [];
  const { epic } = await refreshEpic('missing-both-sources', {
    run: async () => ({ code: 1, stdout: '', stderr: 'forge unavailable' }),
    onProgress: (event) => events.push(event),
  });
  assert.equal(epic.facts['r:feat/x'].localUnavailable, true);
  assert.match(epic.facts['r:feat/x'].mr.error, /forge unavailable/);
  assert.equal(events.find((event) => event.type === 'branch' && event.state !== 'start').state, 'error');
});

test('a pruned remote branch does not turn distance from the base into unpushed commits', async (t) => {
  const repo = fixture(t, 'pruned-remote', (r) => ({ path: r.clone }));
  repo.git(repo.clone, 'push', '-q', 'origin', '--delete', 'feat/x');
  const { epic } = await refreshEpic('pruned-remote', { run: runner() });
  const fact = epic.facts['r:feat/x'];
  assert.equal(fact.mr.state, 'merged');
  assert.equal(fact.ahead, 2);
  assert.equal(fact.unpushed, null);
  assert.equal(fact.remoteBehind, null);
});

test('a new branch without a remote has unknown publication counts', async (t) => {
  const repo = fixture(t, 'new-local-branch', (r) => ({ path: r.clone }), 'local-only');
  repo.git(repo.clone, 'branch', 'local-only', 'feat/x');
  store.patchEpic('new-local-branch', { tasks: [{ id: 'T', branches: [{ repo: 'r', name: 'local-only', worktree: null, mr: null }] }] });
  const { epic } = await refreshEpic('new-local-branch', { run: runner() });
  assert.equal(epic.facts['r:local-only'].ahead, 2);
  assert.equal(epic.facts['r:local-only'].unpushed, null);
});
