#!/usr/bin/env node
// Starts the board on a throwaway data dir with one sample epic: for trying the UI and for screenshots.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = process.env.EPIC_BOARD_HOME || mkdtempSync(join(tmpdir(), 'epic-board-demo-'));
process.env.EPIC_BOARD_HOME = data;
process.env.EPIC_BOARD_PORT ||= '4799';

const store = await import('../server/store.mjs');
const docs = await import('../server/docs.mjs');
const { createBoardServer } = await import('../server/http.mjs');
const { port } = await import('../server/paths.mjs');

const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

if (!store.listEpics().some((e) => e.id === 'SHOP-1')) {
  store.createEpic({ id: 'SHOP-1', title: 'One-page checkout', goal: 'Customers pay on one page; old checkout is switched off' });
  store.patchEpic('SHOP-1', {
    url: 'https://tracker.example.com/browse/SHOP-1',
    repos: {
      api: { path: '/nonexistent/api', base: 'main', provider: 'github', project: 'github.com/acme/api' },
      web: { path: '/nonexistent/web', base: 'main', provider: 'gitlab', project: 'gitlab.com/acme/web' },
    },
    tasks: [
      { id: 'API-12', title: '[api] Draft orders', role: 'main', status: 'Review', statusCheckedAt: ago(2), url: 'https://github.com/acme/api/issues/12', tracker: 'GitHub',
        steps: [{ id: 'model', title: 'Draft model', state: 'done', note: 'migration 012' }, { id: 'endpoints', title: 'Draft endpoints', state: 'done', note: 'contract tests green' }, { id: 'review', title: 'Code review', state: 'waiting' }],
        branches: [{ repo: 'api', name: 'feat/draft-orders', mr: { iid: 87 } }] },
      { id: 'WEB-31', title: '[web] Payment form', role: 'main', status: 'In progress', statusCheckedAt: ago(1), url: 'https://tracker.example.com/browse/WEB-31', tracker: 'Jira',
        steps: [
          { id: 'layout', title: 'Form layout', state: 'done', note: 'matches the mockups' },
          { id: 'card', title: 'Card input', state: 'done' },
          { id: 'wire', title: 'Wire the draft API', state: 'active', after: ['WEB-31/card', 'API-12/endpoints'], label: 'draft schema' },
          { id: 'errors', title: 'Error states', state: 'todo' },
        ],
        branches: [{ repo: 'web', name: 'feat/payment-form', mr: { iid: 412 } }],
        open: [{ id: 'o1', text: 'Rebase on main after the API merge' }] },
      { id: 'OPS-4', title: '[ops] Staging certificates', role: 'side', status: 'Backlog', steps: [] },
    ],
    mergeOrder: [{ id: 'm1', text: 'api', branch: 'api:feat/draft-orders' }, { id: 'm2', text: 'Migration on staging', waiting: 'migration' }, { id: 'm3', text: 'web', branch: 'web:feat/payment-form' }],
    decisions: [{ task: 'WEB-31', text: 'Cards first, wallets in a later epic', by: 'product' }],
    sessions: [{ id: 'demo-claude-1', agent: 'claude', task: 'WEB-31', startedAt: ago(3), lastAt: ago(0.2), doing: 'Wiring the payment form to the draft API', next: 'Error states' },
      { id: 'demo-codex-1', agent: 'codex', task: 'API-12', startedAt: ago(6), lastAt: ago(2), doing: 'Review fixes', next: 'Wait for approval' }],
  });
  const doc = docs.newDoc('SHOP-1', { task: 'WEB-31', step: 'wire', kind: 'plan', title: 'Wiring plan' });
  writeFileSync(doc.path, '# Wiring plan\n\n1. Map the form fields to the draft schema.\n2. Save a draft on every step.\n3. Submit converts the draft into an order.\n');
  store.patchEpic('SHOP-1', {
    waiting: [
      { id: 'psp', kind: 'decision', title: 'Pick the payment provider for launch', task: 'WEB-31', since: ago(5),
        details: 'Both providers pass the security review. Compare **fees for our volume** and the **refund API** before the form is wired, the field set depends on it.',
        refs: ['step:WEB-31/wire', 'decision:d1', `doc:${doc.id}`, 'https://example.com/psp-comparison'],
        input: { type: 'single', options: [{ id: 'a', text: 'Provider A', recommended: true }, { id: 'b', text: 'Provider B' }] },
        checklist: [{ id: 'c1', text: 'Fees compared for 10k orders a month' }, { id: 'c2', text: 'Refund API checked' }] },
      { id: 'migration', kind: 'action', title: 'Apply migration 012 on staging', task: 'API-12', since: ago(20),
        details: 'Run `db/012_drafts.sql` on staging after the API merge, then check that `orders.draft` exists.', refs: ['branch:api:feat/draft-orders'] },
      { id: 'review', kind: 'review', title: 'Approve the draft orders MR', task: 'API-12', since: ago(26), refs: ['task:API-12'] },
      { id: 'coverage', kind: 'review', title: 'Choose acceptance checks', task: 'WEB-31', since: ago(2), input: { type: 'multi', options: [{ id: 'api', text: 'API contract tests' }, { id: 'browser', text: 'Browser checkout' }, { id: 'refund', text: 'Refund flow' }] } },
    ],
  });
  const review = store.readEpic('SHOP-1').waiting.find((item) => item.id === 'review');
  const answered = store.submitWaiting('SHOP-1', review.id, { version: review.version, submissionId: 'demo-review', confirmed: true }, { by: 'button' }).waiting.find((item) => item.id === review.id);
  store.resolveWaiting('SHOP-1', review.id, { version: answered.version, submissionId: 'demo-review', resolution: 'Approved with two small fixes' }, { by: 'agent' });
  const coverage = store.readEpic('SHOP-1').waiting.find((item) => item.id === 'coverage');
  store.submitWaiting('SHOP-1', coverage.id, { version: coverage.version, submissionId: 'demo-coverage', selected: ['api', 'browser'] }, { by: 'button' });
}

const p = process.env.EPIC_BOARD_PORT === '0' ? 0 : port();
const server = createBoardServer({ port: p });
server.listen(p, '127.0.0.1', () => console.log(`demo board: http://localhost:${server.address().port}/e/SHOP-1 (data ${data})`));
