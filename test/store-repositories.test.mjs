import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';
import { makeRepo } from './fixtures/git-fixture.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const git = makeRepo();
const root = realpathSync(git.clone);
const commonDir = join(root, '.git');
const create = (id, repoPath = git.worktree) => {
  store.createEpic({ id, title: id });
  return store.patchEpic(id, { repos: { r: { path: repoPath, base: 'master' } } }).epic;
};

test('registering a linked worktree captures the primary checkout and shared Git directory', () => {
  const epic = create('locations');
  assert.equal(epic.repos.r.path, git.worktree);
  assert.equal(epic.repos.r.root, root);
  assert.equal(epic.repos.r.commonDir, commonDir);
});

test('captured repository identity survives removal of the registered worktree', () => {
  create('removed');
  git.git(git.clone, 'worktree', 'remove', '--force', git.worktree);
  const epic = store.patchEpic('removed', { title: 'Removed checkout' }).epic;
  assert.equal(epic.repos.r.root, root);
  assert.equal(epic.repos.r.commonDir, commonDir);
});

test('retargeting a repository to a missing path clears the previous identity', () => {
  create('retarget', git.clone);
  const missing = join(git.root, 'not-present');
  const epic = store.patchEpic('retarget', { repos: { r: { path: missing } } }).epic;
  assert.equal(epic.repos.r.path, missing);
  assert.equal('root' in epic.repos.r, false);
  assert.equal('commonDir' in epic.repos.r, false);
  assert.equal(epic.repos.r.base, 'master');
});

test('repository identity fields reject malformed values while old records remain valid', () => {
  create('validation', join(git.root, 'missing'));
  for (const field of ['root', 'commonDir']) {
    for (const value of [42, {}, '']) {
      assert.throws(() => store.patchEpic('validation', { repos: { r: { [field]: value } } }), { status: 400, code: 'bad-repo-location' });
    }
  }
});

test('refresh backfills repository identity only while the observed path still matches', () => {
  const epic = create('backfill', git.clone);
  delete epic.repos.r.root;
  delete epic.repos.r.commonDir;
  store.saveEpic(epic);
  const repoLocations = { r: { path: git.clone, root, commonDir } };
  let updated = store.writeFacts('backfill', {}, { repoLocations });
  assert.equal(updated.repos.r.root, root);
  assert.equal(updated.repos.r.commonDir, commonDir);
  const missing = join(git.root, 'new-path');
  store.patchEpic('backfill', { repos: { r: { path: missing } } });
  updated = store.writeFacts('backfill', {}, { repoLocations });
  assert.equal(updated.repos.r.path, missing);
  assert.equal('root' in updated.repos.r, false);
  assert.equal('commonDir' in updated.repos.r, false);
});

test('a pending refresh cannot replace Git or MR facts after its repository path changes', () => {
  const oldAt = '2026-10-15T10:00:00.000Z';
  const newAt = '2026-10-16T10:00:00.000Z';
  for (const [id, result] of [
    ['retargeted-refresh', { head: 'outdated-result', mr: { state: 'merged' } }],
    ['retargeted-partial', { localUnavailable: true, localReason: 'Old checkout removed', mr: { state: 'merged' } }],
  ]) {
    create(id, git.clone);
    store.patchEpic(id, { repos: { 'r:nested': { path: git.clone, base: 'master' } } });
    store.writeFacts(id, { 'r:nested:feature': { head: 'saved-head', mr: { state: 'opened' } } }, { at: oldAt });
    store.patchEpic(id, { repos: { 'r:nested': { path: join(git.root, 'retargeted') } } });
    const epic = store.writeFacts(id, { 'r:nested:feature': result }, {
      at: newAt, repoLocations: { r: { path: git.clone }, 'r:nested': { path: git.clone } },
    });
    const facts = epic.facts['r:nested:feature'];
    assert.equal(facts.head, 'saved-head');
    assert.equal(facts.fetchedAt, oldAt);
    assert.equal(facts.mr.state, 'opened');
    assert.equal(facts.mr.fetchedAt, oldAt);
    assert.equal('localUnavailable' in facts, false);
  }
});

test.after(() => rmSync(git.root, { recursive: true, force: true }));
