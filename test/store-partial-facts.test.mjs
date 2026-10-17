import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const oldAt = '2026-10-15T10:00:00.000Z';
const newAt = '2026-10-16T10:00:00.000Z';
const previous = { head: 'abc123', behind: 2, ahead: 3, dirty: true, worktreeExists: true, mr: { state: 'opened', pipeline: 'running', shaMatchesHead: true, error: null } };
const create = (id) => {
  store.createEpic({ id, title: id });
  store.writeFacts(id, { 'r:feature': previous }, { at: oldAt });
};

test('fresh MR facts are saved independently of a Git error', () => {
  create('error');
  const epic = store.writeFacts('error', { 'r:feature': { error: 'git fetch: offline', mr: { state: 'merged', pipeline: 'success', error: null } } }, { at: newAt });
  const facts = epic.facts['r:feature'];
  assert.equal(facts.head, 'abc123');
  assert.equal(facts.fetchedAt, oldAt);
  assert.equal(facts.error, 'git fetch: offline');
  assert.equal(facts.mr.state, 'merged');
  assert.equal(facts.mr.pipeline, 'success');
  assert.equal(facts.mr.fetchedAt, newAt);
});

test('unavailable local repository preserves Git facts and marks the checkout absent', () => {
  create('unavailable');
  const epic = store.writeFacts('unavailable', { 'r:feature': { localUnavailable: true, localReason: 'Checkout removed', mr: { state: 'merged', error: null } } }, { at: newAt });
  const facts = epic.facts['r:feature'];
  assert.equal(facts.head, 'abc123');
  assert.equal(facts.behind, 2);
  assert.equal(facts.fetchedAt, oldAt);
  assert.equal(facts.error, null);
  assert.equal(facts.localUnavailable, true);
  assert.equal(facts.localReason, 'Checkout removed');
  assert.equal(facts.dirty, null);
  assert.equal(facts.worktreeExists, false);
  assert.equal(facts.mr.state, 'merged');
  assert.equal(facts.mr.fetchedAt, newAt);
  assert.ok(store.readHistory('unavailable').some((event) => event.path === 'facts.r:feature.localUnavailable' && event.after === true));
});

test('a failed MR refresh preserves its own last successful timestamp during local unavailability', () => {
  create('mr-error');
  const epic = store.writeFacts('mr-error', { 'r:feature': { localUnavailable: true, localReason: 'Checkout removed', mr: { error: 'glab: offline' } } }, { at: newAt });
  const facts = epic.facts['r:feature'];
  assert.equal(facts.mr.state, 'opened');
  assert.equal(facts.mr.fetchedAt, oldAt);
  assert.equal(facts.mr.errorAt, newAt);
  assert.equal(facts.mr.error, 'glab: offline');
  assert.equal(facts.mr.shaMatchesHead, null);
});

test('a failed Git read still records current checkout availability and invalidates old head comparison', () => {
  create('git-read-error');
  const epic = store.writeFacts('git-read-error', { 'r:feature': { error: 'git log: missing branch', dirty: null, worktreeExists: false, mr: { error: 'glab: offline' } } }, { at: newAt });
  const facts = epic.facts['r:feature'];
  assert.equal(facts.head, 'abc123');
  assert.equal(facts.fetchedAt, oldAt);
  assert.equal(facts.dirty, null);
  assert.equal(facts.worktreeExists, false);
  assert.equal(facts.mr.shaMatchesHead, null);
  assert.equal(facts.mr.fetchedAt, oldAt);
});

test('successful Git refresh clears unavailable state and old errors', () => {
  create('recovered');
  store.writeFacts('recovered', { 'r:feature': { localUnavailable: true, localReason: 'Checkout removed' } }, { at: newAt });
  const at = '2026-10-16T11:00:00.000Z';
  const epic = store.writeFacts('recovered', { 'r:feature': { ...previous, head: 'def456', dirty: false } }, { at });
  const facts = epic.facts['r:feature'];
  assert.equal(facts.head, 'def456');
  assert.equal(facts.fetchedAt, at);
  assert.equal(facts.error, null);
  assert.equal('localUnavailable' in facts, false);
  assert.equal('localReason' in facts, false);
});

test('a resolved Git directory clears the old unavailable marker even when the current read fails', () => {
  create('resolved-error');
  store.writeFacts('resolved-error', { 'r:feature': { localUnavailable: true, localReason: 'Checkout removed' } }, { at: newAt });
  const epic = store.writeFacts('resolved-error', { 'r:feature': { error: 'git fetch: offline', worktreeExists: false, dirty: null } });
  const facts = epic.facts['r:feature'];
  assert.equal(facts.head, 'abc123');
  assert.equal(facts.fetchedAt, oldAt);
  assert.equal(facts.error, 'git fetch: offline');
  assert.equal('localUnavailable' in facts, false);
  assert.equal('localReason' in facts, false);
});

test('an explicitly removed MR link clears its saved facts during partial and failed Git refreshes', () => {
  for (const [id, result] of [
    ['unlinked-partial', { localUnavailable: true, localReason: 'Checkout removed', mr: null }],
    ['unlinked-error', { error: 'git log: missing branch', worktreeExists: false, mr: null }],
  ]) {
    create(id);
    const epic = store.writeFacts(id, { 'r:feature': result });
    assert.equal(epic.facts['r:feature'].head, 'abc123');
    assert.equal(epic.facts['r:feature'].mr, null);
  }
});
