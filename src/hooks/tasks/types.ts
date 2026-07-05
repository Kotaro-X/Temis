import type { Dispatch, SetStateAction } from "react";

import type { Suggestion } from "../../features/routineSuggestions";
import type {
  LogEntry,
  LogResult,
  SlotKey,
  Tag,
  TaskState,
  TimeBoxSchedule,
  TodayState,
} from "../../types";

export type UseTasksArgs = {
  selectedDate?: string;
  storageReady?: boolean;
  tagLibrary?: Tag[];
  timeBoxSchedule?: TimeBoxSchedule;
  activeTaskId?: string | null;
  setActiveTaskId?: (taskId: string | null) => void;
  now?: number;
};

export type FlatTaskItem = {
  slotKey: SlotKey;
  task: TaskState;
};

export type ArchivedTaskItem = {
  slotKey: SlotKey;
  task: TaskState;
};

export type TaskSectionItem = {
  slotKey: SlotKey;
  visibleTasks: TaskState[];
  activeTasks: TaskState[];
  completedTasks: TaskState[];
  incompleteEstimate: number;
  totalEstimate: number;
  capacityMinutes: number;
  overflow: number;
  remainingMinutes: number;
};

export type TaskDetailInfo = {
  slotKey: SlotKey;
  task: TaskState;
};

export type UseTasksResult = {
  todayState: TodayState | null;
  logs: LogEntry[];
  routineSuggestions: Suggestion[];
  currentSlot: SlotKey;
  activeTaskId: string | null;
  flatTasks: FlatTaskItem[];
  archivedTasks: ArchivedTaskItem[];
  todaySections: TaskSectionItem[];
  completedTimeByTaskId: Map<string, string>;
  inProgressInfo: FlatTaskItem | null;
  selectionMode: boolean;
  selectedTaskIds: string[];
  selectedSet: Set<string>;
  setTodayState: Dispatch<SetStateAction<TodayState | null>>;
  setLogs: Dispatch<SetStateAction<LogEntry[]>>;
  setActiveTaskId: (taskId: string | null) => void;
  loadForDate: (date: string, fallbackTag?: Tag) => Promise<TodayState>;
  loadLogs: () => Promise<LogEntry[]>;
  refresh: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  persistTodayState: (next: TodayState) => Promise<void>;
  persistLogs: (next: LogEntry[]) => Promise<void>;
  updateTask: (
    slotKey: SlotKey,
    taskId: string,
    updater: (task: TaskState) => TaskState,
  ) => void;
  toggleTaskTag: (slotKey: SlotKey, taskId: string, tag: Tag) => void;
  addTask: (slotKey: SlotKey) => TaskState | null;
  addSuggestion: (suggestion: Suggestion) => void;
  dismissSuggestion: (suggestion: Suggestion) => Promise<void>;
  deleteTask: (taskId: string) => void;
  deleteSelectedTasks: () => void;
  archiveTask: (slotKey: SlotKey, taskId: string) => void;
  restoreTask: (
    taskId: string,
    targetDate: string,
    slotKey: SlotKey,
  ) => Promise<void>;
  moveTask: (
    taskId: string,
    fromSlotKey: SlotKey,
    targetDate: string,
    targetSlotKey: SlotKey,
  ) => Promise<void>;
  startTask: (slotKey: SlotKey, taskId: string) => void;
  pauseTask: (slotKey: SlotKey, taskId: string) => void;
  stopTask: (slotKey: SlotKey, taskId: string, result: LogResult) => void;
  getTaskInfo: (
    taskId: string,
    preferredSlotKey?: SlotKey | null,
  ) => TaskDetailInfo | null;
  focusTask: (taskId: string | null) => void;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  toggleSelection: (taskId: string) => void;
  moveModalOpen: boolean;
  moveTaskId: string | null;
  moveFromSlotKey: SlotKey | null;
  moveDateDraft: string;
  moveDateError: "invalid_date" | null;
  moveTargetSlotKey: SlotKey;
  setMoveDateDraft: (value: string) => void;
  setMoveTargetSlotKey: Dispatch<SetStateAction<SlotKey>>;
  openMoveModal: (slotKey: SlotKey, taskId: string) => void;
  closeMoveModal: () => void;
  shiftMoveDateDraft: (delta: number) => void;
  applyMoveTask: () => Promise<"idle" | "invalid_date" | "closed" | "moved">;
  restoreModalOpen: boolean;
  restoreTaskId: string | null;
  restoreDateDraft: string;
  restoreDateError: "invalid_date" | null;
  restoreTargetSlotKey: SlotKey;
  setRestoreDateDraft: (value: string) => void;
  setRestoreTargetSlotKey: Dispatch<SetStateAction<SlotKey>>;
  openRestoreModal: (
    task: TaskState,
    sourceSlotKey: SlotKey,
  ) => "opened" | "not_allowed";
  closeRestoreModal: () => void;
  shiftRestoreDateDraft: (delta: number) => void;
  applyRestoreTask: () => Promise<
    "idle" | "invalid_date" | "failed" | "restored"
  >;
};
