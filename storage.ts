import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_TAGS,
  DEFAULT_TIMEBOX_SCHEDULE,
  LogEntry,
  SlotKey,
  SlotState,
  Tag,
  TaskState,
  TaskStatus,
  TimeBoxSchedule,
  TodayState,
  SLOT_KEYS,
} from "./types";

const TODAY_STATE_KEY_PREFIX = "todayState:";
const LEGACY_TODAY_STATE_KEY = "todayState";
const LOGS_KEY = "logs";
const TAG_LIBRARY_KEY = "tagLibrary";
const TIMEBOX_SCHEDULE_KEY = "timeBoxSchedule";

const createTaskId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getTodayStateKey = (date: string) => `${TODAY_STATE_KEY_PREFIX}${date}`;

const normalizeStatus = (status: unknown): TaskStatus => {
  const allowed: TaskStatus[] = ["TODO", "IN_PROGRESS", "PAUSED", "DONE"];
  if (allowed.includes(status as TaskStatus)) {
    return status as TaskStatus;
  }
  switch (status) {
    case "idle":
    case "failed":
      return "TODO";
    case "running":
      return "IN_PROGRESS";
    case "paused":
      return "PAUSED";
    case "completed":
      return "DONE";
    default:
      return "TODO";
  }
};

const normalizeTags = (tags: unknown, fallbackTag?: Tag): Tag[] => {
  if (Array.isArray(tags)) {
    return tags.filter((tag) => typeof tag === "string");
  }
  if (typeof tags === "string") {
    return [tags];
  }
  return fallbackTag ? [fallbackTag] : [];
};

const normalizeIsArchived = (value: unknown) => value === true;

const normalizeTask = (task: Partial<TaskState>): TaskState => ({
  id: typeof task.id === "string" ? task.id : createTaskId(),
  taskName: typeof task.taskName === "string" ? task.taskName : "",
  tags: normalizeTags(task.tags ?? (task as { tag?: string }).tag),
  estimateMinutes:
    typeof task.estimateMinutes === "number" ? task.estimateMinutes : 25,
  elapsedMinutes:
    typeof task.elapsedMinutes === "number" ? task.elapsedMinutes : 0,
  status: normalizeStatus(task.status),
  isArchived: normalizeIsArchived(task.isArchived),
  startAt: typeof task.startAt === "number" ? task.startAt : null,
});

export const createEmptyTask = (defaultTag?: Tag): TaskState =>
  normalizeTask({
    taskName: "",
    tags: normalizeTags([], defaultTag),
    estimateMinutes: 25,
    elapsedMinutes: 0,
    status: "TODO",
    isArchived: false,
    startAt: null,
  });

const normalizeSlot = (slot: Partial<SlotState> | TaskState): SlotState => {
  if (slot && Array.isArray((slot as SlotState).tasks)) {
    const tasks = (slot as SlotState).tasks.map((task) => normalizeTask(task));
    return { tasks: tasks.length > 0 ? tasks : [createEmptyTask()] };
  }
  // 旧形式の1タスクを配列化する
  if (slot && typeof slot === "object" && "taskName" in slot) {
    return { tasks: [normalizeTask(slot as TaskState)] };
  }
  return { tasks: [createEmptyTask()] };
};

const normalizeTimeValue = (value: unknown) =>
  typeof value === "string" ? value : "";

const normalizeTimeBoxSchedule = (
  schedule: unknown,
): TimeBoxSchedule => {
  if (!schedule || typeof schedule !== "object") {
    return { ...DEFAULT_TIMEBOX_SCHEDULE };
  }
  const raw = schedule as Partial<TimeBoxSchedule>;
  const normalized = SLOT_KEYS.reduce(
    (acc, key) => {
      const entry = raw[key];
      acc[key] = {
        start: normalizeTimeValue(entry?.start) || DEFAULT_TIMEBOX_SCHEDULE[key].start,
        end: normalizeTimeValue(entry?.end) || DEFAULT_TIMEBOX_SCHEDULE[key].end,
      };
      return acc;
    },
    {} as TimeBoxSchedule,
  );
  return normalized;
};

const createEmptySlot = (defaultTag?: Tag): SlotState => ({
  tasks: [createEmptyTask(defaultTag)],
});

export const createEmptyTodayState = (
  date: string,
  defaultTag?: Tag,
): TodayState => {
  const slots = SLOT_KEYS.reduce(
    (acc, key) => {
      acc[key] = createEmptySlot(defaultTag);
      return acc;
    },
    {} as Record<SlotKey, SlotState>,
  );
  return { date, slots };
};

export const loadTodayState = async (
  todayDate: string,
  defaultTag?: Tag,
): Promise<TodayState> => {
  const key = getTodayStateKey(todayDate);
  let raw = await AsyncStorage.getItem(key);
  if (!raw) {
    const legacyRaw = await AsyncStorage.getItem(LEGACY_TODAY_STATE_KEY);
    if (legacyRaw) {
      try {
        const legacyParsed = JSON.parse(legacyRaw) as TodayState;
        if (legacyParsed?.date === todayDate) {
          await AsyncStorage.setItem(key, legacyRaw);
          raw = legacyRaw;
        }
      } catch {
        // ignore legacy parse errors
      }
    }
  }
  if (!raw) {
    return createEmptyTodayState(todayDate, defaultTag);
  }
  try {
    const parsed = JSON.parse(raw) as TodayState;
    if (!parsed || parsed.date !== todayDate) {
      return createEmptyTodayState(todayDate, defaultTag);
    }
    const slots = SLOT_KEYS.reduce(
      (acc, key) => {
        const rawSlot = (parsed.slots as Record<string, SlotState> | undefined)?.[
          key
        ];
        acc[key] = normalizeSlot(rawSlot ?? {});
        return acc;
      },
      {} as Record<SlotKey, SlotState>,
    );
    return { ...parsed, slots };
  } catch {
    return createEmptyTodayState(todayDate, defaultTag);
  }
};

export const loadAllTodayStates = async (): Promise<TodayState[]> => {
  const keys = await AsyncStorage.getAllKeys();
  const stateKeys = keys.filter((key) => key.startsWith(TODAY_STATE_KEY_PREFIX));
  if (stateKeys.length === 0) {
    return [];
  }
  const entries = await AsyncStorage.multiGet(stateKeys);
  const states: TodayState[] = [];
  for (const [key, raw] of entries) {
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as TodayState;
      const date = typeof parsed?.date === "string" ? parsed.date : "";
      const keyDate = key.slice(TODAY_STATE_KEY_PREFIX.length);
      if (!date || date !== keyDate) {
        continue;
      }
      const slots = SLOT_KEYS.reduce(
        (acc, slotKey) => {
          const rawSlot = (parsed.slots as Record<string, SlotState> | undefined)?.[
            slotKey
          ];
          acc[slotKey] = normalizeSlot(rawSlot ?? {});
          return acc;
        },
        {} as Record<SlotKey, SlotState>,
      );
      states.push({ ...parsed, slots });
    } catch {
      continue;
    }
  }
  return states;
};

export const saveTodayState = async (state: TodayState): Promise<void> => {
  await AsyncStorage.setItem(
    getTodayStateKey(state.date),
    JSON.stringify(state),
  );
};

export const loadLogs = async (): Promise<LogEntry[]> => {
  const raw = await AsyncStorage.getItem(LOGS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((log) => log && typeof log === "object")
      .map((log) => {
        const id = typeof log.id === "string" ? log.id : createTaskId();
        const tags = normalizeTags((log as { tags?: Tag[]; tag?: string }).tags);
        const normalized: LogEntry = {
          id,
          date: typeof log.date === "string" ? log.date : "",
          slot: log.slot as SlotKey,
          taskId: typeof log.taskId === "string" ? log.taskId : id,
          taskName: typeof log.taskName === "string" ? log.taskName : "",
          tags,
          estimateMinutes:
            typeof log.estimateMinutes === "number" ? log.estimateMinutes : 0,
          actualMinutes:
            typeof log.actualMinutes === "number" ? log.actualMinutes : 0,
          result: log.result === "completed" ? "completed" : "failed",
          endedAt: typeof log.endedAt === "number" ? log.endedAt : 0,
        };
        return normalized;
      });
  } catch {
    return [];
  }
};

export const saveLogs = async (logs: LogEntry[]): Promise<void> => {
  await AsyncStorage.setItem(LOGS_KEY, JSON.stringify(logs));
};

export const loadTagLibrary = async (): Promise<Tag[]> => {
  const raw = await AsyncStorage.getItem(TAG_LIBRARY_KEY);
  if (!raw) {
    return [...DEFAULT_TAGS];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_TAGS];
    }
    const tags = parsed.filter((tag) => typeof tag === "string");
    return tags.length > 0 ? tags : [];
  } catch {
    return [...DEFAULT_TAGS];
  }
};

export const saveTagLibrary = async (tags: Tag[]): Promise<void> => {
  await AsyncStorage.setItem(TAG_LIBRARY_KEY, JSON.stringify(tags));
};

export const loadTimeBoxSchedule = async (): Promise<TimeBoxSchedule> => {
  const raw = await AsyncStorage.getItem(TIMEBOX_SCHEDULE_KEY);
  if (!raw) {
    return { ...DEFAULT_TIMEBOX_SCHEDULE };
  }
  try {
    const parsed = JSON.parse(raw);
    return normalizeTimeBoxSchedule(parsed);
  } catch {
    return { ...DEFAULT_TIMEBOX_SCHEDULE };
  }
};

export const saveTimeBoxSchedule = async (
  schedule: TimeBoxSchedule,
): Promise<void> => {
  await AsyncStorage.setItem(TIMEBOX_SCHEDULE_KEY, JSON.stringify(schedule));
};
