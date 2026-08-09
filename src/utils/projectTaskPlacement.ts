import type { ProjectTask } from "../types/collaboration";
import type { SlotKey, TimeBoxSchedule } from "../types";
import { getSlotForTime } from "../hooks/tasks/taskUtils.ts";

export const toLocalDateString = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** Keeps existing project tasks visible before they have an explicit Private placement. */
export const getProjectTaskPrivateDate = (task: ProjectTask) =>
  task.privateDate ?? toLocalDateString(task.dueAt ?? task.createdAt);

export const getProjectTaskPrivateSlot = (
  task: ProjectTask,
  timeBoxSchedule: TimeBoxSchedule,
): SlotKey => task.privateSlotKey ?? getSlotForTime(timeBoxSchedule, new Date(task.createdAt));
