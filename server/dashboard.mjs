import { listEpics, readEpic } from './store.mjs';
import { feedSummary, feedSparkline, listFeedSources } from './feed.mjs';
import { readSettings } from './settings.mjs';
import { durationMs } from './settings-registry.mjs';

function openWaiting(epic) {
  return (epic.waiting || []).filter((w) => !w.doneAt && w.status !== 'closed');
}

export function buildDashboard() {
  const summaries = listEpics();
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
        const mr = fact?.mr || branch.mr;
        if (mr && !mr.merged && mr.state !== 'closed') {
          mrOpen++;
          const pipe = mr.pipeline || mr.status;
          if (pipe === 'failed' || pipe === 'canceled' || mr.pipelineStatus === 'failed') mrRed++;
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
      href: '/?filter=tasks',
    },
    waiting: {
      open: waitingOpen,
      oldestDays: waitingDays,
      href: '/?filter=waiting',
    },
    mr: {
      open: mrOpen,
      red: mrRed,
      href: '/?filter=mr',
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
