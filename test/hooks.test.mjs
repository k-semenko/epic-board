import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { tmpHome } from './helpers.mjs';

const data = tmpHome();
const store = await import('../server/store.mjs');
store.createEpic({ id: '3', title: 'E' });
store.patchEpic('3', { repos: { app: { path: '/w/app', base: 'master' } }, tasks: [{ id: '30', title: 'T', steps: [{ id: 's', title: 'Step', state: 'active' }] }], sessions: [{ id: 'old', lastAt: '2026-01-01T00:00:00Z' }, { id: 'sid', task: '30', lastAt: '2026-10-16T00:00:00Z', doing: 'Coding', next: 'Tests' }] });
store.createEpic({ id: '4', title: 'F' });
store.patchEpic('4', { sessions: [{ id: 'sid', lastAt: '2026-10-01T00:00:00Z' }] });

// A throwaway HOME keeps the hook from finding (and updating) a real installed service.
const home = mkdtempSync(join(tmpdir(), 'eb-hook-home-'));
const hookEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: '', XDG_DATA_HOME: '', EPIC_BOARD_HOME: data, CURSOR_PLUGIN_ROOT: '', GROK_PLUGIN_ROOT: '', PLUGIN_ROOT: '', CODEX_THREAD_ID: '' };
const hook = (file, input, env = {}) => spawnSync(process.execPath, [`hooks/${file}`], { input: JSON.stringify(input), encoding: 'utf8', env: { ...hookEnv, ...env } });
const claudeContext = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
const cursorOut = (r) => JSON.parse(r.stdout);

test('compact: brief of the freshest bound epic', () => {
  const r = hook('session-start.mjs', { session_id: 'sid', source: 'compact', cwd: '/tmp' });
  assert.equal(r.status, 0);
  const text = claudeContext(r);
  assert.match(text, /Epic 3 · E/);
  assert.match(text, /doing: Coding/);
});

test('startup bound without a directory: binding line plus a record hint', () => {
  const text = claudeContext(hook('session-start.mjs', { session_id: 'sid', source: 'startup', cwd: '/tmp' }));
  assert.equal(text.split('\n').length, 2);
  assert.match(text, /epic 3/);
  assert.match(text, /--cwd '\/tmp'/);
});

test('unbound: hint only inside an epic repo', () => {
  assert.match(claudeContext(hook('session-start.mjs', { session_id: 'new', source: 'startup', cwd: '/w/app/sub' })), /node ".+\/cli\/epic\.mjs" bind 3 --session new --agent claude/);
  assert.equal(hook('session-start.mjs', { session_id: 'new', source: 'startup', cwd: '/elsewhere' }).stdout, '');
  assert.equal(hook('session-start.mjs', { session_id: 'new', source: 'clear', cwd: '/elsewhere' }).stdout, '');
});

test('cursor session-start: context, env session id, --agent cursor', () => {
  const env = { CURSOR_PLUGIN_ROOT: '/plugin' };
  const bound = cursorOut(hook('session-start.mjs', { session_id: 'sid', cwd: '/tmp' }, env));
  assert.match(bound.additional_context, /epic 3/);
  assert.equal(bound.env.EPIC_BOARD_SESSION_ID, 'sid');
  assert.equal(bound.hookSpecificOutput, undefined);
  const hint = cursorOut(hook('session-start.mjs', { conversation_id: 'new', workspace_roots: ['/w/app/sub'] }, env));
  assert.match(hint.additional_context, /--agent cursor/);
  assert.equal(hint.env.EPIC_BOARD_SESSION_ID, 'new');
  // Outside an epic repo Cursor still exports the session id for bind.
  const bare = cursorOut(hook('session-start.mjs', { session_id: 'solo', cwd: '/elsewhere' }, env));
  assert.equal(bare.additional_context, undefined);
  assert.equal(bare.env.EPIC_BOARD_SESSION_ID, 'solo');
});

test('codex session-start: compatibility env still binds as codex', () => {
  const r = hook('session-start.mjs', { session_id: 'new', source: 'startup', cwd: '/w/app/sub' }, {
    PLUGIN_ROOT: '/plugin', CLAUDE_PLUGIN_ROOT: '/plugin', CODEX_THREAD_ID: 'other',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /bind 3 --session new --agent codex/);
  assert.equal(out.env, undefined);
});

test('codex session-start: thread id is available when input omits session id', () => {
  const r = hook('session-start.mjs', { source: 'startup', cwd: '/w/app' }, {
    PLUGIN_ROOT: '/plugin', CODEX_THREAD_ID: 'thread-id',
  });
  assert.equal(r.status, 0);
  assert.match(claudeContext(r), /bind 3 --session thread-id --agent codex/);
});

test('codex compact and resume restore the freshest bound epic', () => {
  for (const source of ['compact', 'resume']) {
    const r = hook('session-start.mjs', { session_id: 'sid', source, cwd: '/elsewhere' }, { PLUGIN_ROOT: '/plugin' });
    assert.equal(r.status, 0);
    const text = claudeContext(r);
    assert.match(text, /Epic 3 · E/);
    assert.match(text, /doing: Coding/);
    assert.match(text, /next: Tests/);
  }
});

test('pre-compact: instruction for a bound session, nothing otherwise', () => {
  const compact = hook('pre-compact.mjs', { session_id: 'sid' }).stdout;
  assert.match(compact, /state of epic 3/);
  assert.match(compact, /node ".+\/cli\/epic\.mjs" show 3 --session sid/);
  assert.equal(hook('pre-compact.mjs', { session_id: 'nope' }).stdout, '');
});

test('cursor pre-compact: short user_message', () => {
  const r = hook('pre-compact.mjs', { conversation_id: 'sid' }, { CURSOR_PLUGIN_ROOT: '/plugin' });
  assert.equal(r.status, 0);
  const msg = JSON.parse(r.stdout).user_message;
  assert.match(msg, /After compact/);
  assert.match(msg, /show 3 --session sid/);
  assert.doesNotMatch(msg, /summary instructions/);
});

test('broken input never fails the session', () => {
  const r = spawnSync(process.execPath, ['hooks/session-start.mjs'], { input: '{oops', encoding: 'utf8', env: hookEnv });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('session-start warns when the plugin is behind the installed service copy', async () => {
  const { servicePath } = await import('../server/service.mjs');
  const { VERSION } = await import('../server/version.mjs');
  const home = mkdtempSync(join(tmpdir(), 'eb-hook-home-'));
  const env = { HOME: home };
  // With a unit present, a missing or older marker makes the hook reinstall the real launchd/systemd service.
  const unit = servicePath({ env: { ...hookEnv, ...env } });
  mkdirSync(dirname(unit), { recursive: true });
  writeFileSync(unit, '');
  const app = join(home, '.local/share/epic-board/app');
  mkdirSync(app, { recursive: true });
  const install = (version) => writeFileSync(join(app, 'installed.json'), JSON.stringify({ version }));
  const input = { session_id: 'new', source: 'startup', cwd: '/elsewhere' };

  install('99.0.0');
  const text = claudeContext(hook('session-start.mjs', input, env));
  assert.equal(text, `epic-board: plugin is behind the service (${VERSION} < 99.0.0); update: claude plugin marketplace update epic-board && claude plugin update epic-board@epic-board, then restart Claude Code.`);
  assert.match(claudeContext(hook('session-start.mjs', input, { ...env, PLUGIN_ROOT: '/plugin' })), /behind the service .*in Codex/);
  assert.match(cursorOut(hook('session-start.mjs', input, { ...env, CURSOR_PLUGIN_ROOT: '/plugin' })).additional_context, /behind the service .*Customize/);

  install(VERSION);
  assert.equal(hook('session-start.mjs', input, env).stdout, '');
});

test('session-start stays quiet without a service unit', () => {
  const home = mkdtempSync(join(tmpdir(), 'eb-hook-home-'));
  const app = join(home, '.local/share/epic-board/app');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'installed.json'), JSON.stringify({ version: '99.0.0' }));
  const r = hook('session-start.mjs', { session_id: 'new', source: 'startup', cwd: '/elsewhere' }, { HOME: home });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
