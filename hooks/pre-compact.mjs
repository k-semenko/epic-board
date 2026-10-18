import { readInput, findSessionEpic, run, CLI, sessionId, emitPreCompact, isCursor } from './lib.mjs';
import { boardUrl } from '../server/paths.mjs';

run(() => {
  const input = readInput();
  const sid = sessionId(input);
  const bound = sid ? findSessionEpic(sid) : null;
  if (!bound) return;
  const id = bound.epic.id;
  const url = boardUrl(id);
  if (isCursor()) {
    emitPreCompact(
      `epic-board: epic ${id} lives on ${url}. After compact, ask the agent to run ${CLI} show ${id} --session ${sid}.`,
    );
    return;
  }
  emitPreCompact(
    `epic-board: the state of epic ${id} (tasks, steps, branches, merge requests, merge order, items needing a decision, this session's plan) ` +
      `lives on its board: ${url} and in ${CLI} show ${id} --session ${sid}. ` +
      'In the summary, point to the board in one line instead of retelling it. ' +
      "Keep the user's last 2-3 messages verbatim and every restriction or \"only after yes\" condition they set. " +
      'This adds to the other summary instructions and does not replace them.\n',
  );
});
