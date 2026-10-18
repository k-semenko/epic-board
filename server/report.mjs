import { BoardError } from './errors.mjs';
import { waitingAnswer } from './brief.mjs';

const markdown = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#!|~]/g, '\\$&');

function markdownLink(text, href) {
  const title = markdown(text);
  try {
    const url = new URL(href);
    if (['http:', 'https:'].includes(url.protocol)) return `[${title}](${url.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
  } catch {}
  return title;
}

function linkLine(edge, direction) {
  const incoming = direction === 'incoming';
  const other = incoming ? edge.source : edge.target;
  const own = incoming ? edge.target : edge.source;
  const resolution = edge.status === 'unavailable' ? 'unavailable' : `not found (${edge.status})`;
  const status = incoming || edge.status === 'resolved' ? other.state : resolution;
  const targetError = incoming && edge.status !== 'resolved' ? ` · target ${markdown(own.address)}: ${markdown(resolution)}` : '';
  return `- ${markdown(own.title || own.address)} ${incoming ? '←' : '→'} ${markdownLink(`${other.epicTitle || other.epic} → ${other.title || other.address}`, other.url)} · ${markdown(status)} · ${markdown(other.address)}${targetError}${edge.label ? ` — ${markdown(edge.label)}` : ''}`;
}

// A Markdown summary of one task, ready to paste into whatever tracker the task lives in.
export function buildReport(epic, { task, links } = {}) {
  const t = (epic.tasks || []).find((x) => x.id === String(task));
  if (!t) throw new BoardError(404, 'no-task', `epic has no task ${task}`);
  const steps = t.steps || [];
  const out = [`**Report: ${t.title}**`, ''];
  if (t.url) out.push(`Task: ${t.url}`, '');
  out.push('**Done**', '');
  const done = steps.filter((s) => s.state === 'done');
  out.push(...(done.length ? done.map((s) => `- ${s.title}${s.note ? ` — ${s.note}` : ''}`) : ['- nothing yet']));
  const branches = t.branches || [];
  if (branches.length) {
    out.push('', '**Branches and merge requests**', '');
    for (const b of branches) {
      const f = epic.facts?.[`${b.repo}:${b.name}`];
      const mr = b.mr?.iid ? (f?.mr?.url ? ` — [#${b.mr.iid}](${f.mr.url})` : ` — #${b.mr.iid}`) : '';
      const state = f?.mr && !f.mr.error ? `, ${f.mr.state}${f.mr.pipeline ? `, pipeline ${f.mr.pipeline}` : ''}` : '';
      out.push(`- ${b.repo}: \`${b.name}\` @ \`${f?.head ?? '?'}\`${f?.branchMissing || f?.localUnavailable || f?.error ? ' (last known local head)' : ''}${mr}${state}`);
    }
  }
  const decisions = (epic.decisions || []).filter((d) => d.task === t.id);
  if (decisions.length) out.push('', '**Decisions**', '', ...decisions.map((d) => `- ${d.text}${d.by ? ` (${d.by})` : ''}`));
  const waiting = (epic.waiting || []).filter((w) => w.task === t.id);
  const answered = waiting.filter((w) => w.status === 'answered');
  if (answered.length) out.push('', '**Answers awaiting agent review**', '', ...answered.map((w) => `- ${w.id}: ${w.title} — ${waitingAnswer(w)}`));
  const resolved = waiting.filter((w) => w.doneAt);
  if (resolved.length) out.push('', '**Resolved**', '', ...resolved.map((w) => `- ${w.id}: ${w.title}${waitingAnswer(w) ? ` — answer: ${waitingAnswer(w)}` : ''}${w.resolution ? ` — outcome: ${w.resolution}` : ''}`));
  const left = [...steps.filter((s) => s.state !== 'done').map((s) => s.title), ...(t.open || []).map((o) => o.text), ...waiting.filter((w) => !w.doneAt).map((w) => `${w.id}: ${w.title} — waiting for ${w.status === 'answered' ? 'agent' : 'human'}`)];
  out.push('', '**Left**', '', ...(left.length ? left.map((x) => `- ${x}`) : ['- nothing']));
  if (links) {
    out.push('', '**Links**', '', `Snapshot: ${markdown(links.readAt)}`);
    if (links.incomplete) out.push('', '**Warning:** Backlinks are incomplete.', ...(links.errors || []).map((error) => `- ${markdown(error.id)}: ${markdown(error.status)}`));
    const outgoing = (links.outgoing || []).filter((edge) => edge.source.task === t.id);
    const incoming = (links.incoming || []).filter((edge) => edge.target.task === t.id);
    if (outgoing.length) out.push('', '**Outgoing**', '', ...outgoing.map((edge) => linkLine(edge, 'outgoing')));
    if (incoming.length) out.push('', '**Incoming**', '', ...incoming.map((edge) => linkLine(edge, 'incoming')));
    if (!outgoing.length && !incoming.length) out.push('', '- no links');
  }
  return out.join('\n');
}
