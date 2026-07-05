import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useCallback } from "react";

import type {
  LogEntry,
  LogResult,
  SlotKey,
  Tag,
  TaskState,
  TodayState,
} from "../../types";
import {
  pauseAllRunningTasks,
  pauseTaskState,
  round1,
} from "./taskUtils";
import type { UpdateSlot, UpdateTask, UpdateToday } from "./useTaskStateMutations";

type UseTaskExecutionActionsArgs = {
  todayState: TodayState | null;
  setLogs: Dispatch<SetStateAction<LogEntry[]>>;
  setActiveTaskId: (taskId: string | null) => void;
  allowNoActiveTaskRef: MutableRefObject<boolean>;
  persistLogs: (next: LogEntry[]) => Promise<void>;
  updateToday: UpdateToday;
  updateSlot: UpdateSlot;
  updateTask: UpdateTask;
};

export const useTaskExecutionActions = ({
  todayState,
  setLogs,
  setActiveTaskId,
  allowNoActiveTaskRef,
  persistLogs,
  updateToday,
  updateSlot,
  updateTask,
}: UseTaskExecutionActionsArgs) => {
  const startTask = useCallback(
    (slotKey: SlotKey, taskId: string) => {
      if (!todayState) {
        return;
      }
      const target = todayState.slots[slotKey].tasks.find((task) => task.id === taskId);
      if (!target || target.status === "DONE") {
        return;
      }
      const timestamp = Date.now();
      const pausedSlots = pauseAllRunningTasks(todayState.slots, timestamp, taskId);
      const slot = pausedSlots[slotKey];
      const tasks = slot.tasks.map((task) => {
        if (task.id !== taskId || task.status === "DONE") {
          return task;
        }
        return task.status !== "IN_PROGRESS"
          ? { ...task, status: "IN_PROGRESS", startAt: timestamp }
          : task;
      });
      updateToday({
        ...todayState,
        slots: { ...pausedSlots, [slotKey]: { ...slot, tasks } },
      });
    },
    [todayState, updateToday],
  );

  const pauseTask = useCallback(
    (slotKey: SlotKey, taskId: string) => {
      if (!todayState) {
        return;
      }
      const target = todayState.slots[slotKey].tasks.find((task) => task.id === taskId);
      if (!target || target.status !== "IN_PROGRESS") {
        return;
      }
      const timestamp = Date.now();
      updateTask(slotKey, taskId, (task) => pauseTaskState(task, timestamp));
    },
    [todayState, updateTask],
  );

  const stopTask = useCallback(
    (slotKey: SlotKey, taskId: string, result: LogResult) => {
      if (!todayState) {
        return;
      }
      const target = todayState.slots[slotKey].tasks.find((task) => task.id === taskId);
      if (!target || target.status === "DONE" || target.status === "TODO") {
        return;
      }
      const timestamp = Date.now();
      let elapsed = target.elapsedMinutes;
      if (target.status === "IN_PROGRESS" && target.startAt !== null) {
        elapsed = round1(elapsed + (timestamp - target.startAt) / 60000);
      }
      const updatedTask: TaskState = {
        ...target,
        elapsedMinutes: elapsed,
        status: result === "completed" ? "DONE" : "TODO",
        startAt: null,
      };
      updateSlot(slotKey, (current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? updatedTask : task,
        ),
      }));
      const newLog: LogEntry = {
        id: `${todayState.date}-${slotKey}-${taskId}`,
        date: todayState.date,
        slot: slotKey,
        taskId,
        taskName: target.taskName,
        tags: [...target.tags] as Tag[],
        estimateMinutes: target.estimateMinutes,
        actualMinutes: elapsed,
        result,
        endedAt: timestamp,
      };
      setLogs((prev) => {
        const next = [...prev.filter((log) => log.id !== newLog.id), newLog];
        void persistLogs(next);
        return next;
      });
    },
    [persistLogs, setLogs, todayState, updateSlot],
  );

  const focusTask = useCallback(
    (taskId: string | null) => {
      allowNoActiveTaskRef.current = false;
      setActiveTaskId(taskId);
    },
    [allowNoActiveTaskRef, setActiveTaskId],
  );

  return {
    startTask,
    pauseTask,
    stopTask,
    focusTask,
  };
};
