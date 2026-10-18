import { mutatePlannedTask, writePlannedTask, loadTaskLogs, saveTaskLogs } from '../../repositories/taskRepository';
import { loadMemoByTaskId, deleteMemo } from '../../repositories/memoRepository';
import { deleteProjectTask, updateProjectTask } from '../../services/collaboration/collaborationService';
import { localDate, occurrencePatch, slotAt, scheduledPatch, validDate, type PlanningOccurrence } from './planningCore';
import type { TaskState } from '../../types/task';
export type PlanningAction = 'start' | 'pause' | 'done' | 'reopen' | 'archive' | 'delete';
export async function performPlanningAction(item: PlanningOccurrence, action: PlanningAction) {
  if (item.editable === false) throw new Error('編集権限がありません。');
  const now = Date.now();
  const override = { date: item.date, slot: item.slot, plannedStartAt: item.plannedStartAt ?? null, plannedEndAt: item.plannedEndAt ?? null, estimateMinutes: item.estimateMinutes };
  if (item.repeat && item.repeat !== 'none' && action !== 'archive') {
    let log: { elapsed: number; alreadyCompleted: boolean } | null = null;
    const patch = (current: { occurrenceOverrides?: TaskState['occurrenceOverrides'] }) => {
      const previous = current.occurrenceOverrides?.[item.occurrenceDate];
      const running = previous?.executionStatus === 'IN_PROGRESS' && previous.startAt != null;
      const elapsed = (previous?.elapsedMinutes ?? item.elapsedMinutes ?? 0) + (running ? Math.max(0, now - previous!.startAt!) / 60000 : 0);
      log = { elapsed, alreadyCompleted: previous?.completed ?? item.completed };
      return occurrencePatch({}, item.occurrenceDate, { ...override, completed: action === 'done' ? true : action === 'reopen' ? false : previous?.completed ?? item.completed,
        deleted: action === 'delete', executionStatus: action === 'start' ? 'IN_PROGRESS' : action === 'done' ? 'DONE' : action === 'reopen' ? 'TODO' : 'PAUSED', elapsedMinutes: elapsed, startAt: action === 'start' ? now : null });
    };
    if (item.projectId) await updateProjectTask(item.id.slice(8), current => patch(current));
    else await mutatePlannedTask(item.id, current => { const changes = patch(current.task); return { ...current, task: { ...current.task, occurrenceOverrides: { ...current.task.occurrenceOverrides, ...changes.occurrenceOverrides, [item.occurrenceDate]: { ...current.task.occurrenceOverrides?.[item.occurrenceDate], ...changes.occurrenceOverrides[item.occurrenceDate] } } } }; });
    if (!item.projectId && action === 'done' && log && !(log as { alreadyCompleted: boolean }).alreadyCompleted) {
      const logs = await loadTaskLogs(); await saveTaskLogs([...logs, { id: `${item.key}-${now}`, date: item.date, slot: item.slot, taskId: item.id, taskName: item.title, tags: item.occurrenceOverrides?.[item.occurrenceDate]?.tags ?? item.tags ?? [], estimateMinutes: item.estimateMinutes, actualMinutes: (log as { elapsed: number }).elapsed, result: 'completed', endedAt: now }]);
    }
    return;
  }

  if (item.projectId) {
    if (action === 'delete') await deleteProjectTask(item.id.slice(8));
    else await updateProjectTask(item.id.slice(8), action === 'archive' ? { isArchived: true } : { status: ({ start: 'in_progress', pause: 'paused', done: 'completed', reopen: 'todo' } as const)[action] });
    return;
  }
  let deleted: TaskState | null = null;
  let completed: { task: TaskState; date: string; slotKey: typeof item.slot } | null = null;
  await mutatePlannedTask(item.id, current => {
    const elapsedMinutes = current.task.elapsedMinutes + (current.task.status === 'IN_PROGRESS' && current.task.startAt != null ? Math.max(0, now - current.task.startAt) / 60000 : 0);
    const status = action === 'start' ? 'IN_PROGRESS' : action === 'done' ? 'DONE' : action === 'reopen' ? 'TODO' : 'PAUSED';
    const task = { ...current.task, status: action === 'archive' || action === 'delete' ? (current.task.status === 'IN_PROGRESS' ? 'PAUSED' : current.task.status) : status,
      isArchived: action === 'archive' ? true : current.task.isArchived, elapsedMinutes, startAt: action === 'start' ? now : null } as TaskState;
    if (action === 'delete') deleted = task;
    if (action === 'done' && current.task.status !== 'DONE') completed = { ...current, task };
    return { ...current, task };
  });
  if (deleted) {
    await writePlannedTask(deleted, item.date, item.slot, true);
    const memo = await loadMemoByTaskId(item.id); if (memo) await deleteMemo(memo.id);
  }
  if (completed) {
    const result = completed as { task: TaskState; date: string; slotKey: typeof item.slot };
    const logs = await loadTaskLogs();
    await saveTaskLogs([...logs, { id: `${item.id}-${now}`, date: result.date === 'undated' ? localDate(now) : result.date, slot: result.slotKey, taskId: item.id, taskName: result.task.taskName, tags: result.task.tags, estimateMinutes: result.task.estimateMinutes, actualMinutes: result.task.elapsedMinutes, result: 'completed', endedAt: now }]);
  }
}

export async function movePlanningOccurrence(item: PlanningOccurrence, date: string, slot: typeof item.slot, schedule: import('../../types/timer').TimeBoxSchedule) {
  if (item.editable === false) throw new Error('編集権限がありません。');
  if (!validDate(date)) throw new Error('実在する日付を入力してください。');
  const start = item.plannedStartAt == null ? null : new Date(`${date}T${new Date(item.plannedStartAt).toTimeString().slice(0,8)}`).getTime();
  const placement = { date, slot: start == null ? slot : slotAt(schedule, start), plannedStartAt: start,
    plannedEndAt: start == null || item.plannedEndAt == null ? null : start + item.plannedEndAt - item.plannedStartAt!, estimateMinutes: item.estimateMinutes };
  if (placement.plannedStartAt != null && placement.plannedEndAt != null) scheduledPatch(placement.plannedStartAt, placement.plannedEndAt);
  if (item.projectId) await updateProjectTask(item.id.slice(8), current => current.repeat && current.repeat !== 'none' ? occurrencePatch({}, item.occurrenceDate, placement)
    : { privateDate: start == null ? date : localDate(start), privateSlotKey: placement.slot, plannedStartAt: placement.plannedStartAt, plannedEndAt: placement.plannedEndAt });
  else await mutatePlannedTask(item.id, current => current.task.repeat && current.task.repeat !== 'none' ? { ...current, task: { ...current.task, ...occurrencePatch(current.task, item.occurrenceDate, placement) } }
    : { date, slotKey: placement.slot, task: { ...current.task, plannedStartAt: placement.plannedStartAt, plannedEndAt: placement.plannedEndAt } });
}
