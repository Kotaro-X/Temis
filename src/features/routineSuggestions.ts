import AsyncStorage from "@react-native-async-storage/async-storage";
import { SlotKey, SLOT_KEYS, SLOT_LABELS, TaskState } from "../../types";

export type Suggestion = {
  taskName: string;
  slot: SlotKey;
  reason: string;
  score: number;
  normalizedName: string;
};

type RoutineSuggestionOptions = {
  todayKey: string;
  currentSlot: SlotKey;
  lookbackDays?: number;
  maxSuggestions?: number;
};

type TaskAggregate = {
  normalizedName: string;
  displayName: string;
  daySet: Set<string>;
  totalCount: number;
  doneCount: number;
  slotCounts: Record<SlotKey, number>;
};

type ExcludeStats = {
  archived: number;
  emptyName: number;
  invalidTask: number;
  dismissed: number;
  existing: number;
  lowDayCount: number;
  lowSlotShare: number;
};

const TODAY_STATE_KEY_PREFIX = "todayState:";
const DISMISS_KEY_PREFIX = "routineDismiss:";
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_MAX_SUGGESTIONS = 3;
const DEFAULT_MIN_DAY_COUNT = 4;
const DEFAULT_MIN_SLOT_SHARE = 0.35;

const normalizeTaskName = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed
    .replace(/[\n\t]+/g, " ")
    .replace(/[^\w\sぁ-んァ-ン一-龥]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized;
};

const parseDateKey = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateKey = (date: Date) => {
  const pad2 = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;
};

const listLookbackDates = (todayKey: string, lookbackDays: number) => {
  const base = parseDateKey(todayKey) ?? new Date();
  const days = Math.max(1, lookbackDays);
  const keys: string[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(base);
    date.setDate(base.getDate() - offset);
    keys.push(formatDateKey(date));
  }
  return keys;
};

const isDoneStatus = (status: unknown) =>
  status === "DONE" || status === "completed" || status === "done";

const normalizeTaskNameCandidate = (task: Record<string, unknown>) => {
  if (typeof task.taskName === "string") {
    return task.taskName;
  }
  if (typeof task.name === "string") {
    return task.name;
  }
  return "";
};

const getTaskStatus = (task: Record<string, unknown>) => task.status;

const getTaskArchived = (task: Record<string, unknown>) => task.isArchived === true;

type SlotCandidate = {
  tasks?: unknown[];
  taskList?: unknown[];
};

const extractSlotTasks = (state: unknown, slotKey: SlotKey): unknown[] => {
  if (!state || typeof state !== "object") {
    return [];
  }
  const stateRecord = state as Record<string, unknown>;
  const slots = stateRecord.slots as Record<string, unknown> | undefined;
  const slotCandidate = (slots?.[slotKey] ?? stateRecord[slotKey]) as unknown;
  if (!slotCandidate) {
    return [];
  }
  if (Array.isArray(slotCandidate)) {
    return slotCandidate;
  }
  if (typeof slotCandidate === "object") {
    const slotRecord = slotCandidate as SlotCandidate & Record<string, unknown>;
    if (Array.isArray(slotRecord.tasks)) {
      return slotRecord.tasks;
    }
    if (Array.isArray(slotRecord.taskList)) {
      return slotRecord.taskList;
    }
    if ("taskName" in slotRecord || "name" in slotRecord) {
      return [slotRecord];
    }
  }
  return [];
};

const ensureSlotCounts = (): Record<SlotKey, number> =>
  SLOT_KEYS.reduce(
    (acc, key) => {
      acc[key] = 0;
      return acc;
    },
    {} as Record<SlotKey, number>,
  );

const buildReason = (params: {
  lookbackDays: number;
  dayCount: number;
  slotShare: number;
  doneRate: number;
  slotLabel: string;
}) => {
  const slotPercent = Math.round(params.slotShare * 100);
  const donePercent = Math.round(params.doneRate * 100);
  return `直近${params.lookbackDays}日で${params.dayCount}日出現 / ${params.slotLabel}で${slotPercent}% / 完了率${donePercent}%`;
};

const loadDismissedNames = async (todayKey: string) => {
  const dismissKey = `${DISMISS_KEY_PREFIX}${todayKey}`;
  try {
    const raw = await AsyncStorage.getItem(dismissKey);
    if (!raw) {
      return new Set<string>();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }
    return new Set(parsed.filter((item) => typeof item === "string"));
  } catch {
    return new Set<string>();
  }
};

export const dismissSuggestionForToday = async (
  todayKey: string,
  normalizedName: string,
): Promise<void> => {
  const dismissKey = `${DISMISS_KEY_PREFIX}${todayKey}`;
  try {
    const raw = await AsyncStorage.getItem(dismissKey);
    const parsed = raw ? JSON.parse(raw) : [];
    const names = Array.isArray(parsed) ? parsed : [];
    const next = new Set<string>(
      names.filter((item) => typeof item === "string"),
    );
    next.add(normalizedName);
    await AsyncStorage.setItem(dismissKey, JSON.stringify([...next]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[RoutineSuggest] failed to dismiss: ${message}`);
  }
};

export const getRoutineSuggestions = async (
  options: RoutineSuggestionOptions,
): Promise<Suggestion[]> => {
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const maxSuggestions = options.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS;
  const minDayCount = Math.min(DEFAULT_MIN_DAY_COUNT, lookbackDays);
  const targetDates = listLookbackDates(options.todayKey, lookbackDays);
  const targetSet = new Set(targetDates);
  const exclude: ExcludeStats = {
    archived: 0,
    emptyName: 0,
    invalidTask: 0,
    dismissed: 0,
    existing: 0,
    lowDayCount: 0,
    lowSlotShare: 0,
  };

  const keys = await AsyncStorage.getAllKeys();
  const stateKeys = keys.filter(
    (key) =>
      key.startsWith(TODAY_STATE_KEY_PREFIX) &&
      targetSet.has(key.slice(TODAY_STATE_KEY_PREFIX.length)),
  );
  if (stateKeys.length === 0) {
    console.log(
      `[RoutineSuggest] no todayState keys in range lookback=${lookbackDays}`,
    );
    return [];
  }
  const entries = await AsyncStorage.multiGet(stateKeys);
  const aggregates = new Map<string, TaskAggregate>();
  let totalTasks = 0;

  for (const [key, raw] of entries) {
    if (!raw) {
      continue;
    }
    const dateKey = key.slice(TODAY_STATE_KEY_PREFIX.length);
    if (!targetSet.has(dateKey)) {
      continue;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const slotKey of SLOT_KEYS) {
      const tasks = extractSlotTasks(parsed, slotKey);
      if (!Array.isArray(tasks)) {
        continue;
      }
      for (const entryTask of tasks) {
        if (!entryTask || typeof entryTask !== "object") {
          exclude.invalidTask += 1;
          continue;
        }
        totalTasks += 1;
        const taskRecord = entryTask as Record<string, unknown>;
        if (getTaskArchived(taskRecord)) {
          exclude.archived += 1;
          continue;
        }
        const taskName = normalizeTaskNameCandidate(taskRecord);
        const normalizedName = normalizeTaskName(taskName);
        if (!normalizedName) {
          exclude.emptyName += 1;
          continue;
        }
        const aggregate = aggregates.get(normalizedName);
        if (aggregate) {
          aggregate.totalCount += 1;
          aggregate.daySet.add(dateKey);
          aggregate.slotCounts[slotKey] += 1;
          if (isDoneStatus(getTaskStatus(taskRecord))) {
            aggregate.doneCount += 1;
          }
          if (taskName && taskName.length >= aggregate.displayName.length) {
            aggregate.displayName = taskName;
          }
        } else {
          const slotCounts = ensureSlotCounts();
          slotCounts[slotKey] = 1;
          aggregates.set(normalizedName, {
            normalizedName,
            displayName: taskName,
            daySet: new Set([dateKey]),
            totalCount: 1,
            doneCount: isDoneStatus(getTaskStatus(taskRecord)) ? 1 : 0,
            slotCounts,
          });
        }
      }
    }
  }

  const dismissed = await loadDismissedNames(options.todayKey);
  const todayKeyFull = `${TODAY_STATE_KEY_PREFIX}${options.todayKey}`;
  let todaySlotNames = new Set<string>();
  const todayEntry = entries.find(([key]) => key === todayKeyFull);
  if (todayEntry?.[1]) {
    try {
      const todayParsed = JSON.parse(todayEntry[1]);
      todaySlotNames = new Set(
        extractSlotTasks(todayParsed, options.currentSlot)
          .map((task) => {
            if (!task || typeof task !== "object") {
              return "";
            }
            const taskRecord = task as Record<string, unknown>;
            if (getTaskArchived(taskRecord)) {
              return "";
            }
            return normalizeTaskName(normalizeTaskNameCandidate(taskRecord));
          })
          .filter((name) => name.length > 0),
      );
    } catch {
      todaySlotNames = new Set();
    }
  } else {
    try {
      const rawToday = await AsyncStorage.getItem(todayKeyFull);
      if (rawToday) {
        const todayParsed = JSON.parse(rawToday);
        todaySlotNames = new Set(
          extractSlotTasks(todayParsed, options.currentSlot)
            .map((task) => {
              if (!task || typeof task !== "object") {
                return "";
              }
              const taskRecord = task as Record<string, unknown>;
              if (getTaskArchived(taskRecord)) {
                return "";
              }
              return normalizeTaskName(normalizeTaskNameCandidate(taskRecord));
            })
            .filter((name) => name.length > 0),
        );
      }
    } catch {
      todaySlotNames = new Set();
    }
  }

  const suggestions: Suggestion[] = [];
  let candidateCount = 0;
  for (const aggregate of aggregates.values()) {
    const dayCount = aggregate.daySet.size;
    if (dayCount < minDayCount) {
      exclude.lowDayCount += 1;
      continue;
    }
    const slotCount = aggregate.slotCounts[options.currentSlot];
    const slotShare =
      aggregate.totalCount > 0 ? slotCount / aggregate.totalCount : 0;
    if (slotShare < DEFAULT_MIN_SLOT_SHARE) {
      exclude.lowSlotShare += 1;
      continue;
    }
    candidateCount += 1;
    if (todaySlotNames.has(aggregate.normalizedName)) {
      exclude.existing += 1;
      continue;
    }
    if (dismissed.has(aggregate.normalizedName)) {
      exclude.dismissed += 1;
      continue;
    }
    const doneRate =
      aggregate.totalCount > 0
        ? aggregate.doneCount / aggregate.totalCount
        : 0;
    const score =
      dayCount +
      aggregate.totalCount * 0.2 +
      doneRate * 2 +
      slotShare * 2;
    suggestions.push({
      taskName: aggregate.displayName || aggregate.normalizedName,
      slot: options.currentSlot,
      reason: buildReason({
        lookbackDays,
        dayCount,
        slotShare,
        doneRate,
        slotLabel: SLOT_LABELS[options.currentSlot] ?? options.currentSlot,
      }),
      score: Number(score.toFixed(3)),
      normalizedName: aggregate.normalizedName,
    });
  }

  suggestions.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.taskName.length !== b.taskName.length) {
      return b.taskName.length - a.taskName.length;
    }
    return a.taskName.localeCompare(b.taskName);
  });

  const sliced = suggestions.slice(0, maxSuggestions);
  console.log(
    `[RoutineSuggest] lookback=${lookbackDays} totalTasks=${totalTasks} unique=${aggregates.size} candidates=${candidateCount} suggestions=${sliced.length} excluded={archived:${exclude.archived}, empty:${exclude.emptyName}, invalid:${exclude.invalidTask}, lowDay:${exclude.lowDayCount}, lowSlot:${exclude.lowSlotShare}, existing:${exclude.existing}, dismissed:${exclude.dismissed}}`,
  );

  return sliced;
};

export const buildSuggestionTaskState = (
  suggestion: Suggestion,
  taskId: string,
): TaskState => ({
  id: taskId,
  taskName: suggestion.taskName,
  tags: [],
  estimateMinutes: 0,
  elapsedMinutes: 0,
  status: "TODO",
  isArchived: false,
  startAt: null,
});
