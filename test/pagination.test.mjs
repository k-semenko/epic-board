import test from 'node:test';
import assert from 'node:assert/strict';

import { paginate, renderPagination } from '../server/page/pagination.mjs';

test('each page contains its own items without losing the final partial page', () => {
  const items = Array.from({ length: 12 }, (_, index) => index + 1);
  assert.deepEqual(paginate(items, 1, 5), { items: [1, 2, 3, 4, 5], page: 1, pages: 3, total: 12, from: 1, to: 5 });
  assert.deepEqual(paginate(items, 2, 5), { items: [6, 7, 8, 9, 10], page: 2, pages: 3, total: 12, from: 6, to: 10 });
  assert.deepEqual(paginate(items, 3, 5), { items: [11, 12], page: 3, pages: 3, total: 12, from: 11, to: 12 });
  assert.deepEqual(paginate(items, 2, 10).items, [11, 12]);
  assert.equal(paginate(items, 1, 15).items.length, 12);
});

test('pages stay valid when a list shrinks or is empty', () => {
  assert.deepEqual(paginate(['only'], 7, 5), { items: ['only'], page: 1, pages: 1, total: 1, from: 1, to: 1 });
  assert.deepEqual(paginate([], 7, 5), { items: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
  assert.deepEqual(paginate(['first', 'second'], -1, 5).items, ['first', 'second']);
});

test('pagination controls identify their block and disable unavailable navigation', () => {
  const first = renderPagination('waiting', paginate(Array(12).fill('item'), 1, 5), 5);
  assert.match(first, /data-page-size="waiting"/);
  assert.match(first, /value="5" selected/);
  assert.match(first, /value="10"/);
  assert.match(first, /value="15"/);
  assert.match(first, /data-page="0"[^>]*disabled/);
  assert.match(first, /data-page="2"/);
  const last = renderPagination('history', paginate(Array(12).fill('item'), 3, 5), 5);
  assert.match(last, /data-page="4"[^>]*disabled/);
  assert.match(last, /data-page-block="history"/);
  assert.match(last, /11[–−-]12/);
});

test('offline pagination keeps navigation while preventing settings writes', () => {
  const html = renderPagination('decisions', paginate(Array(20).fill('item'), 1, 10), 10, { readOnly: true });
  assert.match(html, /<select[^>]*disabled/);
  assert.match(html, /data-page="2"(?![^>]*disabled)/);
});
