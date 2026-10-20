import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const { buildDashboard, listMergeRequests } = await import('../server/dashboard.mjs');

test('tiles link to views the page can actually open', () => {
  const dash = buildDashboard();
  for (const tile of Object.values(dash)) {
    if (tile.href) assert.match(tile.href, /^\/(tasks(\?waiting=1)?|feed)?$/);
  }
});

test('open requests and active tasks are counted across epics', () => {
  store.createEpic({ id: 'A-1', title: 'A' });
  store.patchEpic('A-1', {
    tasks: [{ id: 'T1', title: 'T1', steps: [{ id: 's', title: 's', state: 'active' }] }],
    waiting: [{ id: 'w1', kind: 'decision', title: 'Pick' }],
  });
  const dash = buildDashboard();
  assert.equal(dash.tasks.inWork, 1);
  assert.equal(dash.waiting.open, 1);
  assert.equal(dash.mr.open, 0);
});

test('merge requests list what is known, flag problems and put open ones first', () => {
  store.createEpic({ id: 'M-1', title: 'M' });
  store.patchEpic('M-1', {
    repos: { web: { path: '/nonexistent/web', base: 'main' } },
    tasks: [{ id: 'T1', title: 'One', branches: [{ repo: 'web', name: 'feat/a', mr: { iid: 7 } }, { repo: 'web', name: 'feat/b', mr: { iid: 8 } }] }],
  });
  const fresh = new Date().toISOString();
  store.writeFacts('M-1', { 'web:feat/a': { fetchedAt: fresh, behind: 3, ahead: 1, unpushed: 0, mr: { state: 'opened', draft: false, pipeline: 'failed', shaMatchesHead: false, url: 'https://x/mr/7', fetchedAt: fresh } } });
  const mrs = listMergeRequests().filter((m) => m.epic === 'M-1');
  assert.equal(mrs.length, 2);
  assert.equal(mrs[0].branch, 'feat/a');
  assert.equal(mrs[0].state, 'opened');
  assert.deepEqual(mrs[0].problems.sort(), ['pipeline', 'sha']);
  assert.equal(mrs[1].state, 'unchecked');
  assert.ok(mrs[1].problems.includes('stale'));
});
