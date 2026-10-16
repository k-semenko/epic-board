import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpHome } from './helpers.mjs';

tmpHome();
const { createBoardServer } = await import('../server/http.mjs');
const server = createBoardServer({ port: 0, run: async () => ({ code: 0, stdout: '', stderr: '' }) });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

// fetch() does not let tests forge Host, so header checks go through node:http.
const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end(body);
});

const call = (path, { method = 'GET', body, headers = {} } = {}) => fetch(base + path, {
  method,
  headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
});

test('create, read, patch, rev, history, health', async () => {
  assert.equal((await call('/api/epics', { method: 'POST', body: { id: '5', title: 'E', goal: 'G' } })).status, 201);
  assert.equal((await call('/api/epics', { method: 'POST', body: { id: '5', title: 'E' } })).status, 409);
  const rev1 = await (await call('/api/epics/5/rev')).json();
  const patched = await call('/api/epics/5', { method: 'PATCH', body: { patch: { tasks: [{ id: '50', title: 'T', role: 'main', steps: [{ id: 's1', title: 'A', state: 'active' }] }] }, by: 'agent', why: 'test' } });
  assert.equal(patched.status, 200);
  const rev2 = await (await call('/api/epics/5/rev')).json();
  assert.notEqual(rev1.updatedAt, rev2.updatedAt);
  const history = await (await call('/api/epics/5/history?limit=5')).json();
  assert.equal(history[0].why, 'test');
  assert.equal((await call('/api/epics/5/diagram')).status, 404, 'removed endpoints stay gone');
  assert.equal((await call('/api/epics/5/result?task=50')).status, 404);
  assert.match((await (await call('/api/health')).json()).version, /^\d+\.\d+\.\d+/);
  const list = await (await call('/api/epics')).json();
  assert.deepEqual(list.map((e) => [e.id, e.waiting]), [['5', 0]]);
});

test('errors carry status and json', async () => {
  const r = await call('/api/epics/5', { method: 'PATCH', body: { patch: { facts: {} } } });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'facts-readonly');
  assert.equal((await call('/api/epics/404')).status, 404);
  assert.equal((await call('/api/epics/..%2Fx')).status, 400);
  assert.equal((await call('/nope')).status, 404);
});

test('global settings can be saved without changing epic data or history', async () => {
  const defaults = await call('/api/settings');
  assert.equal(defaults.status, 200);
  assert.deepEqual(await defaults.json(), { epicSectionOrder: ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history'] });
  const before = await (await call('/api/epics/5')).json();
  const history = await (await call('/api/epics/5/history')).json();
  const settings = { epicSectionOrder: ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'] };
  const saved = await call('/api/settings', { method: 'PUT', body: settings });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), settings);
  assert.deepEqual(await (await call('/api/settings')).json(), settings);
  assert.deepEqual(await (await call('/api/epics/5')).json(), before);
  assert.deepEqual(await (await call('/api/epics/5/history')).json(), history);
});

test('invalid settings requests return 400 and preserve the saved order', async () => {
  const before = await (await call('/api/settings')).json();
  const invalid = [
    {},
    { epicSectionOrder: 'map' },
    { epicSectionOrder: ['map', 'waiting'] },
    { epicSectionOrder: ['map', 'map', 'branches', 'sessions', 'decisions', 'history'] },
    { epicSectionOrder: ['other', 'waiting', 'branches', 'sessions', 'decisions', 'history'] },
    { epicSectionOrder: ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'], port: 1234 },
  ];
  for (const body of invalid) {
    const response = await call('/api/settings', { method: 'PUT', body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).error, 'bad-settings');
    assert.deepEqual(await (await call('/api/settings')).json(), before);
  }
});

test('settings writes use the same origin and JSON guards as epic writes', async () => {
  const body = { epicSectionOrder: ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'] };
  assert.equal((await call('/api/settings', { method: 'PUT', body, headers: { Origin: 'http://evil.example' } })).status, 403);
  const response = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  assert.equal(response.status, 415);
});

test('host and origin checks', async () => {
  assert.equal(await raw('/api/epics', { headers: { Host: 'evil.example' } }), 403);
  assert.equal(await raw('/api/epics', { headers: { Host: `localhost:${port}` } }), 200);
  assert.equal(await raw('/api/epics', { headers: { Host: 'localhost:1' } }), 403);
  assert.equal(await raw('/api/epics', { headers: { Host: `board.example:${port}` } }), 403, 'a custom host needs the config');
  const bad = await call('/api/epics/5/refresh', { method: 'POST', body: {}, headers: { Origin: 'http://evil.example' } });
  assert.equal(bad.status, 403);
  const noJson = await fetch(`${base}/api/epics/5/refresh`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(noJson.status, 415);
});

test('waiting done button and refresh', async () => {
  await call('/api/epics/5', { method: 'PATCH', body: { patch: { waiting: [{ id: 'w1', kind: 'action', title: 'Migrate', checklist: [{ id: 'c1', text: 'Backup' }] }] } } });
  const partial = await call('/api/epics/5/waiting/w1/done', { method: 'POST', body: {} });
  assert.equal(partial.status, 400);
  assert.match((await partial.json()).detail, /Backup/);
  assert.equal((await call('/api/epics/5/waiting/nope/done', { method: 'POST', body: {} })).status, 404);
  assert.equal((await call('/api/epics/5/waiting/w1/done', { method: 'POST', body: { checked: ['c1'], resolution: 'done at 10' } })).status, 200);
  let epic = await (await call('/api/epics/5')).json();
  assert.equal(epic.waiting.length, 1, 'a done item stays on the list');
  assert.ok(epic.waiting[0].doneAt);
  const list = await (await call('/api/epics')).json();
  assert.equal(list.find((e) => e.id === '5').waiting, 0, 'done items are not counted as waiting');
  assert.ok(list.find((e) => e.id === '5').createdAt);
  assert.equal(list.find((e) => e.id === '5').tasks, 1);
  assert.equal(list.find((e) => e.id === '5').branches, 0);
  assert.equal((await call('/api/epics/5/waiting/w1/undo', { method: 'POST', body: {} })).status, 200);
  epic = await (await call('/api/epics/5')).json();
  assert.equal('doneAt' in epic.waiting[0], false);
  assert.equal((await call('/api/epics/5/refresh', { method: 'POST', body: { scope: 'all' } })).status, 200);
});

test('refresh can stream its progress as ndjson', async () => {
  const r = await call('/api/epics/5/refresh?stream=1', { method: 'POST', body: { scope: 'all' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/x-ndjson/);
  const lines = (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.at(-1).type, 'done');
  assert.ok(lines.at(-1).epic.id);
});

test('selfcheck only runs git in repos of known epics', async () => {
  const r = await call('/api/selfcheck?repo=/tmp/not-an-epic-repo');
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'bad-repo');
});

test('page modules are served as javascript', async () => {
  const r = await call('/static/lanes.mjs');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/javascript/);
  assert.equal((await call('/vendor/mermaid.min.js')).status, 404);
  for (const lib of ['marked.min.js', 'purify.min.js']) {
    const v = await call(`/vendor/${lib}`);
    assert.equal(v.status, 200, lib);
    assert.match(v.headers.get('content-type'), /text\/javascript/);
  }
  assert.equal((await call('/vendor/..%2Fpackage.json')).status, 404);
});

test('docs: create, read, save with conflict check, versions, search text', async () => {
  const created = await call('/api/epics/5/docs', { method: 'POST', body: { mode: 'new', task: '50', step: 's1', kind: 'plan', title: 'План' } });
  assert.equal(created.status, 201);
  const doc = await created.json();
  let r = await (await call(`/api/epics/5/docs/${doc.id}`)).json();
  assert.equal(r.text, '# План\n');
  const saved = await call(`/api/epics/5/docs/${doc.id}`, { method: 'PUT', body: { text: '# План\nx\n', mtimeMs: r.mtimeMs } });
  assert.equal(saved.status, 200);
  const stale = await call(`/api/epics/5/docs/${doc.id}`, { method: 'PUT', body: { text: 'y', mtimeMs: 1 } });
  assert.equal(stale.status, 409);
  const versions = await (await call(`/api/epics/5/docs/${doc.id}/versions`)).json();
  assert.equal(versions.length, 1);
  const old = await (await call(`/api/epics/5/docs/${doc.id}/versions/${versions[0].id}`)).json();
  assert.equal(old.text, '# План\n');
  const texts = await (await call('/api/epics/5/docs-text')).json();
  assert.ok(texts.some((t) => t.text.includes('x')));
  assert.equal((await call('/api/epics/5/docs', { method: 'POST', body: { mode: 'link', path: '/etc/hosts.md', kind: 'note', title: 'x' } })).status, 403);
});

test('export downloads one html file', async () => {
  const r = await call('/api/epics/5/export');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="epic-5-\d{4}-\d{2}-\d{2}\.html"/);
  assert.match(await r.text(), /__EPIC_EXPORT__/);
});

test('pages are served', async () => {
  assert.match(await (await call('/')).text(), /<title>/);
  assert.match(await (await call('/e/5')).text(), /epic\.js|app\.js/);
});

test.after(() => server.close());
