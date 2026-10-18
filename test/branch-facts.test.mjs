import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleScript } from '../server/export.mjs';

const checkedAt = '2026-10-16T11:30:00Z';
const mrCheckedAt = '2026-10-16T12:00:00Z';

function appHarness(events = [], lang = 'en') {
  const summary = { innerHTML: '', textContent: '' };
  const document = { addEventListener() {}, querySelector: (selector) => selector === '#pr-summary' ? summary : null };
  const bundle = bundleScript();
  const bootstrap = bundle.lastIndexOf('\nif (EXPORT || location.pathname');
  assert.ok(bootstrap > 0);
  const script = `${bundle.slice(0, bootstrap)}
    setLang(${JSON.stringify(lang)}, { persist: false });
    renderEpic = async () => {};
    globalThis.app = { branches: branchRows, refresh: runRefresh };
  })();`;
  const context = vm.createContext({
    document, window: { __EPIC_EXPORT__: { exportedAt: mrCheckedAt } },
    CSS: { escape: (value) => value }, TextDecoder,
    fetch: async () => new Response(events.map((event) => JSON.stringify(event)).join('\n') + '\n'),
  });
  vm.runInContext(script, context);
  return { ...context.app, summary };
}

function epic(facts = {}, branch = {}) {
  return {
    tasks: [{ id: 'T-1', branches: [{ repo: 'web', name: 'feat/x', mr: { iid: 5 }, ...branch }] }],
    facts: { 'web:feat/x': {
      head: 'abc123', subject: 'Saved commit', behind: 2, ahead: 3, unpushed: 1,
      dirty: null, fetchedAt: checkedAt,
      mr: { state: 'opened', pipeline: 'success', url: 'https://forge.example/pr/5', shaMatchesHead: null, fetchedAt: mrCheckedAt },
      ...facts,
    } },
  };
}

test('unavailable local Git marks preserved facts stale and dates the fresh MR separately', () => {
  const html = appHarness().branches(epic({
    localUnavailable: true, localReason: 'Repository directory was removed',
    error: "git fetch web: fatal: cannot change to '/deleted/worktree': No such file or directory",
  }));
  assert.match(html, /<td class="mono stale">abc123/);
  assert.match(html, /<td class="mono stale"><span class="nowrap"/);
  assert.match(html, /Local Git unavailable/);
  assert.match(html, /Repository directory was removed/);
  assert.doesNotMatch(html, /fatal:|\/deleted\/worktree/);
  assert.match(html, /Git checked <time data-ago="2026-10-16T11:30:00Z"/);
  assert.match(html, /MR checked <time data-ago="2026-10-16T12:00:00Z"/);
  assert.match(html, /opened <span class="ok">success/);
});

test('a failed recent local refresh marks the retained head stale', () => {
  const html = appHarness().branches(epic({ error: 'git fetch web: permission denied' }));
  assert.match(html, /<td class="mono stale">abc123/);
  assert.match(html, /permission denied/);
});

test('a removed branch shows its saved Git snapshot as stale beside the current MR', () => {
  const saved = epic({
    branchMissing: true, unpushed: null, remoteBehind: null, worktreeExists: false,
    mr: { state: 'merged', pipeline: 'success', shaMatchesHead: null, fetchedAt: mrCheckedAt },
  }, { worktree: '/removed/worktree' });
  for (const [lang, label, checked] of [['en', 'Branch removed', 'MR checked'], ['ru', 'Ветка удалена', 'MR проверен']]) {
    const html = appHarness([], lang).branches(saved);
    assert.match(html, /<td class="mono stale">abc123/);
    assert.match(html, /<td class="mono stale"><span class="nowrap"/);
    assert.ok(html.includes(`<div class="muted">${label}</div>`));
    assert.ok(html.includes(`<div class="muted"><span class="phrase">${checked} <time data-ago="${mrCheckedAt}"`));
    assert.match(html, /data-ago="2026-10-16T11:30:00Z"/);
    assert.match(html, /merged <span class="ok">success/);
    assert.doesNotMatch(html, /Unpushed|Не запушено|Worktree removed|Ворктри удалён|Different head|Не та голова/);
  }
});

test('a removed branch without a saved head reports no previous Git check', () => {
  const html = appHarness().branches(epic({
    branchMissing: true, head: null, subject: null, behind: null, ahead: null,
    unpushed: null, remoteBehind: null, fetchedAt: undefined,
  }));
  assert.match(html, /<div class="muted">Branch removed<\/div>/);
  assert.match(html, /Git not checked/);
  assert.doesNotMatch(html, /Git checked|Unpushed/);
});

test('a fetch failure after confirmed branch removal remains visible beside the saved snapshot', () => {
  const html = appHarness().branches(epic({ branchMissing: true, unpushed: null, error: 'git fetch web: permission denied' }));
  assert.match(html, /<td class="mono stale">abc123/);
  assert.match(html, /<div class="crit">git fetch web: permission denied<\/div>/);
  assert.match(html, /Git checked <time data-ago="2026-10-16T11:30:00Z"/);
});

test('only an explicit SHA mismatch displays a different-head warning', () => {
  const render = appHarness().branches;
  for (const [shaMatchesHead, warning] of [[true, false], [false, true], [null, false], [undefined, false]]) {
    const html = render(epic({ mr: { state: 'merged', shaMatchesHead, fetchedAt: mrCheckedAt } }));
    assert.equal(html.includes('Different head'), warning, String(shaMatchesHead));
    assert.equal(html.includes('Local head unknown'), shaMatchesHead == null, String(shaMatchesHead));
  }
});

test('removed worktrees are shown only for branches with an explicit worktree', () => {
  const render = appHarness().branches;
  assert.match(render(epic({ worktreeExists: false }, { worktree: '/deleted/worktree' })), /Worktree removed/);
  assert.doesNotMatch(render(epic({ worktreeExists: false })), /Worktree removed/);
});

test('removing the configured MR hides its retained facts before the next refresh', () => {
  const render = appHarness().branches;
  for (const mr of [null, undefined]) {
    const html = render(epic({}, { mr }));
    assert.doesNotMatch(html, /forge\.example|opened|MR checked|Local head unknown/);
  }
});

test('partial refreshes are counted separately from refreshed and failed branches', async () => {
  const { refresh, summary } = appHarness([
    { type: 'repo', key: 'web', state: 'partial', detail: 'Local Git unavailable' },
    { type: 'branch', key: 'web:feat/x', state: 'partial', detail: 'Local Git unavailable; MR refreshed' },
    { type: 'branch', key: 'other:feat/y', state: 'ok', detail: 'Updated' },
    { type: 'done' },
  ]);
  const rows = new Map(['repo:web', 'branch:web:feat/x', 'branch:other:feat/y'].map((key) => {
    const state = { innerHTML: '' };
    const detail = { textContent: '' };
    return [key, { className: 'pr-row pending', querySelector: (selector) => selector === '.pr-state' ? state : detail }];
  }));
  const close = { disabled: false, textContent: '' };
  const modal = {
    querySelectorAll: () => [...rows.values()],
    querySelector(selector) {
      if (selector === '[data-modal-close]') return close;
      if (selector === '[data-refresh-start]') return { remove() {} };
      return rows.get(selector.match(/^\[data-pr="(.+)"\]$/)?.[1]);
    },
  };
  await refresh('E-1', modal);
  assert.match(summary.innerHTML, /1 refreshed, 1 partial, 0 failed/);
  assert.match(summary.innerHTML, /class="warn"/);
  assert.equal(rows.get('branch:web:feat/x').className, 'pr-row partial');
  assert.equal(close.disabled, false);
});
