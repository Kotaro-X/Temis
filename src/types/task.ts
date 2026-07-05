import type { Tag } from "./tag";
import type { SlotKey } from "./timer";

export type TaskStatus = "TODO" | "IN_PROGRESS" | "PAUSED" | "DONE";

export type TaskState = {
  id: string;
  taskName: string;
  tags: Tag[];
  estimateMinutes: number;
  elapsedMinutes: number;
  status: TaskStatus;
  isArchived: boolean;
  startAt: number | null;
};

export type SlotState = {
  tasks: TaskState[];
};

export type TodayState = {
  date: string;
  slots: Record<SlotKey, SlotState>;
};

export type LogResult = "completed" | "failed";

export type LogEntry = {
  id: string;
  date: string;
  slot: SlotKey;
  taskId: string;
  taskName: string;
  tags: Tag[];
  estimateMinutes: number;
  actualMinutes: number;
  result: LogResult;
  endedAt: number;
};
