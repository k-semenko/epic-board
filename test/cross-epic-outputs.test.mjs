import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const { createBoardServer } = await import('../server/http.mjs');
const { buildReport } = await import('../server/report.mjs');
const { buildExport, bundleScript } = await import('../server/export.mjs');

function fixture() {
  const home = tmpHome();
  process.env.XDG_CONFIG_HOME = join(home, 'config');
  const source = store.createEpic({ id: 'source', title: 'Source epic' });
  source.tasks = [
    { id: 'selected', title: 'Selected task', steps: [{ id: 'work', title: 'Source step', state: 'active', after: ['target/remote/ready'], label: 'uses contract' }] },
    { id: 'other', title: 'Other task', steps: [{ id: 'else', title: 'Other step', after: ['target/remote/other'], label: 'unselected label' }] },
  ];
  store.saveEpic(source);
  const target = store.createEpic({ id: 'target', title: 'Target epic' });
  target.tasks = [{ id: 'remote', title: 'Remote task', steps: [
    { id: 'ready', title: 'Target ready', state: 'done', after: ['source/selected/work'], label: 'used by source' },
    { id: 'other', title: 'Target other', state: 'blocked', after: ['source/other/else'], label: 'unselected backlink' },
  ] }];
  store.saveEpic(target);
  return { home, source, target };
}

const cli = (home, args, env = {}) => spawnSync(process.execPath, ['cli/epic.mjs', ...args], {
  encoding: 'utf8', env: { ...process.env, EPIC_BOARD_HOME: home, ...env },
});
const dataFromExport = (html) => JSON.parse(html.match(/window\.__EPIC_EXPORT__ = (.*?);<\/script>/s)[1]);

async function withServer(run) {
  const server = createBoardServer({ port: 0 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run((path) => fetch(`http://127.0.0.1:${server.address().port}${path}`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('HTTP links and index expose one snapshot while raw reads and revision stay unchanged', async () => {
  const { source } = fixture();
  await withServer(async (get) => {
    const response = await get('/api/epics/source/links');
    assert.equal(response.status, 200);
    const links = await response.json();
    assert.equal(links.outgoing[0].target.state, 'blocked');
    assert.ok(links.incoming.some((edge) => edge.source.address === 'target/remote/ready'));
    assert.equal(links.relatedEpics[0].id, 'target');
    assert.equal(links.incomplete, false);
    assert.ok(links.revision);
    assert.ok(links.readAt);
    const reads = new Map();
    const read = fs.readFileSync;
    fs.readFileSync = (file, ...rest) => {
      if ([store.epicPath('source'), store.epicPath('target')].includes(String(file))) reads.set(String(file), (reads.get(String(file)) || 0) + 1);
      return read(file, ...rest);
    };
    syncBuiltinESMExports();
    let index;
    try {
      index = await (await get('/api/epics')).json();
    } finally {
      fs.readFileSync = read;
      syncBuiltinESMExports();
    }
    assert.deepEqual([...reads.values()], [1, 1]);
    assert.equal(new Set(index.map((epic) => epic.readAt)).size, 1);
    assert.deepEqual(index.find((epic) => epic.id === 'source').relatedEpics, links.relatedEpics);
    assert.deepEqual(await (await get('/api/epics/source')).json(), source);
    assert.deepEqual(await (await get('/api/epics/source/rev')).json(), { updatedAt: source.updatedAt });
  });
});

test('HTTP distinguishes missing and corrupt epics and marks incomplete backlinks', async (t) => {
  const diagnostic = t.mock.method(console, 'error', () => {});
  fixture();
  const source = store.readEpic('source');
  source.tasks[0].steps[0].after.push('absent/task/step');
  store.saveEpic(source);
  fs.writeFileSync(store.epicPath('target'), '{bad json');
  await withServer(async (get) => {
    const links = await (await get('/api/epics/source/links')).json();
    assert.equal(links.outgoing.find((edge) => edge.target.epic === 'absent').status, 'missing-epic');
    assert.equal(links.outgoing.find((edge) => edge.target.epic === 'target').status, 'unavailable');
    assert.equal(links.incomplete, true);
    assert.ok(links.errors.some((error) => error.id === 'target'));
    assert.equal((await get('/api/epics/absent/links')).status, 404);
    assert.equal((await get('/api/epics/target/links')).status, 500);
    assert.equal(diagnostic.mock.callCount(), 1);
    const index = await (await get('/api/epics')).json();
    assert.equal(index.length, 1);
    assert.equal(index[0].incomplete, true);
  });
});

test('HTTP index reports unavailable when every epic file is corrupt', async (t) => {
  const diagnostic = t.mock.method(console, 'error', () => {});
  tmpHome();
  fs.writeFileSync(store.epicPath('only'), '{invalid');
  await withServer(async (get) => {
    const response = await get('/api/epics');
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, 'unavailable-board');
    assert.equal(diagnostic.mock.callCount(), 1);
  });
});

test('CLI warns only about explicitly supplied unresolved external after and keeps raw JSON', () => {
  const { home } = fixture();
  const result = cli(home, ['step', 'source', 'selected/work', '--after', 'absent/task/step,target/missing/step,target/remote/absent', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning:.*absent\/task\/step.*missing-epic/);
  assert.match(result.stderr, /target\/missing\/step.*missing-task/);
  assert.match(result.stderr, /target\/remote\/absent.*missing-step/);
  const raw = JSON.parse(result.stdout);
  assert.equal(raw.id, 'source');
  assert.equal(raw.outgoing, undefined);
  assert.deepEqual(raw.tasks[0].steps[0].after, ['absent/task/step', 'target/missing/step', 'target/remote/absent']);
  assert.equal(cli(home, ['step', 'source', 'selected/work', '--state', 'done']).stderr, '');
  assert.equal(cli(home, ['show', 'source', '--json']).stderr, '');
  assert.equal(cli(home, ['step', 'source', 'selected/work', '--after', 'target/remote/ready']).stderr, '');
  assert.equal(cli(home, ['step', 'source', 'selected/work', '--after', '-']).stderr, '');
});

test('a CLI warning snapshot failure cannot turn a successful write into failure', () => {
  const { home } = fixture();
  const preload = join(home, 'read-failure.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';\nimport { syncBuiltinESMExports } from 'node:module';\nconst read = fs.readdirSync;\nfs.readdirSync = (file, ...args) => { if (String(file).endsWith('/epics')) throw new Error('snapshot unavailable'); return read(file, ...args); };\nsyncBuiltinESMExports();\n`);
  const result = cli(home, ['step', 'source', 'selected/work', '--after', 'absent/task/step', '--json'], { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: cannot check external links:/);
  assert.deepEqual(JSON.parse(result.stdout).tasks[0].steps[0].after, ['absent/task/step']);
  assert.deepEqual(store.readEpic('source').tasks[0].steps[0].after, ['absent/task/step']);
});

test('CLI report filters links by selected task and includes both directions and snapshot time', () => {
  const { home } = fixture();
  const result = cli(home, ['report', 'source', '--task', 'selected']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\*\*Links\*\*/);
  assert.match(result.stdout, /Outgoing[\s\S]*Target ready.*done.*target\/remote\/ready.*uses contract/);
  assert.match(result.stdout, /Incoming[\s\S]*Target ready.*done.*target\/remote\/ready.*used by source/);
  assert.match(result.stdout, /Snapshot: \d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(result.stdout, /Target other|unselected label|unselected backlink|target\/remote\/other/);
  assert.match(result.stdout, /http:\/\/localhost:4747\/e\/target#t-remote\/ready/);
});

test('incoming report keeps source state and marks a deleted target step separately', () => {
  const { home } = fixture();
  const removed = cli(home, ['step', 'target', 'remote/ready', '--delete']);
  assert.equal(removed.status, 0, removed.stderr);
  const result = cli(home, ['report', 'target', '--task', 'remote']);
  assert.equal(result.status, 0, result.stderr);
  const incoming = result.stdout.split('**Incoming**')[1];
  assert.match(incoming, /Source step.*active.*source\/selected\/work/);
  assert.match(incoming, /target\/remote\/ready.*not found.*missing-step/);
});

test('report escapes names and labels and exposes resolution errors and incomplete snapshots', () => {
  const epic = { id: 'own', tasks: [{ id: 't', title: 'Task', steps: [{ id: 's', title: 'Step', state: 'done' }] }] };
  const endpoint = { epic: 'own', task: 't', step: 's', address: 'own/t/s', epicTitle: 'Own', title: '<img> [Task](javascript:bad)', state: 'done', url: 'http://localhost:4747/e/own#t-t/s' };
  const links = {
    outgoing: [{ source: endpoint, target: { ...endpoint, epic: 'foreign', address: 'foreign/t/s', title: '[target](javascript:bad)', epicTitle: '<svg>', url: 'http://localhost:4747/e/foreign#t-t/s' }, label: '<script>\n**label**', status: 'missing-step' }],
    incoming: [], incomplete: true, errors: [{ id: 'broken', status: 'unavailable' }], readAt: '2026-10-18T12:00:00.000Z',
  };
  const text = buildReport(epic, { task: 't', links });
  assert.doesNotMatch(text, /<img>|<svg>|<script>|\[Task\]\(javascript|\[target\]\(javascript|\*\*label\*\*/);
  assert.match(text, /&lt;img&gt;/);
  assert.match(text, /\\\[Task\\\]/);
  assert.match(text, /missing-step/);
  assert.match(text, /incomplete/i);
  assert.match(text, /broken.*unavailable/);
  assert.match(text, /2026-10-18T12:00:00/);
  assert.doesNotMatch(buildReport(epic, { task: 't' }), /\*\*Links\*\*/);
});

test('export embeds a same-snapshot link view without foreign documents or history', () => {
  const { source, target } = fixture();
  target.docs = [{ id: 'secret', title: 'Foreign secret document', path: '/not/copied.md' }];
  store.saveEpic(target);
  store.appendHistory('target', [{ path: 'secret', after: 'Foreign secret history' }]);
  const ownFile = store.epicPath('source');
  const read = fs.readFileSync;
  let ownReads = 0;
  fs.readFileSync = (file, ...args) => {
    if (String(file) === ownFile) ownReads++;
    return read(file, ...args);
  };
  syncBuiltinESMExports();
  let html;
  try {
    html = buildExport('source');
  } finally {
    fs.readFileSync = read;
    syncBuiltinESMExports();
  }
  assert.equal(ownReads, 1);
  const data = dataFromExport(html);
  assert.deepEqual(data.epic, source);
  assert.equal(data.links.outgoing.find((edge) => edge.target.step === 'ready').target.state, 'done');
  assert.equal(data.links.incoming.find((edge) => edge.source.step === 'ready').source.title, 'Target ready');
  assert.ok(data.links.readAt);
  assert.deepEqual(Object.keys(data).sort(), ['docs', 'epic', 'exportedAt', 'history', 'links', 'settings']);
  assert.doesNotMatch(html, /Foreign secret document|Foreign secret history/);
  assert.doesNotMatch(html, /src="\/|href="\/static\//);
  target.tasks[0].steps[0].state = 'blocked';
  store.saveEpic(target);
  assert.equal(data.links.outgoing.find((edge) => edge.target.step === 'ready').target.state, 'done');
  assert.match(bundleScript(), /const __links =/);
});

test('export preserves known missing links and incomplete backlink warning data', () => {
  const { source } = fixture();
  source.tasks[0].steps[0].after.push('absent/task/step');
  store.saveEpic(source);
  fs.writeFileSync(store.epicPath('broken'), '{invalid');
  const data = dataFromExport(buildExport('source'));
  assert.equal(data.links.incomplete, true);
  assert.ok(data.links.errors.some((error) => error.id === 'broken'));
  assert.equal(data.links.outgoing.find((edge) => edge.target.epic === 'absent').status, 'missing-epic');
});

function legacyNumericEpic() {
  const { home } = fixture();
  store.saveEpic({
    schema: 1, id: 42, title: 'Legacy numeric epic',
    tasks: [{ id: 'selected', title: 'Legacy task', steps: [{ id: 'work', title: 'Legacy step', after: ['target/remote/ready'] }] }],
  });
  return home;
}

test('export accepts a legacy numeric epic ID from the board snapshot', () => {
  legacyNumericEpic();
  const data = dataFromExport(buildExport('42'));
  assert.equal(data.epic.id, 42);
  assert.equal(data.epic.schema, 3);
  assert.equal(data.links.outgoing[0].target.state, 'done');
});

test('CLI report accepts a legacy numeric epic ID from the board snapshot', () => {
  const home = legacyNumericEpic();
  const result = cli(home, ['report', '42', '--task', 'selected']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\*\*Report: Legacy task\*\*/);
  assert.match(result.stdout, /Target ready.*done.*target\/remote\/ready/);
});
