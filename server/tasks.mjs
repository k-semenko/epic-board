import { createHash } from 'node:crypto';
import { BoardError } from './errors.mjs';

export function tasksForBoard(snapshot) {
  if (!snapshot.epics.length && snapshot.errors.length) throw new BoardError(500, 'unavailable-board', 'cannot read any epic files');
  const epics = snapshot.epics.map((epic) => ({ id: String(epic.id), title: epic.title || String(epic.id) }));
  const tasks = snapshot.epics.flatMap((epic, index) => (epic.tasks || []).map((task) => {
    const steps = task.steps || [];
    return {
      epic: epics[index],
      id: String(task.id),
      title: String(task.title || task.id),
      status: typeof task.status === 'string' ? task.status : null,
      statusCheckedAt: typeof task.statusCheckedAt === 'string' ? task.statusCheckedAt : null,
      role: task.role === 'side' ? 'side' : 'main',
      progress: { done: steps.filter((step) => step.state === 'done').length, total: steps.length },
      current: steps.filter((step) => step.state === 'active').map((step) => String(step.title || step.id)),
      waiting: (epic.waiting || []).filter((item) => item.task === task.id && !item.doneAt).length,
      url: `/e/${encodeURIComponent(epic.id)}#t-${encodeURIComponent(task.id)}`,
    };
  }));
  const result = { tasks, epics, incomplete: snapshot.errors.length > 0, errors: snapshot.errors };
  const revision = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  return { ...result, readAt: snapshot.readAt, revision };
}
