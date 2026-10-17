import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const { createBoardServer } = await import('../server/http.mjs');
store.createEpic({ id: 'history-pages', title: 'History pagination' });
store.appendHistory('history-pages', Array.from({ length: 620 }, (_, index) => ({
  at: '2026-10-16T12:00:00.000Z', by: 'cli', op: 'set', path: 'title', before: `Title ${index}`, after: `Title ${index + 1}`,
})));

const server = createBoardServer({ port: 0 });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
test.after(() => new Promise((resolve) => server.close(resolve)));
const historyUrl = `http://127.0.0.1:${server.address().port}/api/epics/history-pages/history`;

async function history(query = '') {
  const response = await fetch(historyUrl + query);
  assert.equal(response.status, 200);
  return response.json();
}

test('history limit=all includes events beyond the numeric cap in newest-first order', async () => {
  const events = await history('?limit=all');
  assert.equal(events.length, 621);
  assert.equal(events[0].after, 'Title 620');
  assert.equal(events.at(-2).after, 'Title 1');
  assert.equal(events.at(-1).path, 'epic');
});

test('history numeric limits retain their cap and the existing default fallback', async () => {
  for (const [query, count] of [
    ['', 20], ['?limit=', 20], ['?limit=invalid', 20], ['?limit=0', 20],
    ['?limit=5', 5], ['?limit=500', 500], ['?limit=1000', 500], ['?limit=Infinity', 500],
  ]) {
    const events = await history(query);
    assert.equal(events.length, count, query || 'no limit');
    assert.equal(events[0].after, 'Title 620');
  }
});
