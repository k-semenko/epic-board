import { createHash, randomUUID } from 'node:crypto';
import { BoardError } from './errors.mjs';

const REQUEST_FIELDS = ['title', 'details', 'kind', 'task', 'refs', 'input', 'checklist', 'revisionReason'];
const CREATE_FIELDS = new Set(['id', 'since', ...REQUEST_FIELDS.filter((key) => key !== 'revisionReason')]);
const EDIT_FIELDS = new Set(REQUEST_FIELDS.filter((key) => key !== 'revisionReason'));
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status = 400) => { throw new BoardError(status, code, message); };
const text = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) fail('bad-waiting', `${field} must be nonempty text`);
  return value.trim();
};
const snapshot = (item) => structuredClone(Object.fromEntries(REQUEST_FIELDS.filter((key) => item[key] !== undefined).map((key) => [key, item[key]])));

export function validateWaiting(item) {
  if (typeof item.id !== 'string' || !item.id.trim()) fail('bad-waiting-id', 'pending item id must be nonempty text');
  text(item.title, 'title');
  if (item.details !== undefined && typeof item.details !== 'string') fail('bad-waiting', 'details must be text');
  if (!object(item.input) || !['confirm', 'single', 'multi'].includes(item.input.type)) fail('bad-input', 'input type is confirm, single or multi');
  const { type, options } = item.input;
  if (type === 'confirm') {
    if (options !== undefined) fail('bad-input', 'confirmation does not have options');
  } else {
    if (!Array.isArray(options) || options.length < 2) fail('bad-input', 'choice input needs at least two options');
    const ids = new Set();
    for (const option of options) {
      if (!object(option) || typeof option.id !== 'string' || !ITEM_ID.test(option.id) || ids.has(option.id)) fail('bad-input', 'options need unique short ids');
      text(option.text, 'option text');
      if (option.hint !== undefined && typeof option.hint !== 'string') fail('bad-input', 'option hint must be text');
      if (option.recommended !== undefined && typeof option.recommended !== 'boolean') fail('bad-input', 'recommended must be boolean');
      ids.add(option.id);
    }
  }
  if (!['open', 'answered', 'closed'].includes(item.status) || !Number.isInteger(item.revision) || item.revision < 1 || typeof item.version !== 'string' || !item.version || !Array.isArray(item.rounds)) fail('bad-waiting', 'invalid pending item lifecycle');
  if (item.revision > 1) text(item.revisionReason, 'revision reason');
  if ((item.status === 'closed') !== Boolean(item.doneAt)) fail('bad-waiting', 'doneAt is reserved for closed items');
  if (item.checklist !== undefined && !Array.isArray(item.checklist)) fail('bad-checklist', 'checklist must be an array');
  const checks = new Set();
  for (const entry of item.checklist || []) {
    if (!object(entry) || typeof entry.id !== 'string' || !entry.id.trim() || checks.has(entry.id) || typeof entry.text !== 'string' || !entry.text.trim()) fail('bad-checklist', 'checklist entries need unique ids and nonempty text');
    checks.add(entry.id);
  }
  if (item.refs !== undefined && !Array.isArray(item.refs)) fail('bad-ref', 'refs must be an array');
}

export function createWaiting(fields, at) {
  if (!object(fields)) fail('bad-waiting', 'pending item must be an object');
  for (const key of Object.keys(fields)) if (!CREATE_FIELDS.has(key)) fail('waiting-protected', `${key} is controlled by waiting actions`);
  const item = { ...structuredClone(fields), input: fields.input || { type: 'confirm' }, since: fields.since || at, status: 'open', revision: 1, version: randomUUID(), rounds: [] };
  validateWaiting(item);
  return item;
}

export function migrateWaiting(item, epicId) {
  const version = `legacy-${createHash('sha256').update(JSON.stringify([epicId, item])).digest('hex')}`;
  const next = { ...structuredClone(item), input: { type: 'confirm' }, status: item.doneAt ? 'closed' : 'open', revision: 1, version, rounds: [] };
  if (item.doneAt) next.legacyClosure = { doneAt: item.doneAt, ...(item.checked ? { checked: structuredClone(item.checked) } : {}), ...(item.resolution ? { resolution: item.resolution } : {}), request: snapshot(next) };
  return next;
}

export function prepareWaitingPatch(epic, patch, at) {
  if (!('waiting' in patch)) return patch;
  if (!Array.isArray(patch.waiting)) fail('waiting-protected', 'waiting must be an array of new requests; use waiting actions to edit existing items');
  const ids = new Set();
  const waiting = patch.waiting.map((item) => {
    if (!object(item) || typeof item.id !== 'string' || ids.has(item.id)) fail('bad-waiting', 'pending items need unique ids');
    ids.add(item.id);
    const existing = (epic.waiting || []).find((stored) => stored.id === item.id);
    if (existing) {
      if (Object.keys(item).some((key) => key !== 'id')) fail('waiting-protected', 'use wait revise, submit, resolve or remove with the current version');
      return item;
    }
    return createWaiting(item, at);
  });
  return { ...patch, waiting };
}

function selectedIds(value, allowed, field) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string') || new Set(value).size !== value.length || value.some((id) => !allowed.includes(id))) fail('bad-selection', `${field} must contain unique known ids`);
  return allowed.filter((id) => value.includes(id));
}

function answerFor(request, body) {
  const selected = selectedIds(body.selected ?? [], (request.input.options || []).map((option) => option.id), 'selected');
  const checked = selectedIds(body.checked ?? [], (request.checklist || []).map((entry) => entry.id), 'checked');
  if (checked.length !== (request.checklist || []).length) fail('checklist', 'every checklist item must be confirmed');
  if (body.confirmed !== undefined && typeof body.confirmed !== 'boolean') fail('bad-selection', 'confirmed must be boolean');
  const confirmed = body.confirmed === true;
  if (request.input.type === 'confirm' && !confirmed) fail('bad-selection', 'confirmation requires confirmed: true');
  if (request.input.type === 'single' && selected.length !== 1) fail('bad-selection', 'select exactly one option');
  if (request.input.type === 'multi' && !selected.length) fail('bad-selection', 'select at least one option');
  if (body.comment !== undefined && typeof body.comment !== 'string') fail('bad-selection', 'comment must be text');
  const comment = body.comment?.trim();
  return { confirmed, selected, checked, ...(comment ? { comment } : {}) };
}

function currentVersion(item, version) {
  text(version, 'version');
  if (item.version !== version) fail('waiting-changed', 'the request changed; reread it before continuing', 409);
}

export function transitionWaiting(item, action, body, { by = 'cli', at = new Date().toISOString() } = {}) {
  if (!object(body)) fail('bad-waiting', 'waiting action body must be an object');
  if (action === 'submit') {
    const submissionId = text(body.submissionId, 'submissionId');
    text(body.version, 'version');
    const previous = item.rounds.find((round) => round.response.submissionId === submissionId);
    if (previous) {
      const { at: ignoredAt, by: ignoredBy, submissionId: ignoredId, ...answer } = previous.response;
      let repeated;
      try { repeated = answerFor(previous.request, body); }
      catch (error) {
        if (!(error instanceof BoardError)) throw error;
        fail('submission-conflict', 'submissionId was already used for a different response', 409);
      }
      if (body.version !== previous.version || JSON.stringify(repeated) !== JSON.stringify(answer)) fail('submission-conflict', 'submissionId was already used for a different response', 409);
      return item;
    }
    currentVersion(item, body.version);
    if (item.status !== 'open') fail('waiting-state', 'only an open request accepts a new answer', 409);
    const answer = answerFor(item, body);
    return { ...item, status: 'answered', version: randomUUID(), rounds: [...item.rounds, { revision: item.revision, version: item.version, request: snapshot(item), response: { submissionId, at, by, ...answer } }] };
  }
  currentVersion(item, body.version);
  if (action === 'remove') {
    if (item.status !== 'open' || item.rounds.length || item.legacyClosure) fail('waiting-state', 'a request with answers or a previous closure cannot be removed', 409);
    return null;
  }
  const next = structuredClone(item);
  const round = next.rounds.find((entry) => entry.revision === next.revision);
  if (action === 'resolve') {
    if (item.status !== 'answered' || !round || round.response.submissionId !== body.submissionId) fail('waiting-state', 'resolve requires the current submitted answer', 409);
    const resolution = text(body.resolution, 'resolution');
    round.review = { outcome: 'accepted', at, by, text: resolution };
    return { ...next, status: 'closed', version: randomUUID(), doneAt: at, resolution, ...(round.response.checked.length ? { checked: round.response.checked.slice() } : {}) };
  }
  if (action !== 'revise') fail('bad-action', 'unknown waiting action');
  const reason = text(body.reason, 'reason');
  const patch = body.patch ?? {};
  if (!object(patch)) fail('bad-waiting', 'revision patch must be an object');
  for (const [key, value] of Object.entries(patch)) {
    if (!EDIT_FIELDS.has(key)) fail('waiting-protected', `${key} is not a request field`);
    if (value === null) delete next[key];
    else next[key] = structuredClone(value);
  }
  if (item.status === 'answered') {
    if (!round || round.review) fail('waiting-state', 'the current answer is already reviewed', 409);
    round.review = { outcome: 'revised', at, by, text: reason };
  }
  delete next.doneAt;
  delete next.resolution;
  delete next.checked;
  return { ...next, status: 'open', version: randomUUID(), revision: item.revision + 1, revisionReason: reason };
}
