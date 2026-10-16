import { readInput, findSessionEpic, run, CLI } from './lib.mjs';
import { boardUrl } from '../server/paths.mjs';

run(() => {
  const input = readInput();
  const bound = input.session_id ? findSessionEpic(input.session_id) : null;
  if (!bound) return;
  const id = bound.epic.id;
  process.stdout.write(
    `epic-board: the state of epic ${id} (tasks, steps, branches, merge requests, merge order, items needing a decision, this session's plan) ` +
      `lives on its board: ${boardUrl(id)} and in ${CLI} show ${id} --session ${input.session_id}. ` +
      'In the summary, point to the board in one line instead of retelling it. ' +
      "Keep the user's last 2-3 messages verbatim and every restriction or \"only after yes\" condition they set. " +
      'This adds to the other summary instructions and does not replace them.\n',
  );
});
