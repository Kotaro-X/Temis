export const SLOT_KEYS = ["morning", "forenoon", "afternoon", "night"] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export const SLOT_LABELS: Record<SlotKey, string> = {
  morning: "朝",
  forenoon: "午前",
  afternoon: "午後",
  night: "夜",
};

export type TimeBoxSchedule = Record<
  SlotKey,
  {
    start: string;
    end: string;
  }
>;

export const DEFAULT_TIMEBOX_SCHEDULE: TimeBoxSchedule = {
  morning: { start: "04:00", end: "08:00" },
  forenoon: { start: "08:00", end: "12:00" },
  afternoon: { start: "12:00", end: "18:00" },
  night: { start: "18:00", end: "24:00" },
};

export const DEFAULT_TAGS = [
  "分析/生活",
  "事務",
  "学習",
  "開発",
  "連絡",
  "移動",
  "その他",
] as const;

export type Tag = string;

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
