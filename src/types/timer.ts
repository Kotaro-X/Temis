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
