import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleEpic } from './fixtures/sample-epic.mjs';
import { buildLanes, layoutMap, buildOverview, defaultOpen, defaultStep, sideStack } from '../server/page/lanes.mjs';

test('main tasks become lanes in order, side tasks separate', () => {
  const map = buildLanes(sampleEpic());
  assert.equal(map.goal, 'One-page checkout in production');
  assert.deepEqual(map.lanes.map((l) => l.id), ['API-7', 'WEB-8']);
  assert.deepEqual(map.side.map((l) => l.id), ['OPS-3']);
  assert.equal(map.lanes[1].title, 'Payment form');
  assert.equal(map.lanes[1].status, 'In progress');
});

test('steps keep state and note; unknown state is todo', () => {
  const epic = sampleEpic();
  epic.tasks[1].steps[3].state = 'weird';
  const steps = buildLanes(epic).lanes[1].steps;
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'active', 'todo']);
  assert.equal(steps[1].note, 'unit 120/0');
});

test('only cross-task dependencies are shown, with the step title and label', () => {
  const s3 = buildLanes(sampleEpic()).lanes[1].steps[2];
  assert.deepEqual(s3.deps, [{ task: 'API-7', step: 'meta', title: 'Draft model', label: 'draft schema' }]);
});

test('merge chain marks steps still waiting for a decision', () => {
  const merge = buildLanes(sampleEpic()).merge;
  assert.deepEqual(merge.map((m) => [m.n, m.text, m.waiting]), [[1, 'Release api 2.1.0', false], [2, 'web', false], [3, 'Migration', true]]);
  assert.equal(merge[1].branch, 'web:feat/payment-form');
});

test('here lists active steps across lanes', () => {
  assert.deepEqual(buildLanes(sampleEpic()).here, [{ task: 'WEB-8', step: 's3', title: 'Wire the API' }]);
});

test('layout: steps take columns after their lane predecessor and their cross-task dependency', () => {
  const layout = layoutMap(buildLanes(sampleEpic()));
  const col = (row, step) => layout.rows.find((r) => r.id === row).cells.find((c) => c.id === step).col;
  assert.equal(col('API-7', 'meta'), 0);
  assert.equal(col('API-7', 'night'), 1);
  assert.deepEqual(['s1', 's2', 's3', 's4'].map((s) => col('WEB-8', s)), [0, 1, 2, 3]);
});

test('layout: a dependency on a later column pushes the step right', () => {
  const epic = sampleEpic();
  epic.tasks[0].steps.push({ id: 'late', title: 'Late', state: 'todo' }, { id: 'later', title: 'Later', state: 'todo' });
  epic.tasks[1].steps[1].after = ['WEB-8/s1', 'API-7/later'];
  const layout = layoutMap(buildLanes(epic));
  const lane = layout.rows.find((r) => r.id === 'WEB-8');
  assert.deepEqual(lane.cells.map((c) => c.col), [0, 4, 5, 6]);
});

test('layout: merge follows the merged lanes, goal comes last', () => {
  const layout = layoutMap(buildLanes(sampleEpic()));
  const merge = layout.rows.find((r) => r.kind === 'merge');
  assert.deepEqual(merge.cells.map((c) => c.col), [4, 5, 6]);
  assert.equal(layout.goalCol, 7);
  assert.equal(layout.cols, 8);
});

test('layout: edges inside lanes, across lanes with label, into merge and goal', () => {
  const layout = layoutMap(buildLanes(sampleEpic()));
  const key = (e) => `${e.from.row}:${e.from.col}>${e.to.row}:${e.to.col}${e.label ? `|${e.label}` : ''}`;
  const edges = layout.edges.map(key);
  assert.ok(edges.includes('WEB-8:1>WEB-8:2'));
  assert.ok(edges.includes('API-7:0>WEB-8:2|draft schema'));
  assert.ok(edges.includes('WEB-8:3>@merge:4'));
  assert.ok(edges.includes('@merge:6>@goal:7'));
  assert.ok(!edges.some((e) => e.endsWith('>@goal:7') && !e.startsWith('@merge:')), 'only the merge chain is drawn into the goal; lane-wide arcs were noise');
});

test('layout: active cell is reported for scrolling into view', () => {
  assert.deepEqual(layoutMap(buildLanes(sampleEpic())).focus, { row: 'WEB-8', col: 2 });
});

for (const taskId of ['goal', 'merge']) {
  test(`layout: task id ${taskId} keeps its step chain separate from service rows`, () => {
    const epic = {
      title: 'Certificate rollout', goal: 'Staging accepts the certificate',
      tasks: [{
        id: taskId, title: 'Staging certificate', role: 'main',
        branches: [{ repo: 'ops', name: 'feat/certificate' }],
        steps: [
          { id: 'issue', title: 'Issue certificate', state: 'done' },
          { id: 'check', title: 'Check certificate', state: 'active', after: [`${taskId}/issue`] },
        ],
      }],
      mergeOrder: [{ id: 'release', text: 'Release certificate', branch: 'ops:feat/certificate' }],
    };
    const layout = layoutMap(buildLanes(epic));
    assert.deepEqual(layout.rows.map((r) => [r.id, r.kind]), [[taskId, 'lane'], ['@merge', 'merge'], ['@goal', 'goal']]);
    assert.equal(new Set(layout.rows.map((r) => r.id)).size, layout.rows.length);
    assert.deepEqual(layout.rows.find((r) => r.kind === 'lane').cells.map((c) => [c.id, c.col]), [['issue', 0], ['check', 1]]);
    assert.deepEqual(layout.rows.find((r) => r.kind === 'goal').cells.map((c) => [c.id, c.col]), [['@goal', 3]]);
    assert.deepEqual(layout.edges, [
      { from: { row: taskId, col: 0 }, to: { row: taskId, col: 1 }, label: null },
      { from: { row: taskId, col: 1 }, to: { row: '@merge', col: 2 }, label: null },
      { from: { row: '@merge', col: 2 }, to: { row: '@goal', col: 3 }, label: null },
    ]);
    assert.deepEqual(layout.focus, { row: taskId, col: 1 });
  });
}

test('overview: side cards are separate from the task chain and have no map coordinates', () => {
  const o = buildOverview(sampleEpic());
  assert.deepEqual(o.nodes.map((n) => [n.id, n.col, n.row]), [
    ['API-7', 0, 0], ['WEB-8', 1, 0], ['@merge', 2, 0], ['@goal', 3, 0],
  ]);
  assert.deepEqual(o.side.map((n) => [n.id, n.kind, n.side]), [['OPS-3', 'task', true]]);
  assert.equal(o.side[0].col, undefined);
  assert.equal(o.side[0].row, undefined);
  assert.equal(o.cols, 4);
  assert.equal(o.rows, 1);
});

test('overview: multiple side cards keep their order and have no dependency, merge or goal arrows', () => {
  const epic = sampleEpic();
  const side = epic.tasks.find((t) => t.id === 'OPS-3');
  side.steps = [{ id: 'cert', title: 'Issue staging certificate', state: 'todo', after: ['API-7/meta'] }];
  side.branches = [{ repo: 'ops', name: 'feat/staging-certificate' }];
  epic.tasks[1].steps[3].after = ['WEB-8/s3', 'OPS-3/cert'];
  epic.tasks.push({
    id: 'DOC-4', title: '[docs] Staging guide', role: 'side',
    steps: [{ id: 'guide', title: 'Write staging guide', state: 'todo', after: ['OPS-3/cert', 'WEB-8/s4'] }],
  });
  epic.mergeOrder.push({ id: 'm4', text: 'Staging certificate', branch: 'ops:feat/staging-certificate' });
  const o = buildOverview(epic);
  const sideIds = new Set(['OPS-3', 'DOC-4']);
  assert.ok(o.edges.every((e) => !sideIds.has(e.from) && !sideIds.has(e.to)));
  assert.deepEqual(o.edges.map((e) => `${e.from}>${e.to}`).sort(), ['@merge>@goal', 'API-7>WEB-8', 'WEB-8>@merge']);
  assert.deepEqual(o.nodes.map((n) => [n.id, n.col, n.row]), [
    ['API-7', 0, 0], ['WEB-8', 1, 0], ['@merge', 2, 0], ['@goal', 3, 0],
  ]);
  assert.deepEqual(o.side.map((n) => n.id), ['OPS-3', 'DOC-4']);
  assert.ok(o.side.every((n) => n.col === undefined && n.row === undefined));
  assert.equal(o.cols, 4);
  assert.equal(o.rows, 1);
});

test('overview: side task ids goal and merge stay distinct from service nodes', () => {
  const epic = sampleEpic();
  epic.tasks = epic.tasks.filter((t) => t.role !== 'side');
  epic.tasks.push(
    {
      id: 'goal', title: '[ops] Staging certificate', role: 'side',
      steps: [{ id: 'cert', title: 'Issue certificate', state: 'active', after: ['API-7/meta'] }],
      branches: [{ repo: 'ops', name: 'feat/certificate' }],
    },
    {
      id: 'merge', title: '[docs] Certificate guide', role: 'side',
      steps: [{ id: 'guide', title: 'Write certificate guide', state: 'todo', after: ['goal/cert'] }],
      branches: [{ repo: 'docs', name: 'feat/certificate-guide' }],
    },
  );
  epic.tasks[1].steps[3].after = ['WEB-8/s3', 'goal/cert', 'merge/guide'];
  epic.mergeOrder.push(
    { id: 'certificate', text: 'Release certificate', branch: 'ops:feat/certificate' },
    { id: 'guide', text: 'Publish certificate guide', branch: 'docs:feat/certificate-guide' },
  );
  const o = buildOverview(epic);
  assert.ok(Array.isArray(o.side), 'side cards have their own collection');
  const cards = [...o.nodes, ...o.side];
  assert.equal(new Set(cards.map((n) => n.id)).size, cards.length, 'every task and service node has a unique id');
  assert.equal(o.nodes.find((n) => n.kind === 'goal').id, '@goal');
  assert.equal(o.nodes.find((n) => n.kind === 'merge').id, '@merge');
  assert.deepEqual(o.side.map((n) => [n.id, n.kind, n.side]), [['goal', 'task', true], ['merge', 'task', true]]);
  assert.ok(o.edges.every((e) => !['goal', 'merge'].includes(e.from) && !['goal', 'merge'].includes(e.to)));
  assert.deepEqual(o.edges.map((e) => `${e.from}>${e.to}`).sort(), ['@merge>@goal', 'API-7>WEB-8', 'WEB-8>@merge']);
  assert.deepEqual(o.nodes.map((n) => [n.id, n.col, n.row]), [
    ['API-7', 0, 0], ['WEB-8', 1, 0], ['@merge', 2, 0], ['@goal', 3, 0],
  ]);
  assert.equal(o.cols, 4);
});

test('overview: no side tasks produce an empty side collection', () => {
  const epic = sampleEpic();
  epic.tasks = epic.tasks.filter((t) => t.role !== 'side');
  const o = buildOverview(epic);
  assert.deepEqual(o.side, []);
  assert.equal(o.cols, 4);
  assert.equal(o.rows, 1);
});

test('overview: side-only tasks leave one goal cell and no arrows in the map', () => {
  const o = buildOverview({
    goal: 'Staging is ready',
    tasks: [
      { id: 'OPS-3', title: 'Staging certificates', role: 'side', steps: [{ id: 'cert', title: 'Issue certificate', state: 'active' }] },
      { id: 'DOC-4', title: 'Staging guide', role: 'side', steps: [{ id: 'guide', title: 'Write guide', state: 'todo', after: ['OPS-3/cert'] }] },
    ],
  });
  assert.deepEqual(o.nodes.map((n) => [n.id, n.col, n.row]), [['@goal', 0, 0]]);
  assert.deepEqual(o.side.map((n) => n.id), ['OPS-3', 'DOC-4']);
  assert.deepEqual(o.edges, []);
  assert.equal(o.cols, 1);
  assert.equal(o.rows, 1);
});

test('overview: side cards carry task metadata and count only unresolved waiting items', () => {
  const epic = sampleEpic();
  const side = epic.tasks.find((t) => t.id === 'OPS-3');
  side.status = 'Testing';
  side.steps = [
    { id: 'cert', title: 'Issue staging certificate', state: 'done' },
    { id: 'check', title: 'Check certificate', state: 'active' },
    { id: 'deploy', title: 'Deploy certificate', state: 'todo' },
  ];
  side.branches = [{ repo: 'ops', name: 'feat/certificate' }, { repo: 'tools', name: 'feat/certificate-check' }];
  epic.facts['ops:feat/certificate'] = { unpushed: 2, dirty: false };
  epic.facts['tools:feat/certificate-check'] = { unpushed: 0, dirty: true };
  epic.waiting.push(
    { id: 'approve-cert', task: 'OPS-3', title: 'Approve certificate' },
    { id: 'check-cert', task: 'OPS-3', title: 'Check certificate' },
    { id: 'issued-cert', task: 'OPS-3', title: 'Issue certificate', doneAt: '2026-10-16T10:00:00Z' },
  );
  const o = buildOverview(epic);
  assert.ok(Array.isArray(o.side), 'side cards have their own collection');
  const card = o.side.find((n) => n.id === 'OPS-3');
  assert.ok(card, 'the side task has an overview card');
  assert.equal(card.kind, 'task');
  assert.equal(card.side, true);
  assert.equal(card.title, 'Staging certificates');
  assert.equal(card.fullTitle, '[ops] Staging certificates');
  assert.equal(card.status, 'Testing');
  assert.deepEqual(card.progress, { done: 1, total: 3 });
  assert.deepEqual(card.current, ['Check certificate']);
  assert.equal(card.waiting, 2);
  assert.equal(card.unpushed, true);
  assert.equal(card.dirty, true);
});

test('overview: card carries progress, current step, waiting count and branch flags', () => {
  const card = buildOverview(sampleEpic()).nodes.find((n) => n.id === 'WEB-8');
  assert.deepEqual(card.progress, { done: 2, total: 4 });
  assert.deepEqual(card.current, ['Wire the API']);
  assert.equal(card.waiting, 1);
  assert.equal(card.unpushed, true);
  assert.equal(card.dirty, false);
  assert.equal(card.status, 'In progress');
});

test('overview: step links collapse into one labelled arrow per task pair', () => {
  const epic = sampleEpic();
  epic.tasks[1].steps[3].after = ['WEB-8/s3', 'API-7/night'];
  epic.tasks[1].steps[3].label = 'nightly results';
  const edges = buildOverview(epic).edges.map((e) => `${e.from}>${e.to}|${e.labels.join(',')}`);
  assert.ok(edges.includes('API-7>WEB-8|draft schema,nightly results'));
  assert.ok(edges.includes('WEB-8>@merge|'));
  assert.ok(edges.includes('@merge>@goal|'));
  assert.ok(!edges.some((e) => e.startsWith('API-7>@goal')), 'a task feeding another task does not also point at the goal');
});

test('overview: cards of one column stack in rows', () => {
  const epic = sampleEpic();
  epic.tasks.push({ id: 'WEB-9', title: '[web] Catalog', role: 'main', steps: [{ id: 'c', title: 'Catalog', state: 'todo', after: ['API-7/meta'] }] });
  const o = buildOverview(epic);
  const pos = (id) => { const n = o.nodes.find((x) => x.id === id); return [n.col, n.row]; };
  assert.deepEqual(pos('WEB-8'), [1, 0]);
  assert.deepEqual(pos('WEB-9'), [1, 1]);
  assert.equal(o.rows, 2);
});

test('done waiting items count nowhere', () => {
  const epic = sampleEpic();
  epic.waiting[0].doneAt = '2026-10-16T10:00:00Z';
  assert.equal(buildLanes(epic).merge[2].waiting, false);
  assert.equal(buildOverview(epic).nodes.find((n) => n.id === 'WEB-8').waiting, 0);
});

test('default opened task: the one with the active step, else the first lane', () => {
  const epic = sampleEpic();
  const side = epic.tasks.pop();
  side.steps = [{ id: 'cert', title: 'Issue certificate', state: 'active' }];
  epic.tasks.unshift(side);
  assert.equal(defaultOpen(buildLanes(epic)), 'WEB-8');
  epic.tasks.find((t) => t.id === 'WEB-8').steps[2].state = 'todo';
  assert.equal(defaultOpen(buildLanes(epic)), 'API-7');
  assert.equal(defaultOpen(buildLanes({ tasks: [] })), null);
});

test('default opened task: the first side task when no main tasks exist', () => {
  const epic = {
    tasks: [
      { id: 'OPS-3', title: 'Staging certificates', role: 'side', steps: [] },
      { id: 'DOC-4', title: 'Staging guide', role: 'side', steps: [{ id: 'guide', title: 'Write guide', state: 'active' }] },
    ],
  };
  assert.equal(defaultOpen(buildLanes(epic)), 'OPS-3');
});

test('default step of a task: active, else the first unfinished, else the last', () => {
  const lanes = buildLanes(sampleEpic()).lanes;
  assert.equal(defaultStep(lanes[1]), 's3');
  assert.equal(defaultStep(lanes[0]), 'night');
  assert.equal(defaultStep({ steps: [{ id: 'a', state: 'done' }, { id: 'b', state: 'done' }] }), 'b');
  assert.equal(defaultStep({ steps: [] }), null);
});

const stackCards = Object.freeze([
  Object.freeze({ id: 'OPS-3', title: 'Staging certificates' }),
  Object.freeze({ id: 'DOC-4', title: 'Staging guide' }),
  Object.freeze({ id: 'QA-5', title: 'Staging acceptance' }),
]);

test('side stack: the open side task wins and repeated selection is stable', () => {
  const stack = sideStack(stackCards, 'DOC-4', 'QA-5');
  assert.equal(stack.front, stackCards[1]);
  assert.deepEqual(stack.back, [stackCards[0], stackCards[2]]);
  assert.deepEqual(sideStack(stackCards, 'DOC-4', stack.front.id), stack);
  assert.deepEqual(stackCards.map((c) => c.id), ['OPS-3', 'DOC-4', 'QA-5']);
});

test('side stack: opening a main task keeps the previously selected side task', () => {
  const stack = sideStack(stackCards, 'WEB-8', 'QA-5');
  assert.equal(stack.front, stackCards[2]);
  assert.deepEqual(stack.back, [stackCards[0], stackCards[1]]);
  assert.deepEqual(sideStack(stackCards, 'API-7', stack.front.id), stack);
});

test('side stack: stale ids fall back to a surviving previous task or the first card', () => {
  assert.equal(sideStack(stackCards, 'removed-open', 'DOC-4').front, stackCards[1]);
  const fallback = { front: stackCards[0], back: [stackCards[1], stackCards[2]] };
  assert.deepEqual(sideStack(stackCards, 'removed-open', 'removed-previous'), fallback);
  assert.deepEqual(sideStack(stackCards, null, 'removed-previous'), fallback);
  assert.deepEqual(sideStack(stackCards, null, null), fallback);
});

test('side stack: zero cards have no front or back even with stale selections', () => {
  assert.deepEqual(sideStack([], 'OPS-3', 'DOC-4'), { front: null, back: [] });
});

test('side stack: one card stays in front without duplicating it in back', () => {
  assert.deepEqual(sideStack([stackCards[0]], 'WEB-8', 'removed-previous'), { front: stackCards[0], back: [] });
  assert.deepEqual(sideStack([stackCards[0]], 'OPS-3', 'OPS-3'), { front: stackCards[0], back: [] });
});
