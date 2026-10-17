import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief } from '../server/brief.mjs';
import { buildReport } from '../server/report.mjs';

const answer = {
  revision: 1,
  request: { title: 'Provider', input: { type: 'single', options: [{ id: 'a', text: 'Provider A' }, { id: 'b', text: 'Provider B' }] } },
  response: { submissionId: 'human-1', at: '2026-10-16T10:00:00Z', selected: ['b'], checked: [], confirmed: false, comment: 'Refunds checked' },
};
const epic = {
  id: 'shop', title: 'Checkout', tasks: [{ id: 'pay', title: 'Payments' }],
  waiting: [
    { id: 'legal', title: 'Legal review', kind: 'approval', status: 'open', task: 'pay', revision: 1, version: 'legal-v1', rounds: [] },
    { id: 'psp', title: 'Provider', kind: 'decision', status: 'answered', task: 'pay', revision: 1, version: 'psp-v2', rounds: [answer] },
    { id: 'budget', title: 'Budget', kind: 'approval', status: 'closed', task: 'pay', revision: 1, version: 'budget-v3', doneAt: '2026-10-16T11:00:00Z', resolution: 'Budget recorded', rounds: [{ revision: 1, request: { title: 'Budget', input: { type: 'confirm' } }, response: { submissionId: 'human-2', confirmed: true, checked: [], selected: [] }, review: { outcome: 'accepted', text: 'Budget recorded' } }] },
  ],
};

test('brief names next actor, item IDs and answer without implying automatic review', () => {
  const text = buildBrief(epic);
  assert.match(text, /Needs a decision: 2/);
  assert.match(text, /Human: 1.*Agent: 1/);
  assert.match(text, /legal.*human/);
  assert.match(text, /psp.*agent/);
  assert.match(text, /Provider B/);
  assert.match(text, /Refunds checked/);
  assert.doesNotMatch(text, /Budget recorded/);
  assert.ok(text.split('\n').length <= 25);
});

test('report distinguishes unreviewed answer from agent resolution and keeps it left', () => {
  const text = buildReport(epic, { task: 'pay' });
  assert.match(text, /\*\*Answers awaiting agent review\*\*[\s\S]*psp.*Provider B.*Refunds checked/);
  assert.match(text, /\*\*Resolved\*\*[\s\S]*budget.*Confirmed.*Budget recorded/);
  assert.match(text, /\*\*Left\*\*[\s\S]*Legal review.*waiting for human[\s\S]*Provider.*waiting for agent/);
});
