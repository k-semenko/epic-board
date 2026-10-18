import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dataDir, boardUrl } from './paths.mjs';
import { checkId, migrate } from './store.mjs';
import { BoardError } from './errors.mjs';
import { normalizeAfter, parseStepRef } from './step-refs.mjs';

const indexes = new WeakMap();
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value) => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const states = new Set(['todo', 'active', 'done', 'blocked', 'waiting']);

function usableEpic(epic, id) {
  if (!object(epic) || !identity(epic.id) || String(epic.id) !== id || !parseStepRef('task/step', id)) return false;
  if (epic.title != null && typeof epic.title !== 'string') return false;
  if (epic.tasks !== undefined && !Array.isArray(epic.tasks)) return false;
  const tasks = new Set();
  for (const task of epic.tasks || []) {
    if (!object(task) || !identity(task.id) || !parseStepRef(`${task.id}/step`, id) || tasks.has(String(task.id))) return false;
    tasks.add(String(task.id));
    if (task.steps !== undefined && !Array.isArray(task.steps)) return false;
    const steps = new Set();
    for (const step of task.steps || []) {
      if (!object(step) || !identity(step.id) || !parseStepRef(`${task.id}/${step.id}`, id) || steps.has(String(step.id))) return false;
      steps.add(String(step.id));
      if (step.title != null && typeof step.title !== 'string') return false;
      if (step.label != null && typeof step.label !== 'string') return false;
      if (step.state && !states.has(step.state)) return false;
      try { normalizeAfter(step.after ?? [], id); }
      catch { return false; }
    }
  }
  return true;
}

export function readBoardSnapshot() {
  const dir = path.join(dataDir(), 'epics');
  let names;
  try { names = fs.readdirSync(dir); }
  catch (error) {
    if (error.code === 'ENOENT') return { epics: [], errors: [], readAt: new Date().toISOString() };
    throw new BoardError(500, 'unavailable-board', 'cannot list epic files');
  }
  const epics = [];
  const errors = [];
  for (const name of names.sort(compare)) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5);
    if (!parseStepRef('task/step', id)) continue;
    try {
      const epic = migrate(JSON.parse(fs.readFileSync(path.join(dir, `${checkId(id)}.json`), 'utf8')));
      if (!usableEpic(epic, id)) throw new Error('invalid epic shape');
      epics.push(epic);
    } catch {
      errors.push({ id, status: 'unavailable' });
    }
  }
  return { epics, errors, readAt: new Date().toISOString() };
}

function buildIndex(snapshot) {
  if (indexes.has(snapshot)) return indexes.get(snapshot);
  try {
    if (!object(snapshot) || !Array.isArray(snapshot.epics) || !Array.isArray(snapshot.errors)
      || !snapshot.epics.every((epic) => object(epic) && usableEpic(epic, String(epic.id)))
      || !snapshot.errors.every((error) => object(error) && parseStepRef('task/step', error.id) && error.status === 'unavailable')) throw new Error('invalid snapshot shape');
  } catch {
    throw new BoardError(500, 'broken-snapshot', 'invalid board snapshot');
  }
  const epics = new Map(snapshot.epics.map((epic) => [String(epic.id), epic]));
  const errors = [...snapshot.errors].sort((a, b) => compare(a.id, b.id) || compare(a.status, b.status));
  const unavailable = new Set(errors.map((error) => error.id));
  const tasks = new Set();
  const endpoints = new Map();
  const outgoing = new Map();
  const incoming = new Map();
  const baseUrl = boardUrl();
  const epicUrl = (id) => `${baseUrl}e/${encodeURIComponent(id)}`;
  const endpoint = (ref, epic, step) => ({
    epic: ref.epic, task: ref.task, step: ref.step, address: ref.address,
    epicTitle: epic ? epic.title || String(epic.id) : null,
    title: step ? step.title || String(step.id) : null,
    state: step ? step.state || 'todo' : null,
    url: `${epicUrl(ref.epic)}#t-${encodeURIComponent(ref.task)}/${encodeURIComponent(ref.step)}`,
  });
  for (const epic of snapshot.epics) for (const task of epic.tasks || []) {
    tasks.add(`${epic.id}/${task.id}`);
    for (const step of task.steps || []) {
      const ref = parseStepRef(`${task.id}/${step.id}`, epic.id);
      endpoints.set(ref.address, endpoint(ref, epic, step));
    }
  }
  const append = (map, id, edge) => {
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(edge);
  };
  for (const epic of snapshot.epics) for (const task of epic.tasks || []) for (const step of task.steps || []) {
    const sourceRef = parseStepRef(`${task.id}/${step.id}`, epic.id);
    for (const value of normalizeAfter(step.after ?? [], epic.id)) {
      const ref = parseStepRef(value, epic.id);
      if (ref.local) continue;
      const targetEpic = epics.get(ref.epic);
      const target = endpoints.get(ref.address);
      const status = unavailable.has(ref.epic) ? 'unavailable' : !targetEpic ? 'missing-epic' : !tasks.has(`${ref.epic}/${ref.task}`) ? 'missing-task' : !target ? 'missing-step' : 'resolved';
      const edge = { source: endpoints.get(sourceRef.address), target: target || endpoint(ref, targetEpic), label: step.label || '', status };
      append(outgoing, String(epic.id), edge);
      append(incoming, ref.epic, edge);
    }
  }
  const edgeCompare = (a, b) => compare(a.source.address, b.source.address) || compare(a.target.address, b.target.address);
  for (const edges of [...outgoing.values(), ...incoming.values()]) edges.sort(edgeCompare);
  const index = { epics, errors, unavailable, outgoing, incoming, epicUrl };
  indexes.set(snapshot, index);
  return index;
}

export function linksForEpic(snapshot, id) {
  id = checkId(id);
  if (!parseStepRef('task/step', id)) throw new BoardError(400, 'bad-id', 'invalid epic id');
  const index = buildIndex(snapshot);
  if (index.unavailable.has(id)) throw new BoardError(500, 'broken-epic', `cannot read epic ${id}`);
  if (!index.epics.has(id)) throw new BoardError(404, 'no-epic', `no epic ${id}`);
  const outgoing = index.outgoing.get(id) || [];
  const incoming = index.incoming.get(id) || [];
  const related = new Set([...outgoing.map((edge) => edge.target.epic), ...incoming.map((edge) => edge.source.epic)]);
  related.delete(id);
  const relatedEpics = [...related].sort(compare).map((relatedId) => {
    const epic = index.epics.get(relatedId);
    return { id: relatedId, title: epic ? epic.title || relatedId : null, url: index.epicUrl(relatedId), status: index.unavailable.has(relatedId) ? 'unavailable' : epic ? 'resolved' : 'missing-epic' };
  });
  const result = { outgoing, incoming, relatedEpics, incomplete: index.errors.length > 0, errors: index.errors };
  const revision = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  return { ...result, readAt: snapshot.readAt, revision };
}
