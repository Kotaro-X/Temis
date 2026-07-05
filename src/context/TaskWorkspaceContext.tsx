import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useWindowDimensions } from "react-native";

import { useAppRefresh } from "./AppRefreshContext";
import {
  buildMemoTaskIndexEntries,
  buildTimeBoxTaskPreviews,
  type TimeBoxTaskPreviewItem,
} from "../hooks/tasks/taskSelectors";
import { useTaskLogState, type UseTaskLogStateResult } from "../hooks/tasks/useTaskLogState";
import { useTaskScreenState } from "../hooks/tasks/useTaskScreenState";
import { useTasks, type UseTasksResult } from "../hooks/useTasks";
import { useTimer } from "../hooks/useTimer";
import type { AppLanguage } from "../i18n";
import { updateTaskIndex as setMemoTaskIndex } from "../repositories/memoRepository";
import type { TaskWorkspaceScreenKey } from "../types/appNavigation";
import type { SlotKey, Tag, TimeBoxSchedule, TodayState } from "../types";
import { SLOT_KEYS } from "../types";

let ScreenOrientationModule: typeof import("expo-screen-orientation") | null = null;
try {
  ScreenOrientationModule = require("expo-screen-orientation");
} catch (_error) {
  ScreenOrientationModule = null;
}

type TaskWorkspaceContextValue = UseTasksResult & {
  detailTaskInfo: ReturnType<typeof useTaskScreenState>["detailTaskInfo"];
  openTaskDetail: ReturnType<typeof useTaskScreenState>["openTaskDetail"];
  closeTaskDetail: ReturnType<typeof useTaskScreenState>["closeTaskDetail"];
  logState: UseTaskLogStateResult;
  timeBoxTaskPreviews: Record<SlotKey, TimeBoxTaskPreviewItem[]>;
  renameTag: (current: Tag, next: Tag) => void;
  archiveTag: (tag: Tag) => void;
};

type ProviderProps = {
  selectedDate: string;
  storageReady: boolean;
  tagLibrary: Tag[];
  timeBoxSchedule: TimeBoxSchedule;
  currentScreen: TaskWorkspaceScreenKey | null;
  language: AppLanguage;
  noTagLabel: string;
  untitledLabel: string;
  tr: (key: string) => string;
  children: React.ReactNode;
};

const TaskWorkspaceContext = createContext<TaskWorkspaceContextValue | null>(null);

const renameTagInTodayState = (
  state: TodayState,
  current: Tag,
  next: Tag,
): TodayState => ({
  ...state,
  slots: SLOT_KEYS.reduce(
    (acc, slotKey) => {
      const slot = state.slots[slotKey];
      acc[slotKey] = {
        ...slot,
        tasks: slot.tasks.map((task) =>
          task.tags.includes(current)
            ? {
                ...task,
                tags: task.tags.map((tag) => (tag === current ? next : tag)),
              }
            : task,
        ),
      };
      return acc;
    },
    {} as TodayState["slots"],
  ),
});

const renameTagInLogs = (logs: UseTasksResult["logs"], current: Tag, next: Tag) =>
  logs.map((log) =>
    log.tags.includes(current)
      ? {
          ...log,
          tags: log.tags.map((tag) => (tag === current ? next : tag)),
        }
      : log,
  );

export const TaskWorkspaceProvider = ({
  selectedDate,
  storageReady,
  tagLibrary,
  timeBoxSchedule,
  currentScreen,
  language,
  noTagLabel,
  untitledLabel,
  tr,
  children,
}: ProviderProps) => {
  const { registerRefreshHandler } = useAppRefresh();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const { activeTaskId, setActiveTaskId, now } = useTimer();
  const taskState = useTasks({
    selectedDate,
    storageReady,
    tagLibrary,
    timeBoxSchedule,
    activeTaskId,
    setActiveTaskId,
    now,
  });
  const { detailTaskInfo, openTaskDetail, closeTaskDetail } =
    useTaskScreenState({ getTaskInfo: taskState.getTaskInfo });
  const logState = useTaskLogState({
    logs: taskState.logs,
    tagLibrary,
    appLanguage: language,
    noTagLabel,
    untitledLabel,
    tr,
    isLandscape,
    height,
    active: currentScreen === "logs",
  });

  const timeBoxTaskPreviews = useMemo(
    () => buildTimeBoxTaskPreviews(taskState.todayState, untitledLabel),
    [taskState.todayState, untitledLabel],
  );
  const memoTaskIndexEntries = useMemo(
    () =>
      buildMemoTaskIndexEntries(
        taskState.todayState,
        taskState.logs,
        untitledLabel,
      ),
    [taskState.logs, taskState.todayState, untitledLabel],
  );

  useEffect(() => {
    setMemoTaskIndex(memoTaskIndexEntries);
  }, [memoTaskIndexEntries]);

  useEffect(
    () => registerRefreshHandler("tasks", taskState.refreshTasks),
    [registerRefreshHandler, taskState.refreshTasks],
  );

  useEffect(() => {
    if (currentScreen === "today" || !taskState.selectionMode) {
      return;
    }
    taskState.exitSelectionMode();
  }, [currentScreen, taskState.exitSelectionMode, taskState.selectionMode]);

  useEffect(() => {
    const applyOrientation = async () => {
      if (!ScreenOrientationModule) {
        return;
      }
      try {
        if (currentScreen === "logs") {
          await ScreenOrientationModule.unlockAsync();
        } else {
          await ScreenOrientationModule.lockAsync(
            ScreenOrientationModule.OrientationLock.PORTRAIT_UP,
          );
        }
      } catch (_error) {
        // no-op
      }
    };
    applyOrientation();
  }, [currentScreen]);

  const value = useMemo<TaskWorkspaceContextValue>(
    () => ({
      ...taskState,
      detailTaskInfo,
      openTaskDetail,
      closeTaskDetail,
      logState,
      timeBoxTaskPreviews,
      renameTag: (current: Tag, next: Tag) => {
        if (taskState.todayState) {
          void taskState.persistTodayState(
            renameTagInTodayState(taskState.todayState, current, next),
          );
        }
        if (taskState.logs.length > 0) {
          void taskState.persistLogs(
            renameTagInLogs(taskState.logs, current, next),
          );
        }
        logState.syncTagRename(current, next);
      },
      archiveTag: (tag: Tag) => {
        logState.syncTagArchive(tag);
      },
    }),
    [closeTaskDetail, detailTaskInfo, logState, openTaskDetail, taskState, timeBoxTaskPreviews],
  );

  return (
    <TaskWorkspaceContext.Provider value={value}>
      {children}
    </TaskWorkspaceContext.Provider>
  );
};

export const useTaskWorkspace = () => {
  const context = useContext(TaskWorkspaceContext);
  if (!context) {
    throw new Error("useTaskWorkspace must be used within TaskWorkspaceProvider");
  }
  return context;
};

export type { TaskWorkspaceContextValue };
