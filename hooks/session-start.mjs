import { readInput, findSessionEpic, epicForCwd, run, CLI, sessionId, cwdOf, agentName, emitSessionContext, isCursor, outdatedNote } from './lib.mjs';
import { buildBrief } from '../server/brief.mjs';
import { boardUrl } from '../server/paths.mjs';
import { shQuote } from '../server/page/session-command.mjs';

async function syncNotes() {
  try {
    const { syncIfOutdated } = await import('../server/service.mjs');
    const updated = await syncIfOutdated();
    return updated ? [updated] : [];
  } catch (e) {
    return [`epic-board: service update failed (${e.message}); run ${CLI} service install`];
  }
}

function boardNotes(input, sid) {
  const notes = [];
  const bound = sid ? findSessionEpic(sid) : null;
  const cwdFlag = `--cwd ${shQuote(cwdOf(input))}`;
  if (bound && (input.source === 'compact' || input.source === 'resume')) {
    notes.push(`${buildBrief(bound.epic, { session: sid })}\nThe board is the source of truth for this epic; update it through ${CLI} (skill epic-board).`);
  } else if (bound) {
    notes.push(`epic-board: session bound to epic ${bound.epic.id}, board ${boardUrl(bound.epic.id)}`);
  } else if (sid) {
    // After /clear the session id is new, so it is treated like any unbound session.
    const epic = epicForCwd(cwdOf(input));
    if (epic) notes.push(`epic-board: session ${sid}; if this work belongs to epic ${epic.id}, bind it: ${CLI} bind ${epic.id} --session ${sid} --agent ${agentName()} ${cwdFlag}`);
  }
  if (bound && !bound.session.cwd) {
    const agent = bound.session.agent || agentName();
    notes.push(`epic-board: session ${sid} has no directory; record it: ${CLI} bind ${bound.epic.id} --session ${sid} --agent ${agent} ${cwdFlag}`);
  }
  return notes;
}

run(async () => {
  const input = readInput();
  const sid = sessionId(input);
  // Cursor sessionStart is fire-and-forget: emit before any service install can delay stdout.
  if (isCursor()) {
    const notes = [await outdatedNote(), ...boardNotes(input, sid)].filter(Boolean);
    emitSessionContext(notes.join('\n') || null, { sessionId: sid });
    await syncNotes();
    return;
  }
  const notes = [...(await syncNotes()), await outdatedNote(), ...boardNotes(input, sid)].filter(Boolean);
  if (notes.length) emitSessionContext(notes.join('\n'));
});
