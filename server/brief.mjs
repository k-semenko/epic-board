import { boardUrl } from './paths.mjs';

export function ago(iso, now = Date.now()) {
  if (!iso) return '-';
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

export function branchLine(key, f, mrIid) {
  if (!f) return `${key} · no facts yet, run refresh`;
  const parts = [`${key} ${f.branchMissing || f.localUnavailable || f.error ? 'last known ' : ''}${f.head ?? '?'}`];
  if (f.behind) parts.push(`behind ${f.behind}`);
  if (f.unpushed) parts.push(`unpushed ${f.unpushed}`);
  if (f.dirty) parts.push('dirty tree');
  if (f.mr && !f.mr.error) parts.push(`MR ${mrIid ? `#${mrIid} ` : ''}${[f.mr.draft ? 'draft' : f.mr.state, f.mr.pipeline].filter(Boolean).join(' ')}`);
  if (f.mr?.error) parts.push(`MR: ${f.mr.error}`);
  if (f.localUnavailable) parts.push('local Git unavailable');
  if (f.branchMissing) parts.push('branch removed');
  if (f.error) parts.push(`error: ${f.error}`);
  return parts.join(' · ');
}

export function waitingAnswer(item) {
  const round = (item.rounds || []).findLast((r) => r.revision === item.revision);
  if (!round) return '';
  const { response, request } = round;
  const options = new Map((request.input?.options || []).map((o) => [o.id, o.text]));
  return [response.clarification ? 'Clarification' : '', response.confirmed ? 'Confirmed' : '', ...(response.selected || []).map((id) => options.get(id) || id), response.comment].filter(Boolean).join('; ').replace(/\s+/g, ' ');
}

// Hook output after compaction: short enough to read in one glance, never more than 25 lines.
export function buildBrief(epic, { session, now = Date.now() } = {}) {
  const lines = [`Epic ${epic.id} · ${epic.title} — ${boardUrl(epic.id)}`];
  if (epic.archived) lines.unshift(`Epic archived: ${epic.archived.summary}. Run epic.mjs reopen ${epic.id} to continue.`);
  if (epic.goal) lines.push(`Goal: ${epic.goal}`);
  const active = [];
  for (const t of epic.tasks || []) for (const s of t.steps || []) if (s.state === 'active') active.push(`▶ ${t.id}/${s.id} ${s.title}`);
  lines.push(...(active.length ? active.slice(0, 5) : ['No active steps']));
  const waiting = (epic.waiting || []).filter((w) => !w.doneAt);
  if (waiting.length) {
    lines.push(`Needs a decision: ${waiting.length}`);
    lines.push(`Human: ${waiting.filter((w) => w.status !== 'answered').length} · Agent: ${waiting.filter((w) => w.status === 'answered').length}`);
    for (const w of waiting.slice(0, 5)) lines.push(`- ${w.id} · waiting for ${w.status === 'answered' ? 'agent' : 'human'} · [${w.kind || 'other'}] ${w.title}${w.task ? ` (${w.task})` : ''}${w.checklist?.length ? ` · checklist ${w.checklist.length}` : ''}${w.status === 'answered' ? ` · answer: ${waitingAnswer(w)}` : ''}`);
  }
  const own = (epic.sessions || []).find((s) => s.id === session);
  if (own) lines.push(`Session: doing: ${own.doing || '-'}; next: ${own.next || '-'} (marked ${ago(own.lastAt, now)} ago)`);
  const branches = [];
  for (const t of epic.tasks || []) for (const b of t.branches || []) branches.push([`${b.repo}:${b.name}`, b.mr?.iid]);
  for (const [key, iid] of branches.slice(0, 6)) lines.push(branchLine(key, epic.facts?.[key], iid));
  const stamps = Object.values(epic.facts || {}).map((f) => f.fetchedAt).filter(Boolean).sort();
  if (stamps.length) lines.push(`Facts: oldest refresh ${ago(stamps[0], now)} ago`);
  return lines.slice(0, 25).join('\n');
}
