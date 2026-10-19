import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const { searchBoard } = await import('../server/search.mjs');

store.createEpic({ id: 'SHOP-1', title: 'Оплата «в один клик»', goal: 'Платёж на одной странице' });
store.patchEpic('SHOP-1', { tasks: [{ id: 'WEB-31', title: 'Payment form', open: [{ id: 'o1', text: 'Пересобрать ветку после ревью' }],
  steps: [{ id: 'wire', title: 'Wire the draft API' }] }] });

const hits = (q, opts) => searchBoard(q, opts).groups.flatMap((g) => g.items);
const marked = (hit) => hit.marks.map(([a, b]) => hit.text.slice(a, b));

test('matches are ranges over the plain text, so guillemets in titles stay text', () => {
  const [hit] = hits('клик');
  assert.equal(hit.text, 'Оплата «в один клик»');
  assert.deepEqual(marked(hit), ['клик']);
});

test('every query word is marked, inside words and regardless of ё', () => {
  const [hit] = hits('плат стран');
  assert.equal(hit.type, 'epic');
  assert.deepEqual(marked(hit), ['плат']);
  assert.ok(hit.snippet.includes('Платёж'));
  assert.deepEqual(hit.snippetMarks.map(([a, b]) => hit.snippet.slice(a, b)), ['Плат', 'стран']);
  assert.deepEqual(hits('платеж').map((h) => h.type), ['epic']);
});

test('wrong keyboard layout finds and marks the intended word', () => {
  const [hit] = hits('rkbr');
  assert.deepEqual(marked(hit), ['клик']);
});

test('task, step and loose end links open the task on the epic map', () => {
  const byType = Object.fromEntries(hits('WEB-31').concat(hits('wire'), hits('Пересобрать')).map((h) => [h.type, h.href]));
  assert.equal(byType.task, '/e/SHOP-1#t-WEB-31');
  assert.equal(byType.step, '/e/SHOP-1#t-WEB-31/wire');
  assert.equal(byType.open, '/e/SHOP-1#t-WEB-31');
});

test('settings are found by their translated label in both languages', () => {
  assert.ok(hits('хранить мусор').some((h) => h.type === 'setting' && h.id === 'feed.retention.noise'));
  assert.ok(hits('keep noise').some((h) => h.type === 'setting' && h.id === 'feed.retention.noise'));
});

test('a write that bypasses the service is visible to the next search', () => {
  assert.equal(hits('Возврат').length, 0);
  store.patchEpic('SHOP-1', { tasks: [{ id: 'RET-1', title: 'Возврат средств' }] });
  assert.equal(hits('Возврат')[0]?.href, '/e/SHOP-1#t-RET-1');
});

test('a group returns more than five hits so the page can expand it', () => {
  store.patchEpic('SHOP-1', { tasks: Array.from({ length: 8 }, (_, i) => ({ id: `BULK-${i}`, title: `Массовая задача ${i}` })) });
  const group = searchBoard('массовая').groups.find((g) => g.type === 'task');
  assert.equal(group.total, 8);
  assert.equal(group.items.length, 8);
});
