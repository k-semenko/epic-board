import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readEpic, writeFacts } from './store.mjs';
import { BoardError } from './errors.mjs';
import { branchLine } from './brief.mjs';
import { stripProxy } from './paths.mjs';

const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];

export function cleanEnv(env = process.env) {
  if (!stripProxy(env)) return env;
  const out = { ...env };
  for (const k of PROXY_VARS) delete out[k];
  return out;
}

export function execRunner(cmd, args, { cwd, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, env: cleanEnv(), timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      const text = String(stderr || '') || (err ? (err.killed ? `timeout ${timeoutMs} ms` : err.message) : '');
      resolve({ code, stdout: String(stdout || ''), stderr: text });
    });
  });
}

function targetsOf(epic, { scope, task, branch }) {
  const out = [];
  for (const t of epic.tasks || []) {
    if (scope === 'task' && t.id !== task) continue;
    for (const b of t.branches || []) {
      const key = `${b.repo}:${b.name}`;
      if (scope === 'branch' && key !== branch) continue;
      out.push({ ...b, key, task: t.id });
    }
  }
  if (scope !== 'all' && !out.length) throw new BoardError(404, 'no-target', `epic has no ${scope === 'task' ? `task ${task} with branches` : `branch ${branch}`}`);
  return out;
}

async function counts(git, range) {
  const r = await git('rev-list', '--left-right', '--count', '--end-of-options', range);
  if (r.code !== 0) return null;
  const [left, right] = r.stdout.trim().split(/\s+/).map(Number);
  return { left, right };
}

const GH_STATE = { OPEN: 'opened', CLOSED: 'closed', MERGED: 'merged' };

// gh reports one entry per check; the page wants one pipeline word like GitLab gives.
export function rollup(checks) {
  if (!Array.isArray(checks) || !checks.length) return null;
  const word = (c) => String(c.conclusion || c.state || c.status || '').toUpperCase();
  const words = checks.map(word);
  if (words.some((w) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(w))) return 'failed';
  if (words.some((w) => ['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'EXPECTED', 'REQUESTED'].includes(w))) return 'running';
  return 'success';
}

const PROVIDERS = {
  gitlab: {
    cmd: 'glab',
    args: (iid, project) => ['mr', 'view', String(iid), '-R', project, '-F', 'json'],
    parse: (mr) => ({ state: mr.state ?? null, draft: Boolean(mr.draft), sha: mr.sha ?? null, pipeline: mr.head_pipeline?.status ?? mr.pipeline?.status ?? null, url: mr.web_url ?? null }),
  },
  github: {
    cmd: 'gh',
    args: (iid, project) => ['pr', 'view', String(iid), '-R', project, '--json', 'state,isDraft,headRefOid,url,statusCheckRollup'],
    parse: (pr) => ({ state: GH_STATE[pr.state] ?? (pr.state ? String(pr.state).toLowerCase() : null), draft: Boolean(pr.isDraft), sha: pr.headRefOid ?? null, pipeline: rollup(pr.statusCheckRollup), url: pr.url ?? null }),
  },
};

async function mrFacts(repo, target, head, run) {
  const provider = PROVIDERS[repo.provider];
  if (!target.mr?.iid || !provider || !repo.project) return null;
  const r = await run(provider.cmd, provider.args(target.mr.iid, repo.project), { cwd: repo.path });
  if (r.code !== 0) return { error: `${provider.cmd}: ${r.stderr.trim() || r.code}` };
  try {
    const mr = provider.parse(JSON.parse(r.stdout));
    return { ...mr, shaMatchesHead: Boolean(mr.sha && head && mr.sha.startsWith(head)), error: null };
  } catch (e) {
    return { error: `${provider.cmd}: not JSON (${e.message})` };
  }
}

async function branchFacts(epic, target, run) {
  const repo = epic.repos[target.repo];
  const worktreeExists = Boolean(target.worktree && existsSync(target.worktree));
  const cwd = worktreeExists ? target.worktree : repo.path;
  const git = (...args) => run('git', ['-C', cwd, ...args]);
  const log = await git('log', '-1', '--format=%h%x00%s', '--end-of-options', target.name);
  if (log.code !== 0) return { error: `git log ${target.name}: ${log.stderr.trim() || log.code}` };
  const [head, subject] = log.stdout.trim().split('\0');
  const base = await counts(git, `origin/${repo.base}...${target.name}`);
  const remote = await git('rev-parse', '--verify', '--quiet', '--end-of-options', `refs/remotes/origin/${target.name}`);
  const own = remote.code === 0 ? await counts(git, `origin/${target.name}...${target.name}`) : null;
  let dirty = null;
  if (worktreeExists) {
    const status = await git('status', '--porcelain');
    dirty = status.code === 0 ? status.stdout.trim().length > 0 : null;
  }
  return {
    head, subject,
    behind: base?.left ?? null,
    ahead: base?.right ?? null,
    unpushed: own ? own.right : base?.right ?? null,
    remoteBehind: own ? own.left : null,
    dirty, worktreeExists,
    mr: await mrFacts(repo, target, head, run),
  };
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Network runs without the epic lock; only the final merge of facts takes it.
export async function refreshEpic(id, { scope = 'all', task, branch, run = execRunner, onProgress = () => {} } = {}) {
  const epic = readEpic(id);
  const targets = targetsOf(epic, { scope, task, branch });
  const repoErrors = {};
  for (const name of new Set(targets.map((t) => t.repo))) {
    const repo = epic.repos?.[name];
    if (!repo) {
      repoErrors[name] = `repo ${name} is not described in repos`;
      onProgress({ type: 'repo', key: name, state: 'error', detail: repoErrors[name] });
      continue;
    }
    onProgress({ type: 'repo', key: name, state: 'start' });
    const r = await run('git', ['-C', repo.path, 'fetch', '--prune', 'origin']);
    if (r.code !== 0) repoErrors[name] = `git fetch ${name}: ${r.stderr.trim() || r.code}`;
    onProgress({ type: 'repo', key: name, state: repoErrors[name] ? 'error' : 'ok', detail: repoErrors[name] || 'git fetch' });
  }
  const results = {};
  const facts = await pool(targets, 4, async (t) => {
    onProgress({ type: 'branch', key: t.key, state: 'start' });
    const f = repoErrors[t.repo] ? { error: repoErrors[t.repo] } : await branchFacts(epic, t, run);
    onProgress({ type: 'branch', key: t.key, state: f.error ? 'error' : 'ok', detail: f.error || branchLine(t.key, f, t.mr?.iid).replace(`${t.key} `, '') });
    return f;
  });
  targets.forEach((t, i) => {
    results[t.key] = facts[i];
  });
  return { epic: writeFacts(id, results), results };
}
