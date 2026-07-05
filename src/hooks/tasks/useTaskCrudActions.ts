import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useCallback } from "react";

import {
  buildSuggestionTaskState,
  dismissSuggestionForToday,
  type Suggestion,
} from "../../features/routineSuggestions";
import * as taskRepository from "../../repositories/taskRepository";
import type { LogEntry, SlotKey, Tag, TaskState, TodayState } from "../../types";
import { buildFlatTasks } from "./taskSelectors";
import { pauseTaskState, removeTasksFromState } from "./taskUtils";
import type { FlatTaskItem } from "./types";
import type { UpdateSlot, UpdateTask, UpdateToday } from "./useTaskStateMutations";

type UseTaskCrudActionsArgs = {
  todayState: TodayState | null;
  selectedDate: string;
  defaultTag?: Tag;
  flatTasks: FlatTaskItem[];
  activeTaskId: string | null;
  selectedTaskIds: string[];
  setRoutineSuggestions: Dispatch<SetStateAction<Suggestion[]>>;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  setSelectedTaskIds: Dispatch<SetStateAction<string[]>>;
  setActiveTaskId: (taskId: string | null) => void;
  allowNoActiveTaskRef: MutableRefObject<boolean>;
  loadForDate: (date: string, fallbackTag?: Tag) => Promise<TodayState>;
  updateToday: UpdateToday;
  updateSlot: UpdateSlot;
  updateTask: UpdateTask;
};

export const useTaskCrudActions = ({
  todayState,
  selectedDate,
  defaultTag,
  flatTasks,
  activeTaskId,
  selectedTaskIds,
  setRoutineSuggestions,
  setSelectionMode,
  setSelectedTaskIds,
  setActiveTaskId,
  allowNoActiveTaskRef,
  loadForDate,
  updateToday,
  updateSlot,
  updateTask,
}: UseTaskCrudActionsArgs) => {
  const toggleTaskTag = useCallback(
    (slotKey: SlotKey, taskId: string, tag: Tag) => {
      updateTask(slotKey, taskId, (task) => {
        const exists = task.tags.includes(tag);
        return {
          ...task,
          tags: exists
            ? task.tags.filter((item) => item !== tag)
            : [...task.tags, tag],
        };
      });
    },
    [updateTask],
  );

  const addTask = useCallback(
    (slotKey: SlotKey) => {
      if (!todayState) {
        return null;
      }
      const created = taskRepository.createTask(todayState, slotKey, defaultTag);
      allowNoActiveTaskRef.current = false;
      setActiveTaskId(created.task.id);
      updateToday(created.nextState);
      return created.task;
    },
    [allowNoActiveTaskRef, defaultTag, setActiveTaskId, todayState, updateToday],
  );

  const addSuggestion = useCallback(
    (suggestion: Suggestion) => {
      if (!todayState) {
        return;
      }
      const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newTask = buildSuggestionTaskState(suggestion, taskId);
      allowNoActiveTaskRef.current = false;
      setActiveTaskId(taskId);
      updateSlot(suggestion.slot, (slot) => ({
        ...slot,
        tasks: [...slot.tasks, newTask],
      }));
      setRoutineSuggestions((prev) =>
        prev.filter((item) => item.normalizedName !== suggestion.normalizedName),
      );
    },
    [
      allowNoActiveTaskRef,
      setActiveTaskId,
      setRoutineSuggestions,
      todayState,
      updateSlot,
    ],
  );

  const dismissSuggestion = useCallback(
    async (suggestion: Suggestion) => {
      await dismissSuggestionForToday(selectedDate, suggestion.normalizedName);
      setRoutineSuggestions((prev) =>
        prev.filter((item) => item.normalizedName !== suggestion.normalizedName),
      );
    },
    [selectedDate, setRoutineSuggestions],
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      if (!todayState) {
        return;
      }
      const taskInfo = taskRepository.findTaskById(todayState, taskId);
      if (taskInfo?.task.status === "DONE") {
        return;
      }
      const beforeFlat = flatTasks;
      const wasActive = taskId === activeTaskId;
      const nextState = removeTasksFromState(todayState, new Set([taskId]));
      updateToday(nextState);
      setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId));
      if (!wasActive) {
        return;
      }
      let nextActive: string | null = null;
      const index = beforeFlat.findIndex((item) => item.task.id === taskId);
      if (index >= 0) {
        const nextItem = beforeFlat[index + 1];
        const prevItem = beforeFlat[index - 1];
        nextActive = nextItem?.task.id ?? prevItem?.task.id ?? null;
      }
      if (!nextActive) {
        const remaining = buildFlatTasks(nextState);
        nextActive = remaining[0]?.task.id ?? null;
      }
      setActiveTaskId(nextActive);
    },
    [
      activeTaskId,
      flatTasks,
      setActiveTaskId,
      setSelectedTaskIds,
      todayState,
      updateToday,
    ],
  );

  const deleteSelectedTasks = useCallback(() => {
    if (!todayState || selectedTaskIds.length === 0) {
      return;
    }
    const deletableIds = selectedTaskIds.filter((taskId) => {
      const info = taskRepository.findTaskById(todayState, taskId);
      return info?.task.status !== "DONE";
    });
    if (deletableIds.length === 0) {
      return;
    }
    const nextState = removeTasksFromState(todayState, new Set(deletableIds));
    updateToday(nextState);
    const remaining = buildFlatTasks(nextState);
    setActiveTaskId(remaining[0]?.task.id ?? null);
    setSelectionMode(false);
    setSelectedTaskIds([]);
  }, [
    selectedTaskIds,
    setActiveTaskId,
    setSelectedTaskIds,
    setSelectionMode,
    todayState,
    updateToday,
  ]);

  const archiveTask = useCallback(
    (slotKey: SlotKey, taskId: string) => {
      if (!todayState) {
        return;
      }
      const timestamp = Date.now();
      updateTask(slotKey, taskId, (task) => {
        if (task.isArchived) {
          return task;
        }
        const nextTask: TaskState =
          task.status === "IN_PROGRESS"
            ? task.startAt !== null
              ? pauseTaskState(task, timestamp)
              : { ...task, status: "PAUSED", startAt: null }
            : task;
        return { ...nextTask, isArchived: true, startAt: null };
      });
    },
    [todayState, updateTask],
  );

  const restoreTask = useCallback(
    async (taskId: string, targetDate: string, slotKey: SlotKey) => {
      await taskRepository.restoreTask(taskId, targetDate, slotKey);
      await loadForDate(selectedDate, defaultTag);
    },
    [defaultTag, loadForDate, selectedDate],
  );

  const moveTask = useCallback(
    async (
      taskId: string,
      fromSlotKey: SlotKey,
      targetDate: string,
      targetSlotKey: SlotKey,
    ) => {
      if (!todayState) {
        return;
      }
      const moved = await taskRepository.moveTask({
        currentState: todayState,
        taskId,
        fromSlotKey,
        targetDate,
        targetSlotKey,
        defaultTag,
      });
      updateToday(moved.sourceState);
      if (moved.targetState) {
        await taskRepository.saveTasks(moved.targetState);
      }
    },
    [defaultTag, todayState, updateToday],
  );

  return {
    toggleTaskTag,
    addTask,
    addSuggestion,
    dismissSuggestion,
    deleteTask,
    deleteSelectedTasks,
    archiveTask,
    restoreTask,
    moveTask,
  };
};
