import { useCallback, useMemo } from "react";

import * as taskRepository from "../../repositories/taskRepository";
import type { LogEntry, SlotKey, TimeBoxSchedule, TodayState } from "../../types";
import { buildArchivedTasks, buildCompletedTimeByTaskId, buildFlatTasks, buildTodaySections } from "./taskSelectors";
import { getSlotForTime } from "./taskUtils";
import type { FlatTaskItem, TaskDetailInfo, TaskSectionItem } from "./types";

type UseTaskDerivedStateArgs = {
  todayState: TodayState | null;
  logs: LogEntry[];
  timeBoxSchedule: TimeBoxSchedule;
  selectedTaskIds: string[];
  now: number;
};

type UseTaskDerivedStateResult = {
  currentSlot: SlotKey;
  flatTasks: FlatTaskItem[];
  archivedTasks: ReturnType<typeof buildArchivedTasks>;
  todaySections: TaskSectionItem[];
  selectedSet: Set<string>;
  completedTimeByTaskId: Map<string, string>;
  inProgressInfo: FlatTaskItem | null;
  getTaskInfo: (
    taskId: string,
    preferredSlotKey?: SlotKey | null,
  ) => TaskDetailInfo | null;
};

export const useTaskDerivedState = ({
  todayState,
  logs,
  timeBoxSchedule,
  selectedTaskIds,
  now,
}: UseTaskDerivedStateArgs): UseTaskDerivedStateResult => {
  const currentSlot = useMemo(
    () => getSlotForTime(timeBoxSchedule, new Date(now)),
    [now, timeBoxSchedule],
  );

  const flatTasks = useMemo(
    () => (todayState ? buildFlatTasks(todayState) : []),
    [todayState],
  );

  const archivedTasks = useMemo(
    () => (todayState ? buildArchivedTasks(todayState) : []),
    [todayState],
  );

  const todaySections = useMemo(
    () => (todayState ? buildTodaySections(todayState, timeBoxSchedule) : []),
    [timeBoxSchedule, todayState],
  );

  const selectedSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);

  const completedTimeByTaskId = useMemo(
    () => buildCompletedTimeByTaskId(logs),
    [logs],
  );

  const inProgressInfo = useMemo(
    () => flatTasks.find((item) => item.task.status === "IN_PROGRESS") ?? null,
    [flatTasks],
  );

  const getTaskInfo = useCallback(
    (taskId: string, preferredSlotKey?: SlotKey | null): TaskDetailInfo | null => {
      if (!todayState) {
        return null;
      }
      if (preferredSlotKey) {
        const task = todayState.slots[preferredSlotKey].tasks.find(
          (item) => item.id === taskId,
        );
        if (task) {
          return { task, slotKey: preferredSlotKey };
        }
      }
      return taskRepository.findTaskById(todayState, taskId);
    },
    [todayState],
  );

  return {
    currentSlot,
    flatTasks,
    archivedTasks,
    todaySections,
    selectedSet,
    completedTimeByTaskId,
    inProgressInfo,
    getTaskInfo,
  };
};
