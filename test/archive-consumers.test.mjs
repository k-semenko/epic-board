import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpHome } from './helpers.mjs';

const home = tmpHome();
after(() => rmSync(home, { recursive: true, force: true }));
const store = await import('../server/store.mjs');
const { buildDashboard, listMergeRequests } = await import('../server/dashboard.mjs');
const { tasksForBoard } = await import('../server/tasks.mjs');
const { searchBoard } = await import('../server/search.mjs');
const { selfcheck } = await import('../server/selfcheck.mjs');
const { buildBrief } = await import('../server/brief.mjs');
const { epicForCwd, findSessionEpic } = await import('../hooks/lib.mjs');

const seed = (id, title, repoPath, lastAt) => {
  store.createEpic({ id, title, goal: 'Zephyr rollout' });
  store.patchEpic(id, {
    repos: { app: { path: repoPath, base: 'main' } },
    tasks: [{ id: `${id}-t`, title: 'Zephyr task', steps: [{ id: 's', title: 's', state: 'active' }], branches: [{ repo: 'app', name: 'feat/z', mr: { iid: 7 } }] }],
    waiting: [{ id: 'w', title: 'Pick' }],
    sessions: [{ id: 'sid', lastAt }],
  });
};
seed('live', 'Zephyr live', '/w/live', '2026-10-01T00:00:00Z');
seed('gone', 'Zephyr gone', '/w/gone', '2026-10-19T00:00:00Z');
store.archiveEpic('gone', { summary: 'Delivered' });

test('the dashboard and merge requests skip archived epics', () => {
  const dash = buildDashboard();
  assert.equal(dash.tasks.inWork, 1);
  assert.equal(dash.waiting.open, 1);
  assert.deepEqual([...new Set(listMergeRequests().map((mr) => mr.epic?.id ?? mr.epic))], ['live']);
});

test('the tasks view skips archived epics', () => {
  const board = tasksForBoard({ epics: store.listEpics(), errors: [] });
  assert.ok(board.tasks.every((t) => t.epic.id === 'live'));
  assert.ok(board.epics.every((e) => e.id === 'live'));
});

test('search puts archived epics after live ones and marks them', () => {
  const epics = searchBoard('Zephyr').groups.find((g) => g.type === 'epic').items;
  assert.deepEqual(epics.map((e) => e.id), ['live', 'gone']);
  assert.equal(epics[1].archived, true);
  assert.equal(epics[0].archived, undefined);
});

test('selfcheck does not look at archived repositories', async () => {
  const calls = [];
  const run = async (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { code: 0, stdout: '', stderr: '' }; };
  await selfcheck({ run });
  assert.ok(!calls.some((c) => c.includes('/w/gone')));
});

test('hooks never offer or restore an archived epic', () => {
  assert.equal(epicForCwd('/w/gone/src'), null);
  assert.equal(epicForCwd('/w/live/src').id, 'live');
  assert.equal(findSessionEpic('sid').epic.id, 'live');
});

test('the brief of an archived epic says so first', () => {
  const brief = buildBrief(store.readEpic('gone'));
  assert.ok(brief.startsWith('Epic archived: Delivered. Run epic.mjs reopen gone to continue.'), brief.split('\n')[0]);
});

test('an archived search hit carries a visible archived tag', async () => {
  const { hitHtml } = await import('../server/page/shell.mjs');
  const hit = { href: '/e/gone', text: 'Zephyr gone', marks: [], where: '' };
  assert.match(hitHtml({ ...hit, archived: true }), /class="search-archived"[^>]*>archived</);
  assert.doesNotMatch(hitHtml(hit), /search-archived/);
});
