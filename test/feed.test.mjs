import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';

const home = tmpHome();
const feed = await import('../server/feed.mjs');
const store = await import('../server/store.mjs');

const sample = (externalId, overrides = {}) => ({
  source: 'chat-triage',
  externalId,
  kind: 'alert',
  severity: 'important',
  title: `Title ${externalId}`,
  ...overrides,
});

test.beforeEach(() => feed.clearFeedForTests());

test('upsert grows count and keeps ts while content changes flip changedSinceMark', () => {
  const first = feed.addFeedItems(sample('chat-1', { title: 'One', body: 'a' }));
  assert.equal(first.items[0].count, 1);
  assert.equal(first.items[0].id, 'chat-triage~' + first.items[0].id.split('~')[1]);
  const ts = first.items[0].ts;
  feed.markFeedItems([first.items[0].id], 'noise');
  const same = feed.addFeedItems(sample('chat-1', { title: 'One', body: 'a' }));
  assert.equal(same.items[0].count, 2);
  assert.equal(same.items[0].ts, ts);
  assert.equal(same.items[0].changedSinceMark, false);
  const changed = feed.addFeedItems(sample('chat-1', { title: 'Two', body: 'a' }));
  assert.equal(changed.items[0].count, 3);
  assert.equal(changed.items[0].changedSinceMark, true);
  assert.equal(feed.listFeedItems({ unmarked: true }).length, 1);
});

test('unknown board refs become warnings; bad ref format is 400', () => {
  store.createEpic({ id: 'SHOP-1', title: 'Shop' });
  const ok = feed.addFeedItems(sample('r1', { refs: ['epic:SHOP-1', 'epic:MISSING', 'https://example.com/x'] }));
  assert.deepEqual(ok.items[0].refs, ['epic:SHOP-1', 'https://example.com/x']);
  assert.ok(ok.warnings.some((w) => /MISSING/.test(w.warning)));
  assert.throws(() => feed.addFeedItems(sample('r2', { refs: ['nope:x'] })), { status: 400 });
});

test('secrets in title are rejected', () => {
  assert.throws(() => feed.addFeedItems(sample('s1', { title: 'token ghp_abcdefghijklmnopqrstuvwxyz12' })), { status: 400, code: 'secret' });
});

test('add batch is atomic per source file', () => {
  assert.throws(() => feed.addFeedItems([
    sample('a1'),
    sample('a2', { title: 'ghp_abcdefghijklmnopqrstuvwxyz12' }),
  ]), { status: 400 });
  assert.equal(feed.listFeedItems({ source: 'chat-triage' }).length, 0);
});

test('mark unmark delete and summary', () => {
  const { items } = feed.addFeedItems([sample('m1', { severity: 'fire' }), sample('m2', { severity: 'normal' })]);
  feed.markFeedItems([items[0].id], 'important', { comment: 'keep' });
  assert.equal(feed.listFeedItems({ unmarked: true }).length, 1);
  feed.unmarkFeedItems([items[0].id]);
  assert.equal(feed.listFeedItems({ unmarked: true }).length, 2);
  feed.deleteFeedItems([items[1].id]);
  const summary = feed.feedSummary();
  assert.equal(summary.total, 1);
  assert.equal(summary.fire, 1);
});

test('prune respects retention and keepLinked', () => {
  store.createEpic({ id: 'KEEP', title: 'Keep' });
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const { items } = feed.addFeedItems([
    sample('old-noise', { severity: 'noise' }),
    sample('old-link', { refs: ['epic:KEEP'] }),
  ]);
  feed.markFeedItems([items[0].id], 'noise');
  feed.markFeedItems([items[1].id], 'noise');
  // Rewrite timestamps as if aged.
  const file = join(home, 'feed', 'items', 'chat-triage.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const item of data.items) {
    item.updatedAt = old;
    item.mark.at = old;
  }
  writeFileSync(file, JSON.stringify(data, null, 2));
  const result = feed.pruneFeed();
  const left = feed.listFeedItems({ source: 'chat-triage' });
  assert.equal(left.length, 1);
  assert.equal(left[0].externalId, 'old-link');
  assert.ok(result[0].removed.includes(items[0].id));
});

test('profile aggregates accumulate marks across prune', () => {
  const { items } = feed.addFeedItems(sample('p1', { severity: 'important' }));
  feed.markFeedItems([items[0].id], 'noise', { comment: 'skip' });
  feed.deleteFeedItems([items[0].id]);
  const agg = feed.feedProfileAggregates('chat-triage');
  assert.equal(agg.matrix['important:noise'], 1);
  assert.ok(agg.comments.some((c) => c.comment === 'skip'));
  feed.setFeedProfile('chat-triage', 'Noise in QA channel.');
  assert.match(feed.showFeedProfile('chat-triage').text, /Noise/);
});
