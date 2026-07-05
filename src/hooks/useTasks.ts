import { useCallback, useRef, useState } from "react";

import type { Suggestion } from "../features/routineSuggestions";
import * as taskRepository from "../repositories/taskRepository";
import type { LogEntry, Tag, TodayState } from "../types";
import { DEFAULT_TIMEBOX_SCHEDULE } from "../types";
import { useTaskActions } from "./tasks/useTaskActions";
import { useTaskDerivedState } from "./tasks/useTaskDerivedState";
import { useTaskEffects } from "./tasks/useTaskEffects";
import { useTaskModalState } from "./tasks/useTaskModalState";
import type { UseTasksArgs, UseTasksResult } from "./tasks/types";
import { useTimer } from "./useTimer";

export type {
  ArchivedTaskItem,
  FlatTaskItem,
  TaskDetailInfo,
  TaskSectionItem,
  UseTasksArgs,
  UseTasksResult,
} from "./tasks/types";

const toDateString = (date: Date) => date.toISOString().slice(0, 10);

export const useTasks = (args: UseTasksArgs = {}): UseTasksResult => {
  const {
    selectedDate = toDateString(new Date()),
    storageReady = true,
    tagLibrary = [],
    timeBoxSchedule = DEFAULT_TIMEBOX_SCHEDULE,
    activeTaskId: externalActiveTaskId,
    setActiveTaskId: externalSetActiveTaskId,
    now: externalNow,
  } = args;
  const [todayState, setTodayState] = useState<TodayState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [routineSuggestions, setRoutineSuggestions] = useState<Suggestion[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const internalTimer = useTimer();
  const activeTaskId = externalActiveTaskId ?? internalTimer.activeTaskId;
  const setActiveTaskId =
    externalSetActiveTaskId ?? internalTimer.setActiveTaskId;
  const now = externalNow ?? internalTimer.now;
  const allowNoActiveTaskRef = useRef(false);
  const defaultTag = tagLibrary[0];

  const loadForDate = useCallback(async (date: string, fallbackTag?: Tag) => {
    const next = await taskRepository.loadTasks(date, fallbackTag);
    setTodayState(next);
    return next;
  }, []);

  const loadLogs = useCallback(async () => {
    const next = await taskRepository.loadTaskLogs();
    setLogs(next);
    return next;
  }, []);

  const persistTodayState = useCallback(async (next: TodayState) => {
    setTodayState(next);
    await taskRepository.saveTasks(next);
  }, []);

  const persistLogs = useCallback(async (next: LogEntry[]) => {
    setLogs(next);
    await taskRepository.saveTaskLogs(next);
  }, []);

  const derived = useTaskDerivedState({
    todayState,
    logs,
    timeBoxSchedule,
    selectedTaskIds,
    now,
  });

  useTaskEffects({
    storageReady,
    selectedDate,
    defaultTag,
    currentSlot: derived.currentSlot,
    todayState,
    flatTasks: derived.flatTasks,
    selectionMode,
    activeTaskId,
    setActiveTaskId,
    setRoutineSuggestions,
    setSelectedTaskIds,
    loadLogs,
    loadForDate,
    allowNoActiveTaskRef,
  });

  const refresh = useCallback(async () => {
    const [loadedLogs, loadedToday] = await Promise.all([
      loadLogs(),
      loadForDate(selectedDate, defaultTag),
    ]);
    setLogs(loadedLogs);
    setTodayState(loadedToday);
  }, [defaultTag, loadForDate, loadLogs, selectedDate]);

  const actions = useTaskActions({
    todayState,
    selectedDate,
    defaultTag,
    flatTasks: derived.flatTasks,
    activeTaskId,
    selectedTaskIds,
    setLogs,
    setRoutineSuggestions,
    setSelectionMode,
    setSelectedTaskIds,
    setActiveTaskId,
    allowNoActiveTaskRef,
    persistTodayState,
    persistLogs,
    loadForDate,
  });

  const modalState = useTaskModalState({
    selectedDate,
    moveTask: actions.moveTask,
    restoreTask: actions.restoreTask,
  });

  return {
    todayState,
    logs,
    routineSuggestions,
    currentSlot: derived.currentSlot,
    activeTaskId,
    flatTasks: derived.flatTasks,
    archivedTasks: derived.archivedTasks,
    todaySections: derived.todaySections,
    completedTimeByTaskId: derived.completedTimeByTaskId,
    inProgressInfo: derived.inProgressInfo,
    selectionMode,
    selectedTaskIds,
    selectedSet: derived.selectedSet,
    setTodayState,
    setLogs,
    setActiveTaskId,
    loadForDate,
    loadLogs,
    refresh,
    refreshTasks: refresh,
    persistTodayState,
    persistLogs,
    getTaskInfo: derived.getTaskInfo,
    ...actions,
    ...modalState,
  };
};
