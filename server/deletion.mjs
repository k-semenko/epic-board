import { BoardError } from './errors.mjs';
import { parseStepRef } from './step-refs.mjs';

export function planDeletion(epic, taskId, stepId) {
  const task = (epic.tasks || []).find((item) => item.id === taskId);
  if (!task) throw new BoardError(404, 'no-task', `epic has no task ${taskId}`);
  if (stepId !== undefined && !(task.steps || []).some((item) => item.id === stepId)) {
    throw new BoardError(404, 'no-step', `task ${taskId} has no step ${stepId}`);
  }
  const wholeTask = stepId === undefined;
  const removedStep = (ref) => wholeTask ? ref.startsWith(`${taskId}/`) : ref === `${taskId}/${stepId}`;
  const removedAfter = (ref) => {
    const target = parseStepRef(ref, epic.id);
    return Boolean(target?.local && target.task === String(taskId) && (wholeTask || target.step === String(stepId)));
  };
  const survivingTasks = wholeTask ? epic.tasks.filter((item) => item.id !== taskId) : epic.tasks;
  const survivingBranches = new Set(survivingTasks.flatMap((item) => (item.branches || []).map((branch) => `${branch.repo}:${branch.name}`)));
  const removedBranches = new Set(wholeTask ? (task.branches || []).map((branch) => `${branch.repo}:${branch.name}`).filter((key) => !survivingBranches.has(key)) : []);
  const removedRef = (ref) => {
    if (wholeTask && ref === `task:${taskId}`) return true;
    if (ref.startsWith('branch:')) return removedBranches.has(ref.slice(7));
    if (!ref.startsWith('step:')) return false;
    // Match the stored reference parser, including legacy refs with extra slash segments.
    const [refTask, refStep] = ref.slice(5).split('/');
    return removedStep(`${refTask}/${refStep}`);
  };
  const references = [];
  const reference = (path, value) => references.push(`${path} -> ${value}`);
  const taskPatches = new Map();
  taskPatches.set(taskId, wholeTask ? { id: taskId, $delete: true } : { id: taskId, steps: [{ id: stepId, $delete: true }] });
  for (const currentTask of survivingTasks) {
    for (const step of currentTask.steps || []) {
      if (currentTask.id === taskId && step.id === stepId) continue;
      const after = (step.after || []).filter((ref) => !removedAfter(ref));
      if (after.length === (step.after || []).length) continue;
      for (const ref of step.after.filter(removedAfter)) reference(`tasks[${currentTask.id}].steps[${step.id}].after`, ref);
      if (!taskPatches.has(currentTask.id)) taskPatches.set(currentTask.id, { id: currentTask.id, steps: [] });
      taskPatches.get(currentTask.id).steps.push({ id: step.id, after });
    }
  }
  const docs = [];
  for (const doc of epic.docs || []) {
    if (doc.task !== taskId || (!wholeTask && doc.step !== stepId)) continue;
    const fields = wholeTask ? { task: null, step: null } : { step: null };
    if (wholeTask) reference(`docs[${doc.id}].task`, taskId);
    if (doc.step !== undefined) reference(`docs[${doc.id}].step`, `${taskId}/${doc.step}`);
    docs.push({ id: doc.id, ...fields });
  }
  const waiting = [];
  for (const item of epic.waiting || []) {
    const fields = {};
    if (wholeTask && item.task === taskId) {
      reference(`waiting[${item.id}].task`, taskId);
      fields.task = null;
    }
    const refs = (item.refs || []).filter((ref) => !removedRef(ref));
    if (refs.length !== (item.refs || []).length) {
      for (const ref of item.refs.filter(removedRef)) reference(`waiting[${item.id}].refs`, ref);
      fields.refs = refs;
    }
    if (Object.keys(fields).length) waiting.push({ id: item.id, ...fields });
  }
  const sessions = [];
  if (wholeTask) {
    for (const session of epic.sessions || []) {
      if (session.task !== taskId) continue;
      reference(`sessions[${session.id}].task`, taskId);
      sessions.push({ id: session.id, task: null });
    }
    for (const decision of epic.decisions || []) {
      if (decision.task === taskId) reference(`decisions[${decision.id}].task (append-only history)`, taskId);
    }
  }
  let mergeOrder;
  if ((epic.mergeOrder || []).some((item) => removedBranches.has(item.branch))) {
    mergeOrder = epic.mergeOrder.map((item) => {
      if (!removedBranches.has(item.branch)) return item;
      reference(`mergeOrder[${item.id}].branch`, `branch:${item.branch}`);
      const { branch, ...rest } = item;
      return rest;
    });
  }
  return { patch: { tasks: [...taskPatches.values()], ...(docs.length ? { docs } : {}), ...(sessions.length ? { sessions } : {}), ...(mergeOrder ? { mergeOrder } : {}) }, waiting, references };
}
