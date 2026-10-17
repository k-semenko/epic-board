import test from 'node:test';
import assert from 'node:assert/strict';

import * as order from '../server/page/section-order.mjs';

test('old or incomplete settings retain every available section once', () => {
  assert.deepEqual(order.normalizeSectionOrder(['history', 'map', 'history', 'retired']),
    ['history', 'map', 'waiting', 'branches', 'sessions', 'decisions']);
  assert.deepEqual(order.normalizeSectionOrder(null),
    ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history']);
});

test('moving a section inserts it at the requested position without changing the saved input', () => {
  const saved = ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history'];
  assert.deepEqual(order.moveSection(saved, 'history', 0),
    ['history', 'waiting', 'map', 'branches', 'sessions', 'decisions']);
  assert.deepEqual(order.moveSection(saved, 'waiting', 5),
    ['map', 'branches', 'sessions', 'decisions', 'history', 'waiting']);
  assert.deepEqual(saved, ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history']);
  assert.deepEqual(order.moveSection(saved, 'missing', 0), saved);
});
