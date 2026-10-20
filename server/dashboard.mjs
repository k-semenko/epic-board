import { listEpics, readEpic, isArchived } from './store.mjs';
import { feedSummary, feedSparkline, listFeedSources } from './feed.mjs';
import { readSettings } from './settings.mjs';
import { durationMs } from './settings-registry.mjs';

function openWaiting(epic) {
  return (epic.waiting || []).filter((w) => !w.doneAt && w.status !== 'closed');
}

export function buildDashboard() {
  const summaries = listEpics().filter((epic) => !isArchived(epic));
  const settings = readSettings();
  const pins = new Set(settings['epic.pinned'] || []);
  let tasksInWork = 0;
  let tasksBlocked = 0;
  let tasksWaiting = 0;
  let waitingOpen = 0;
  let waitingOldest = null;
  let mrOpen = 0;
  let mrRed = 0;

  for (const summary of summaries) {
    let epic;
    try { epic = readEpic(summary.id); } catch { continue; }
    for (const task of epic.tasks || []) {
      const states = (task.steps || []).map((s) => s.state);
      if (states.includes('active')) tasksInWork++;
      if (states.includes('blocked')) tasksBlocked++;
      if (states.includes('waiting')) tasksWaiting++;
      for (const branch of task.branches || []) {
        const fact = epic.facts?.[`${branch.repo}:${branch.name}`];
        // Refresh writes MR facts with state opened|merged|closed; a bare iid means it was never refreshed.
        if (fact?.mr?.state === 'opened') {
          mrOpen++;
          if (fact.mr.pipeline === 'failed') mrRed++;
        }
      }
    }
    for (const item of openWaiting(epic)) {
      waitingOpen++;
      const since = Date.parse(item.since || item.createdAt || epic.createdAt);
      if (since && (!waitingOldest || since < waitingOldest)) waitingOldest = since;
    }
  }

  const feed = feedSummary();
  const spark = feedSparkline(14);
  const silentAfter = durationMs(settings['feed.sourceSilentAfter']) ?? 86_400_000;
  const now = Date.now();
  const sources = listFeedSources();
  const active = sources.filter((s) => s.latestAt && now - Date.parse(s.latestAt) <= silentAfter);
  const silent = sources.filter((s) => !s.latestAt || now - Date.parse(s.latestAt) > silentAfter);

  const waitingDays = waitingOldest ? Math.max(0, Math.floor((now - waitingOldest) / 86_400_000)) : null;

  return {
    epics: {
      active: summaries.length,
      total: summaries.length,
      pinned: pins.size,
      href: '/',
    },
    tasks: {
      inWork: tasksInWork,
      blocked: tasksBlocked,
      waiting: tasksWaiting,
      href: '/tasks',
    },
    waiting: {
      open: waitingOpen,
      oldestDays: waitingDays,
      href: '/tasks?waiting=1',
    },
    mr: {
      open: mrOpen,
      red: mrRed,
      href: null,
    },
    feed: {
      unmarked: feed.unmarked,
      fire: feed.fire,
      spark,
      href: '/feed',
    },
    connectors: {
      active: active.length,
      silent: silent.map((s) => s.source),
      href: '/feed',
    },
  };
}

const DAY = 86_400_000;

// Every branch with a merge request across epics, with what is known about it and how fresh that knowledge is.
export function listMergeRequests({ now = Date.now() } = {}) {
  const out = [];
  for (const summary of listEpics().filter((epic) => !isArchived(epic))) {
    let epic;
    try { epic = readEpic(summary.id); } catch { continue; }
    for (const task of epic.tasks || []) {
      for (const branch of task.branches || []) {
        if (!branch.mr) continue;
        const fact = epic.facts?.[`${branch.repo}:${branch.name}`] || null;
        const mr = fact?.mr || null;
        const checkedAt = mr?.fetchedAt || fact?.fetchedAt || null;
        const state = mr?.state ? (mr.draft && mr.state === 'opened' ? 'draft' : mr.state) : 'unchecked';
        const problems = [];
        if (mr?.pipeline === 'failed') problems.push('pipeline');
        if (mr?.shaMatchesHead === false && state !== 'merged' && state !== 'closed') problems.push('sha');
        if (typeof fact?.unpushed === 'number' && fact.unpushed > 0) problems.push('unpushed');
        if (fact?.branchMissing && state !== 'merged') problems.push('missing');
        if (mr?.error || fact?.error) problems.push('error');
        if (!checkedAt || now - Date.parse(checkedAt) > DAY) problems.push('stale');
        out.push({
          epic: epic.id, epicTitle: epic.title, task: task.id, taskTitle: task.title,
          repo: branch.repo, branch: branch.name, base: epic.repos?.[branch.repo]?.base || null,
          iid: branch.mr.iid ?? null, url: mr?.url || null, state, pipeline: mr?.pipeline || null,
          behind: fact?.behind ?? null, ahead: fact?.ahead ?? null, unpushed: fact?.unpushed ?? null,
          subject: fact?.subject || null, checkedAt, error: mr?.error || fact?.error || null, problems,
        });
      }
    }
  }
  const rank = { opened: 0, draft: 1, unchecked: 2, merged: 3, closed: 4 };
  return out.sort((a, b) => (rank[a.state] ?? 5) - (rank[b.state] ?? 5) || b.problems.length - a.problems.length || String(b.checkedAt || '').localeCompare(String(a.checkedAt || '')));
}
