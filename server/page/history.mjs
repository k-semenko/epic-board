import { t } from './i18n.mjs';

// History events as people read them: where, what, and the value before and after.
const FIELDS = new Set(['state', 'title', 'note', 'status', 'statusCheckedAt', 'after', 'label', 'role', 'doing', 'next', 'lastAt', 'head', 'behind', 'ahead', 'unpushed',
  'remoteBehind', 'dirty', 'error', 'doneAt', 'agent', 'task', 'startedAt', 'text', 'worktree', 'goal', 'url', 'details', 'resolution', 'checklist', 'checked', 'refs', 'kind',
  'tracker', 'mr.state', 'mr.draft', 'mr.pipeline']);
// Events written before schema 2 still carry the old field names.
const OLD = { stage: 'status', stageCheckedAt: 'statusCheckedAt' };
const STATES = new Set(['done', 'active', 'waiting', 'blocked', 'todo']);
const KINDS = { steps: 'h.step', branches: 'h.branch', open: 'h.open' };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const pad = (n) => String(n).padStart(2, '0');
const field = (name) => {
  const key = OLD[name] || name;
  return FIELDS.has(key) ? t(`f.${key}`) : name;
};

function show(value, name) {
  if (value === null || value === undefined) return null;
  if (name === 'state' && STATES.has(value)) return t(`state.${value}`);
  if (typeof value === 'string' && ISO.test(value)) {
    const d = new Date(value);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (Array.isArray(value)) return value.length ? show(value.map((v) => show(v)).join(', ')) : '—';
  if (typeof value === 'object') {
    if (value.title ?? value.text ?? value.name) return show(value.title ?? value.text ?? value.name);
    // A session record has no title: who, on which task, doing what.
    if (value.agent || value.task || value.doing) return show([value.agent, value.task, value.doing].filter(Boolean).join(' · '));
    return show(JSON.stringify(value));
  }
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

const tail = (path) => path.replace(/^\.+/, '');

export function describeEvent(e) {
  const change = e.op === 'refresh' ? 'set' : e.op;
  const out = (where, what, name) => ({ where, what, change, before: show(e.before, name), after: show(e.after, name) });
  const path = String(e.path || '');
  if (path === 'epic') return out(t('h.epic'), t('h.created'));

  let m = path.match(/^facts\.(.+?:[^.]+(?:\.[^.]+)*?)\.(mr\.\w+|\w+)$/);
  if (m) return out(m[1], field(m[2]), m[2]);

  m = path.match(/^tasks\[([^\]]+)\]\.(steps|branches|open)\[([^\]]+)\](.*)$/);
  if (m) {
    const kind = t(KINDS[m[2]]);
    const where = `${m[1]} · ${kind} ${m[3]}`;
    const name = tail(m[4]);
    if (!name) return out(where, t(e.op === 'remove' ? 'h.removed' : 'h.added', { k: kind }));
    return out(where, field(name), name);
  }
  m = path.match(/^tasks\[([^\]]+)\](.*)$/);
  if (m) {
    const name = tail(m[2]);
    return out(m[1], name ? field(name) : t(e.op === 'remove' ? 'h.taskRemoved' : 'h.taskAdded'), name);
  }
  m = path.match(/^waiting\[([^\]]+)\](.*)$/);
  if (m) {
    const name = tail(m[2]);
    if (name === 'status') return { where: t('h.waiting'), what: t('h.waitStage'), change, before: e.before ? t(`w.status.${e.before}`) : null, after: e.after ? t(`w.status.${e.after}`) : null };
    if (name === 'revision') return out(t('h.waiting'), t('h.waitRevision'), name);
    if (name === 'revisionReason') return out(t('h.waiting'), t('w.revisionReason'), name);
    if (name === 'rounds') {
      const round = e.after?.at(-1);
      const submitted = (e.after?.length || 0) > (e.before?.length || 0);
      const labels = (round?.response?.selected || []).map((id) => round.request.input?.options?.find((option) => option.id === id)?.text || id);
      const answer = round ? [round.request.title, ...(round.request.input?.type === 'confirm' ? [t('w.confirmed')] : labels), round.response.comment].filter(Boolean).join(' · ') : null;
      return { where: t('h.waiting'), what: t(submitted ? 'h.waitSubmitted' : round?.review?.outcome === 'revised' ? 'w.returned' : 'h.waitReviewed'), change: 'add', before: null, after: show(submitted ? answer : round?.review?.text) };
    }
    return out(t('h.waiting'), name ? field(name) : t(e.op === 'remove' ? 'h.itemRemoved' : 'h.itemAdded'), name);
  }
  m = path.match(/^decisions\[([^\]]+)\]/);
  if (m) return out(t('h.decisions'), t('h.decisionAdded'));
  m = path.match(/^sessions\[([^\]-]+)[^\]]*\](.*)$/);
  if (m) {
    const name = tail(m[2]);
    return out(t('h.session', { id: m[1].slice(0, 8) }), name ? field(name) : t('h.bound'), name);
  }
  m = path.match(/^repos\.([^.]+)\.?(.*)$/);
  if (m) return out(t('h.repo', { name: m[1] }), m[2] || t('h.described'), m[2]);
  if (path === 'mergeOrder') return out(t('h.merge'), t('h.order'));
  return out(path, field(path), path);
}

export function historyEntries(history) {
  return history.map((event, index) => ({ event, target: `h-${index}` }))
    .filter(({ event }) => !/^waiting\[[^\]]+\]\.version$/.test(event.path)).slice(0, 20)
    .map((entry) => {
      const description = describeEvent(entry.event);
      return { ...entry, description, searchText: [description.where, description.what, description.before, description.after].filter(Boolean).join(' · ') };
    });
}
