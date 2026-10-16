// Pure model of the epic map, shared by the page and the tests: no DOM here.
const STATES = new Set(['done', 'active', 'waiting', 'blocked', 'todo']);
export const MERGE_ID = '@merge';
export const GOAL_ID = '@goal';

const shortTitle = (title) => String(title || '').replace(/^\[[^\]]*\]\s*/, '');

export function buildLanes(epic) {
  const tasks = epic.tasks || [];
  const stepTitles = new Map();
  for (const t of tasks) for (const s of t.steps || []) stepTitles.set(`${t.id}/${s.id}`, s.title);

  const lane = (t) => ({
    id: t.id,
    title: shortTitle(t.title),
    fullTitle: t.title,
    status: t.status ?? null,
    branches: (t.branches || []).map((b) => `${b.repo}:${b.name}`),
    steps: (t.steps || []).map((s) => ({
      id: s.id,
      title: s.title,
      state: STATES.has(s.state) ? s.state : 'todo',
      note: s.note ?? null,
      // Order inside a lane is already shown by the chain; only links from other tasks need words.
      deps: (s.after || [])
        .filter((ref) => !ref.startsWith(`${t.id}/`) && stepTitles.has(ref))
        .map((ref) => ({ task: ref.split('/')[0], step: ref.split('/')[1], title: stepTitles.get(ref), label: s.label ?? null })),
    })),
  });

  const waitingIds = new Set((epic.waiting || []).filter((w) => !w.doneAt).map((w) => w.id));
  const lanes = tasks.filter((t) => t.role !== 'side').map(lane);
  return {
    goal: epic.goal || epic.title,
    lanes,
    side: tasks.filter((t) => t.role === 'side').map(lane),
    merge: (epic.mergeOrder || []).map((m, i) => ({
      n: i + 1,
      text: m.text,
      branch: m.branch ?? null,
      waiting: Boolean(m.waiting && waitingIds.has(m.waiting)),
    })),
    here: lanes.flatMap((l) => l.steps.filter((s) => s.state === 'active').map((s) => ({ task: l.id, step: s.id, title: s.title }))),
  };
}

const lastCol = (row) => (row.cells.length ? row.cells.at(-1).col : -1);

// Columns are a partial order: a step sits right of its lane predecessor and of every step it waits for.
export function layoutMap(map) {
  const col = new Map();
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (const lane of map.lanes) {
      let prev = -1;
      for (const step of lane.steps) {
        let c = prev + 1;
        for (const d of step.deps) {
          const dc = col.get(`${d.task}/${d.step}`);
          if (dc !== undefined) c = Math.max(c, dc + 1);
        }
        const key = `${lane.id}/${step.id}`;
        if (col.get(key) !== c) {
          col.set(key, c);
          changed = true;
        }
        prev = c;
      }
    }
    if (!changed) break;
  }

  const rows = map.lanes.map((lane) => ({ ...lane, kind: 'lane', cells: lane.steps.map((s) => ({ ...s, col: col.get(`${lane.id}/${s.id}`) })) }));
  const edges = [];
  for (const row of rows) {
    row.cells.forEach((cell, i) => {
      if (i > 0) edges.push({ from: { row: row.id, col: row.cells[i - 1].col }, to: { row: row.id, col: cell.col }, label: null });
      for (const d of cell.deps) {
        const dc = col.get(`${d.task}/${d.step}`);
        if (dc !== undefined) edges.push({ from: { row: d.task, col: dc }, to: { row: row.id, col: cell.col }, label: d.label });
      }
    });
  }

  const mergeBranches = new Set(map.merge.map((m) => m.branch).filter(Boolean));
  const merged = rows.filter((r) => r.cells.length && r.branches.some((b) => mergeBranches.has(b)));
  let tail = null;
  if (map.merge.length) {
    const start = Math.max(-1, ...(merged.length ? merged : rows).map(lastCol)) + 1;
    const mergeRow = { kind: 'merge', id: MERGE_ID, title: 'merge', cells: map.merge.map((m, i) => ({ ...m, id: `m${m.n}`, title: m.text, state: m.waiting ? 'waiting' : 'todo', col: start + i })) };
    mergeRow.cells.forEach((cell, i) => {
      if (i > 0) edges.push({ from: { row: MERGE_ID, col: mergeRow.cells[i - 1].col }, to: { row: MERGE_ID, col: cell.col }, label: null });
    });
    for (const r of merged) edges.push({ from: { row: r.id, col: lastCol(r) }, to: { row: MERGE_ID, col: start }, label: null });
    rows.push(mergeRow);
    tail = { row: MERGE_ID, col: lastCol(mergeRow) };
  }

  const goalCol = Math.max(-1, ...rows.map(lastCol)) + 1;
  if (tail) edges.push({ from: tail, to: { row: GOAL_ID, col: goalCol }, label: null });
  // Without a merge chain every lane leads to the goal; with one, arcs from other lanes only add noise.
  if (!tail) for (const r of rows) if (r.cells.length) edges.push({ from: { row: r.id, col: lastCol(r) }, to: { row: GOAL_ID, col: goalCol }, label: null });
  rows.push({ kind: 'goal', id: GOAL_ID, title: 'goal', cells: [{ id: GOAL_ID, title: map.goal, state: 'goal', col: goalCol, deps: [] }] });

  const active = rows.flatMap((r) => r.cells.filter((c) => c.state === 'active').map((c) => ({ row: r.id, col: c.col })));
  return { rows, edges, cols: goalCol + 1, goalCol, focus: active[0] ?? null };
}

// Task-level view: step links collapse into one arrow per task pair, so a long task no longer stretches the map.
export function buildOverview(epic) {
  const map = buildLanes(epic);
  const lanes = map.lanes;
  const links = new Map();
  for (const lane of lanes) {
    for (const step of lane.steps) {
      for (const d of step.deps) {
        const key = `${d.task}>${lane.id}`;
        if (!links.has(key)) links.set(key, { from: d.task, to: lane.id, labels: [] });
        if (d.label && !links.get(key).labels.includes(d.label)) links.get(key).labels.push(d.label);
      }
    }
  }
  const col = new Map(lanes.map((l) => [l.id, 0]));
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (const { from, to } of links.values()) {
      if (!col.has(from)) continue;
      const c = Math.max(col.get(to), col.get(from) + 1);
      if (c !== col.get(to)) {
        col.set(to, c);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const facts = epic.facts || {};
  const taskNode = (l) => {
    const branchFacts = l.branches.map((b) => facts[b]).filter(Boolean);
    return {
      id: l.id,
      kind: 'task',
      title: l.title,
      fullTitle: l.fullTitle,
      status: l.status,
      progress: { done: l.steps.filter((s) => s.state === 'done').length, total: l.steps.length },
      current: l.steps.filter((s) => s.state === 'active').map((s) => s.title),
      waiting: (epic.waiting || []).filter((w) => w.task === l.id && !w.doneAt).length,
      unpushed: branchFacts.some((f) => f.unpushed > 0),
      dirty: branchFacts.some((f) => f.dirty === true),
    };
  };
  const nodes = lanes.map((l) => ({ ...taskNode(l), col: col.get(l.id) }));
  const side = map.side.map((l) => ({ ...taskNode(l), side: true }));
  const edges = [...links.values()].filter((e) => col.has(e.from));

  const mergeBranches = new Set(map.merge.map((m) => m.branch).filter(Boolean));
  const merged = lanes.filter((l) => l.branches.some((b) => mergeBranches.has(b))).map((l) => l.id);
  const lastTaskCol = Math.max(-1, ...nodes.map((n) => n.col));
  let goalFrom = [];
  if (map.merge.length) {
    const start = Math.max(-1, ...nodes.filter((n) => merged.includes(n.id)).map((n) => n.col), merged.length ? -1 : lastTaskCol) + 1;
    nodes.push({
      id: MERGE_ID, kind: 'merge', title: 'merge', col: start,
      progress: { done: 0, total: map.merge.length },
      current: map.merge.filter((m) => m.waiting).map((m) => m.text),
      waiting: map.merge.filter((m) => m.waiting).length,
    });
    for (const id of merged) edges.push({ from: id, to: MERGE_ID, labels: [] });
    goalFrom.push(MERGE_ID);
  }
  const feeds = new Set(edges.map((e) => e.from));
  goalFrom = goalFrom.concat(nodes.filter((n) => n.kind === 'task' && !feeds.has(n.id)).map((n) => n.id));
  const goalCol = Math.max(-1, ...nodes.map((n) => n.col)) + 1;
  nodes.push({ id: GOAL_ID, kind: 'goal', title: map.goal, col: goalCol });
  for (const id of goalFrom) edges.push({ from: id, to: GOAL_ID, labels: [] });

  const perCol = new Map();
  for (const n of nodes) {
    n.row = perCol.get(n.col) ?? 0;
    perCol.set(n.col, n.row + 1);
  }
  return { nodes, side, edges, cols: goalCol + 1, rows: Math.max(...perCol.values()) };
}

export function sideStack(side, open, previous) {
  const front = side.find((n) => n.id === open) ?? side.find((n) => n.id === previous) ?? side[0] ?? null;
  const at = side.indexOf(front);
  return { front, back: at < 0 ? [] : [...side.slice(at + 1), ...side.slice(0, at)] };
}

export function cycleSide(side, current, direction = 1) {
  if (!side.length) return null;
  const at = side.findIndex((n) => n.id === current);
  if (at < 0) return (direction === -1 ? side.at(-1) : side[0]).id;
  return side[(at + direction + side.length) % side.length].id;
}

// The map always shows one task opened: where the work is now, otherwise the first one.
export function defaultOpen(map) {
  return map.here[0]?.task ?? map.lanes[0]?.id ?? map.side[0]?.id ?? null;
}

// The step shown under the timeline: where work is, otherwise the next unfinished one.
export function defaultStep(lane) {
  const steps = lane?.steps || [];
  return (steps.find((s) => s.state === 'active') || steps.find((s) => s.state !== 'done') || steps.at(-1))?.id ?? null;
}
