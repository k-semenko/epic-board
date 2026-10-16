import { readInput, findSessionEpic, epicForCwd, run, CLI } from './lib.mjs';
import { buildBrief } from '../server/brief.mjs';
import { boardUrl } from '../server/paths.mjs';

run(async () => {
  const input = readInput();
  const notes = [];
  try {
    const { syncIfOutdated } = await import('../server/service.mjs');
    const updated = await syncIfOutdated();
    if (updated) notes.push(updated);
  } catch (e) {
    notes.push(`epic-board: service update failed (${e.message}); run ${CLI} service install`);
  }
  const sid = input.session_id;
  const bound = sid ? findSessionEpic(sid) : null;
  if (bound && (input.source === 'compact' || input.source === 'resume')) {
    notes.push(`${buildBrief(bound.epic, { session: sid })}\nThe board is the source of truth for this epic; update it through ${CLI} (skill epic-board).`);
  } else if (bound) {
    notes.push(`epic-board: session bound to epic ${bound.epic.id}, board ${boardUrl(bound.epic.id)}`);
  } else if (sid) {
    // After /clear the session id is new, so it is treated like any unbound session.
    const epic = epicForCwd(input.cwd);
    if (epic) notes.push(`epic-board: session ${sid}; if this work belongs to epic ${epic.id}, bind it: ${CLI} bind ${epic.id} --session ${sid} --agent claude`);
  }
  if (notes.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: notes.join('\n') } }));
});
