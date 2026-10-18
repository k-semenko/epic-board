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

export function sessionId(input) {
  return input.session_id || input.conversation_id || null;
}

export function cwdOf(input) {
  if (input.cwd) return input.cwd;
  const roots = input.workspace_roots;
  if (Array.isArray(roots) && roots[0]) return roots[0];
  return process.cwd();
}

// Cursor sets CURSOR_PLUGIN_ROOT (and sometimes CLAUDE_PLUGIN_ROOT for compatibility).
export function isCursor() {
  return Boolean(process.env.CURSOR_PLUGIN_ROOT);
}

export function agentName() {
  if (isCursor()) return 'cursor';
  if (process.env.GROK_PLUGIN_ROOT) return 'grok';
  return 'claude';
}

// Cursor: additional_context + env (session id survives if context is dropped).
// Claude: nested hookSpecificOutput.
export function emitSessionContext(text, { sessionId: sid } = {}) {
  if (isCursor()) {
    const out = {};
    if (text) out.additional_context = text;
    if (sid) out.env = { EPIC_BOARD_SESSION_ID: sid };
    if (Object.keys(out).length) process.stdout.write(JSON.stringify(out));
    return;
  }
  if (!text) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
}

// Claude PreCompact reads plain text; Cursor preCompact shows user_message only.
export function emitPreCompact(text) {
  if (!text) return;
  if (isCursor()) {
    process.stdout.write(JSON.stringify({ user_message: text }));
  } else {
    process.stdout.write(text);
  }
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
