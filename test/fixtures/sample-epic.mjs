export function sampleEpic() {
  const now = new Date().toISOString();
  return {
    schema: 2, id: 'shop', title: 'Checkout redesign', goal: 'One-page checkout in production',
    createdAt: now, updatedAt: now,
    repos: { web: { path: '/w/web', base: 'main', provider: 'gitlab', project: 'gitlab.example.com/acme/web' } },
    tasks: [
      { id: 'API-7', title: '[api] Order "draft" model (v2)', role: 'main', status: 'Testing', statusCheckedAt: now,
        steps: [{ id: 'meta', title: 'Draft model', state: 'done' }, { id: 'night', title: 'Nightly check', state: 'waiting' }] },
      { id: 'WEB-8', title: '[web] Payment form', role: 'main', status: 'In progress', statusCheckedAt: now, url: 'https://tracker.example.com/WEB-8',
        steps: [
          { id: 's1', title: 'Form layout', state: 'done', note: 'CI green' },
          { id: 's2', title: 'Card input', state: 'done', note: 'unit 120/0' },
          { id: 's3', title: 'Wire the API', state: 'active', after: ['WEB-8/s2', 'API-7/meta'], label: 'draft schema' },
          { id: 's4', title: 'Error states', state: 'todo' },
        ],
        branches: [{ repo: 'web', name: 'feat/payment-form', mr: { iid: 1393 } }],
        open: [{ id: 'o1', text: 'Rebase web on main' }] },
      { id: 'OPS-3', title: '[ops] Staging certificates', role: 'side', status: 'Backlog', steps: [] },
    ],
    waiting: [{ id: 'migration', kind: 'action', title: 'Apply the migration on staging', details: 'Run `db/012.sql`, then check the **orders** table', refs: ['step:WEB-8/s3'], checklist: [{ id: 'c1', text: 'Backup taken' }], task: 'WEB-8', since: now }],
    mergeOrder: [
      { id: 'm1', text: 'Release api 2.1.0' },
      { id: 'm2', text: 'web', branch: 'web:feat/payment-form' },
      { id: 'm3', text: 'Migration', waiting: 'migration' },
    ],
    decisions: [{ id: 'd1', at: now, task: 'WEB-8', text: 'Cards before wallets' }],
    sessions: [{ id: 'sess-1', task: 'WEB-8', startedAt: now, lastAt: now, doing: 'Stage 3 plan', next: 'Agree the plan' }],
    facts: {
      'web:feat/payment-form': {
        head: 'eaf756ec85', subject: 'x', behind: 120, ahead: 15, unpushed: 9, remoteBehind: 0, dirty: false,
        worktreeExists: true, fetchedAt: now, error: null,
        mr: { state: 'opened', draft: true, sha: 'eb5d31f733', pipeline: 'success', url: 'https://gitlab.example.com/acme/web/-/merge_requests/1393', shaMatchesHead: false, error: null },
      },
    },
  };
}
