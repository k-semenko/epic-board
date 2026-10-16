import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { listEpics } from '../server/store.mjs';
import { dataDir } from '../server/paths.mjs';
import { fileURLToPath } from 'node:url';

// The agent reads these lines without the skill loaded, so the CLI is named by its absolute path.
export const CLI = `node "${resolve(fileURLToPath(import.meta.url), '..', '..', 'cli', 'epic.mjs')}"`;

export function readInput() {
  return JSON.parse(readFileSync(0, 'utf8') || '{}');
}

// A session may be bound to several epics over its life; the freshest mark wins.
export function findSessionEpic(sid) {
  let best = null;
  for (const epic of listEpics()) {
    const session = (epic.sessions || []).find((s) => s.id === sid);
    if (session && (!best || String(session.lastAt) > String(best.session.lastAt))) best = { epic, session };
  }
  return best;
}

export function epicForCwd(cwd) {
  if (!cwd) return null;
  const here = resolve(cwd) + sep;
  return listEpics().find((e) => Object.values(e.repos || {}).some((r) => r.path && here.startsWith(resolve(r.path) + sep))) || null;
}

// Hooks must never break a session: errors go to a log file and the hook exits 0.
export async function run(fn) {
  try {
    await fn();
  } catch (e) {
    try {
      mkdirSync(dataDir(), { recursive: true });
      appendFileSync(join(dataDir(), 'hooks.log'), `${new Date().toISOString()} ${e.stack || e}\n`);
    } catch {}
  }
  process.exit(0);
}
