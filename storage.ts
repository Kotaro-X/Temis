import AsyncStorage from "@react-native-async-storage/async-storage";
import { nanoid } from "nanoid/non-secure";
import {
  DEFAULT_TAGS,
  DEFAULT_TIMEBOX_SCHEDULE,
  LogEntry,
  SlotKey,
  SlotState,
  SimpleTodoItem,
  Tag,
  TagRecord,
  TaskState,
  TaskStatus,
  TimeBoxSchedule,
  TodayState,
  SLOT_KEYS,
  SyncEntityEnvelope,
  SyncEntityMetadata,
  SyncEntityType,
  SyncQueueItem,
} from "./types";
import { getBuiltinTagId } from "./src/tagLocalization";
import {
  logSkippedSyncEnvelope,
  validateSyncEnvelope,
} from "./src/services/sync/syncEnvelopeValidator";
import { mergeTodayStatesWithLegacy } from "./src/utils/todayStateMerge";

const TODAY_STATE_KEY_PREFIX = "todayState:";
const LEGACY_TODAY_STATE_KEY = "todayState";
const LOGS_KEY = "logs";
const TAG_LIBRARY_KEY = "tagLibrary";
const ARCHIVED_TAG_LIBRARY_KEY = "archivedTagLibrary";
const TAG_RECORDS_KEY = "tagRecords";
const TIMEBOX_SCHEDULE_KEY = "timeBoxSchedule";
const DOWNLOAD_COMPLETE_NOTICE_KEY = "downloadCompleteNoticeShown";
const APP_LANGUAGE_KEY = "appLanguage";
const CLOUD_SYNC_ENTITLED_KEY = "cloudSyncEntitled";
const CLOUD_SYNC_ENABLED_KEY = "cloudSyncEnabled";
const SIMPLE_TODOS_KEY = "simpleTodos";
const SYNC_QUEUE_KEY = "syncQueue";
const SYNC_RECORDS_KEY_PREFIX = "syncRecords:";
const SYNC_DEVICE_ID_KEY = "syncDeviceId";
const LAST_SYNCED_AT_KEY = "lastCloudSyncedAt";
const SYNC_METADATA_KEY_PREFIX = "syncMetadata:v2";

const createTaskId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getTodayStateKey = (date: string) => `${TODAY_STATE_KEY_PREFIX}${date}`;
const getSyncRecordsKey = (entityType: SyncEntityType) =>
  `${SYNC_RECORDS_KEY_PREFIX}${entityType}`;
const getSyncMetadataKey = (userId: string, entityType: SyncEntityType) =>
  `${SYNC_METADATA_KEY_PREFIX}:${encodeURIComponent(userId)}:${entityType}`;

const isSyncEntityType = (value: unknown): value is SyncEntityType =>
  value === "tag" || value === "todo" || value === "task" || value === "memo";

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

const normalizeSimpleTodo = (entry: Partial<SimpleTodoItem>): SimpleTodoItem => {
  const id = typeof entry.id === "string" ? entry.id : createTaskId();
  const repeat =
    entry.repeat === "none" ||
    entry.repeat === "daily" ||
    entry.repeat === "weekly" ||
    entry.repeat === "monthly" ||
    entry.repeat === "yearly"
      ? entry.repeat
      : "none";
  const reminderDate =
    typeof entry.reminderDate === "string" ? entry.reminderDate : null;
  const notificationId =
    typeof entry.notificationId === "string" ? entry.notificationId : null;

  return {
    id,
    text: typeof entry.text === "string" ? entry.text : "",
    memo: typeof entry.memo === "string" ? entry.memo : "",
    tags: normalizeTags(entry.tags),
    isDone: entry.isDone === true,
    createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
    doneAt: typeof entry.doneAt === "number" ? entry.doneAt : null,
    reminderDate,
    reminderTime:
      typeof entry.reminderTime === "string" ? entry.reminderTime : null,
    repeat,
    notificationId,
    notificationIds: Array.isArray(entry.notificationIds)
      ? entry.notificationIds.filter(
          (value): value is string => typeof value === "string",
        )
      : notificationId
        ? [notificationId]
        : [],
    seriesId:
      typeof entry.seriesId === "string"
        ? entry.seriesId
        : repeat !== "none"
          ? id
          : null,
    seriesAnchorDate:
      typeof entry.seriesAnchorDate === "string"
        ? entry.seriesAnchorDate
        : reminderDate && repeat !== "none"
          ? reminderDate
          : null,
    occurrenceDate:
      typeof entry.occurrenceDate === "string" ? entry.occurrenceDate : null,
    isDeleted: entry.isDeleted === true,
  };
};

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
    return { tasks };
  }
  // 旧形式の1タスクを配列化する
  if (slot && typeof slot === "object" && "taskName" in slot) {
    return { tasks: [normalizeTask(slot as TaskState)] };
  }
  return { tasks: [] };
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

const createEmptySlot = (_defaultTag?: Tag): SlotState => ({
  tasks: [],
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
  const hasLegacyStateKey = keys.includes(LEGACY_TODAY_STATE_KEY);
  if (stateKeys.length === 0 && !hasLegacyStateKey) {
    return [];
  }
  const entries = await AsyncStorage.multiGet(
    hasLegacyStateKey
      ? [...stateKeys, LEGACY_TODAY_STATE_KEY]
      : stateKeys,
  );
  const states: TodayState[] = [];
  let legacyState: TodayState | null = null;
  for (const [key, raw] of entries) {
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as TodayState;
      const date = typeof parsed?.date === "string" ? parsed.date : "";
      if (!date) {
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
      const normalizedState = { ...parsed, slots };
      if (key === LEGACY_TODAY_STATE_KEY) {
        legacyState = normalizedState;
        continue;
      }
      const keyDate = key.slice(TODAY_STATE_KEY_PREFIX.length);
      if (date !== keyDate) {
        continue;
      }
      states.push(normalizedState);
    } catch {
      continue;
    }
  }
  return mergeTodayStatesWithLegacy(states, legacyState);
};

export const loadDownloadCompleteNoticeShown = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(DOWNLOAD_COMPLETE_NOTICE_KEY);
  return raw === "true";
};

export const saveDownloadCompleteNoticeShown = async (): Promise<void> => {
  await AsyncStorage.setItem(DOWNLOAD_COMPLETE_NOTICE_KEY, "true");
};

export const loadAppLanguage = async (): Promise<"ja" | "en"> => {
  const raw = await loadStoredAppLanguage();
  return raw ?? "ja";
};

export const loadStoredAppLanguage = async (): Promise<"ja" | "en" | null> => {
  const raw = await AsyncStorage.getItem(APP_LANGUAGE_KEY);
  if (raw === "ja" || raw === "en") {
    return raw;
  }
  return null;
};

export const saveAppLanguage = async (
  language: "ja" | "en",
): Promise<void> => {
  await AsyncStorage.setItem(APP_LANGUAGE_KEY, language);
};

export const loadCloudSyncEntitled = async (): Promise<boolean> => {
  if (__DEV__) {
    return true;
  }
  const raw = await AsyncStorage.getItem(CLOUD_SYNC_ENTITLED_KEY);
  return raw === "true";
};

export const saveCloudSyncEntitled = async (value: boolean): Promise<void> => {
  await AsyncStorage.setItem(CLOUD_SYNC_ENTITLED_KEY, value ? "true" : "false");
};

export const loadCloudSyncEnabled = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(CLOUD_SYNC_ENABLED_KEY);
  return raw === "true";
};

export const saveCloudSyncEnabled = async (value: boolean): Promise<void> => {
  await AsyncStorage.setItem(CLOUD_SYNC_ENABLED_KEY, value ? "true" : "false");
};

export const saveTodayState = async (state: TodayState): Promise<void> => {
  await AsyncStorage.setItem(
    getTodayStateKey(state.date),
    JSON.stringify(state),
  );
};

export const saveAllTodayStates = async (
  states: TodayState[],
): Promise<void> => {
  const existingKeys = await AsyncStorage.getAllKeys();
  const stateKeys = existingKeys.filter((key) =>
    key.startsWith(TODAY_STATE_KEY_PREFIX),
  );
  const nextEntries = states.map((state) => [
    getTodayStateKey(state.date),
    JSON.stringify(state),
  ] as const);
  const nextKeySet = new Set(nextEntries.map(([key]) => key));
  const keysToRemove = stateKeys.filter((key) => !nextKeySet.has(key));

  if (keysToRemove.length > 0) {
    await AsyncStorage.multiRemove(keysToRemove);
  }
  if (nextEntries.length > 0) {
    await AsyncStorage.multiSet(nextEntries);
  }
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

const sortTagRecords = (records: TagRecord[]) =>
  [...records].sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    return a.id.localeCompare(b.id);
  });

const normalizeTagRecord = (record: Partial<TagRecord>, fallbackOrder: number): TagRecord => {
  const builtinId =
    typeof record.id === "string" && record.id.startsWith("builtin-")
      ? record.id
      : typeof record.name === "string"
        ? getBuiltinTagId(record.name)
        : null;
  const id =
    builtinId ??
    (typeof record.id === "string" && record.id.trim().length > 0
      ? record.id
      : nanoid());
  const createdAt =
    typeof record.createdAt === "number" ? record.createdAt : Date.now();
  const updatedAt =
    typeof record.updatedAt === "number" ? record.updatedAt : createdAt;

  return {
    id,
    name: typeof record.name === "string" ? record.name : "",
    order:
      typeof record.order === "number" && Number.isFinite(record.order)
        ? record.order
        : fallbackOrder,
    createdAt,
    updatedAt,
    archivedAt:
      typeof record.archivedAt === "number" ? record.archivedAt : null,
    deletedAt:
      typeof record.deletedAt === "number" ? record.deletedAt : null,
    deviceId: typeof record.deviceId === "string" ? record.deviceId : null,
  };
};

const migrateTagArraysToRecords = (active: Tag[], archived: Tag[]): TagRecord[] => {
  const now = Date.now();
  const seenIds = new Set<string>();
  const makeRecord = (name: Tag, order: number, archivedAt: number | null) => {
    const builtinId = getBuiltinTagId(name);
    let id = builtinId ?? nanoid();
    if (seenIds.has(id)) {
      id = nanoid();
    }
    seenIds.add(id);
    return normalizeTagRecord(
      {
        id,
        name,
        order,
        createdAt: now + order,
        updatedAt: now + order,
        archivedAt,
        deletedAt: null,
        deviceId: null,
      },
      order,
    );
  };

  return [
    ...active.map((name, index) => makeRecord(name, index, null)),
    ...archived.map((name, index) =>
      makeRecord(name, active.length + index, now + active.length + index),
    ),
  ];
};

export const loadTagRecords = async (): Promise<TagRecord[]> => {
  const raw = await AsyncStorage.getItem(TAG_RECORDS_KEY);
  if (!raw) {
    const [active, archived] = await Promise.all([
      loadTagLibrary(),
      loadArchivedTagLibrary(),
    ]);
    const migrated = migrateTagArraysToRecords(active, archived);
    await saveTagRecords(migrated);
    return migrated;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return sortTagRecords(
      parsed
        .filter((entry) => entry && typeof entry === "object")
        .map((entry, index) =>
          normalizeTagRecord(entry as Partial<TagRecord>, index),
        )
        .filter((record) => record.name.length > 0),
    );
  } catch {
    return [];
  }
};

export const saveTagRecords = async (records: TagRecord[]): Promise<void> => {
  const sorted = sortTagRecords(records);
  const activeTags = sorted
    .filter((record) => record.deletedAt === null && record.archivedAt === null)
    .map((record) => record.name);
  const archivedTags = sorted
    .filter((record) => record.deletedAt === null && record.archivedAt !== null)
    .map((record) => record.name);

  await AsyncStorage.multiSet([
    [TAG_RECORDS_KEY, JSON.stringify(sorted)],
    [TAG_LIBRARY_KEY, JSON.stringify(activeTags)],
    [ARCHIVED_TAG_LIBRARY_KEY, JSON.stringify(archivedTags)],
  ]);
};

export const loadSyncQueue = async (): Promise<SyncQueueItem[]> => {
  const raw = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : nanoid(),
        entityType: isSyncEntityType(entry.entityType)
          ? entry.entityType
          : "tag",
        entityId: typeof entry.entityId === "string" ? entry.entityId : "",
        operation: "upsert" as const,
        payload: entry.payload,
        createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
        updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
        attemptCount:
          typeof entry.attemptCount === "number" ? entry.attemptCount : 0,
        lastError:
          typeof entry.lastError === "string" ? entry.lastError : null,
        nextRetryAt:
          typeof entry.nextRetryAt === "number" ? entry.nextRetryAt : 0,
      }))
      .filter((entry) => entry.entityId.length > 0);
  } catch {
    return [];
  }
};

export const saveSyncQueue = async (items: SyncQueueItem[]): Promise<void> => {
  await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(items));
};

const normalizeSyncEntityEnvelope = <TType extends SyncEntityType>(
  entityType: TType,
  value: unknown,
): SyncEntityEnvelope<TType> | null => {
  const result = validateSyncEnvelope(entityType, value);
  if (!result.ok) {
    const documentId =
      value && typeof value === "object" && "entityId" in value &&
      typeof value.entityId === "string"
        ? value.entityId
        : "unknown";
    logSkippedSyncEnvelope(entityType, `local:${documentId}`, result);
    return null;
  }
  return result.envelope;
};

export const loadSyncEntityRecords = async <TType extends SyncEntityType>(
  entityType: TType,
): Promise<SyncEntityEnvelope<TType>[]> => {
  const raw = await AsyncStorage.getItem(getSyncRecordsKey(entityType));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => normalizeSyncEntityEnvelope(entityType, entry))
      .filter(
        (entry): entry is SyncEntityEnvelope<TType> => entry !== null,
      )
      .sort((left, right) => left.entityId.localeCompare(right.entityId));
  } catch {
    return [];
  }
};

export const saveSyncEntityRecords = async <TType extends SyncEntityType>(
  entityType: TType,
  records: SyncEntityEnvelope<TType>[],
): Promise<void> => {
  const sorted = [...records].sort((left, right) =>
    left.entityId.localeCompare(right.entityId),
  );
  await AsyncStorage.setItem(
    getSyncRecordsKey(entityType),
    JSON.stringify(sorted),
  );
};

const normalizeSyncEntityMetadata = (value: unknown): SyncEntityMetadata => {
  const entry = value && typeof value === "object"
    ? value as Partial<SyncEntityMetadata>
    : {};
  return {
    lastPulledAt:
      typeof entry.lastPulledAt === "number" && Number.isFinite(entry.lastPulledAt)
        ? entry.lastPulledAt
        : null,
    lastPulledId:
      typeof entry.lastPulledId === "string" && entry.lastPulledId.length > 0
        ? entry.lastPulledId
        : null,
    lastPushedAt:
      typeof entry.lastPushedAt === "number" && Number.isFinite(entry.lastPushedAt)
        ? entry.lastPushedAt
        : null,
    initialSyncCompleted: entry.initialSyncCompleted === true,
    status:
      entry.status === "syncing" ||
      entry.status === "succeeded" ||
      entry.status === "failed"
        ? entry.status
        : "idle",
    error: typeof entry.error === "string" ? entry.error : null,
  };
};

export const loadSyncEntityMetadata = async (
  userId: string,
  entityType: SyncEntityType,
): Promise<SyncEntityMetadata> => {
  const raw = await AsyncStorage.getItem(getSyncMetadataKey(userId, entityType));
  if (!raw) {
    return normalizeSyncEntityMetadata(null);
  }
  try {
    return normalizeSyncEntityMetadata(JSON.parse(raw));
  } catch {
    return normalizeSyncEntityMetadata(null);
  }
};

export const saveSyncEntityMetadata = async (
  userId: string,
  entityType: SyncEntityType,
  metadata: SyncEntityMetadata,
): Promise<void> => {
  await AsyncStorage.setItem(
    getSyncMetadataKey(userId, entityType),
    JSON.stringify(normalizeSyncEntityMetadata(metadata)),
  );
};

export const loadSyncDeviceId = async (): Promise<string | null> => {
  const raw = await AsyncStorage.getItem(SYNC_DEVICE_ID_KEY);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

export const saveSyncDeviceId = async (deviceId: string): Promise<void> => {
  await AsyncStorage.setItem(SYNC_DEVICE_ID_KEY, deviceId);
};

export const loadLastCloudSyncedAt = async (): Promise<number | null> => {
  const raw = await AsyncStorage.getItem(LAST_SYNCED_AT_KEY);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export const saveLastCloudSyncedAt = async (value: number): Promise<void> => {
  await AsyncStorage.setItem(LAST_SYNCED_AT_KEY, String(value));
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

export const loadArchivedTagLibrary = async (): Promise<Tag[]> => {
  const raw = await AsyncStorage.getItem(ARCHIVED_TAG_LIBRARY_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((tag) => typeof tag === "string");
  } catch {
    return [];
  }
};

export const saveArchivedTagLibrary = async (tags: Tag[]): Promise<void> => {
  await AsyncStorage.setItem(ARCHIVED_TAG_LIBRARY_KEY, JSON.stringify(tags));
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

export const loadSimpleTodos = async (): Promise<SimpleTodoItem[]> => {
  const raw = await AsyncStorage.getItem(SIMPLE_TODOS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => normalizeSimpleTodo(item as Partial<SimpleTodoItem>));
  } catch {
    return [];
  }
};

export const saveSimpleTodos = async (
  items: SimpleTodoItem[],
): Promise<void> => {
  await AsyncStorage.setItem(SIMPLE_TODOS_KEY, JSON.stringify(items));
};

export const unarchiveTaskToDateSlot = async (
  taskId: string,
  targetDateISO: string,
  slotKey: SlotKey,
): Promise<void> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDateISO)) {
    throw new Error("Invalid target date.");
  }
  const states = await loadAllTodayStates();
  let sourceState: TodayState | null = null;
  let sourceSlotKey: SlotKey | null = null;
  let sourceTask: TaskState | null = null;

  for (const state of states) {
    for (const key of SLOT_KEYS) {
      const task = state.slots[key].tasks.find((item) => item.id === taskId);
      if (task) {
        sourceState = state;
        sourceSlotKey = key;
        sourceTask = task;
        break;
      }
    }
    if (sourceState) {
      break;
    }
  }

  if (!sourceState || !sourceSlotKey || !sourceTask) {
    throw new Error("Task not found.");
  }
  if (!sourceTask.isArchived) {
    throw new Error("Task is not archived.");
  }
  if (sourceTask.status === "DONE") {
    throw new Error("DONE tasks cannot be restored.");
  }

  const restoredTask: TaskState = {
    ...sourceTask,
    isArchived: false,
    status: "TODO",
    startAt: null,
  };

  const defaultTag = (await loadTagLibrary())[0];
  const targetState =
    sourceState.date === targetDateISO
      ? sourceState
      : states.find((state) => state.date === targetDateISO) ??
        (await loadTodayState(targetDateISO, defaultTag));

  const sourceSlot = sourceState.slots[sourceSlotKey];
  const nextSourceSlot: SlotState = {
    ...sourceSlot,
    tasks: sourceSlot.tasks.filter((task) => task.id !== taskId),
  };

  const targetSlot = targetState.slots[slotKey];
  const targetHasTask = targetSlot.tasks.some((task) => task.id === taskId);
  const nextTargetSlot: SlotState = {
    ...targetSlot,
    tasks: targetHasTask
      ? targetSlot.tasks.map((task) =>
          task.id === taskId ? restoredTask : task,
        )
      : [...targetSlot.tasks, restoredTask],
  };

  if (targetState.date === sourceState.date) {
    const nextState: TodayState = {
      ...sourceState,
      slots: {
        ...sourceState.slots,
        [sourceSlotKey]: nextSourceSlot,
        [slotKey]: nextTargetSlot,
      },
    };
    await saveTodayState(nextState);
    return;
  }

  const nextSourceState: TodayState = {
    ...sourceState,
    slots: { ...sourceState.slots, [sourceSlotKey]: nextSourceSlot },
  };
  const nextTargetState: TodayState = {
    ...targetState,
    slots: { ...targetState.slots, [slotKey]: nextTargetSlot },
  };
  await saveTodayState(nextSourceState);
  await saveTodayState(nextTargetState);
};
