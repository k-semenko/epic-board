import { BoardError } from './errors.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STEP_ID = /^[\w.-]{1,64}$/;
const valid = (value, pattern) => typeof value === 'string' && value.trim() === value && pattern.test(value);

export function parseStepRef(value, ownerEpicId) {
  const owner = String(ownerEpicId ?? '');
  if (typeof value !== 'string' || !valid(owner, ID)) return null;
  const parts = value.split('/');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [epic, task, step] = parts.length === 2 ? [owner, ...parts] : parts;
  if (!valid(epic, ID) || !valid(task, ID) || !valid(step, STEP_ID)) return null;
  const local = epic === owner;
  const address = `${epic}/${task}/${step}`;
  return { epic, task, step, address, local, ref: local ? `${task}/${step}` : address };
}

export function normalizeAfter(values, ownerEpicId) {
  if (!Array.isArray(values)) throw new BoardError(400, 'bad-after', 'after must be an array of step addresses');
  const refs = new Set();
  for (const value of values) {
    const parsed = parseStepRef(value, ownerEpicId);
    if (!parsed) throw new BoardError(400, 'bad-after', 'after addresses must be task/step or epic/task/step with valid identifiers');
    refs.add(parsed.ref);
  }
  return [...refs];
}
