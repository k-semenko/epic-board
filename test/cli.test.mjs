import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'eb-cli-'));
const cli = (args, env = { EPIC_BOARD_HOME: data }) => spawnSync(process.execPath, ['cli/epic.mjs', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const ok = (args) => {
  const r = cli(args);
  assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
  return r;
};
const show = () => JSON.parse(cli(['show', 'shop', '--json']).stdout);

test('build an epic through the cli', () => {
  ok(['new', 'shop', '--title', 'Checkout', '--goal', 'One-page checkout', '--url', 'https://tracker.example.com/EPIC-1']);
  ok(['repo', 'shop', 'web', '--path', '/w/web', '--base', 'main', '--provider', 'github', '--project', 'github.com/acme/web']);
  ok(['task', 'shop', 'WEB-90', '--title', 'Pay button', '--role', 'main', '--status', 'In progress', '--url', 'https://tracker.example.com/WEB-90', '--tracker', 'Jira']);
  ok(['step', 'shop', 'WEB-90/s1', '--title', 'A', '--state', 'done', '--note', 'tests ok']);
  ok(['step', 'shop', 'WEB-90/s2', '--title', 'B', '--state', 'active', '--after', 'WEB-90/s1', '--label', 'x']);
  ok(['branch', 'shop', 'WEB-90', 'web', 'feat/x', '--mr', '12']);
  ok(['wait', 'shop', 'add', 'psp', '--kind', 'decision', '--title', 'Pick a provider', '--details', 'Fees **and** refunds', '--task', 'WEB-90', '--ref', 'step:WEB-90/s2', '--ref', 'https://example.com/x', '--check', 'Fees compared', '--check', 'Legal ok']);
  ok(['decide', 'shop', '--task', 'WEB-90', '--text', 'Use cards first']);
  ok(['open-item', 'shop', 'WEB-90', 'add', 'Rebase']);
  ok(['merge', 'shop', '--set', JSON.stringify([{ id: 'm1', text: 'web', branch: 'web:feat/x' }])]);
  ok(['bind', 'shop', '--session', 'sid-1', '--task', 'WEB-90']);
  ok(['note', 'shop', '--session', 'sid-1', '--doing', 'Writing', '--next', 'Tests']);
  const epic = show();
  assert.equal(epic.url, 'https://tracker.example.com/EPIC-1');
  assert.deepEqual(epic.repos.web, { path: '/w/web', base: 'main', provider: 'github', project: 'github.com/acme/web' });
  const task = epic.tasks[0];
  assert.deepEqual([task.status, task.tracker, task.url], ['In progress', 'Jira', 'https://tracker.example.com/WEB-90']);
  assert.ok(task.statusCheckedAt);
  assert.equal(task.steps[1].after[0], 'WEB-90/s1');
  assert.equal(task.branches[0].mr.iid, 12);
  const w = epic.waiting[0];
  assert.deepEqual([w.title, w.details, w.refs, w.checklist], ['Pick a provider', 'Fees **and** refunds', ['step:WEB-90/s2', 'https://example.com/x'], [{ id: 'c1', text: 'Fees compared' }, { id: 'c2', text: 'Legal ok' }]]);
  assert.equal(epic.decisions[0].by, undefined, 'no author is invented');
  const brief = cli(['show', 'shop', '--session', 'sid-1']).stdout;
  assert.match(brief, /doing: Writing/);
  assert.match(brief, /Needs a decision: 1/);
  assert.ok(brief.trim().split('\n').length <= 25);
  assert.match(ok(['report', 'shop', '--task', 'WEB-90']).stdout, /\*\*Report: Pay button\*\*/);
  assert.match(ok(['url', 'shop']).stdout, /\/e\/shop/);
  const docPath = ok(['doc', 'new', 'shop', 'WEB-90/s1', '--kind', 'plan', '--title', 'Stage plan']).stdout.trim();
  assert.match(docPath, /plan-.*\.md$/);
  writeFileSync(docPath, '# Stage plan\ntext\n');
  assert.match(ok(['doc', 'list', 'shop']).stdout, /WEB-90\/s1 · plan · Stage plan/);
  ok(['docs-mode', 'shop', 'board']);
  assert.equal(show().docsMode, 'board');
  assert.equal(cli(['docs-mode', 'shop', 'weird']).status, 1);
  ok(['doc', 'remove', 'shop', show().docs[0].id]);
  const out = join(data, 'export.html');
  ok(['export', 'shop', '--out', out]);
  assert.match(readFileSync(out, 'utf8'), /__EPIC_EXPORT__/);
  ok(['open-item', 'shop', 'WEB-90', 'done', task.open[0].id]);
  assert.match(cli(['wait', 'shop', 'done', 'psp']).stderr, /resolve/);
  assert.match(cli(['wait', 'shop', 'undo', 'psp']).stderr, /revise/);
  let w1 = JSON.parse(ok(['wait', 'shop', 'show', 'psp', '--json']).stdout);
  assert.equal(w1.input.type, 'confirm');
  assert.equal(cli(['wait', 'shop', 'submit', 'psp', '--confirmed', '--submission-id', 'human-1']).status, 1);
  const partial = cli(['wait', 'shop', 'submit', 'psp', '--version', w1.version, '--submission-id', 'human-1', '--confirmed', '--checked', 'c1']);
  assert.equal(partial.status, 1);
  assert.match(partial.stderr, /checklist/i);
  ok(['wait', 'shop', 'submit', 'psp', '--version', w1.version, '--submission-id', 'human-1', '--confirmed', '--checked', 'c1,c2', '--comment', 'Fees reviewed']);
  w1 = show().waiting[0];
  assert.equal(w1.status, 'answered');
  assert.equal(w1.doneAt, undefined);
  assert.match(ok(['wait', 'shop', 'show', 'psp']).stdout, /Fees reviewed/);
  assert.equal(cli(['wait', 'shop', 'resolve', 'psp', '--version', 'stale', '--submission-id', 'human-1', '--resolution', 'Use X']).status, 1);
  ok(['wait', 'shop', 'resolve', 'psp', '--version', w1.version, '--submission-id', 'human-1', '--resolution', 'Cards via provider X']);
  w1 = show().waiting[0];
  assert.equal(w1.status, 'closed');
  assert.equal(w1.resolution, 'Cards via provider X');
  ok(['wait', 'shop', 'revise', 'psp', '--version', w1.version, '--reason', 'Fees changed', '--title', 'Confirm fees', '--check', 'New fees compared']);
  w1 = show().waiting[0];
  assert.equal(w1.revision, 2);
  assert.deepEqual(w1.checklist, [{ id: 'c1', text: 'New fees compared' }]);
  assert.equal(cli(['wait', 'shop', 'remove', 'psp', '--version', w1.version]).status, 1);
  ok(['wait', 'shop', 'add', 'temporary', '--title', 'Mistaken request']);
  const temporary = show().waiting.find((w) => w.id === 'temporary');
  assert.equal(cli(['wait', 'shop', 'remove', 'temporary']).status, 1);
  ok(['wait', 'shop', 'remove', 'temporary', '--version', temporary.version]);
  assert.equal(show().waiting.some((w) => w.id === 'temporary'), false);
  ok(['bind', 'shop', '--session', 'sid-2', '--agent', 'codex']);
  assert.equal(show().sessions.find((s) => s.id === 'sid-2').agent, 'codex');
  assert.equal(show().sessions.find((s) => s.id === 'sid-2').cwd, process.cwd());
  ok(['bind', 'shop', '--session', 'sid-2', '--agent', 'codex']);
  assert.equal(show().sessions.find((s) => s.id === 'sid-2').cwd, process.cwd());
  ok(['bind', 'shop', '--session', 'sid-2', '--cwd', '/tmp/other']);
  assert.equal(show().sessions.find((s) => s.id === 'sid-2').cwd, '/tmp/other');
  ok(['note', 'shop', '--session', 'sid-2', '--doing', 'still']);
  assert.equal(show().sessions.find((s) => s.id === 'sid-2').cwd, '/tmp/other');
  assert.equal(cli(['bind', 'shop', '--session', 'sid-4', '--cwd', 'relative']).status, 1);
  assert.equal(cli(['bind', 'shop', '--session', 'sid-3', '--agent', 'Bad Agent!']).status, 1);
});

test('errors go to stderr with code 1', () => {
  const r = cli(['step', 'shop', 'WEB-90/s3', '--title', 'C', '--after', 'WEB-90/nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing step/);
  assert.equal(cli(['note', 'shop', '--session', 'unbound', '--doing', 'x']).status, 1);
  assert.equal(cli(['frobnicate']).status, 1);
  assert.match(cli(['help']).stdout, /wait <epic> add/);
});

test('a copy of the plugin (like the cache) finds data through the config', () => {
  const home = mkdtempSync(join(tmpdir(), 'eb-home-'));
  mkdirSync(join(home, '.config', 'epic-board'), { recursive: true });
  writeFileSync(join(home, '.config', 'epic-board', 'config.json'), JSON.stringify({ dataDir: data }));
  const copy = mkdtempSync(join(tmpdir(), 'eb-copy-'));
  for (const dir of ['cli', 'server']) cpSync(dir, join(copy, dir), { recursive: true });
  cpSync('package.json', join(copy, 'package.json'));
  const env = { ...process.env, HOME: home };
  delete env.EPIC_BOARD_HOME;
  delete env.XDG_CONFIG_HOME;
  const r = spawnSync(process.execPath, [join(copy, 'cli/epic.mjs'), 'show', 'shop', '--json'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).id, 'shop');
});


test('CLI choice requests preserve IDs and recommendation without selecting for the human', () => {
  ok(['wait', 'shop', 'add', 'choice', '--title', 'Provider', '--input', 'single', '--option', 'a=Provider A', '--option', 'b=Provider B', '--recommend', 'a', '--ref', 'waiting:psp']);
  let w = JSON.parse(ok(['wait', 'shop', 'show', 'choice', '--json']).stdout);
  assert.deepEqual(w.input, { type: 'single', options: [{ id: 'a', text: 'Provider A', recommended: true }, { id: 'b', text: 'Provider B' }] });
  assert.equal(w.rounds.length, 0);
  assert.equal(cli(['wait', 'shop', 'submit', 'choice', '--version', w.version, '--submission-id', 'choice-1', '--selected', 'a,b']).status, 1);
  ok(['wait', 'shop', 'submit', 'choice', '--version', w.version, '--submission-id', 'choice-1', '--selected', 'b']);
  w = show().waiting.find((x) => x.id === 'choice');
  assert.deepEqual(w.rounds[0].response.selected, ['b']);
  ok(['wait', 'shop', 'revise', 'choice', '--version', w.version, '--reason', 'Allow two providers', '--input', 'multi', '--option', 'a=Provider A', '--option', 'b=Provider B']);
  w = show().waiting.find((x) => x.id === 'choice');
  ok(['wait', 'shop', 'submit', 'choice', '--version', w.version, '--submission-id', 'choice-2', '--selected', 'a,b']);
  w = show().waiting.find((x) => x.id === 'choice');
  assert.deepEqual(w.rounds[1].response.selected, ['a', 'b']);
  assert.equal(w.rounds[0].review.outcome, 'revised');
  assert.equal(cli(['wait', 'shop', 'add', 'bad-choice', '--title', 'Bad', '--input', 'single', '--option', 'a=A', '--option', 'b=B', '--recommend', 'missing']).status, 1);
  assert.equal(show().waiting.some((x) => x.id === 'bad-choice'), false);
});

test('revising choice options keeps the existing input type and guards stale versions', () => {
  for (const type of ['single', 'multi']) {
    const id = `revise-${type}`;
    ok(['wait', 'shop', 'add', id, '--title', 'Provider', '--input', type, '--option', 'a=A', '--option', 'b=B']);
    let w = JSON.parse(ok(['wait', 'shop', 'show', id, '--json']).stdout);
    const originalVersion = w.version;
    ok(['wait', 'shop', 'revise', id, '--version', w.version, '--reason', 'Updated labels', '--option', 'a=New A', '--option', 'b=New B']);
    w = JSON.parse(ok(['wait', 'shop', 'show', id, '--json']).stdout);
    assert.deepEqual(w.input, { type, options: [{ id: 'a', text: 'New A' }, { id: 'b', text: 'New B' }] });
    assert.equal(cli(['wait', 'shop', 'revise', id, '--version', originalVersion, '--reason', 'Stale change', '--option', 'a=Old A', '--option', 'b=Old B']).status, 1);
    assert.deepEqual(JSON.parse(ok(['wait', 'shop', 'show', id, '--json']).stdout), w);
  }
});

test('input-only revision retains choice options and recommendation-only revision targets current options', () => {
  ok(['wait', 'shop', 'add', 'input-patch', '--title', 'Provider', '--input', 'single', '--option', 'a=A', '--option', 'b=B', '--recommend', 'a']);
  let w = JSON.parse(ok(['wait', 'shop', 'show', 'input-patch', '--json']).stdout);
  ok(['wait', 'shop', 'revise', 'input-patch', '--version', w.version, '--reason', 'Allow several', '--input', 'multi']);
  w = JSON.parse(ok(['wait', 'shop', 'show', 'input-patch', '--json']).stdout);
  assert.deepEqual(w.input, { type: 'multi', options: [{ id: 'a', text: 'A', recommended: true }, { id: 'b', text: 'B' }] });
  ok(['wait', 'shop', 'revise', 'input-patch', '--version', w.version, '--reason', 'Recommend B', '--recommend', 'b']);
  w = JSON.parse(ok(['wait', 'shop', 'show', 'input-patch', '--json']).stdout);
  assert.deepEqual(w.input, { type: 'multi', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B', recommended: true }] });
  assert.equal(cli(['wait', 'shop', 'revise', 'input-patch', '--version', w.version, '--reason', 'Unknown advice', '--recommend', 'missing']).status, 1);
  assert.deepEqual(JSON.parse(ok(['wait', 'shop', 'show', 'input-patch', '--json']).stdout), w);
  ok(['wait', 'shop', 'revise', 'input-patch', '--version', w.version, '--reason', 'Confirm the text', '--input', 'confirm']);
  w = JSON.parse(ok(['wait', 'shop', 'show', 'input-patch', '--json']).stdout);
  assert.deepEqual(w.input, { type: 'confirm' });
});

test('the agent closes a request from the cli with only an outcome', () => {
  ok(['wait', 'shop', 'add', 'hub', '--title', 'Default hub']);
  assert.match(cli(['wait', 'shop', 'done', 'hub']).stderr, /resolve hub --resolution/);
  ok(['wait', 'shop', 'resolve', 'hub', '--resolution', 'Agreed in chat: 8006']);
  const w = show().waiting.find((x) => x.id === 'hub');
  assert.equal(w.status, 'closed');
  assert.equal(w.resolution, 'Agreed in chat: 8006');
});

test('archive, list and reopen an epic from the cli', () => {
  ok(['new', 'old', '--title', 'Old work']);
  const bare = cli(['archive', 'old']);
  assert.notEqual(bare.status, 0);
  assert.match(bare.stderr, /summary/);
  ok(['archive', 'old', '--summary', 'Shipped']);
  assert.doesNotMatch(ok(['list']).stdout, /^old /m);
  const archived = ok(['list', '--archived']).stdout;
  assert.match(archived, /^old /m);
  assert.doesNotMatch(archived, /^shop /m);
  assert.match(cli(['bind', 'old', '--session', 'sid-9']).stderr, /epic-archived|archived/);
  ok(['reopen', 'old', '--why', 'more']);
  assert.match(ok(['list']).stdout, /^old /m);
});
