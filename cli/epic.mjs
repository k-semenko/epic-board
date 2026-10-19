#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFileSync, readFileSync } from 'node:fs';
import * as store from '../server/store.mjs';
import { refreshEpic } from '../server/refresh.mjs';
import { buildBrief, branchLine } from '../server/brief.mjs';
import { buildReport } from '../server/report.mjs';
import { boardUrl } from '../server/paths.mjs';
import { buildExport } from '../server/export.mjs';
import * as docs from '../server/docs.mjs';
import { BoardError } from '../server/errors.mjs';
import { readBoardSnapshot, linksForEpic } from '../server/links.mjs';
import { parseStepRef } from '../server/step-refs.mjs';
import { readSettingsState, writeSettings, parseConfigValue, SETTINGS_REGISTRY, SETTINGS_BY_KEY } from '../server/settings.mjs';
import * as feed from '../server/feed.mjs';

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
  json: { type: 'boolean' }, delete: { type: 'boolean' }, 'cleanup-refs': { type: 'boolean' }, out: { type: 'string' }, repo: { type: 'string' },
  group: { type: 'string' }, source: { type: 'string' }, since: { type: 'string' }, unmarked: { type: 'boolean' },
  severity: { type: 'string' }, mark: { type: 'string' },
  'dry-run': { type: 'boolean' }, 'text-file': { type: 'string' },
};

const HELP = `epic.mjs <command> ... (data: see "doctor"; "-" as a flag value clears the field)

  list                                         epics and their pages
  new <epic> --title T [--goal G] [--url U]    create an epic (id: letters, digits, . _ -)
  repo <epic> <name> --path P [--base main] [--provider gitlab|github --project host/owner/name]
  task <epic> <task> --title T [--url U] [--tracker Jira] [--status S] [--role main|side]
  task <epic> <task> --delete [--cleanup-refs]
  step <epic> <task>/<step> [--title T] [--state done|active|todo|blocked|waiting] [--after t/s,...] [--label L] [--note N]
  step <epic> <task>/<step> --delete [--cleanup-refs]
  branch <epic> <task> <repo> <branch> [--worktree P] [--mr N] [--delete]
  open-item <epic> <task> add <text> | done <id>
  wait <epic> add <id> --title T [--kind decision|approval|review|action|other] [--details MD] [--task T]
                       [--ref task:T|step:T/S|branch:repo:name|doc:ID|decision:ID|waiting:ID|https://...]... [--check "item"]...
                       [--input confirm|single|multi] [--option id=text]... [--recommend id]
  wait <epic> show <id> [--json]              full request, version and responses
  wait <epic> submit <id> --version V --submission-id S [--confirmed | --selected a,b] [--checked c1,c2] [--comment C]
  wait <epic> clarify <id> --version V --submission-id S --comment C
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
  config list [--group G] [--json]             board settings from the registry
  config get <key> [--json]
  config set <key> <value>                     value by type (14d, true, JSON for lists)
  config reset <key>                           restore the registry default
  feed add <file|-> [--json]                   upsert feed items (object or array)
  feed list [--unmarked] [--source X] [--since 1d] [--severity S] [--mark M|none] [--json]
  feed mark <id…> important|unimportant|noise [--comment C]
  feed unmark <id…> | feed delete <id…>
  feed summary [--json] | feed prune [--dry-run]
  feed profile --source X [--json] | feed profile set --source X --text-file F
  feed profile show --source X

Deletion refuses incoming references by default. --cleanup-refs detaches dependencies,
documents, waiting/session links and orphan branch links in merge order; document files,
append-only decisions and waiting history are retained. Waiting versions change; statuses stay.
If a document loses its last allowed worktree root, import/relink it or retain the root first.
Task/step --delete cannot be combined with edit flags. --cleanup-refs requires --delete.

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

const deleting = (o) => {
  if (o['cleanup-refs'] && !o.delete) throw new BoardError(400, 'usage', '--cleanup-refs requires --delete');
  if (o.delete) {
    const edits = Object.keys(o).filter((key) => !['delete', 'cleanup-refs', 'why', 'json'].includes(key));
    if (edits.length) throw new BoardError(400, 'usage', `--delete cannot be combined with edit flags: ${edits.map((key) => `--${key}`).join(', ')}`);
  }
  return o.delete;
};
const deletionOptions = (o) => ({ cleanupRefs: o['cleanup-refs'] || false, by: 'cli', why: o.why || '' });

function warnAfter(epic, task, step, after) {
  const targets = new Set((after || []).map((value) => parseStepRef(value, epic)).filter((ref) => ref && !ref.local).map((ref) => ref.address));
  if (!targets.size) return;
  try {
    const links = linksForEpic(readBoardSnapshot(), epic);
    for (const edge of links.outgoing) {
      if (edge.source.task === task && edge.source.step === step && targets.has(edge.target.address) && edge.status !== 'resolved') {
        console.error(`warning: ${edge.target.address}: ${edge.status}`);
      }
    }
  } catch (error) {
    console.error(`warning: cannot check external links: ${error.detail || error.message}`);
  }
}

const listIds = (value) => value === undefined ? [] : value.split(',').map((s) => s.trim()).filter(Boolean);
const waitingRequest = (o, currentInput) => {
  let input;
  if (o.input !== undefined || o.option !== undefined || o.recommend !== undefined) {
    const type = o.input || currentInput?.type || 'confirm';
    let options = o.option?.map((value) => {
      const separator = value.indexOf('=');
      if (separator < 1 || !value.slice(separator + 1).trim()) throw new BoardError(400, 'usage', '--option must be id=text');
      const id = value.slice(0, separator);
      return { id, text: value.slice(separator + 1) };
    }) ?? (type === 'confirm' ? undefined : currentInput?.options);
    if (o.recommend !== undefined) {
      if (!options?.some((x) => x.id === o.recommend)) throw new BoardError(400, 'usage', '--recommend must name a current or supplied option ID');
      options = options.map((option) => defined({ ...option, recommended: option.id === o.recommend ? true : undefined }));
    }
    input = defined({ type, options });
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
  task: ([epic, task], o) => {
    need(task, 'task id');
    if (deleting(o)) return store.deleteTask(epic, task, deletionOptions(o));
    return patch(epic, { tasks: [defined({ id: task, title: o.title, url: orNull(o.url), tracker: orNull(o.tracker), role: o.role, status: orNull(o.status), statusCheckedAt: o.status ? now() : undefined })] }, o.why);
  },
  step: ([epic, ref], o) => {
    const remove = deleting(o);
    if (remove && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[\w.-]{1,64}$/.test(need(ref, '<task>/<step>'))) {
      throw new BoardError(400, 'usage', 'step reference must be <task>/<step> with valid task and step ids');
    }
    const [task, step] = need(ref, '<task>/<step>').split('/');
    if (remove) return store.deleteStep(epic, task, step, deletionOptions(o));
    const after = o.after === undefined ? undefined : o.after === '-' ? null : o.after.split(',').map((s) => s.trim()).filter(Boolean);
    const result = patch(epic, { tasks: [{ id: task, steps: [defined({ id: need(step, 'step id'), title: o.title, state: o.state, after, label: orNull(o.label), note: orNull(o.note) })] }] }, o.why);
    if (after !== undefined) warnAfter(epic, task, step, after);
    return result;
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
    if (action === 'clarify') return store.clarifyWaiting(epic, itemId, { version: need(o.version, '--version'), submissionId: need(o['submission-id'], '--submission-id'), comment: need(o.comment, '--comment') }, opts);
    if (action === 'resolve') return store.resolveWaiting(epic, itemId, { version: need(o.version, '--version'), submissionId: need(o['submission-id'], '--submission-id'), resolution: need(o.resolution, '--resolution') }, opts);
    if (action === 'revise') {
      const version = need(o.version, '--version');
      const reason = need(o.reason, '--reason');
      const item = (store.readEpic(epic).waiting || []).find((w) => w.id === itemId);
      if (!item) throw new BoardError(404, 'no-waiting', `epic has no waiting item ${itemId}`);
      return store.reviseWaiting(epic, itemId, { version, reason, patch: waitingRequest(o, item.input) }, opts);
    }
    if (action === 'remove') return store.removeWaiting(epic, itemId, { version: need(o.version, '--version') }, opts);
    throw new BoardError(400, 'usage', 'wait <epic> add|show|submit|clarify|resolve|revise|remove <id>; run epic.mjs help');
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
  report: ([epic], o) => {
    const task = need(o.task, '--task');
    const id = store.checkId(epic);
    const snapshot = readBoardSnapshot();
    const links = linksForEpic(snapshot, id);
    return { text: buildReport(snapshot.epics.find((value) => String(value.id) === id), { task, links }) };
  },
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
  config: ([action, key, ...rest], o) => {
    const state = readSettingsState();
    if (action === 'list') {
      const rows = SETTINGS_REGISTRY.filter((entry) => !o.group || entry.group === o.group);
      if (o.json) return { rev: state.rev, values: Object.fromEntries(rows.map((entry) => [entry.key, state.values[entry.key]])) };
      return {
        text: rows.map((entry) => `${entry.key} = ${JSON.stringify(state.values[entry.key])}`).join('\n') || 'no settings',
      };
    }
    const entry = SETTINGS_BY_KEY[need(key, 'settings key')];
    if (!entry) throw new BoardError(400, 'bad-settings', `unknown settings key ${key}`);
    if (action === 'get') {
      const value = state.values[entry.key];
      return o.json ? { key: entry.key, value, rev: state.rev } : { text: typeof value === 'string' ? value : JSON.stringify(value) };
    }
    if (action === 'set') {
      const raw = need(rest.join(' '), 'value');
      const saved = writeSettings({ [entry.key]: parseConfigValue(entry, raw) }, { rev: state.rev });
      return o.json ? saved : { text: `${entry.key} = ${JSON.stringify(saved.values[entry.key])}` };
    }
    if (action === 'reset') {
      const saved = writeSettings({ [entry.key]: null }, { rev: state.rev });
      return o.json ? saved : { text: `${entry.key} = ${JSON.stringify(saved.values[entry.key])}` };
    }
    throw new BoardError(400, 'usage', 'config list|get|set|reset');
  },
  feed: ([action, ...rest], o) => {
    if (action === 'add') {
      const file = need(rest[0], 'feed add <file|->');
      const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
      let payload;
      try { payload = JSON.parse(text); } catch { throw new BoardError(400, 'bad-json', 'feed add file is not JSON'); }
      const result = feed.addFeedItems(payload);
      if (o.json) return result;
      const warn = result.warnings.length ? `\nwarnings: ${result.warnings.map((w) => w.warning).join('; ')}` : '';
      return { text: `ok: ${result.items.length} item(s)${warn}` };
    }
    if (action === 'list') {
      const items = feed.listFeedItems({ unmarked: o.unmarked, source: o.source, since: o.since, severity: o.severity, mark: o.mark });
      return o.json ? items : { text: items.map((item) => `${item.id} · ${item.severity} · ${item.title}${item.mark ? ` · ${item.mark.value}` : ''}`).join('\n') || 'no items' };
    }
    if (action === 'mark') {
      const value = rest.at(-1);
      const ids = rest.slice(0, -1);
      if (!ids.length) throw new BoardError(400, 'usage', 'feed mark <id…> important|unimportant|noise');
      const items = feed.markFeedItems(ids, value, { comment: o.comment });
      return o.json ? items : { text: `ok: marked ${items.length}` };
    }
    if (action === 'unmark') {
      const items = feed.unmarkFeedItems(rest);
      return o.json ? items : { text: `ok: unmarked ${items.length}` };
    }
    if (action === 'delete') {
      const items = feed.deleteFeedItems(rest);
      return o.json ? items : { text: `ok: deleted ${items.length}` };
    }
    if (action === 'summary') {
      const summary = feed.feedSummary();
      return o.json ? summary : { text: `unmarked ${summary.unmarked} (fire ${summary.fire}) · total ${summary.total}` };
    }
    if (action === 'prune') {
      const result = feed.pruneFeed({ dryRun: o['dry-run'] });
      return o.json ? result : { text: result.map((row) => `${row.source}: removed ${row.removed.length}, kept ${row.kept}`).join('\n') || 'nothing to prune' };
    }
    if (action === 'profile') {
      const sub = rest[0];
      if (sub === 'set') {
        const text = readFileSync(need(o['text-file'], '--text-file'), 'utf8');
        const saved = feed.setFeedProfile(need(o.source, '--source'), text);
        return o.json ? saved : { text: `ok: profile ${saved.source}` };
      }
      if (sub === 'show') {
        const shown = feed.showFeedProfile(need(o.source, '--source'));
        return o.json ? shown : { text: shown.text || '(empty)' };
      }
      const aggregates = feed.feedProfileAggregates(need(o.source, '--source'));
      return o.json ? aggregates : { text: JSON.stringify(aggregates, null, 2) };
    }
    throw new BoardError(400, 'usage', 'feed add|list|mark|unmark|delete|summary|prune|profile');
  },
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const fn = COMMANDS[command ?? 'help'];
  if (!fn) throw new BoardError(400, 'usage', `no command "${command}"; run "epic.mjs help"`);
  const { values, positionals } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true, strict: true });
  if (values['cleanup-refs'] && !['task', 'step'].includes(command)) throw new BoardError(400, 'usage', '--cleanup-refs requires task or step --delete');
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
