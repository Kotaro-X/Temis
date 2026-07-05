import type {
  SlotKey,
  SlotState,
  TaskState,
  TimeBoxSchedule,
  TodayState,
} from "../../types";
import { SLOT_KEYS } from "../../types";

const pad2 = (num: number) => String(num).padStart(2, "0");

export const round1 = (num: number) => Math.round(num * 10) / 10;

export const parseTimeString = (value: string) => {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) {
    return null;
  }
  if (hours === 24 && minutes !== 0) {
    return null;
  }
  return hours * 60 + minutes;
};

export const getSlotForTime = (
  schedule: TimeBoxSchedule,
  now: Date,
): SlotKey => {
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const key of SLOT_KEYS) {
    const start = parseTimeString(schedule[key].start);
    const end = parseTimeString(schedule[key].end);
    if (start === null || end === null) {
      continue;
    }
    if (minutes >= start && minutes < end) {
      return key;
    }
  }
  return SLOT_KEYS[0];
};

export const getCapacityMinutes = (
  schedule: TimeBoxSchedule,
  slotKey: SlotKey,
) => {
  const entry = schedule[slotKey];
  const start = parseTimeString(entry.start);
  const end = parseTimeString(entry.end);
  if (start === null || end === null) {
    return 0;
  }
  return Math.max(0, end - start);
};

export const pauseTaskState = (task: TaskState, now: number): TaskState => {
  if (task.status !== "IN_PROGRESS" || task.startAt === null) {
    return task;
  }
  const diffMinutes = (now - task.startAt) / 60000;
  return {
    ...task,
    elapsedMinutes: round1(task.elapsedMinutes + diffMinutes),
    status: "PAUSED",
    startAt: null,
  };
};

export const pauseAllRunningTasks = (
  slots: Record<SlotKey, SlotState>,
  now: number,
  exceptTaskId: string,
) => {
  const nextSlots: Record<SlotKey, SlotState> = { ...slots };
  for (const slotKey of SLOT_KEYS) {
    const slot = nextSlots[slotKey];
    let changed = false;
    const tasks = slot.tasks.map((task) => {
      if (task.status === "IN_PROGRESS" && task.id !== exceptTaskId) {
        changed = true;
        return pauseTaskState(task, now);
      }
      return task;
    });
    if (changed) {
      nextSlots[slotKey] = { ...slot, tasks };
    }
  }
  return nextSlots;
};

export const removeTasksFromState = (
  state: TodayState,
  idSet: Set<string>,
): TodayState => {
  const nextSlots = SLOT_KEYS.reduce(
    (acc, slotKey) => {
      const slot = state.slots[slotKey];
      const tasks = slot.tasks.filter((task) => !idSet.has(task.id));
      acc[slotKey] =
        tasks.length === slot.tasks.length ? slot : { ...slot, tasks };
      return acc;
    },
    {} as Record<SlotKey, SlotState>,
  );
  return { ...state, slots: nextSlots };
};

export const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};
