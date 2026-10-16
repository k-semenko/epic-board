import { BoardError } from './errors.mjs';

// A Markdown summary of one task, ready to paste into whatever tracker the task lives in.
export function buildReport(epic, { task } = {}) {
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
      out.push(`- ${b.repo}: \`${b.name}\` @ \`${f?.head ?? '?'}\`${mr}${state}`);
    }
  }
  const decisions = (epic.decisions || []).filter((d) => d.task === t.id);
  if (decisions.length) out.push('', '**Decisions**', '', ...decisions.map((d) => `- ${d.text}${d.by ? ` (${d.by})` : ''}`));
  const resolved = (epic.waiting || []).filter((w) => w.task === t.id && w.doneAt);
  if (resolved.length) out.push('', '**Resolved**', '', ...resolved.map((w) => `- ${w.title}${w.resolution ? ` — ${w.resolution}` : ''}`));
  const left = [...steps.filter((s) => s.state !== 'done').map((s) => s.title), ...(t.open || []).map((o) => o.text), ...(epic.waiting || []).filter((w) => w.task === t.id && !w.doneAt).map((w) => w.title)];
  out.push('', '**Left**', '', ...(left.length ? left.map((x) => `- ${x}`) : ['- nothing']));
  return out.join('\n');
}
