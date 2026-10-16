#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import * as store from '../server/store.mjs';
import { refreshEpic } from '../server/refresh.mjs';
import { buildBrief, branchLine } from '../server/brief.mjs';
import { buildReport } from '../server/report.mjs';
import { boardUrl } from '../server/paths.mjs';
import { buildExport } from '../server/export.mjs';
import * as docs from '../server/docs.mjs';
import { BoardError } from '../server/errors.mjs';

const OPTIONS = {
  title: { type: 'string' }, goal: { type: 'string' }, url: { type: 'string' }, path: { type: 'string' }, base: { type: 'string' },
  provider: { type: 'string' }, project: { type: 'string' }, role: { type: 'string' },
  status: { type: 'string' }, tracker: { type: 'string' }, state: { type: 'string' }, after: { type: 'string' },
  label: { type: 'string' }, note: { type: 'string' }, worktree: { type: 'string' }, mr: { type: 'string' },
  kind: { type: 'string' }, text: { type: 'string' }, details: { type: 'string' }, ref: { type: 'string', multiple: true },
  input: { type: 'string' }, option: { type: 'string', multiple: true }, recommend: { type: 'string' },
  version: { type: 'string' }, 'submission-id': { type: 'string' }, selected: { type: 'string' },
  comment: { type: 'string' }, confirmed: { type: 'boolean' }, reason: { type: 'string' },
  check: { type: 'string', multiple: true }, checked: { type: 'string' }, resolution: { type: 'string' },
  task: { type: 'string' }, by: { type: 'string' }, set: { type: 'string' }, session: { type: 'string' },
  doing: { type: 'string' }, next: { type: 'string' }, agent: { type: 'string' }, branch: { type: 'string' }, why: { type: 'string' },
  json: { type: 'boolean' }, delete: { type: 'boolean' }, out: { type: 'string' }, repo: { type: 'string' },
};

const HELP = `epic.mjs <command> ... (data: see "doctor"; "-" as a flag value clears the field)

  list                                         epics and their pages
  new <epic> --title T [--goal G] [--url U]    create an epic (id: letters, digits, . _ -)
  repo <epic> <name> --path P [--base main] [--provider gitlab|github --project host/owner/name]
  task <epic> <task> --title T [--url U] [--tracker Jira] [--status S] [--role main|side]
  step <epic> <task>/<step> [--title T] [--state done|active|todo|blocked|waiting] [--after t/s,...] [--label L] [--note N]
  branch <epic> <task> <repo> <branch> [--worktree P] [--mr N] [--delete]
  open-item <epic> <task> add <text> | done <id>
  wait <epic> add <id> --title T [--kind decision|approval|review|action|other] [--details MD] [--task T]
                       [--ref task:T|step:T/S|branch:repo:name|doc:ID|decision:ID|waiting:ID|https://...]... [--check "item"]...
                       [--input confirm|single|multi] [--option id=text]... [--recommend id]
  wait <epic> show <id> [--json]              full request, version and responses
  wait <epic> submit <id> --version V --submission-id S [--confirmed | --selected a,b] [--checked c1,c2] [--comment C]
  wait <epic> resolve <id> --version V --submission-id S --resolution R
  wait <epic> revise <id> --version V --reason R [request flags from add]
  wait <epic> remove <id> --version V          only unanswered requests without history
  decide <epic> --text T [--task T] [--by NAME]
  merge <epic> --set '[{"id":"m1","text":"...","branch":"repo:branch"}]'
  bind <epic> --session SID [--task T] [--agent claude|codex|...]
  note <epic> --session SID [--doing D] [--next N]
  refresh <epic> [--task T | --branch repo:branch]
  show <epic> [--session SID] [--json]
  report <epic> --task T                       Markdown summary of a task
  url <epic>
  doc new|link|import <epic> [<task>[/<step>]] --kind spec|plan|log|review|note --title T [--path P]
  doc list <epic> | doc remove <epic> <id>
  docs-mode <epic> board|linked
  export <epic> [--out file.html]
  doctor [--repo PATH]                         tools, credentials and paths as this machine sees them
  service install|uninstall|status             run the board as a user service (launchd / systemd)

Every change accepts --why "<reason>", which goes into the history.`;

const now = () => new Date().toISOString();
const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
const need = (value, what) => {
  if (value === undefined || value === '') throw new BoardError(400, 'usage', `${what} is required`);
  return value;
};
const patch = (epic, body, why) => store.patchEpic(epic, body, { by: 'cli', why: why || '' });
// "-" clears a field: the merge patch treats null as removal.
const orNull = (v) => (v === '-' ? null : v);

const listIds = (value) => value === undefined ? [] : value.split(',').map((s) => s.trim()).filter(Boolean);
const waitingRequest = (o) => {
  let input;
  if (o.input !== undefined || o.option !== undefined || o.recommend !== undefined) {
    const options = o.option?.map((value) => {
      const separator = value.indexOf('=');
      if (separator < 1 || !value.slice(separator + 1).trim()) throw new BoardError(400, 'usage', '--option must be id=text');
      const id = value.slice(0, separator);
      return defined({ id, text: value.slice(separator + 1), recommended: id === o.recommend ? true : undefined });
    });
    if (o.recommend !== undefined && !options?.some((x) => x.id === o.recommend)) throw new BoardError(400, 'usage', '--recommend must name one of the supplied --option IDs');
    input = defined({ type: o.input || 'confirm', options });
  }
  return defined({ title: o.title, kind: o.kind, details: orNull(o.details), task: orNull(o.task), refs: o.ref, checklist: o.check?.map((text, i) => ({ id: `c${i + 1}`, text })), input });
};

const COMMANDS = {
  help: () => ({ text: HELP }),
  new: ([epic], o) => {
    const created = store.createEpic({ id: epic, title: o.title, goal: o.goal }, { by: 'cli' });
    return o.url ? patch(epic, { url: o.url }, o.why) : created;
  },
  repo: ([epic, name], o) => patch(epic, { repos: { [need(name, 'repo name')]: defined({ path: o.path, base: o.base, provider: orNull(o.provider), project: orNull(o.project) }) } }, o.why),
  task: ([epic, task], o) => patch(epic, { tasks: [defined({ id: need(task, 'task id'), title: o.title, url: orNull(o.url), tracker: orNull(o.tracker), role: o.role, status: orNull(o.status), statusCheckedAt: o.status ? now() : undefined })] }, o.why),
  step: ([epic, ref], o) => {
    const [task, step] = need(ref, '<task>/<step>').split('/');
    const after = o.after === undefined ? undefined : o.after === '-' ? null : o.after.split(',').map((s) => s.trim()).filter(Boolean);
    return patch(epic, { tasks: [{ id: task, steps: [defined({ id: need(step, 'step id'), title: o.title, state: o.state, after, label: orNull(o.label), note: orNull(o.note) })] }] }, o.why);
  },
  branch: ([epic, task, repo, name], o) => patch(epic, { tasks: [{ id: need(task, 'task id'), branches: [defined({ repo: need(repo, 'repo'), name: need(name, 'branch name'), worktree: orNull(o.worktree), mr: o.mr ? { iid: Number(o.mr) } : undefined, $delete: o.delete || undefined })] }] }, o.why),
  'open-item': ([epic, task, action, value], o) => {
    if (action === 'add') return patch(epic, { tasks: [{ id: task, open: [{ id: `o${Date.now().toString(36)}`, text: need(value, 'text') }] }] }, o.why);
    if (action === 'done') return patch(epic, { tasks: [{ id: task, open: [{ id: need(value, 'item id'), $delete: true }] }] }, o.why);
    throw new BoardError(400, 'usage', 'open-item <epic> <task> add <text> | done <id>');
  },
  wait: ([epic, action, id], o) => {
    const itemId = need(id, 'item id');
    const opts = { by: 'cli', why: o.why || '' };
    if (action === 'show') {
      const item = (store.readEpic(epic).waiting || []).find((w) => w.id === itemId);
      if (!item) throw new BoardError(404, 'no-waiting', `epic has no waiting item ${itemId}`);
      return o.json ? item : { text: JSON.stringify(item, null, 2) };
    }
    if (action === 'add') return patch(epic, { waiting: [{ id: itemId, kind: o.kind || 'decision', ...waitingRequest(o), since: now() }] }, o.why);
    if (action === 'done' || action === 'undo') throw new BoardError(400, 'usage', `Use wait ${epic} ${action === 'done' ? `resolve ${itemId} --version V --submission-id S --resolution R after human submission` : `revise ${itemId} --version V --reason R`}`);
    if (action === 'submit') return store.submitWaiting(epic, itemId, defined({ version: need(o.version, '--version'), submissionId: need(o['submission-id'], '--submission-id'), confirmed: o.confirmed, selected: listIds(o.selected), checked: listIds(o.checked), comment: o.comment }), opts);
    if (action === 'resolve') return store.resolveWaiting(epic, itemId, { version: need(o.version, '--version'), submissionId: need(o['submission-id'], '--submission-id'), resolution: need(o.resolution, '--resolution') }, opts);
    if (action === 'revise') return store.reviseWaiting(epic, itemId, { version: need(o.version, '--version'), reason: need(o.reason, '--reason'), patch: waitingRequest(o) }, opts);
    if (action === 'remove') return store.removeWaiting(epic, itemId, { version: need(o.version, '--version') }, opts);
    throw new BoardError(400, 'usage', 'wait <epic> add|show|submit|resolve|revise|remove <id>; run epic.mjs help');
  },
  decide: ([epic], o) => patch(epic, { decisions: [defined({ task: o.task, text: need(o.text, '--text'), by: o.by })] }, o.why),
  merge: ([epic], o) => {
    let steps;
    try {
      steps = JSON.parse(need(o.set, "--set '[...]'"));
    } catch (e) {
      if (e instanceof BoardError) throw e;
      throw new BoardError(400, 'usage', '--set takes a JSON array of steps');
    }
    return patch(epic, { mergeOrder: steps }, o.why);
  },
  bind: ([epic], o) => {
    const sid = need(o.session, '--session');
    const exists = (store.readEpic(epic).sessions || []).some((s) => s.id === sid);
    return patch(epic, { sessions: [defined({ id: sid, task: o.task, agent: o.agent, startedAt: exists ? undefined : now(), lastAt: now() })] }, o.why);
  },
  note: ([epic], o) => {
    const sid = need(o.session, '--session');
    if (!(store.readEpic(epic).sessions || []).some((s) => s.id === sid)) throw new BoardError(404, 'not-bound', `session ${sid} is not bound: epic.mjs bind ${epic} --session ${sid}`);
    return patch(epic, { sessions: [defined({ id: sid, doing: o.doing, next: o.next, lastAt: now() })] }, o.why);
  },
  refresh: async ([epic], o) => {
    const scope = o.branch ? 'branch' : o.task ? 'task' : 'all';
    const { epic: next, results } = await refreshEpic(epic, { scope, task: o.task, branch: o.branch });
    return { text: Object.keys(results).map((key) => branchLine(key, next.facts[key], null)).join('\n') || 'no branches', epic: next };
  },
  show: ([epic], o) => (o.json ? store.readEpic(epic) : { text: buildBrief(store.readEpic(epic), { session: o.session }) }),
  report: ([epic], o) => ({ text: buildReport(store.readEpic(epic), { task: need(o.task, '--task') }) }),
  url: ([epic]) => ({ text: boardUrl(store.checkId(epic)) }),
  doc: ([action, epic, a, b], o) => {
    const place = (ref) => {
      if (!ref || ref === '-') return {};
      const [task, step] = ref.split('/');
      return { task, step: step || undefined };
    };
    if (action === 'new') return { text: docs.newDoc(epic, { ...place(a), kind: o.kind, title: o.title }).path };
    if (action === 'link') return { text: docs.linkDoc(epic, { ...place(a), kind: o.kind, title: o.title, path: need(o.path, '--path') }).path };
    if (action === 'import') return { text: docs.importDoc(epic, { ...place(a), kind: o.kind, title: o.title, path: need(o.path, '--path') }).path };
    if (action === 'list') {
      const list = store.readEpic(epic).docs || [];
      return { text: list.map((d) => `${d.id} · ${[d.task, d.step].filter(Boolean).join('/') || 'epic'} · ${d.kind} · ${d.title} · ${d.owned ? 'board' : 'linked'} · ${d.path}`).join('\n') || 'no documents' };
    }
    if (action === 'remove') {
      docs.removeDoc(epic, need(a, 'document id'));
      return { text: 'ok' };
    }
    throw new BoardError(400, 'usage', 'doc new|link|import <epic> [<task>/<step>] --kind ... --title ... [--path ...] | doc list <epic> | doc remove <epic> <id>');
  },
  'docs-mode': ([epic, mode]) => patch(epic, { docsMode: need(mode, 'board or linked') }),
  export: ([epic], o) => {
    const out = o.out || `epic-${store.checkId(epic)}-${now().slice(0, 10)}.html`;
    writeFileSync(out, buildExport(epic));
    return { text: out };
  },
  list: () => ({ text: store.listEpics().map((e) => `${e.id} · ${e.title} — ${boardUrl(e.id)}`).join('\n') || 'no epics yet' }),
  doctor: async (_, o) => {
    const { selfcheck } = await import('../server/selfcheck.mjs');
    return { text: JSON.stringify(await selfcheck({ repo: o.repo }), null, 2) };
  },
  service: async ([action]) => {
    const service = await import('../server/service.mjs');
    if (action === 'install') return { text: await service.install() };
    if (action === 'uninstall') return { text: service.uninstall() };
    if (action === 'status') return { text: await service.status() };
    throw new BoardError(400, 'usage', 'service install|uninstall|status');
  },
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const fn = COMMANDS[command ?? 'help'];
  if (!fn) throw new BoardError(400, 'usage', `no command "${command}"; run "epic.mjs help"`);
  const { values, positionals } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true, strict: true });
  const out = await fn(positionals, values);
  if (values.json) console.log(JSON.stringify(out.epic ?? out, null, 2));
  else if (out?.text !== undefined) console.log(out.text);
  else if (out?.changes) console.log(`ok: ${out.changes.length} change(s)`);
  else console.log('ok');
}

main().catch((e) => {
  console.error(`error: ${e instanceof BoardError ? e.detail : e.message}`);
  process.exit(1);
});
