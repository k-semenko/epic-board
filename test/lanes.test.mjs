import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleEpic } from './fixtures/sample-epic.mjs';
import { buildLanes, layoutMap, buildOverview, defaultOpen, defaultStep } from '../server/page/lanes.mjs';

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
  assert.ok(edges.includes('WEB-8:3>merge:4'));
  assert.ok(edges.includes('merge:6>goal:7'));
  assert.ok(!edges.some((e) => e.endsWith('>goal:7') && !e.startsWith('merge:')), 'only the merge chain is drawn into the goal; lane-wide arcs were noise');
});

test('layout: active cell is reported for scrolling into view', () => {
  assert.deepEqual(layoutMap(buildLanes(sampleEpic())).focus, { row: 'WEB-8', col: 2 });
});

test('overview: one card per task, columns by task dependencies, then merge and goal', () => {
  const o = buildOverview(sampleEpic());
  const node = (id) => o.nodes.find((n) => n.id === id);
  assert.deepEqual(['API-7', 'WEB-8', 'merge', 'goal'].map((id) => node(id).col), [0, 1, 2, 3]);
  assert.equal(node('OPS-3'), undefined, 'side tasks stay off the overview');
  assert.equal(o.cols, 4);
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
  assert.ok(edges.includes('WEB-8>merge|'));
  assert.ok(edges.includes('merge>goal|'));
  assert.ok(!edges.some((e) => e.startsWith('API-7>goal')), 'a task feeding another task does not also point at the goal');
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
  assert.equal(defaultOpen(buildLanes(sampleEpic())), 'WEB-8');
  const epic = sampleEpic();
  epic.tasks[1].steps[2].state = 'todo';
  assert.equal(defaultOpen(buildLanes(epic)), 'API-7');
  assert.equal(defaultOpen(buildLanes({ tasks: [] })), null);
});

test('default step of a task: active, else the first unfinished, else the last', () => {
  const lanes = buildLanes(sampleEpic()).lanes;
  assert.equal(defaultStep(lanes[1]), 's3');
  assert.equal(defaultStep(lanes[0]), 'night');
  assert.equal(defaultStep({ steps: [{ id: 'a', state: 'done' }, { id: 'b', state: 'done' }] }), 'b');
  assert.equal(defaultStep({ steps: [] }), null);
});
