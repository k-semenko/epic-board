import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpHome } from './helpers.mjs';
import { makeRepo } from './fixtures/git-fixture.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const { refreshEpic, execRunner, cleanEnv } = await import('../server/refresh.mjs');
const repo = makeRepo();

store.createEpic({ id: '7', title: 'E' });
store.patchEpic('7', {
  repos: { r: { path: repo.clone, base: 'master', provider: 'gitlab', project: 'gitlab.example.com/q/r' } },
  tasks: [{ id: '70', title: 'T', role: 'main', branches: [
    { repo: 'r', name: 'feat/x', worktree: repo.worktree, mr: { iid: 5 } },
    { repo: 'r', name: 'gone' },
  ] }],
});

const calls = [];
const stub = (glabJson) => async (cmd, args, opts) => {
  calls.push([cmd, ...args]);
  if (cmd === 'glab') return glabJson ? { code: 0, stdout: JSON.stringify(glabJson), stderr: '' } : { code: 1, stdout: '', stderr: 'boom' };
  return execRunner(cmd, args, opts);
};

test('facts for a branch with worktree, MR and a missing branch', async () => {
  const { epic } = await refreshEpic('7', { run: stub({ state: 'opened', draft: true, sha: 'abc', head_pipeline: { status: 'success' }, web_url: 'u' }) });
  const f = epic.facts['r:feat/x'];
  assert.equal(f.behind, 0);
  assert.equal(f.ahead, 2);
  assert.equal(f.unpushed, 1);
  assert.equal(f.remoteBehind, 0);
  assert.equal(f.dirty, true);
  assert.equal(f.worktreeExists, true);
  assert.equal(f.mr.pipeline, 'success');
  assert.equal(f.mr.shaMatchesHead, false);
  assert.equal(f.error, null);
  assert.match(epic.facts['r:gone'].error, /gone/);
  assert.equal(calls.filter((c) => c[0] === 'git' && c.includes('fetch')).length, 1, 'one fetch per repo');
  assert.ok(calls.filter((c) => c[0] === 'git' && c.includes('log')).every((c) => c.includes('--end-of-options')));
  assert.ok(calls.some((c) => c[0] === 'glab' && c.includes('gitlab.example.com/q/r')));
});

test('glab falls back to pipeline, MR error does not fail the branch', async () => {
  let { epic } = await refreshEpic('7', { scope: 'branch', branch: 'r:feat/x', run: stub({ state: 'merged', draft: false, sha: 'x', pipeline: { status: 'failed' } }) });
  assert.equal(epic.facts['r:feat/x'].mr.pipeline, 'failed');
  ({ epic } = await refreshEpic('7', { scope: 'branch', branch: 'r:feat/x', run: stub(null) }));
  assert.equal(epic.facts['r:feat/x'].error, null);
  assert.match(epic.facts['r:feat/x'].mr.error, /boom/);
});

test('error keeps previous facts and fetchedAt', async () => {
  const before = store.readEpic('7').facts['r:feat/x'];
  const failing = async (cmd, args) => ({ code: 128, stdout: '', stderr: 'fatal: no' });
  const { epic } = await refreshEpic('7', { scope: 'branch', branch: 'r:feat/x', run: failing });
  const f = epic.facts['r:feat/x'];
  assert.match(f.error, /fatal/);
  assert.equal(f.fetchedAt, before.fetchedAt);
  assert.equal(f.ahead, before.ahead);
});

test('removed worktree falls back to repo path', async () => {
  repo.git(repo.clone, 'worktree', 'remove', '--force', repo.worktree);
  const { epic } = await refreshEpic('7', { scope: 'branch', branch: 'r:feat/x', run: stub({ state: 'opened', sha: 'x' }) });
  const f = epic.facts['r:feat/x'];
  assert.equal(f.error, null);
  assert.equal(f.worktreeExists, false);
  assert.equal(f.dirty, null);
});

test('refresh writes history only for changed fields', async () => {
  const count = () => store.readHistory('7', { limit: 1000 }).filter((e) => e.by === 'refresh').length;
  await refreshEpic('7', { scope: 'branch', branch: 'r:feat/x', run: stub({ state: 'opened', sha: 'x' }) });
  const n = count();
  await refreshEpic('7', { scope: 'branch', branch: 'r:feat/x', run: stub({ state: 'opened', sha: 'x' }) });
  assert.equal(count(), n);
});

test('a slow refresh does not lose a concurrent patch', async () => {
  const slow = async (cmd, args, opts) => {
    if (args.includes('fetch')) await new Promise((r) => setTimeout(r, 300));
    return stub({ state: 'opened', sha: 'x' })(cmd, args, opts);
  };
  const pending = refreshEpic('7', { run: slow });
  await new Promise((r) => setTimeout(r, 50));
  store.patchEpic('7', { tasks: [{ id: '70', open: [{ id: 'o1', text: 'Rebase' }] }] });
  const { epic } = await pending;
  assert.equal(epic.tasks[0].open[0].text, 'Rebase');
});

test('unknown scope target is 404, proxies are stripped only when asked', async () => {
  await assert.rejects(refreshEpic('7', { scope: 'branch', branch: 'r:nope' }), { status: 404 });
  const base = { HTTP_PROXY: 'x', https_proxy: 'y', ALL_PROXY: 'z', PATH: '/bin', HOME: '/nowhere' };
  assert.deepEqual(cleanEnv(base), base);
  assert.deepEqual(cleanEnv({ ...base, EPIC_BOARD_STRIP_PROXY: '1' }), { PATH: '/bin', HOME: '/nowhere', EPIC_BOARD_STRIP_PROXY: '1' });
});

test('GitHub pull requests through gh', async () => {
  store.createEpic({ id: 'gh', title: 'E' });
  store.patchEpic('gh', {
    repos: { r: { path: repo.clone, base: 'master', provider: 'github', project: 'github.com/acme/r' } },
    tasks: [{ id: 'T-1', title: 'T', branches: [{ repo: 'r', name: 'master', mr: { iid: 12 } }] }],
  });
  const seen = [];
  const run = async (cmd, args, opts) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh') {
      return { code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', isDraft: false, headRefOid: 'deadbeef', url: 'https://github.com/acme/r/pull/12', statusCheckRollup: [{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: '' }] }) };
    }
    return execRunner(cmd, args, opts);
  };
  const { epic } = await refreshEpic('gh', { run });
  const mr = epic.facts['r:master'].mr;
  assert.deepEqual([mr.state, mr.draft, mr.pipeline, mr.url], ['opened', false, 'running', 'https://github.com/acme/r/pull/12']);
  assert.ok(seen.some((c) => c[0] === 'gh' && c.join(' ').includes('pr view 12 -R github.com/acme/r')));
});

test('a repo without provider gets git facts only', async () => {
  store.createEpic({ id: 'plain', title: 'E' });
  store.patchEpic('plain', { repos: { r: { path: repo.clone, base: 'master' } }, tasks: [{ id: 'A', title: 'T', branches: [{ repo: 'r', name: 'master', mr: { iid: 3 } }] }] });
  const { epic } = await refreshEpic('plain', { run: execRunner });
  assert.equal(epic.facts['r:master'].mr, null);
  assert.equal(epic.facts['r:master'].error, null);
});

test.after(() => rmSync(repo.root, { recursive: true, force: true }));

test('glab failure keeps previous MR facts and marks the error', async () => {
  let { epic } = await refreshEpic('7', { scope: 'branch', branch: 'r:feat/x', run: stub({ state: 'merged', sha: 'x', web_url: 'u1', head_pipeline: { status: 'success' } }) });
  assert.ok(epic.facts['r:feat/x'].mr.fetchedAt);
  const okAt = epic.facts['r:feat/x'].mr.fetchedAt;
  ({ epic } = await refreshEpic('7', { scope: 'branch', branch: 'r:feat/x', run: stub(null) }));
  const mr = epic.facts['r:feat/x'].mr;
  assert.equal(mr.url, 'u1');
  assert.equal(mr.state, 'merged');
  assert.equal(mr.fetchedAt, okAt);
  assert.match(mr.error, /boom/);
  assert.ok(mr.errorAt);
});

test('progress events: each repo fetch and each branch start and finish in order', async () => {
  const events = [];
  await refreshEpic('7', { run: stub({ state: 'opened', sha: 'x' }), onProgress: (e) => events.push(e) });
  const kinds = events.map((e) => `${e.type}:${e.key}:${e.state}`);
  assert.deepEqual(kinds.slice(0, 2), ['repo:r:start', 'repo:r:ok']);
  assert.ok(kinds.includes('branch:r:feat/x:start'));
  assert.ok(kinds.includes('branch:r:feat/x:ok'));
  assert.ok(kinds.includes('branch:r:gone:error'));
  assert.equal(events.find((e) => e.key === 'r:gone' && e.state === 'error').detail.includes('gone'), true);
  assert.ok(kinds.indexOf('branch:r:feat/x:start') < kinds.indexOf('branch:r:feat/x:ok'));
  assert.match(events.find((e) => e.key === 'r:feat/x' && e.state === 'ok').detail, /\S/);
});
