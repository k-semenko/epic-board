import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.mjs';
import { BoardError } from './errors.mjs';
import { migrateWaiting, prepareWaitingPatch, transitionWaiting, validateWaiting } from './waiting.mjs';

// Any tracker key works as an id (42, PROJ-12, gh.341); it also names files, so no slashes or leading dots.
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const SCHEMA = 3;
export const WAITING_KINDS = ['decision', 'approval', 'review', 'action', 'other'];
export const PROVIDERS = ['gitlab', 'github'];

export function checkId(id) {
  const value = String(id ?? '');
  if (!ID.test(value)) throw new BoardError(400, 'bad-id', `epic id must match ${ID.source}, got "${value}"`);
  return value;
}

function epicsDir() {
  const dir = path.join(dataDir(), 'epics');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function epicPath(id) {
  return path.join(epicsDir(), `${checkId(id)}.json`);
}

const historyPath = (id) => path.join(epicsDir(), `${checkId(id)}.history.ndjson`);
const lockPath = (id) => path.join(epicsDir(), `${checkId(id)}.lock`);

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Only a dead owner loses the lock: a slow but live writer must never have its write raced.
export function withLock(id, fn, { timeoutMs = 5000 } = {}) {
  const file = lockPath(id);
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner = null;
      try {
        owner = JSON.parse(fs.readFileSync(file, 'utf8')).pid;
      } catch {}
      if (owner && !alive(owner)) {
        try {
          fs.unlinkSync(file);
        } catch {}
        continue;
      }
      if (Date.now() > until) throw new BoardError(423, 'locked', `epic ${id} is locked by process ${owner ?? '?'}, retry later`);
      pause(25);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
}

export function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

const OLD_KINDS = { ddl: 'action', smoke: 'action', approve: 'approval' };

// Schema 1 was tied to one tracker and one forge; the file is rewritten on the next save.
export function migrate(epic) {
  if (!epic || (epic.schema ?? 1) >= SCHEMA) return epic;
  const out = { ...epic, schema: SCHEMA, repos: {} };
  for (const [name, repo] of Object.entries(epic.repos || {})) {
    const { glab, ...rest } = repo;
    out.repos[name] = glab ? { ...rest, provider: 'gitlab', project: glab } : rest;
  }
  out.tasks = (epic.tasks || []).map(({ stage, stageCheckedAt, ...t }) => ({
    ...t,
    ...(stage !== undefined ? { status: stage } : {}),
    ...(stageCheckedAt !== undefined ? { statusCheckedAt: stageCheckedAt } : {}),
  }));
  const taskIds = new Set(out.tasks.map((t) => t.id));
  // Schema 1 never validated these items, so a migrated file must not fail its first write.
  out.waiting = (epic.waiting || []).map(({ text, kind, task, ...w }) => migrateWaiting({
    ...w,
    ...(task !== undefined && taskIds.has(task) ? { task } : {}),
    kind: OLD_KINDS[kind] || (WAITING_KINDS.includes(kind) ? kind : 'other'),
    title: w.title || text || '(untitled)',
  }, epic.id));
  return out;
}

export function readEpic(id) {
  const file = epicPath(id);
  if (!fs.existsSync(file)) throw new BoardError(404, 'no-epic', `no epic ${id}`);
  try {
    return migrate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    throw new BoardError(500, 'broken-epic', `cannot parse epic file ${file} (${e.message})`);
  }
}

export function listEpics() {
  const out = [];
  for (const name of fs.readdirSync(epicsDir())) {
    if (!name.endsWith('.json') || !ID.test(name.slice(0, -5))) continue;
    try {
      out.push(readEpic(name.slice(0, -5)));
    } catch {}
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function saveEpic(epic) {
  writeAtomic(epicPath(epic.id), `${JSON.stringify(epic, null, 2)}\n`);
}

export function appendHistory(id, events) {
  if (!events.length) return;
  fs.appendFileSync(historyPath(id), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

export function readHistory(id, { limit = 20 } = {}) {
  const file = historyPath(id);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const events = [];
  // A hand-damaged line must not take the whole history (and the page) down with it.
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  return events.slice(-limit).reverse();
}

export function createEpic({ id, title, goal = '' }, { by = 'cli' } = {}) {
  checkId(id);
  if (!title) throw new BoardError(400, 'no-title', 'an epic needs a title (--title)');
  return withLock(id, () => {
    if (fs.existsSync(epicPath(id))) throw new BoardError(409, 'exists', `epic ${id} already exists`);
    const at = new Date().toISOString();
    const epic = {
      schema: SCHEMA, id: String(id), title, goal, createdAt: at, updatedAt: at,
      repos: {}, tasks: [], waiting: [], mergeOrder: [], decisions: [], sessions: [], facts: {},
    };
    saveEpic(epic);
    appendHistory(id, [{ at, by, op: 'add', path: 'epic', before: null, after: { title, goal }, why: '' }]);
    return epic;
  });
}
const MERGE_KEYS = {
  tasks: ['id'], steps: ['id'], branches: ['repo', 'name'], open: ['id'],
  waiting: ['id'], decisions: ['id'], sessions: ['id'], docs: ['id'],
};
const APPEND_ONLY = new Set(['decisions']);
const IMMUTABLE = ['id', 'schema', 'createdAt', 'updatedAt'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (item, keys) => keys.map((k) => item[k]).join(':');

function stripMeta(item) {
  const { $delete, ...rest } = item;
  return rest;
}

function mergeArray(base, patch, name, at, changes) {
  const keys = MERGE_KEYS[name];
  if (!keys) {
    if (!same(base, patch)) changes.push({ op: 'set', path: at, before: base ?? null, after: patch });
    return patch;
  }
  const out = [...(base || [])];
  for (const item of patch) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BoardError(400, 'bad-item', `${at}: items must be objects`);
    for (const k of keys) {
      if (item[k] === undefined || item[k] === '') throw new BoardError(400, 'no-key', `${at}: item has no "${k}"`);
    }
    const key = keyOf(item, keys);
    const where = `${at}[${key}]`;
    const index = out.findIndex((x) => keyOf(x, keys) === key);
    if (item.$delete) {
      if (APPEND_ONLY.has(name)) throw new BoardError(400, 'append-only', `${at}: entries can only be added`);
      if (index >= 0) {
        changes.push({ op: 'remove', path: where, before: out[index], after: null });
        out.splice(index, 1);
      }
      continue;
    }
    if (index < 0) {
      const added = stripMeta(item);
      changes.push({ op: 'add', path: where, before: null, after: added });
      out.push(added);
    } else {
      if (APPEND_ONLY.has(name)) throw new BoardError(400, 'append-only', `${at}: entry ${key} exists and cannot be edited`);
      out[index] = mergeObject(out[index], stripMeta(item), where, changes);
    }
  }
  return out;
}

function mergeObject(base, patch, at, changes) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const where = at ? `${at}.${k}` : k;
    if (v === null) {
      if (k in out) {
        changes.push({ op: 'remove', path: where, before: out[k], after: null });
        delete out[k];
      }
    } else if (Array.isArray(v)) {
      out[k] = mergeArray(out[k], v, k, where, changes);
    } else if (typeof v === 'object') {
      const prev = out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? out[k] : {};
      out[k] = mergeObject(prev, v, where, changes);
    } else if (!same(out[k], v)) {
      changes.push({ op: 'set', path: where, before: out[k] ?? null, after: v });
      out[k] = v;
    }
  }
  return out;
}

// Refnames are validated here, not by git, so a hostile name never reaches a git argv.
const BAD_REF = /(^-)|(^\/)|(\/$)|(\.\.)|(@\{)|(\.lock$)|(\/\.)|(^\.)|[\s~^:?*[\\\x00-\x1f\x7f]/;

const URL_RE = /^https?:\/\/[^\s]+$/i;

function checkUrl(value, where) {
  if (value !== undefined && (typeof value !== 'string' || !URL_RE.test(value))) throw new BoardError(400, 'bad-url', `${where}: url must start with http:// or https://`);
}

// A pending item points at things already on the board, so the page can jump to them.
function refExists(epic, ref) {
  if (typeof ref !== 'string') return false;
  if (URL_RE.test(ref)) return true;
  const [kind, ...rest] = ref.split(':');
  const value = rest.join(':');
  const tasks = epic.tasks || [];
  if (kind === 'task') return tasks.some((t) => t.id === value);
  if (kind === 'step') {
    const [task, step] = value.split('/');
    return tasks.some((t) => t.id === task && (t.steps || []).some((s) => s.id === step));
  }
  if (kind === 'branch') return tasks.some((t) => (t.branches || []).some((b) => `${b.repo}:${b.name}` === value));
  if (kind === 'doc') return (epic.docs || []).some((d) => d.id === value);
  if (kind === 'decision') return (epic.decisions || []).some((d) => d.id === value);
  if (kind === 'waiting') return (epic.waiting || []).some((w) => w.id === value);
  return false;
}

export function validateEpic(epic) {
  const steps = new Set();
  for (const t of epic.tasks || []) for (const s of t.steps || []) steps.add(`${t.id}/${s.id}`);
  if (epic.docsMode !== undefined && !['board', 'linked'].includes(epic.docsMode)) {
    throw new BoardError(400, 'bad-docs-mode', 'docsMode is board or linked');
  }
  checkUrl(epic.url, 'epic');
  for (const [name, repo] of Object.entries(epic.repos || {})) {
    if (repo.provider !== undefined && !PROVIDERS.includes(repo.provider)) throw new BoardError(400, 'bad-provider', `repo ${name}: provider is ${PROVIDERS.join(' or ')}`);
    if (repo.project !== undefined && !/^[\w.-]+(\/[\w.-]+)+$/.test(String(repo.project))) throw new BoardError(400, 'bad-project', `repo ${name}: project is host/owner/name, e.g. github.com/acme/web`);
  }
  for (const s of epic.sessions || []) {
    if (s.agent !== undefined && !/^[a-z0-9-]{1,20}$/.test(String(s.agent))) {
      throw new BoardError(400, 'bad-agent', `session ${s.id}: agent is a lowercase name such as claude, codex, grok`);
    }
  }
  for (const t of epic.tasks || []) {
    if (!ID.test(String(t.id))) throw new BoardError(400, 'bad-task-id', `task id must match ${ID.source}, got "${t.id}"`);
    checkUrl(t.url, `task ${t.id}`);
    if (t.role && !['main', 'side'].includes(t.role)) throw new BoardError(400, 'bad-role', `task ${t.id}: role is main or side`);
    for (const s of t.steps || []) {
      if (!/^[\w.-]{1,64}$/.test(String(s.id))) throw new BoardError(400, 'bad-step-id', `task ${t.id}: step id may use letters, digits, _ . -`);
      if (s.state && !['done', 'active', 'todo', 'blocked', 'waiting'].includes(s.state)) {
        throw new BoardError(400, 'bad-state', `step ${t.id}/${s.id}: state is done, active, todo, blocked or waiting`);
      }
      for (const ref of s.after || []) {
        if (!steps.has(ref)) throw new BoardError(400, 'bad-after', `step ${t.id}/${s.id}: after points to a missing step ${ref}`);
      }
    }
    for (const b of t.branches || []) {
      if (!epic.repos?.[b.repo]) throw new BoardError(400, 'bad-repo', `branch ${b.name}: repo "${b.repo}" is not described (epic.mjs repo ...)`);
      if (typeof b.name !== 'string' || BAD_REF.test(b.name)) throw new BoardError(400, 'bad-branch', `invalid branch name: "${b.name}"`);
      if (b.mr && !Number.isInteger(b.mr.iid)) throw new BoardError(400, 'bad-mr', `branch ${b.name}: mr.iid is an integer`);
    }
  }
  for (const w of epic.waiting || []) {
    validateWaiting(w);
    if (!w.title) throw new BoardError(400, 'no-title', `pending item ${w.id}: needs a title`);
    if (w.kind !== undefined && !WAITING_KINDS.includes(w.kind)) throw new BoardError(400, 'bad-kind', `pending item ${w.id}: kind is ${WAITING_KINDS.join(', ')}`);
    if (w.task !== undefined && !(epic.tasks || []).some((t) => t.id === w.task)) throw new BoardError(400, 'bad-ref', `pending item ${w.id}: no task ${w.task}`);
    for (const ref of w.refs || []) {
      if (!refExists(epic, ref)) throw new BoardError(400, 'bad-ref', `pending item ${w.id}: "${ref}" is neither a board item (task:, step:, branch:, doc:, decision:) nor an http(s) link`);
    }
    const ids = new Set();
    for (const c of w.checklist || []) {
      if (!c || !c.id || !c.text || ids.has(c.id)) throw new BoardError(400, 'bad-checklist', `pending item ${w.id}: every checklist item needs a unique id and text`);
      ids.add(c.id);
    }
  }
}

function prepareDecisions(epic, patch, at) {
  if (!Array.isArray(patch.decisions)) return patch;
  let n = (epic.decisions || []).length;
  return { ...patch, decisions: patch.decisions.map((d) => (d.id ? d : { ...d, id: `d${++n}`, at: d.at || at })) };
}

// `check` sees the merged epic under the lock, before anything is written.
export function patchEpic(id, patch, { by = 'cli', why = '', lockTimeoutMs, check } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new BoardError(400, 'bad-patch', 'patch must be an object');
  if ('facts' in patch) throw new BoardError(400, 'facts-readonly', 'facts are written by refresh only');
  for (const k of IMMUTABLE) {
    if (k in patch) throw new BoardError(400, 'immutable', `field ${k} cannot be changed`);
  }
  return withLock(id, () => {
    const epic = readEpic(id);
    const at = new Date().toISOString();
    const changes = [];
    const next = mergeObject(epic, prepareDecisions(epic, prepareWaitingPatch(epic, patch, at), at), '', changes);
    validateEpic(next);
    if (check) check(next);
    if (!changes.length) return { epic, changes };
    next.updatedAt = at;
    saveEpic(next);
    appendHistory(id, changes.map((c) => ({ at, by, why, ...c })));
    return { epic: next, changes };
  }, lockTimeoutMs ? { timeoutMs: lockTimeoutMs } : undefined);
}
function pendingItem(epic, itemId) {
  const item = (epic.waiting || []).find((w) => w.id === itemId);
  if (!item) throw new BoardError(404, 'no-waiting', `no pending item ${itemId}`);
  return item;
}

function changeWaiting(id, itemId, action, body, { by = 'cli', why = '' } = {}) {
  return withLock(id, () => {
    const epic = readEpic(id);
    const before = pendingItem(epic, itemId);
    const at = new Date().toISOString();
    const after = transitionWaiting(before, action, body, { by, at });
    if (after === before) return epic;
    const next = { ...epic, updatedAt: at, waiting: epic.waiting.flatMap((item) => item.id === itemId ? (after ? [after] : []) : [item]) };
    validateEpic(next);
    const changes = after ? [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !same(before[key], after[key])).map((key) => ({ op: 'set', path: `waiting[${itemId}].${key}`, before: before[key] ?? null, after: after[key] ?? null })) : [{ op: 'remove', path: `waiting[${itemId}]`, before, after: null }];
    saveEpic(next);
    appendHistory(id, changes.map((change) => ({ at, by, why, ...change })));
    return next;
  });
}

export function submitWaiting(id, itemId, body, opts) {
  return changeWaiting(id, itemId, 'submit', body, opts);
}

export function resolveWaiting(id, itemId, body, opts) {
  return changeWaiting(id, itemId, 'resolve', body, opts);
}

export function reviseWaiting(id, itemId, body, opts) {
  return changeWaiting(id, itemId, 'revise', body, opts);
}

export function removeWaiting(id, itemId, body, opts) {
  return changeWaiting(id, itemId, 'remove', body, opts);
}

export function reopenWaiting() {
  throw new BoardError(400, 'waiting-action', 'use wait revise with version and a reason');
}

const WATCHED = ['head', 'behind', 'ahead', 'unpushed', 'remoteBehind', 'dirty', 'mr.state', 'mr.draft', 'mr.pipeline', 'error'];
const pick = (obj, dotted) => dotted.split('.').reduce((v, k) => (v == null ? undefined : v[k]), obj);

// A failed refresh keeps the last good facts and their fetchedAt, so the page can show them as stale.
export function writeFacts(id, results, { at = new Date().toISOString() } = {}) {
  return withLock(id, () => {
    const epic = readEpic(id);
    const facts = { ...(epic.facts || {}) };
    const events = [];
    for (const [key, result] of Object.entries(results)) {
      const prev = facts[key] || null;
      const next = result.error ? { ...(prev || {}), error: result.error, errorAt: at } : { ...result, fetchedAt: at, error: null };
      // A glab failure keeps the last good MR facts, like a git failure keeps the branch facts.
      if (!result.error && next.mr) next.mr = next.mr.error ? { ...(prev?.mr || {}), error: next.mr.error, errorAt: at } : { ...next.mr, fetchedAt: at };
      for (const field of WATCHED) {
        const before = pick(prev, field) ?? null;
        const after = pick(next, field) ?? null;
        if (!same(before, after)) events.push({ at, by: 'refresh', why: '', op: 'refresh', path: `facts.${key}.${field}`, before, after });
      }
      facts[key] = next;
    }
    epic.facts = facts;
    epic.updatedAt = at;
    saveEpic(epic);
    appendHistory(id, events);
    return epic;
  });
}
