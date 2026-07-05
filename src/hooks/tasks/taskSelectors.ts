import type {
  LogEntry,
  SlotKey,
  TaskState,
  TimeBoxSchedule,
  TodayState,
} from "../../types";
import { SLOT_KEYS } from "../../types";
import { formatTime, getCapacityMinutes } from "./taskUtils";
import type { ArchivedTaskItem, FlatTaskItem, TaskSectionItem } from "./types";

export type TimeBoxTaskPreviewItem = {
  id: string;
  title: string;
};

const sumEstimateMinutesAll = (tasks: TaskState[]) =>
  Math.round(
    tasks.reduce((acc, task) => {
      const value = Number(task.estimateMinutes);
      return acc + (Number.isFinite(value) ? value : 0);
    }, 0),
  );

const sumEstimateMinutesIncomplete = (tasks: TaskState[]) =>
  Math.round(
    tasks.reduce((acc, task) => {
      if (task.status === "DONE") {
        return acc;
      }
      const value = Number(task.estimateMinutes);
      return acc + (Number.isFinite(value) ? value : 0);
    }, 0),
  );

export const buildFlatTasks = (state: TodayState): FlatTaskItem[] => {
  const items: FlatTaskItem[] = [];
  for (const slotKey of SLOT_KEYS) {
    for (const task of state.slots[slotKey].tasks) {
      if (!task.isArchived && task.status !== "DONE") {
        items.push({ slotKey, task });
      }
    }
  }
  return items;
};

export const buildArchivedTasks = (state: TodayState): ArchivedTaskItem[] => {
  const items: ArchivedTaskItem[] = [];
  for (const slotKey of SLOT_KEYS) {
    for (const task of state.slots[slotKey].tasks) {
      if (task.isArchived) {
        items.push({ slotKey, task });
      }
    }
  }
  return items;
};

export const buildTodaySections = (
  state: TodayState,
  timeBoxSchedule: TimeBoxSchedule,
): TaskSectionItem[] =>
  SLOT_KEYS.map((slotKey) => {
    const slot = state.slots[slotKey];
    const visibleTasks = slot.tasks.filter((task) => !task.isArchived);
    const activeTasks = visibleTasks.filter((task) => task.status !== "DONE");
    const completedTasks = visibleTasks.filter((task) => task.status === "DONE");
    const incompleteEstimate = sumEstimateMinutesIncomplete(visibleTasks);
    const totalEstimate = sumEstimateMinutesAll(visibleTasks);
    const capacityMinutes = getCapacityMinutes(timeBoxSchedule, slotKey);
    const overflow = Math.max(0, incompleteEstimate - capacityMinutes);
    const remainingMinutes = Math.max(0, capacityMinutes - incompleteEstimate);
    return {
      slotKey,
      visibleTasks,
      activeTasks,
      completedTasks,
      incompleteEstimate,
      totalEstimate,
      capacityMinutes,
      overflow,
      remainingMinutes,
    };
  });

export const buildCompletedTimeByTaskId = (logs: LogEntry[]) => {
  const map = new Map<string, string>();
  for (const log of logs) {
    if (log.result !== "completed") {
      continue;
    }
    if (!map.has(log.taskId)) {
      map.set(log.taskId, formatTime(log.endedAt));
    }
  }
  return map;
};

export const buildTimeBoxTaskPreviews = (
  state: TodayState | null,
  untitledLabel: string,
): Record<SlotKey, TimeBoxTaskPreviewItem[]> =>
  SLOT_KEYS.reduce(
    (acc, slotKey) => {
      acc[slotKey] = state
        ? state.slots[slotKey].tasks
            .filter((task) => !task.isArchived)
            .map((task) => ({
              id: task.id,
              title: task.taskName || untitledLabel,
            }))
        : [];
      return acc;
    },
    {} as Record<SlotKey, TimeBoxTaskPreviewItem[]>,
  );

export const buildMemoTaskIndexEntries = (
  state: TodayState | null,
  logs: LogEntry[],
  untitledLabel: string,
): Array<{ taskId: string; taskTitle: string }> => {
  const entries: Array<{ taskId: string; taskTitle: string }> = [];
  if (logs.length > 0) {
    const seen = new Set<string>();
    const sortedLogs = [...logs].sort((a, b) => b.endedAt - a.endedAt);
    for (const log of sortedLogs) {
      const title = log.taskName.trim();
      if (!log.taskId || !title || seen.has(log.taskId)) {
        continue;
      }
      entries.push({ taskId: log.taskId, taskTitle: title });
      seen.add(log.taskId);
    }
  }
  if (!state) {
    return entries;
  }
  for (const slotKey of SLOT_KEYS) {
    for (const task of state.slots[slotKey].tasks) {
      entries.push({
        taskId: task.id,
        taskTitle: task.taskName || untitledLabel,
      });
    }
  }
  return entries;
};
