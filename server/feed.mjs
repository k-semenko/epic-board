import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.mjs';
import { BoardError } from './errors.mjs';
import { ID, withFileLock, writeAtomic, epicPath } from './store.mjs';
import { assertNoSecrets } from './secrets.mjs';
import { readSettings } from './settings.mjs';
import { durationMs } from './settings-registry.mjs';

export const FEED_KINDS = Object.freeze(['mention', 'alert', 'question', 'report', 'info']);
export const FEED_SEVERITIES = Object.freeze(['fire', 'important', 'normal', 'noise']);
export const FEED_MARKS = Object.freeze(['important', 'unimportant', 'noise']);
export const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const CHANGE_FIELDS = ['title', 'body', 'severity', 'kind'];

const feedRoot = () => join(dataDir(), 'feed');
const itemsDir = () => join(feedRoot(), 'items');
const profilesDir = () => join(feedRoot(), 'profiles');
const historyPath = () => join(feedRoot(), 'history.ndjson');
const revPath = () => join(feedRoot(), 'rev.json');
const sourcePath = (source) => join(itemsDir(), `${source}.json`);
const profilePath = (source) => join(profilesDir(), `${source}.md`);
const statsPath = (source) => join(profilesDir(), `${source}.stats.json`);

function ensureDirs() {
  mkdirSync(itemsDir(), { recursive: true });
  mkdirSync(profilesDir(), { recursive: true });
}

function bumpRev() {
  ensureDirs();
  let rev = 0;
  try {
    rev = JSON.parse(readFileSync(revPath(), 'utf8')).rev || 0;
  } catch {}
  const next = rev + 1;
  writeAtomic(revPath(), `${JSON.stringify({ rev: next })}\n`);
  return next;
}

export function feedRev() {
  try {
    return JSON.parse(readFileSync(revPath(), 'utf8')).rev || 0;
  } catch {
    return 0;
  }
}

function appendHistory(event) {
  ensureDirs();
  appendFileSync(historyPath(), `${JSON.stringify({ ...event, at: event.at || new Date().toISOString() })}\n`);
}

function itemId(source, externalId) {
  const hash = createHash('sha1').update(externalId).digest('hex').slice(0, 8);
  return `${source}~${hash}`;
}

export function parseFeedId(id) {
  if (typeof id !== 'string') return null;
  const sep = id.lastIndexOf('~');
  if (sep < 1) return null;
  const source = id.slice(0, sep);
  if (!ID.test(source)) return null;
  return { source, id };
}

function readSourceFile(source) {
  const file = sourcePath(source);
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) throw new Error('bad shape');
    return data;
  } catch (e) {
    if (e.code === 'ENOENT') return { schema: 0, source: source, items: [] };
    throw new BoardError(500, 'broken-feed', `cannot read feed source ${source} (${e.message})`);
  }
}

function writeSourceFile(source, data) {
  ensureDirs();
  writeAtomic(sourcePath(source), `${JSON.stringify({ schema: 0, source, items: data.items }, null, 2)}\n`);
}

function listSourceNames() {
  ensureDirs();
  return readdirSync(itemsDir()).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).filter((name) => ID.test(name));
}

function epicExists(id) {
  try {
    return existsSync(epicPath(id));
  } catch {
    return false;
  }
}

function taskExists(epicId, taskId) {
  try {
    const epic = JSON.parse(readFileSync(epicPath(epicId), 'utf8'));
    return (epic.tasks || []).some((t) => t.id === taskId);
  } catch {
    return false;
  }
}

function stepExists(epicId, taskId, stepId) {
  try {
    const epic = JSON.parse(readFileSync(epicPath(epicId), 'utf8'));
    const task = (epic.tasks || []).find((t) => t.id === taskId);
    return Boolean(task && (task.steps || []).some((s) => s.id === stepId));
  } catch {
    return false;
  }
}

function waitingExists(epicId, waitingId) {
  try {
    const epic = JSON.parse(readFileSync(epicPath(epicId), 'utf8'));
    return (epic.waiting || []).some((w) => w.id === waitingId);
  } catch {
    return false;
  }
}

/** Validate format; drop unknown board objects with warnings. Bad format throws. */
export function normalizeFeedRefs(refs) {
  if (refs === undefined) return { refs: [], warnings: [] };
  if (!Array.isArray(refs)) throw new BoardError(400, 'bad-feed', 'refs must be an array');
  const out = [];
  const warnings = [];
  for (const ref of refs) {
    if (typeof ref !== 'string' || !ref) throw new BoardError(400, 'bad-feed', 'each ref must be a nonempty string');
    if (URL_RE.test(ref)) {
      out.push(ref);
      continue;
    }
    const [kind, ...rest] = ref.split(':');
    const value = rest.join(':');
    if (kind === 'epic') {
      if (!ID.test(value)) throw new BoardError(400, 'bad-feed', `bad ref ${ref}`);
      if (!epicExists(value)) warnings.push(`unknown ${ref}`);
      else out.push(ref);
      continue;
    }
    if (kind === 'task') {
      const [epic, task] = value.split('/');
      if (!ID.test(epic || '') || !ID.test(task || '')) throw new BoardError(400, 'bad-feed', `bad ref ${ref}`);
      if (!taskExists(epic, task)) warnings.push(`unknown ${ref}`);
      else out.push(ref);
      continue;
    }
    if (kind === 'step') {
      const [epic, task, step] = value.split('/');
      if (!ID.test(epic || '') || !ID.test(task || '') || !/^[\w.-]{1,64}$/.test(step || '')) throw new BoardError(400, 'bad-feed', `bad ref ${ref}`);
      if (!stepExists(epic, task, step)) warnings.push(`unknown ${ref}`);
      else out.push(ref);
      continue;
    }
    if (kind === 'waiting') {
      const [epic, waiting] = value.split('/');
      if (!ID.test(epic || '') || !ID.test(waiting || '')) throw new BoardError(400, 'bad-feed', `bad ref ${ref}`);
      if (!waitingExists(epic, waiting)) warnings.push(`unknown ${ref}`);
      else out.push(ref);
      continue;
    }
    throw new BoardError(400, 'bad-feed', `bad ref ${ref}`);
  }
  return { refs: [...new Set(out)], warnings };
}

function validateIncoming(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BoardError(400, 'bad-feed', 'feed item must be an object');
  const source = raw.source;
  const externalId = raw.externalId;
  if (!ID.test(String(source ?? ''))) throw new BoardError(400, 'bad-feed', `source must match ${ID.source}`);
  if (!EXTERNAL_ID.test(String(externalId ?? ''))) throw new BoardError(400, 'bad-feed', 'externalId must be 1–128 chars of letters, digits, . _ : / -');
  if (!FEED_KINDS.includes(raw.kind)) throw new BoardError(400, 'bad-feed', `kind must be ${FEED_KINDS.join('|')}`);
  if (!FEED_SEVERITIES.includes(raw.severity)) throw new BoardError(400, 'bad-feed', `severity must be ${FEED_SEVERITIES.join('|')}`);
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 200) throw new BoardError(400, 'bad-feed', 'title is required, ≤ 200 chars');
  if (raw.body !== undefined && (typeof raw.body !== 'string' || raw.body.length > 2000)) throw new BoardError(400, 'bad-feed', 'body must be a string ≤ 2000 chars');
  if (raw.channel !== undefined && (typeof raw.channel !== 'string' || raw.channel.length > 100)) throw new BoardError(400, 'bad-feed', 'channel must be a string ≤ 100 chars');
  assertNoSecrets(raw.title, 'title');
  if (raw.body) assertNoSecrets(raw.body, 'body');
  if (raw.channel) assertNoSecrets(raw.channel, 'channel');
  const { refs, warnings } = normalizeFeedRefs(raw.refs);
  return {
    source,
    externalId,
    kind: raw.kind,
    severity: raw.severity,
    title: raw.title.trim(),
    body: raw.body || undefined,
    channel: raw.channel || undefined,
    refs,
    warnings,
  };
}

function dayKey(iso = new Date().toISOString()) {
  return iso.slice(0, 10);
}

function readStats(source) {
  try {
    return JSON.parse(readFileSync(statsPath(source), 'utf8'));
  } catch {
    return { days: {} };
  }
}

function writeStats(source, stats) {
  ensureDirs();
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const minDay = cutoff.toISOString().slice(0, 10);
  for (const day of Object.keys(stats.days || {})) {
    if (day < minDay) delete stats.days[day];
  }
  writeAtomic(statsPath(source), `${JSON.stringify(stats, null, 2)}\n`);
}

function bumpStat(source, severity, mark, delta, at = new Date().toISOString(), meta = {}) {
  const stats = readStats(source);
  const day = dayKey(at);
  stats.days[day] ||= {};
  const key = `${severity}:${mark}`;
  stats.days[day][key] = (stats.days[day][key] || 0) + delta;
  if (stats.days[day][key] === 0) delete stats.days[day][key];
  if (meta.comment && delta > 0) {
    stats.comments = [{ id: meta.id, comment: meta.comment, mark, at }, ...(stats.comments || [])].slice(0, 50);
  }
  if (meta.mismatch && delta > 0) {
    stats.mismatches = [{ id: meta.id, severity, mark, title: meta.title, at }, ...(stats.mismatches || [])].slice(0, 50);
  }
  writeStats(source, stats);
}

function isUnmarked(item) {
  return !item.mark || item.changedSinceMark;
}

function retentionKey(item) {
  if (!item.mark || item.changedSinceMark) return 'feed.retention.unmarked';
  if (item.mark.value === 'noise') return 'feed.retention.noise';
  if (item.mark.value === 'unimportant') return 'feed.retention.unimportant';
  return 'feed.retention.important';
}

function itemAgeBase(item) {
  const updated = Date.parse(item.updatedAt);
  const marked = item.mark?.at ? Date.parse(item.mark.at) : 0;
  return Math.max(updated || 0, marked || 0);
}

function hasLiveEpicLink(item) {
  for (const ref of item.refs || []) {
    if (ref.startsWith('epic:') && epicExists(ref.slice(5))) return true;
    if (ref.startsWith('task:') || ref.startsWith('step:') || ref.startsWith('waiting:')) {
      const epic = ref.split(':')[1]?.split('/')[0];
      if (epic && epicExists(epic)) return true;
    }
  }
  return false;
}

function shouldPruneItem(item, settings, now = Date.now()) {
  if (settings['feed.retention.keepLinked'] && hasLiveEpicLink(item)) return false;
  const ms = durationMs(settings[retentionKey(item)]);
  if (ms === null) return false;
  return now - itemAgeBase(item) > ms;
}

function pruneSourceLocked(source, { dryRun = false, settings = readSettings(), now = Date.now() } = {}) {
  const data = readSourceFile(source);
  const keep = [];
  const removed = [];
  for (const item of data.items) {
    if (shouldPruneItem(item, settings, now)) removed.push(item);
    else keep.push(item);
  }
  if (!dryRun && removed.length) {
    data.items = keep;
    writeSourceFile(source, data);
    for (const item of removed) appendHistory({ type: 'prune', id: item.id, source });
    bumpRev();
  }
  return { source, removed: removed.map((item) => item.id), kept: keep.length };
}

export function pruneFeed({ dryRun = false, source } = {}) {
  const settings = readSettings();
  const sources = source ? [source] : listSourceNames();
  return sources.map((name) => withFileLock(sourcePath(name), () => pruneSourceLocked(name, { dryRun, settings })));
}

function upsertOne(data, incoming, at) {
  const id = itemId(incoming.source, incoming.externalId);
  const index = data.items.findIndex((item) => item.externalId === incoming.externalId);
  if (index === -1) {
    const item = {
      schema: 0,
      id,
      source: incoming.source,
      externalId: incoming.externalId,
      ts: at,
      updatedAt: at,
      channel: incoming.channel,
      kind: incoming.kind,
      severity: incoming.severity,
      title: incoming.title,
      body: incoming.body,
      refs: incoming.refs,
      count: 1,
      changedSinceMark: false,
    };
    data.items.push(item);
    return { item, created: true };
  }
  const prev = data.items[index];
  const changed = CHANGE_FIELDS.some((field) => (prev[field] || '') !== (incoming[field] || ''));
  const next = {
    ...prev,
    updatedAt: at,
    channel: incoming.channel,
    kind: incoming.kind,
    severity: incoming.severity,
    title: incoming.title,
    body: incoming.body,
    refs: incoming.refs,
    count: (prev.count || 1) + 1,
    changedSinceMark: prev.mark ? (prev.changedSinceMark || changed) : false,
  };
  data.items[index] = next;
  return { item: next, created: false, changed };
}

export function addFeedItems(input) {
  const list = Array.isArray(input) ? input : [input];
  if (!list.length) throw new BoardError(400, 'bad-feed', 'feed add needs at least one item');
  if (list.length > 200) throw new BoardError(400, 'bad-feed', 'at most 200 items per add');
  const prepared = list.map(validateIncoming);
  const bySource = new Map();
  for (const item of prepared) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }
  const items = [];
  const warnings = [];
  const at = new Date().toISOString();
  for (const [source, batch] of bySource) {
    withFileLock(sourcePath(source), () => {
      pruneSourceLocked(source, { settings: readSettings() });
      const data = readSourceFile(source);
      for (const incoming of batch) {
        const result = upsertOne(data, incoming, at);
        items.push(result.item);
        for (const warning of incoming.warnings) warnings.push({ id: result.item.id, warning });
        appendHistory({ type: result.created ? 'add' : 'update', id: result.item.id, source });
      }
      writeSourceFile(source, data);
      bumpRev();
    });
  }
  return { items, warnings };
}

export function listFeedItems({ unmarked, source, since, severity, mark } = {}) {
  const sources = source ? [source] : listSourceNames();
  let sinceMs = 0;
  if (since) {
    const ms = durationMs(since) ?? (since === '0' ? null : undefined);
    if (ms === undefined && parseFloat(since)) {
      // allow ISO timestamps
      sinceMs = Date.parse(since) || 0;
    } else if (ms) sinceMs = Date.now() - ms;
  }
  const items = [];
  for (const name of sources) {
    if (!ID.test(name)) continue;
    const data = readSourceFile(name);
    for (const item of data.items) {
      if (unmarked && !isUnmarked(item)) continue;
      if (severity && item.severity !== severity) continue;
      if (mark === 'none' && item.mark) continue;
      if (mark && mark !== 'none' && item.mark?.value !== mark) continue;
      if (sinceMs && Date.parse(item.updatedAt) < sinceMs) continue;
      items.push(item);
    }
  }
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.id).localeCompare(String(a.id)));
  return items;
}

function mutateIds(ids, fn) {
  if (!Array.isArray(ids) || !ids.length) throw new BoardError(400, 'bad-feed', 'ids must be a nonempty array');
  const bySource = new Map();
  for (const id of ids) {
    const parsed = parseFeedId(id);
    if (!parsed) throw new BoardError(400, 'bad-feed', `bad feed id ${id}`);
    if (!bySource.has(parsed.source)) bySource.set(parsed.source, new Set());
    bySource.get(parsed.source).add(id);
  }
  const changed = [];
  for (const [source, set] of bySource) {
    withFileLock(sourcePath(source), () => {
      const data = readSourceFile(source);
      let dirty = false;
      for (const id of set) {
        const index = data.items.findIndex((item) => item.id === id);
        if (index === -1) throw new BoardError(404, 'no-feed-item', `feed item ${id} not found`);
        const result = fn(data.items[index], data, index);
        if (result) {
          changed.push(result);
          dirty = true;
        }
      }
      if (dirty) {
        writeSourceFile(source, data);
        bumpRev();
      }
    });
  }
  return changed;
}

export function markFeedItems(ids, value, { comment, by = 'human' } = {}) {
  if (!FEED_MARKS.includes(value)) throw new BoardError(400, 'bad-feed', `mark must be ${FEED_MARKS.join('|')}`);
  if (comment !== undefined && (typeof comment !== 'string' || comment.length > 500)) throw new BoardError(400, 'bad-feed', 'comment must be a string ≤ 500 chars');
  if (comment) assertNoSecrets(comment, 'comment');
  const at = new Date().toISOString();
  return mutateIds(ids, (item) => {
    if (item.mark) bumpStat(item.source, item.severity, item.mark.value, -1, item.mark.at);
    item.mark = { value, comment: comment || undefined, at, by };
    item.changedSinceMark = false;
    const mismatch = ((item.severity === 'important' || item.severity === 'fire') && value === 'noise')
      || (item.severity === 'noise' && value === 'important');
    bumpStat(item.source, item.severity, value, 1, at, {
      id: item.id, comment, title: item.title, mismatch,
    });
    appendHistory({ type: 'mark', id: item.id, source: item.source, value, comment });
    return item;
  });
}

export function unmarkFeedItems(ids) {
  return mutateIds(ids, (item) => {
    if (!item.mark) return null;
    bumpStat(item.source, item.severity, item.mark.value, -1, item.mark.at);
    appendHistory({ type: 'unmark', id: item.id, source: item.source, previous: item.mark });
    delete item.mark;
    item.changedSinceMark = false;
    return item;
  });
}

export function deleteFeedItems(ids) {
  return mutateIds(ids, (item, data, index) => {
    data.items.splice(index, 1);
    appendHistory({ type: 'delete', id: item.id, source: item.source });
    return item;
  });
}

export function feedSummary() {
  const items = listFeedItems();
  const unmarked = items.filter(isUnmarked);
  const bySource = {};
  for (const item of unmarked) {
    bySource[item.source] ||= { unmarked: 0, fire: 0 };
    bySource[item.source].unmarked++;
    if (item.severity === 'fire') bySource[item.source].fire++;
  }
  return {
    rev: feedRev(),
    unmarked: unmarked.length,
    fire: unmarked.filter((item) => item.severity === 'fire').length,
    total: items.length,
    bySource,
  };
}

export function feedProfileAggregates(source, { days = 7 } = {}) {
  if (!ID.test(source)) throw new BoardError(400, 'bad-id', `bad source ${source}`);
  const since = Date.now() - days * 86_400_000;
  const stats = readStats(source);
  const matrix = {};
  for (const severity of FEED_SEVERITIES) for (const mark of FEED_MARKS) matrix[`${severity}:${mark}`] = 0;
  for (const [day, counts] of Object.entries(stats.days || {})) {
    if (Date.parse(`${day}T00:00:00Z`) < since - 86_400_000) continue;
    for (const [key, n] of Object.entries(counts)) matrix[key] = (matrix[key] || 0) + n;
  }
  const mismatches = (stats.mismatches || []).filter((row) => Date.parse(row.at) >= since).slice(0, 20);
  const comments = (stats.comments || []).filter((row) => Date.parse(row.at) >= since).slice(0, 20);
  const channelNoise = {};
  for (const item of listFeedItems({ source })) {
    if (!item.mark || Date.parse(item.mark.at) < since) continue;
    if (item.mark.value === 'noise' && item.channel) {
      channelNoise[item.channel] ||= { noise: 0, total: 0 };
    }
  }
  for (const item of listFeedItems({ source })) {
    if (!item.channel || Date.parse(item.updatedAt) < since) continue;
    channelNoise[item.channel] ||= { noise: 0, total: 0 };
    channelNoise[item.channel].total++;
    if (item.mark?.value === 'noise') channelNoise[item.channel].noise++;
  }
  const noisyChannels = Object.entries(channelNoise)
    .filter(([, c]) => c.total >= 3 && c.noise === c.total)
    .map(([channel, c]) => ({ channel, count: c.total }));
  return { source, days, matrix, mismatches, comments, noisyChannels };
}

export function setFeedProfile(source, text) {
  if (!ID.test(source)) throw new BoardError(400, 'bad-id', `bad source ${source}`);
  if (typeof text !== 'string' || !text.trim()) throw new BoardError(400, 'bad-feed', 'profile text is required');
  if (text.length > 2000) throw new BoardError(400, 'bad-feed', 'profile text must be ≤ 2000 chars');
  assertNoSecrets(text, 'profile');
  ensureDirs();
  const file = profilePath(source);
  const versions = join(profilesDir(), '.versions', source);
  if (existsSync(file)) {
    mkdirSync(versions, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeAtomic(join(versions, `${stamp}.md`), readFileSync(file, 'utf8'));
  }
  writeAtomic(file, text.endsWith('\n') ? text : `${text}\n`);
  bumpRev();
  return { source, text };
}

export function showFeedProfile(source) {
  if (!ID.test(source)) throw new BoardError(400, 'bad-id', `bad source ${source}`);
  try {
    return { source, text: readFileSync(profilePath(source), 'utf8') };
  } catch (e) {
    if (e.code === 'ENOENT') return { source, text: '' };
    throw e;
  }
}

export function feedSparkline(days = 14) {
  const counts = Array.from({ length: days }, () => 0);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  for (const item of listFeedItems()) {
    const day = Math.floor((Date.parse(item.ts) - start.getTime()) / 86_400_000);
    if (day >= 0 && day < days) counts[day]++;
  }
  return counts;
}

export function listFeedSources() {
  return listSourceNames().map((source) => {
    const items = readSourceFile(source).items;
    const latest = items.reduce((max, item) => Math.max(max, Date.parse(item.updatedAt) || 0), 0);
    return { source, count: items.length, latestAt: latest ? new Date(latest).toISOString() : null };
  });
}

export function clearFeedForTests() {
  if (!process.env.EPIC_BOARD_HOME) throw new Error('clearFeedForTests requires EPIC_BOARD_HOME');
  rmSync(feedRoot(), { recursive: true, force: true });
}
