import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';

const data = tmpHome();
const store = await import('../server/store.mjs');
store.createEpic({ id: '3', title: 'E' });
store.patchEpic('3', { repos: { app: { path: '/w/app', base: 'master' } }, tasks: [{ id: '30', title: 'T', steps: [{ id: 's', title: 'Step', state: 'active' }] }], sessions: [{ id: 'old', lastAt: '2026-01-01T00:00:00Z' }, { id: 'sid', task: '30', lastAt: '2026-10-16T00:00:00Z', doing: 'Coding', next: 'Tests' }] });
store.createEpic({ id: '4', title: 'F' });
store.patchEpic('4', { sessions: [{ id: 'sid', lastAt: '2026-10-01T00:00:00Z' }] });

// A throwaway HOME keeps the hook from finding (and updating) a real installed service.
const home = mkdtempSync(join(tmpdir(), 'eb-hook-home-'));
const hook = (file, input, env = {}) => spawnSync(process.execPath, [`hooks/${file}`], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, HOME: home, XDG_CONFIG_HOME: '', XDG_DATA_HOME: '', EPIC_BOARD_HOME: data, ...env } });
const context = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;

test('compact: brief of the freshest bound epic', () => {
  const r = hook('session-start.mjs', { session_id: 'sid', source: 'compact', cwd: '/tmp' });
  assert.equal(r.status, 0);
  const text = context(r);
  assert.match(text, /Epic 3 · E/);
  assert.match(text, /doing: Coding/);
});

test('startup bound: one line', () => {
  const text = context(hook('session-start.mjs', { session_id: 'sid', source: 'startup', cwd: '/tmp' }));
  assert.equal(text.split('\n').length, 1);
  assert.match(text, /epic 3/);
});

test('unbound: hint only inside an epic repo', () => {
  assert.match(context(hook('session-start.mjs', { session_id: 'new', source: 'startup', cwd: '/w/app/sub' })), /node ".+\/cli\/epic\.mjs" bind 3 --session new/);
  assert.equal(hook('session-start.mjs', { session_id: 'new', source: 'startup', cwd: '/elsewhere' }).stdout, '');
  assert.equal(hook('session-start.mjs', { session_id: 'new', source: 'clear', cwd: '/elsewhere' }).stdout, '');
});

test('pre-compact: instruction for a bound session, nothing otherwise', () => {
  const compact = hook('pre-compact.mjs', { session_id: 'sid' }).stdout;
  assert.match(compact, /state of epic 3/);
  assert.match(compact, /node ".+\/cli\/epic\.mjs" show 3 --session sid/);
  assert.equal(hook('pre-compact.mjs', { session_id: 'nope' }).stdout, '');
});

test('broken input never fails the session', () => {
  const r = spawnSync(process.execPath, ['hooks/session-start.mjs'], { input: '{oops', encoding: 'utf8', env: { ...process.env, HOME: home, EPIC_BOARD_HOME: data } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
