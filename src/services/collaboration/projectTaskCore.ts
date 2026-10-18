import { normalizePlanning } from '../../features/taskPlanning/planningCore.ts';
import type { ProjectTask, ProjectTaskStatus } from "../../types/collaboration.ts";
import type { TaskState } from "../../types/task.ts";

export const projectTaskOwner = (task: ProjectTask, memberIds?: readonly string[]): string | null => {
  const owner = task.assigneeUserId !== undefined ? task.assigneeUserId : task.creatorUserId ?? task.ownerUserId;
  return owner && (!memberIds || memberIds.includes(owner)) ? owner : null;
};

export const projectTaskElapsed = (task: Pick<ProjectTask, "status" | "elapsedMinutes" | "startAt">, timestamp: number): number =>
  Math.max(0, task.elapsedMinutes ?? 0) +
  (task.status === "in_progress" && task.startAt != null ? Math.max(0, timestamp - task.startAt) / 60000 : 0);

/** Applied to the latest transactional record, never to a screen snapshot. */
export const transitionProjectTask = (task: ProjectTask, status: ProjectTaskStatus, timestamp: number): ProjectTask => {
  if (task.status === status) return task;
  const elapsedMinutes = projectTaskElapsed(task, timestamp);
  return { ...task, status, elapsedMinutes, startAt: status === "in_progress" ? timestamp : null,
    completedAt: status === "completed" ? timestamp : null };
};

export const projectTaskState = (task: ProjectTask): TaskState => ({
  ...normalizePlanning(task),
  id: `project:${task.id}`, taskName: task.title, tags: task.tags ?? [],
  estimateMinutes: task.estimateMinutes ?? 25, elapsedMinutes: task.elapsedMinutes ?? 0,
  status: ({ todo: "TODO", in_progress: "IN_PROGRESS", paused: "PAUSED", completed: "DONE" } as const)[task.status],
  isArchived: task.isArchived === true, startAt: task.startAt ?? null,
});

export const changedProjectTaskFields = <T extends object>(baseline: T, draft: T): Partial<T> =>
  Object.fromEntries(Object.entries(draft).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(baseline[key as keyof T]))) as Partial<T>;
