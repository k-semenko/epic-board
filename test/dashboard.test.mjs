import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const { buildDashboard } = await import('../server/dashboard.mjs');

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
