import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleEpic } from './fixtures/sample-epic.mjs';
import { buildBrief, ago } from '../server/brief.mjs';
import { buildReport } from '../server/report.mjs';

test('brief: active step, pending decisions, session, facts, ≤ 25 lines', () => {
  const text = buildBrief(sampleEpic(), { session: 'sess-1' });
  assert.match(text, /▶ WEB-8\/s3 Wire the API/);
  assert.match(text, /\[action\] Apply the migration on staging \(WEB-8\) · checklist 1/);
  assert.match(text, /doing: Stage 3 plan/);
  assert.match(text, /web:feat\/payment-form eaf756ec85 · behind 120 · unpushed 9 · MR #1393 draft success/);
  assert.ok(text.split('\n').length <= 25);
});

test('ago', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.equal(ago('2026-10-16T11:55:00Z', now), '5 min');
  assert.equal(ago('2026-10-16T09:00:00Z', now), '3 h');
  assert.equal(ago('2026-10-14T12:00:00Z', now), '2 d');
  assert.equal(ago(null, now), '-');
});

test('brief and report label retained local facts when only the MR can be refreshed', () => {
  const epic = sampleEpic();
  Object.assign(epic.facts['web:feat/payment-form'], { localUnavailable: true, dirty: null });
  assert.match(buildBrief(epic), /web:feat\/payment-form last known eaf756ec85.*local Git unavailable/);
  assert.match(buildReport(epic, { task: 'WEB-8' }), /eaf756ec85` \(last known local head\)/);
});

test('task report', () => {
  const md = buildReport(sampleEpic(), { task: 'WEB-8' });
  assert.match(md, /^\*\*Report: \[web\] Payment form\*\*/);
  assert.match(md, /Task: https:\/\/tracker\.example\.com\/WEB-8/);
  assert.match(md, /- Form layout — CI green/);
  assert.match(md, /\[#1393\]\(https:\/\/gitlab\.example\.com\/acme\/web\/-\/merge_requests\/1393\)/);
  assert.match(md, /- Rebase web on main/);
  assert.match(md, /- migration: Apply the migration on staging — waiting for human/);
  assert.throws(() => buildReport(sampleEpic(), { task: 'nope' }), { status: 404 });
});

test('brief and report treat resolved items as done', () => {
  const epic = sampleEpic();
  Object.assign(epic.waiting[0], { doneAt: '2026-10-16T10:00:00Z', resolution: 'applied at 10:00' });
  assert.doesNotMatch(buildBrief(epic), /migration/);
  assert.match(buildReport(epic, { task: 'WEB-8' }), /\*\*Resolved\*\*\n\n- migration: Apply the migration on staging — outcome: applied at 10:00/);
});
