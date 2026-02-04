import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ScreenOrientation from "expo-screen-orientation";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import {
  DEFAULT_TAGS,
  DEFAULT_TIMEBOX_SCHEDULE,
  LogEntry,
  LogResult,
  SlotKey,
  SlotState,
  TaskState,
  TaskStatus,
  TimeBoxSchedule,
  TodayState,
  SLOT_KEYS,
  SLOT_LABELS,
  Tag,
} from "./types";
import {
  createEmptyTask,
  createEmptyTodayState,
  loadLogs,
  loadTagLibrary,
  loadTimeBoxSchedule,
  loadTodayState,
  saveLogs,
  saveTagLibrary,
  saveTimeBoxSchedule,
  saveTodayState,
} from "./storage";
import HighlightEditor from "./src/components/HighlightEditor";
import MemoSearchModal from "./src/components/MemoSearchModal";
import { setTaskIndex } from "./src/db/memoRepo";
import {
  FreeNoteSummary,
  getDailyNoteByDate,
  getFreeNoteById,
  listFreeNotes,
  upsertDailyNote,
  upsertFreeNote,
} from "./src/db/noteRepo";
import { ensureDbReady } from "./src/db/sqlite";
import TaskDetailScreen from "./src/screens/TaskDetailScreen";
import MemosScreen from "./src/screens/MemosScreen";

const FOOTER_HEIGHT = Math.max(
  56,
  Math.round(Dimensions.get("window").height * 0.08),
);

const pad2 = (num: number) => String(num).padStart(2, "0");
const LOG_ANALYSIS_POINT_GAP = 12;
const LOG_ANALYSIS_MONTH_SLOTS = 31;
const LOG_ANALYSIS_YEAR_SLOTS = 366;

const toDateString = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;

const round1 = (num: number) => Math.round(num * 10) / 10;

const formatMinutes = (num: number) => round1(num).toFixed(1);

const diffLabel = (diff: number) =>
  diff >= 0 ? `+${formatMinutes(diff)}` : formatMinutes(diff);

const formatFullDate = (date: Date) =>
  `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;

const formatMonth = (date: Date) =>
  `${date.getFullYear()}/${pad2(date.getMonth() + 1)}`;

const formatMonthLabel = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return value;
  }
  return match[2];
};

const formatShortDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return value;
  }
  return `${match[2]}/${match[3]}`;
};

const buildDateRange = (start: Date, end: Date) => {
  const results: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= endDate) {
    results.push(toDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return results;
};

const getDaysInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate();

const buildDailyTotalsForDates = (
  logs: LogEntry[],
  dateList: string[],
  tagFilter: string,
) => {
  const totals = new Map<string, number>();
  for (const date of dateList) {
    totals.set(date, 0);
  }
  for (const log of logs) {
    if (!totals.has(log.date)) {
      continue;
    }
    if (tagFilter === ALL_TAG_FILTER) {
      totals.set(log.date, (totals.get(log.date) ?? 0) + log.actualMinutes);
      continue;
    }
    if (tagFilter === NO_TAG_LABEL) {
      if (log.tags.length === 0) {
        totals.set(log.date, (totals.get(log.date) ?? 0) + log.actualMinutes);
      }
      continue;
    }
    if (log.tags.includes(tagFilter)) {
      totals.set(log.date, (totals.get(log.date) ?? 0) + log.actualMinutes);
    }
  }
  return dateList.map((date) => ({
    date,
    minutes: round1(totals.get(date) ?? 0),
  }));
};

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const formatDateTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${toDateString(date)} ${formatTime(timestamp)}`;
};

const parseTimeString = (value: string) => {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 24) {
    return null;
  }
  if (minutes < 0 || minutes > 59) {
    return null;
  }
  if (hours === 24 && minutes !== 0) {
    return null;
  }
  return hours * 60 + minutes;
};

const parseDateString = (value: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

const sumEstimateMinutesAll = (tasks: TaskState[]) =>
  Math.round(
    tasks.reduce((acc, task) => {
      const value = Number(task.estimateMinutes);
      return acc + (Number.isFinite(value) ? value : 0);
    }, 0),
  );

const sumEstimateMinutesIncomplete = (tasks: TaskState[]) =>
  Math.round(
    tasks.reduce((acc, task) => {
      if (task.status === "DONE") {
        return acc;
      }
      const value = Number(task.estimateMinutes);
      return acc + (Number.isFinite(value) ? value : 0);
    }, 0),
  );

const getCapacityMinutes = (
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

const parseMinutes = (text: string) => {
  const cleaned = text.replace(/[^0-9]/g, "");
  if (cleaned.length === 0) {
    return 0;
  }
  const value = parseInt(cleaned, 10);
  return Number.isNaN(value) ? 0 : value;
};

const ALL_TAG_FILTER = "すべて";
const NO_TAG_LABEL = "タグなし";

const statusLabel: Record<TaskStatus, string> = {
  TODO: "未完",
  IN_PROGRESS: "進行中",
  PAUSED: "中断",
  DONE: "完了",
};

const statusPalette: Record<
  TaskStatus,
  { bar: string; badgeBg: string; badgeText: string }
> = {
  TODO: {
    bar: "#9ca3af",
    badgeBg: "#f3f4f6",
    badgeText: "#374151",
  },
  IN_PROGRESS: {
    bar: "#2563eb",
    badgeBg: "#dbeafe",
    badgeText: "#1e40af",
  },
  PAUSED: {
    bar: "#f59e0b",
    badgeBg: "#fef3c7",
    badgeText: "#92400e",
  },
  DONE: {
    bar: "#16a34a",
    badgeBg: "#dcfce7",
    badgeText: "#166534",
  },
};

const ActionButton = ({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    style={[styles.actionButton, disabled && styles.actionButtonDisabled]}
    disabled={disabled}
  >
    <Text
      style={[styles.actionButtonText, disabled && styles.actionButtonTextDisabled]}
    >
      {label}
    </Text>
  </Pressable>
);

const MenuButton = ({ onPress }: { onPress: () => void }) => (
  <Pressable style={styles.menuButton} onPress={onPress}>
    <Ionicons name="menu" size={20} color="#111827" />
  </Pressable>
);

const buildFlatTasks = (state: TodayState) => {
  const items: { slotKey: SlotKey; task: TaskState }[] = [];
  for (const slotKey of SLOT_KEYS) {
    for (const task of state.slots[slotKey].tasks) {
      if (!task.isArchived && task.status !== "DONE") {
        items.push({ slotKey, task });
      }
    }
  }
  return items;
};

const removeTasksFromState = (state: TodayState, idSet: Set<string>) => {
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

const findTaskById = (state: TodayState, taskId: string) => {
  for (const slotKey of SLOT_KEYS) {
    const task = state.slots[slotKey].tasks.find((item) => item.id === taskId);
    if (task) {
      return task;
    }
  }
  return null;
};

const findTaskLocation = (state: TodayState, taskId: string) => {
  for (const slotKey of SLOT_KEYS) {
    const task = state.slots[slotKey].tasks.find((item) => item.id === taskId);
    if (task) {
      return { slotKey, task };
    }
  }
  return null;
};

type Screen =
  | "today"
  | "logs"
  | "archive"
  | "tags"
  | "timeSettings"
  | "notes"
  | "memos";

const LogMetricValue = ({ value }: { value: number }) => {
  return (
    <View style={styles.logLandscapeMetricCell}>
      <Text style={styles.logLandscapeValue}>{formatMinutes(value)}m</Text>
    </View>
  );
};

const LogDiffMetric = ({ diff }: { diff: number }) => {
  const diffColor =
    diff > 0 ? "#dc2626" : diff < 0 ? "#2563eb" : "#6b7280";
  return (
    <View style={styles.logLandscapeDiffCell}>
      <Text style={[styles.logLandscapeValue, { color: diffColor }]}>
        {`${diffLabel(diff)}m`}
      </Text>
    </View>
  );
};

const renderMetricCell = ({
  kind,
  value,
  diff,
}: {
  kind: "estimate" | "actual" | "diff";
  value?: number;
  diff?: number;
}) => {
  if (kind === "diff") {
    return <LogDiffMetric diff={diff ?? 0} />;
  }
  return <LogMetricValue value={value ?? 0} />;
};

const LandscapeLogView = ({ logs }: { logs: LogEntry[] }) => {
  return (
    <View style={styles.logLandscapeTable}>
      <View style={[styles.logLandscapeRow, styles.logLandscapeHeaderRow]}>
        <View style={styles.logLandscapeMetaCell}>
          <Text style={styles.logLandscapeHeaderCell}>タスク</Text>
        </View>
        <View style={styles.logLandscapeMetricCell}>
          <Text
            style={[
              styles.logLandscapeHeaderCell,
              styles.logLandscapeHeaderMetric,
            ]}
          >
            予
          </Text>
        </View>
        <View style={styles.logLandscapeMetricCell}>
          <Text
            style={[
              styles.logLandscapeHeaderCell,
              styles.logLandscapeHeaderMetric,
            ]}
          >
            実
          </Text>
        </View>
        <View style={styles.logLandscapeDiffCell}>
          <Text
            style={[
              styles.logLandscapeHeaderCell,
              styles.logLandscapeHeaderMetric,
            ]}
          >
            差
          </Text>
        </View>
      </View>
      {logs.map((log) => {
        const diff = round1(log.actualMinutes - log.estimateMinutes);
        const tags =
          log.tags.length > 0 ? log.tags : ([NO_TAG_LABEL] as Tag[]);
        const visibleTags = tags.slice(0, 3);
        const overflowCount = tags.length - visibleTags.length;
        return (
          <View key={log.id} style={styles.logLandscapeRow}>
            <View style={styles.logLandscapeMetaCell}>
              <View style={styles.logLandscapeTitleRow}>
                <Text
                  style={styles.logLandscapeTitle}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {log.taskName || "未設定"}
                </Text>
                <View style={styles.logLandscapeTags}>
                  {visibleTags.map((tag) =>
                    tag === NO_TAG_LABEL ? (
                      <View key={tag} style={styles.logLandscapeTagChipMuted}>
                        <Text style={styles.logLandscapeTagTextMuted}>
                          {tag}
                        </Text>
                      </View>
                    ) : (
                      <View key={tag} style={styles.logLandscapeTagChip}>
                        <Text style={styles.logLandscapeTagText}>{tag}</Text>
                      </View>
                    ),
                  )}
                  {overflowCount > 0 && (
                    <View style={styles.logLandscapeTagChipMuted}>
                      <Text style={styles.logLandscapeTagTextMuted}>
                        {`+${overflowCount}`}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <Text style={styles.logLandscapeMeta}>{log.date}</Text>
            </View>
            {renderMetricCell({
              kind: "estimate",
              value: log.estimateMinutes,
            })}
            {renderMetricCell({
              kind: "actual",
              value: log.actualMinutes,
            })}
            {renderMetricCell({ kind: "diff", diff })}
          </View>
        );
      })}
    </View>
  );
};

export default function App() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [screen, setScreen] = useState<Screen>("today");
  const [selectedDate, setSelectedDate] = useState<string>(
    toDateString(new Date()),
  );
  const [todayState, setTodayState] = useState<TodayState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [tagLibrary, setTagLibrary] = useState<Tag[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editingTagDraft, setEditingTagDraft] = useState("");
  const [logView, setLogView] = useState<"table" | "board">("table");
  const [logQuery, setLogQuery] = useState("");
  const [logTagFilter, setLogTagFilter] = useState(ALL_TAG_FILTER);
  const [logAnalysisPeriod, setLogAnalysisPeriod] = useState<7 | 30 | 365>(7);
  const [logAnalysisTag, setLogAnalysisTag] = useState(ALL_TAG_FILTER);
  const [logAnalysisCollapsed, setLogAnalysisCollapsed] = useState(false);
  const [logAnalysisOffsets, setLogAnalysisOffsets] = useState({
    7: 0,
    30: 0,
    365: 0,
  });
  const [logAnalysisWidth, setLogAnalysisWidth] = useState(0);
  const [memoSearchOpen, setMemoSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagDropdownTaskId, setTagDropdownTaskId] = useState<string | null>(
    null,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState(selectedDate);
  const [dateError, setDateError] = useState<string | null>(null);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTaskId, setMoveTaskId] = useState<string | null>(null);
  const [moveFromSlotKey, setMoveFromSlotKey] = useState<SlotKey | null>(null);
  const [moveDateDraft, setMoveDateDraft] = useState(selectedDate);
  const [moveDateError, setMoveDateError] = useState<string | null>(null);
  const [moveTargetSlotKey, setMoveTargetSlotKey] = useState<SlotKey>(
    SLOT_KEYS[0],
  );
  const [storageReady, setStorageReady] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notesTab, setNotesTab] = useState<"daily" | "free">("daily");
  const [dailyNoteId, setDailyNoteId] = useState<string | null>(null);
  const [dailyNoteBody, setDailyNoteBody] = useState("");
  const [dailyNoteLoading, setDailyNoteLoading] = useState(false);
  const [dailyNoteSaving, setDailyNoteSaving] = useState(false);
  const [freeNotes, setFreeNotes] = useState<FreeNoteSummary[]>([]);
  const [freeNoteDraft, setFreeNoteDraft] = useState<{
    id: string | null;
    title: string;
    body: string;
  }>({ id: null, title: "", body: "" });
  const [freeNoteLoading, setFreeNoteLoading] = useState(false);
  const [freeNoteSaving, setFreeNoteSaving] = useState(false);
  const [timeBoxSchedule, setTimeBoxSchedule] = useState<TimeBoxSchedule>(
    DEFAULT_TIMEBOX_SCHEDULE,
  );
  const [timeBoxDraft, setTimeBoxDraft] = useState<TimeBoxSchedule>(
    DEFAULT_TIMEBOX_SCHEDULE,
  );
  const [timeBoxError, setTimeBoxError] = useState<string | null>(null);
  const [expandedTimeBoxes, setExpandedTimeBoxes] = useState<
    Record<SlotKey, boolean>
  >(
    () =>
      SLOT_KEYS.reduce(
        (acc, key) => {
          acc[key] = false;
          return acc;
        },
        {} as Record<SlotKey, boolean>,
      ),
  );
  const [completedExpandedBySlot, setCompletedExpandedBySlot] = useState<
    Record<SlotKey, boolean>
  >(
    () =>
      SLOT_KEYS.reduce(
        (acc, key) => {
          acc[key] = false;
          return acc;
        },
        {} as Record<SlotKey, boolean>,
      ),
  );
  const logScrollRef = useRef<ScrollView | null>(null);
  const logScrollOffset = useRef({ x: 0, y: 0 });
  const logTableScrollRef = useRef<ScrollView | null>(null);
  const logTableScrollOffset = useRef({ x: 0, y: 0 });
  const logBoardScrollRef = useRef<ScrollView | null>(null);
  const logBoardScrollOffset = useRef({ x: 0, y: 0 });
  const [activeExpandedBySlot, setActiveExpandedBySlot] = useState<
    Record<SlotKey, boolean>
  >(
    () =>
      SLOT_KEYS.reduce(
        (acc, key) => {
          acc[key] = true;
          return acc;
        },
        {} as Record<SlotKey, boolean>,
      ),
  );

  useEffect(() => {
    ensureDbReady().catch(() => null);
  }, []);

  useEffect(() => {
    const load = async () => {
      const loadedTags = await loadTagLibrary();
      const [loadedLogs, loadedSchedule] = await Promise.all([
        loadLogs(),
        loadTimeBoxSchedule(),
      ]);
      setTagLibrary(loadedTags);
      setLogs(loadedLogs);
      setTimeBoxSchedule(loadedSchedule);
      setTimeBoxDraft(loadedSchedule);
      setStorageReady(true);
    };
    load();
  }, []);

  useEffect(() => {
    if (!storageReady) {
      return;
    }
    let active = true;
    const load = async () => {
      const defaultTag = tagLibrary[0];
      const loadedToday = await loadTodayState(selectedDate, defaultTag);
      if (active) {
        setTodayState(loadedToday);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [selectedDate, tagLibrary, storageReady]);

  useEffect(() => {
    const entries: Array<{ taskId: string; taskTitle: string }> = [];
    if (logs.length > 0) {
      const seen = new Set<string>();
      const sortedLogs = [...logs].sort((a, b) => b.endedAt - a.endedAt);
      for (const log of sortedLogs) {
        const title = log.taskName.trim();
        if (!log.taskId || !title || seen.has(log.taskId)) {
          continue;
        }
        entries.push({ taskId: log.taskId, taskTitle: title });
        seen.add(log.taskId);
      }
    }
    if (todayState) {
      for (const slotKey of SLOT_KEYS) {
        for (const task of todayState.slots[slotKey].tasks) {
          entries.push({
            taskId: task.id,
            taskTitle: task.taskName || "未設定",
          });
        }
      }
    }
    setTaskIndex(entries);
  }, [todayState, logs]);

  useEffect(() => {
    if (screen !== "notes" || notesTab !== "daily") {
      return;
    }
    let active = true;
    setDailyNoteLoading(true);
    getDailyNoteByDate(selectedDate)
      .then((note) => {
        if (!active) {
          return;
        }
        setDailyNoteId(note?.id ?? null);
        setDailyNoteBody(note?.body ?? "");
      })
      .finally(() => {
        if (active) {
          setDailyNoteLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [screen, notesTab, selectedDate]);

  useEffect(() => {
    if (screen !== "notes" || notesTab !== "free") {
      return;
    }
    let active = true;
    setFreeNoteLoading(true);
    listFreeNotes()
      .then((items) => {
        if (active) {
          setFreeNotes(items);
        }
      })
      .finally(() => {
        if (active) {
          setFreeNoteLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [screen, notesTab]);

  const flatTasks = useMemo(
    () => (todayState ? buildFlatTasks(todayState) : []),
    [todayState],
  );

  const archivedTasks = useMemo(() => {
    if (!todayState) {
      return [];
    }
    const items: { slotKey: SlotKey; task: TaskState }[] = [];
    for (const slotKey of SLOT_KEYS) {
      for (const task of todayState.slots[slotKey].tasks) {
        if (task.isArchived) {
          items.push({ slotKey, task });
        }
      }
    }
    return items;
  }, [todayState]);

  const selectedSet = useMemo(
    () => new Set(selectedTaskIds),
    [selectedTaskIds],
  );

  useEffect(() => {
    if (!todayState) {
      return;
    }
    if (flatTasks.length === 0) {
      if (activeTaskId) {
        setActiveTaskId(null);
      }
      return;
    }
    if (!activeTaskId) {
      setActiveTaskId(flatTasks[0].task.id);
      return;
    }
    const exists = flatTasks.some((item) => item.task.id === activeTaskId);
    if (!exists) {
      setActiveTaskId(flatTasks[0].task.id);
    }
  }, [todayState, flatTasks, activeTaskId]);

  useEffect(() => {
    if (!selectionMode) {
      return;
    }
    const existingIds = new Set(flatTasks.map((item) => item.task.id));
    setSelectedTaskIds((prev) => prev.filter((id) => existingIds.has(id)));
  }, [selectionMode, flatTasks]);

  useEffect(() => {
    setTagDropdownTaskId(null);
  }, [activeTaskId, selectionMode, screen]);

  useEffect(() => {
    const applyOrientation = async () => {
      try {
        if (screen === "logs") {
          await ScreenOrientation.unlockAsync();
        } else {
          await ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.PORTRAIT_UP,
          );
        }
      } catch (_error) {
        // no-op: keep UI usable even if orientation lock fails
      }
    };
    applyOrientation();
  }, [screen]);

  const activeInfo = useMemo(() => {
    if (!todayState || !activeTaskId) {
      return null;
    }
    return flatTasks.find((item) => item.task.id === activeTaskId) ?? null;
  }, [todayState, flatTasks, activeTaskId]);

  const updateTodayState = (next: TodayState) => {
    setTodayState(next);
    saveTodayState(next);
  };

  const updateSlot = (key: SlotKey, updater: (slot: SlotState) => SlotState) => {
    if (!todayState) {
      return;
    }
    const next: TodayState = {
      ...todayState,
      slots: {
        ...todayState.slots,
        [key]: updater(todayState.slots[key]),
      },
    };
    updateTodayState(next);
  };

  const updateTask = (
    slotKey: SlotKey,
    taskId: string,
    updater: (task: TaskState) => TaskState,
  ) => {
    updateSlot(slotKey, (slot) => ({
      ...slot,
      tasks: slot.tasks.map((task) =>
        task.id === taskId ? updater(task) : task,
      ),
    }));
  };

  const saveTagLibraryState = (nextTags: Tag[]) => {
    setTagLibrary(nextTags);
    saveTagLibrary(nextTags);
  };

  const updateTodayTags = (
    current: TodayState,
    updater: (tags: Tag[]) => Tag[],
  ) => {
    const nextSlots = SLOT_KEYS.reduce(
      (acc, slotKey) => {
        const slot = current.slots[slotKey];
        const tasks = slot.tasks.map((task) => {
          const nextTags = updater(task.tags);
          return nextTags === task.tags ? task : { ...task, tags: nextTags };
        });
        acc[slotKey] = { ...slot, tasks };
        return acc;
      },
      {} as Record<SlotKey, SlotState>,
    );
    return { ...current, slots: nextSlots };
  };

  const updateLogTags = (updater: (tags: Tag[]) => Tag[]) => {
    setLogs((prev) => {
      const next = prev.map((log) => {
        const nextTags = updater(log.tags);
        return nextTags === log.tags ? log : { ...log, tags: nextTags };
      });
      saveLogs(next);
      return next;
    });
  };

  const handleAddTag = () => {
    const name = tagDraft.trim();
    if (!name || tagLibrary.includes(name)) {
      setTagDraft("");
      return;
    }
    saveTagLibraryState([...tagLibrary, name]);
    setTagDraft("");
  };

  const handleStartEditTag = (tag: Tag) => {
    setEditingTag(tag);
    setEditingTagDraft(tag);
  };

  const handleCancelEditTag = () => {
    setEditingTag(null);
    setEditingTagDraft("");
  };

  const handleSaveEditTag = () => {
    if (!editingTag) {
      return;
    }
    const nextName = editingTagDraft.trim();
    if (!nextName) {
      return;
    }
    if (nextName === editingTag) {
      handleCancelEditTag();
      return;
    }
    if (tagLibrary.includes(nextName)) {
      return;
    }
    const nextTags = tagLibrary.map((tag) =>
      tag === editingTag ? nextName : tag,
    );
    saveTagLibraryState(nextTags);
    if (todayState) {
      const nextState = updateTodayTags(todayState, (tags) =>
        tags.map((tag) => (tag === editingTag ? nextName : tag)),
      );
      updateTodayState(nextState);
    }
    updateLogTags((tags) =>
      tags.map((tag) => (tag === editingTag ? nextName : tag)),
    );
    if (logTagFilter === editingTag) {
      setLogTagFilter(nextName);
    }
    handleCancelEditTag();
  };

  const handleDeleteTag = (tag: Tag) => {
    const nextTags = tagLibrary.filter((item) => item !== tag);
    saveTagLibraryState(nextTags);
    if (todayState) {
      const nextState = updateTodayTags(todayState, (tags) =>
        tags.filter((item) => item !== tag),
      );
      updateTodayState(nextState);
    }
    updateLogTags((tags) => tags.filter((item) => item !== tag));
    if (logTagFilter === tag) {
      setLogTagFilter(ALL_TAG_FILTER);
    }
  };

  const confirmDeleteTag = (tag: Tag) => {
    Alert.alert("確認", "このタグを削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      { text: "削除", style: "destructive", onPress: () => handleDeleteTag(tag) },
    ]);
  };

  const pauseTask = (task: TaskState, now: number): TaskState => {
    if (task.status !== "IN_PROGRESS" || task.startAt === null) {
      return task;
    }
    // startAtとの差分で経過分を加算する
    const diffMinutes = (now - task.startAt) / 60000;
    return {
      ...task,
      elapsedMinutes: round1(task.elapsedMinutes + diffMinutes),
      status: "PAUSED",
      startAt: null,
    };
  };

  const pauseAllRunningTasks = (
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
          return pauseTask(task, now);
        }
        return task;
      });
      if (changed) {
        nextSlots[slotKey] = { ...slot, tasks };
      }
    }
    return nextSlots;
  };

  const handleAddTask = (key: SlotKey) => {
    const newTask = createEmptyTask(tagLibrary[0]);
    updateSlot(key, (slot) => ({
      ...slot,
      tasks: [...slot.tasks, newTask],
    }));
    setActiveTaskId(newTask.id);
  };

  const toggleTaskTag = (slotKey: SlotKey, taskId: string, tag: Tag) => {
    updateTask(slotKey, taskId, (task) => {
      const exists = task.tags.includes(tag);
      const nextTags = exists
        ? task.tags.filter((item) => item !== tag)
        : [...task.tags, tag];
      return { ...task, tags: nextTags };
    });
  };

  const toggleSelection = (taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  };

  const deleteTask = (taskId: string) => {
    if (!todayState) {
      return;
    }
    const task = findTaskById(todayState, taskId);
    if (task?.status === "DONE") {
      return;
    }
    const beforeFlat = flatTasks;
    const wasActive = taskId === activeTaskId;
    const nextState = removeTasksFromState(todayState, new Set([taskId]));
    updateTodayState(nextState);
    setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId));
    if (!wasActive) {
      return;
    }
    let nextActive: string | null = null;
    const index = beforeFlat.findIndex((item) => item.task.id === taskId);
    if (index >= 0) {
      const nextItem = beforeFlat[index + 1];
      const prevItem = beforeFlat[index - 1];
      if (nextItem) {
        nextActive = nextItem.task.id;
      } else if (prevItem) {
        nextActive = prevItem.task.id;
      }
    }
    if (!nextActive) {
      const remaining = buildFlatTasks(nextState);
      nextActive = remaining.length > 0 ? remaining[0].task.id : null;
    }
    setActiveTaskId(nextActive);
  };

  const deleteTasks = (taskIds: string[]) => {
    if (!todayState || taskIds.length === 0) {
      return;
    }
    const deletableIds = taskIds.filter((taskId) => {
      const task = findTaskById(todayState, taskId);
      return task?.status !== "DONE";
    });
    if (deletableIds.length === 0) {
      return;
    }
    const nextState = removeTasksFromState(todayState, new Set(deletableIds));
    updateTodayState(nextState);
    const remaining = buildFlatTasks(nextState);
    setActiveTaskId(remaining.length > 0 ? remaining[0].task.id : null);
    setSelectionMode(false);
    setSelectedTaskIds([]);
  };

  const confirmDeleteTask = (taskId: string) => {
    Alert.alert("確認", "このタスクを削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      { text: "削除", style: "destructive", onPress: () => deleteTask(taskId) },
    ]);
  };

  const confirmDeleteSelected = () => {
    const count = selectedTaskIds.length;
    if (count === 0) {
      return;
    }
    Alert.alert("確認", `選択した${count}件のタスクを削除しますか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => deleteTasks(selectedTaskIds),
      },
    ]);
  };

  const closeMenu = () => setMenuOpen(false);

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedTaskIds([]);
  };

  const handleMenuNavigate = (nextScreen: Screen) => {
    if (nextScreen === "timeSettings") {
      setTimeBoxDraft(timeBoxSchedule);
      setTimeBoxError(null);
    }
    setScreen(nextScreen);
    closeMenu();
    if (nextScreen !== "today") {
      exitSelectionMode();
    }
  };

  const handleSelectionMenu = () => {
    if (selectionMode) {
      exitSelectionMode();
    } else {
      setScreen("today");
      setSelectionMode(true);
      setSelectedTaskIds([]);
    }
    closeMenu();
  };

  const handleArchiveTask = (slotKey: SlotKey, taskId: string) => {
    if (!todayState) {
      return;
    }
    const now = Date.now();
    updateTask(slotKey, taskId, (task) => {
      if (task.isArchived) {
        return task;
      }
      let nextTask = task;
      if (task.status === "IN_PROGRESS") {
        // Archive pauses running tasks to stop timing before hiding them.
        nextTask =
          task.startAt !== null
            ? pauseTask(task, now)
            : { ...task, status: "PAUSED", startAt: null };
      }
      return { ...nextTask, isArchived: true, startAt: null };
    });
  };

  const confirmArchiveTask = (slotKey: SlotKey, taskId: string) => {
    Alert.alert("確認", "このタスクをアーカイブへ移動しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "移動",
        style: "destructive",
        onPress: () => handleArchiveTask(slotKey, taskId),
      },
    ]);
  };

  const restoreTaskToSlot = (taskId: string, targetSlotKey: SlotKey) => {
    if (!todayState) {
      return;
    }
    const located = findTaskLocation(todayState, taskId);
    if (!located) {
      return;
    }
    const { slotKey: sourceSlotKey, task } = located;
    const restoredTask: TaskState = {
      ...task,
      isArchived: false,
      status: "TODO",
      startAt: null,
    };
    const nextSlots: Record<SlotKey, SlotState> = {
      ...todayState.slots,
    };
    if (sourceSlotKey === targetSlotKey) {
      const slot = todayState.slots[sourceSlotKey];
      nextSlots[sourceSlotKey] = {
        ...slot,
        tasks: slot.tasks.map((item) =>
          item.id === taskId ? restoredTask : item,
        ),
      };
    } else {
      const sourceSlot = todayState.slots[sourceSlotKey];
      const targetSlot = todayState.slots[targetSlotKey];
      nextSlots[sourceSlotKey] = {
        ...sourceSlot,
        tasks: sourceSlot.tasks.filter((item) => item.id !== taskId),
      };
      nextSlots[targetSlotKey] = {
        ...targetSlot,
        tasks: [...targetSlot.tasks, restoredTask],
      };
    }
    updateTodayState({ ...todayState, slots: nextSlots });
  };

  const confirmRestoreTask = (taskId: string, targetSlotKey: SlotKey) => {
    Alert.alert(
      "確認",
      `このタスクを当日の「${SLOT_LABELS[targetSlotKey]}」に戻しますか？`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "戻す",
          onPress: () => restoreTaskToSlot(taskId, targetSlotKey),
        },
      ],
    );
  };

  const promptRestoreTask = (taskId: string) => {
    Alert.alert("戻し先を選択", "", [
      ...SLOT_KEYS.map((key) => ({
        text: SLOT_LABELS[key],
        onPress: () => confirmRestoreTask(taskId, key),
      })),
      { text: "キャンセル", style: "cancel" },
    ]);
  };

  const updateTimeBoxDraft = (
    slotKey: SlotKey,
    field: "start" | "end",
    value: string,
  ) => {
    setTimeBoxDraft((prev) => ({
      ...prev,
      [slotKey]: { ...prev[slotKey], [field]: value },
    }));
  };

  const validateTimeBoxSchedule = (draft: TimeBoxSchedule) => {
    const ranges: { key: SlotKey; start: number; end: number }[] = [];
    for (const key of SLOT_KEYS) {
      const entry = draft[key];
      const start = parseTimeString(entry.start);
      const end = parseTimeString(entry.end);
      if (start === null || end === null) {
        return "時刻はHH:MM形式で入力してください";
      }
      if (start >= end) {
        return "開始時刻は終了時刻より前にしてください";
      }
      ranges.push({ key, start, end });
    }
    for (let i = 0; i < ranges.length; i += 1) {
      for (let j = i + 1; j < ranges.length; j += 1) {
        const a = ranges[i];
        const b = ranges[j];
        if (a.start < b.end && b.start < a.end) {
          return "時間帯が重複しています";
        }
      }
    }
    return null;
  };

  const handleSaveTimeBoxSchedule = () => {
    const error = validateTimeBoxSchedule(timeBoxDraft);
    if (error) {
      setTimeBoxError(error);
      return;
    }
    setTimeBoxSchedule(timeBoxDraft);
    saveTimeBoxSchedule(timeBoxDraft);
    setTimeBoxError(null);
    setScreen("today");
  };

  const handleCancelTimeBoxSchedule = () => {
    setTimeBoxDraft(timeBoxSchedule);
    setTimeBoxError(null);
    setScreen("today");
  };

  const handleResetTimeBoxSchedule = () => {
    setTimeBoxDraft(DEFAULT_TIMEBOX_SCHEDULE);
    setTimeBoxError(null);
  };

  const openDatePicker = () => {
    setDateDraft(selectedDate);
    setDateError(null);
    setDatePickerOpen(true);
  };

  const closeDatePicker = () => {
    setDatePickerOpen(false);
  };

  const shiftDateDraft = (delta: number) => {
    const base = parseDateString(dateDraft) ?? parseDateString(selectedDate);
    const date = base ?? new Date();
    const next = new Date(date);
    next.setDate(next.getDate() + delta);
    setDateDraft(toDateString(next));
    setDateError(null);
  };

  const openMoveModal = (slotKey: SlotKey, taskId: string) => {
    setMoveTaskId(taskId);
    setMoveFromSlotKey(slotKey);
    setMoveDateDraft(selectedDate);
    setMoveTargetSlotKey(slotKey);
    setMoveDateError(null);
    setMoveModalOpen(true);
  };

  const closeMoveModal = () => {
    setMoveModalOpen(false);
    setMoveTaskId(null);
    setMoveFromSlotKey(null);
  };

  const shiftMoveDateDraft = (delta: number) => {
    const base = parseDateString(moveDateDraft) ?? parseDateString(selectedDate);
    const date = base ?? new Date();
    const next = new Date(date);
    next.setDate(next.getDate() + delta);
    setMoveDateDraft(toDateString(next));
    setMoveDateError(null);
  };

  const applyMoveTask = async () => {
    if (!todayState || !moveTaskId || !moveFromSlotKey) {
      return;
    }
    const parsed = parseDateString(moveDateDraft);
    if (!parsed) {
      setMoveDateError("YYYY-MM-DDで入力してください");
      return;
    }
    const targetDate = toDateString(parsed);
    const targetSlot = moveTargetSlotKey;
    setMoveDateError(null);
    if (targetDate === selectedDate && targetSlot === moveFromSlotKey) {
      setMoveModalOpen(false);
      return;
    }
    const sourceSlot = todayState.slots[moveFromSlotKey];
    const movingTask = sourceSlot.tasks.find((task) => task.id === moveTaskId);
    if (!movingTask) {
      return;
    }
    const nextSourceSlot: SlotState = {
      ...sourceSlot,
      tasks: sourceSlot.tasks.filter((task) => task.id !== moveTaskId),
    };
    if (targetDate === selectedDate) {
      const targetSlotState = todayState.slots[targetSlot];
      const nextTargetSlot: SlotState = {
        ...targetSlotState,
        tasks: [...targetSlotState.tasks, movingTask],
      };
      updateTodayState({
        ...todayState,
        slots: {
          ...todayState.slots,
          [moveFromSlotKey]: nextSourceSlot,
          [targetSlot]: nextTargetSlot,
        },
      });
      setMoveModalOpen(false);
      return;
    }
    const defaultTag = tagLibrary[0];
    const targetState = await loadTodayState(targetDate, defaultTag);
    const targetSlotState = targetState.slots[targetSlot];
    const nextTargetSlot: SlotState = {
      ...targetSlotState,
      tasks: [...targetSlotState.tasks, movingTask],
    };
    const nextTargetState: TodayState = {
      ...targetState,
      slots: { ...targetState.slots, [targetSlot]: nextTargetSlot },
    };
    updateTodayState({
      ...todayState,
      slots: { ...todayState.slots, [moveFromSlotKey]: nextSourceSlot },
    });
    await saveTodayState(nextTargetState);
    setMoveModalOpen(false);
  };

  const applyDateDraft = () => {
    const parsed = parseDateString(dateDraft);
    if (!parsed) {
      setDateError("YYYY-MM-DDで入力してください");
      return;
    }
    const normalized = toDateString(parsed);
    setSelectedDate(normalized);
    setDatePickerOpen(false);
  };

  const handleRefresh = async () => {
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    try {
      const [loadedTags, loadedLogs, loadedSchedule] = await Promise.all([
        loadTagLibrary(),
        loadLogs(),
        loadTimeBoxSchedule(),
      ]);
      setTagLibrary(loadedTags);
      setLogs(loadedLogs);
      setTimeBoxSchedule(loadedSchedule);
      if (screen !== "timeSettings") {
        setTimeBoxDraft(loadedSchedule);
      }
      const defaultTag = loadedTags[0];
      const loadedToday = await loadTodayState(selectedDate, defaultTag);
      setTodayState(loadedToday);
      if (screen === "notes") {
        if (notesTab === "daily") {
          const note = await getDailyNoteByDate(selectedDate);
          setDailyNoteId(note?.id ?? null);
          setDailyNoteBody(note?.body ?? "");
        } else {
          const items = await listFreeNotes();
          setFreeNotes(items);
        }
      }
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  const toggleTimeBoxSection = (slotKey: SlotKey) => {
    setExpandedTimeBoxes((prev) => ({
      ...prev,
      [slotKey]: !prev[slotKey],
    }));
  };
  const toggleActiveSection = (slotKey: SlotKey) => {
    setActiveExpandedBySlot((prev) => ({
      ...prev,
      [slotKey]: !prev[slotKey],
    }));
  };

  const openTaskFromTimeBox = (taskId: string) => {
    setScreen("today");
    setActiveTaskId(taskId);
  };

  const openSearch = (keyword: string) => {
    setSearchQuery(keyword);
    setMemoSearchOpen(true);
  };


  const refreshFreeNotes = async () => {
    setFreeNoteLoading(true);
    try {
      const items = await listFreeNotes();
      setFreeNotes(items);
    } finally {
      setFreeNoteLoading(false);
    }
  };

  const handleSelectFreeNote = async (noteId: string) => {
    setFreeNoteLoading(true);
    try {
      const note = await getFreeNoteById(noteId);
      if (note) {
        setFreeNoteDraft({
          id: note.id,
          title: note.title ?? "",
          body: note.body,
        });
      }
    } finally {
      setFreeNoteLoading(false);
    }
  };

  const handleNewFreeNote = () => {
    setFreeNoteDraft({ id: null, title: "", body: "" });
  };

  const handleSaveDailyNote = async () => {
    if (dailyNoteSaving) {
      return;
    }
    setDailyNoteSaving(true);
    try {
      const saved = await upsertDailyNote(selectedDate, dailyNoteBody);
      setDailyNoteId(saved.id);
    } finally {
      setDailyNoteSaving(false);
    }
  };

  const handleSaveFreeNote = async () => {
    if (freeNoteSaving) {
      return;
    }
    setFreeNoteSaving(true);
    try {
      const saved = await upsertFreeNote({
        id: freeNoteDraft.id,
        title: freeNoteDraft.title.trim() || null,
        body: freeNoteDraft.body,
      });
      setFreeNoteDraft({
        id: saved.id,
        title: saved.title ?? "",
        body: saved.body,
      });
      await refreshFreeNotes();
    } finally {
      setFreeNoteSaving(false);
    }
  };

  const handleStart = (slotKey: SlotKey, taskId: string) => {
    if (!todayState) {
      return;
    }
    const currentSlot = todayState.slots[slotKey];
    const target = currentSlot.tasks.find((task) => task.id === taskId);
    if (!target || target.status === "DONE") {
      return;
    }
    const now = Date.now();
    const pausedSlots = pauseAllRunningTasks(todayState.slots, now, taskId);
    const slot = pausedSlots[slotKey];
    const tasks = slot.tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }
      if (task.status === "DONE") {
        return task;
      }
      if (task.status !== "IN_PROGRESS") {
        return { ...task, status: "IN_PROGRESS", startAt: now };
      }
      return task;
    });
    updateTodayState({
      ...todayState,
      slots: { ...pausedSlots, [slotKey]: { ...slot, tasks } },
    });
  };

  const handlePause = (slotKey: SlotKey, taskId: string) => {
    if (!todayState) {
      return;
    }
    const slot = todayState.slots[slotKey];
    const target = slot.tasks.find((task) => task.id === taskId);
    if (!target || target.status !== "IN_PROGRESS") {
      return;
    }
    const now = Date.now();
    updateTask(slotKey, taskId, (task) => pauseTask(task, now));
  };

  const handleStop = (slotKey: SlotKey, taskId: string, result: LogResult) => {
    if (!todayState) {
      return;
    }
    const slot = todayState.slots[slotKey];
    const target = slot.tasks.find((task) => task.id === taskId);
    if (!target || target.status === "DONE" || target.status === "TODO") {
      return;
    }
    const now = Date.now();
    let elapsed = target.elapsedMinutes;
    if (target.status === "IN_PROGRESS" && target.startAt !== null) {
      elapsed = round1(elapsed + (now - target.startAt) / 60000);
    }
    const updatedTask: TaskState = {
      ...target,
      elapsedMinutes: elapsed,
      status: result === "completed" ? "DONE" : "TODO",
      startAt: null,
    };
    updateSlot(slotKey, (current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId ? updatedTask : task,
      ),
    }));
    // ログは1件だけ確定して保存する
    const newLog: LogEntry = {
      id: `${todayState.date}-${slotKey}-${taskId}`,
      date: todayState.date,
      slot: slotKey,
      taskId,
      taskName: target.taskName,
      tags: [...target.tags],
      estimateMinutes: target.estimateMinutes,
      actualMinutes: elapsed,
      result,
      endedAt: now,
    };
    setLogs((prev) => {
      const next = [...prev.filter((log) => log.id !== newLog.id), newLog];
      saveLogs(next);
      return next;
    });
  };

  const activeIndex = activeTaskId
    ? flatTasks.findIndex((item) => item.task.id === activeTaskId)
    : -1;
  const canMovePrev = activeIndex > 0;
  const canMoveNext = activeIndex >= 0 && activeIndex < flatTasks.length - 1;

  const moveActive = (direction: "prev" | "next") => {
    if (!activeTaskId || flatTasks.length === 0 || selectionMode) {
      return;
    }
    const index = flatTasks.findIndex((item) => item.task.id === activeTaskId);
    if (index === -1) {
      return;
    }
    const nextIndex = direction === "prev" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= flatTasks.length) {
      return;
    }
    setActiveTaskId(flatTasks[nextIndex].task.id);
  };

  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !selectionMode &&
          Math.abs(gesture.dx) > 20 &&
          Math.abs(gesture.dy) < 20,
        onPanResponderRelease: (_, gesture) => {
          // スワイプは左=次、右=前に移動する
          if (selectionMode) {
            return;
          }
          if (gesture.dx < -40) {
            moveActive("next");
          } else if (gesture.dx > 40) {
            moveActive("prev");
          }
        },
      }),
    [activeTaskId, flatTasks, selectionMode],
  );

  const menuPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dy) > 10 && Math.abs(gesture.dx) < 20,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 40) {
            closeMenu();
          }
        },
      }),
    [],
  );

  const last7Logs = useMemo(() => {
    const today = new Date();
    const last7Dates = Array.from({ length: 7 }, (_, index) => {
      const d = new Date(today);
      d.setDate(today.getDate() - index);
      return toDateString(d);
    });
    const dateSet = new Set(last7Dates);
    return logs
      .filter((log) => dateSet.has(log.date))
      .sort((a, b) => {
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date);
        }
        const aEnded = typeof a.endedAt === "number" ? a.endedAt : 0;
        const bEnded = typeof b.endedAt === "number" ? b.endedAt : 0;
        if (aEnded !== bEnded) {
          return bEnded - aEnded;
        }
        return 0;
      });
  }, [logs]);

  const tagFilterOptions = useMemo(() => {
    const options = [ALL_TAG_FILTER, ...tagLibrary];
    const hasNoTag = last7Logs.some((log) => log.tags.length === 0);
    if (hasNoTag && !options.includes(NO_TAG_LABEL)) {
      options.push(NO_TAG_LABEL);
    }
    return options;
  }, [tagLibrary, last7Logs]);

  const tagOptions = useMemo(
    () => (tagLibrary.length > 0 ? tagLibrary : [...DEFAULT_TAGS]),
    [tagLibrary],
  );

  const logAnalysisTagOptions = useMemo(() => {
    const options = [
      ALL_TAG_FILTER,
      ...(tagLibrary.length > 0 ? tagLibrary : [...DEFAULT_TAGS]),
    ];
    const hasNoTag = logs.some((log) => log.tags.length === 0);
    if (hasNoTag && !options.includes(NO_TAG_LABEL)) {
      options.push(NO_TAG_LABEL);
    }
    return options;
  }, [tagLibrary, logs]);

  const logAnalysisChartHeight = Math.max(140, Math.round(height * 0.22));

  const logAnalysisRange = useMemo(() => {
    const today = new Date();
    if (logAnalysisPeriod === 7) {
      const offset = logAnalysisOffsets[7];
      const end = new Date(today);
      end.setDate(end.getDate() - offset * 7);
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      return {
        dateList: buildDateRange(start, end),
        label: `${formatFullDate(start)} – ${formatShortDate(toDateString(end))}`,
        totalSlots: 7,
      };
    }
    if (logAnalysisPeriod === 30) {
      const offset = logAnalysisOffsets[30];
      const anchor = new Date(today.getFullYear(), today.getMonth() - offset, 1);
      const daysInMonth = getDaysInMonth(
        anchor.getFullYear(),
        anchor.getMonth(),
      );
      const end = offset === 0
        ? today
        : new Date(anchor.getFullYear(), anchor.getMonth(), daysInMonth);
      return {
        dateList: buildDateRange(anchor, end),
        label: formatMonth(anchor),
        totalSlots: LOG_ANALYSIS_MONTH_SLOTS,
      };
    }
    const offset = logAnalysisOffsets[365];
    const year = today.getFullYear() - offset;
    const start = new Date(year, 0, 1);
    const end = offset === 0 ? today : new Date(year, 11, 31);
    return {
      dateList: buildDateRange(start, end),
      label: `${year}/01 – ${year}/12`,
      totalSlots: LOG_ANALYSIS_YEAR_SLOTS,
    };
  }, [logAnalysisPeriod, logAnalysisOffsets]);

  const completedTimeByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    if (!todayState) {
      return map;
    }
    for (const log of logs) {
      if (log.date !== todayState.date || log.result !== "completed") {
        continue;
      }
      if (typeof log.endedAt !== "number" || log.endedAt <= 0) {
        continue;
      }
      map.set(log.taskId, formatTime(log.endedAt));
    }
    return map;
  }, [logs, todayState]);

  const filteredLogs = useMemo(() => {
    const query = logQuery.trim().toLowerCase();
    return last7Logs.filter((log) => {
      if (query && !log.taskName.toLowerCase().includes(query)) {
        return false;
      }
      if (logTagFilter !== ALL_TAG_FILTER) {
        if (logTagFilter === NO_TAG_LABEL) {
          return log.tags.length === 0;
        }
        return log.tags.includes(logTagFilter);
      }
      return true;
    });
  }, [last7Logs, logQuery, logTagFilter]);

  const boardTags = useMemo(() => {
    const tags = [...tagLibrary];
    const hasNoTag = filteredLogs.some((log) => log.tags.length === 0);
    if (hasNoTag && !tags.includes(NO_TAG_LABEL)) {
      tags.push(NO_TAG_LABEL);
    }
    return tags.length > 0 ? tags : [NO_TAG_LABEL];
  }, [tagLibrary, filteredLogs]);

  const logAnalysisTotals = useMemo(
    () =>
      buildDailyTotalsForDates(
        logs,
        logAnalysisRange.dateList,
        logAnalysisTag,
      ),
    [logs, logAnalysisRange.dateList, logAnalysisTag],
  );

  const logAnalysisScaleMax = useMemo(() => {
    let max = 0;
    for (const item of logAnalysisTotals) {
      max = Math.max(max, item.minutes);
    }
    return max > 0 ? max : 1;
  }, [logAnalysisTotals]);

  const logAnalysisDisplayMax = useMemo(() => {
    let max = 0;
    for (const item of logAnalysisTotals) {
      max = Math.max(max, item.minutes);
    }
    return max;
  }, [logAnalysisTotals]);

  const logAnalysisLabelEvery = useMemo(() => {
    if (logAnalysisPeriod === 7) {
      return 1;
    }
    if (logAnalysisPeriod === 30) {
      return 5;
    }
    return 999;
  }, [logAnalysisPeriod]);

  const logAnalysisChartBaseWidth = useMemo(() => {
    if (logAnalysisRange.totalSlots <= 1) {
      return 0;
    }
    return (logAnalysisRange.totalSlots - 1) * LOG_ANALYSIS_POINT_GAP;
  }, [logAnalysisRange.totalSlots]);

  const logAnalysisChartWidth = useMemo(
    () => Math.max(logAnalysisWidth, logAnalysisChartBaseWidth),
    [logAnalysisWidth, logAnalysisChartBaseWidth],
  );

  const logAnalysisStep = useMemo(() => {
    if (logAnalysisRange.totalSlots <= 1) {
      return 0;
    }
    return logAnalysisChartWidth / (logAnalysisRange.totalSlots - 1);
  }, [logAnalysisChartWidth, logAnalysisRange.totalSlots]);

  const logAnalysisOffsetX = useMemo(() => {
    if (logAnalysisTotals.length <= 1) {
      return Math.max(0, logAnalysisChartWidth / 2);
    }
    const plotWidth = (logAnalysisTotals.length - 1) * logAnalysisStep;
    return Math.max(0, (logAnalysisChartWidth - plotWidth) / 2);
  }, [logAnalysisTotals.length, logAnalysisStep, logAnalysisChartWidth]);

  const logAnalysisPoints = useMemo(() => {
    return logAnalysisTotals.map((item, index) => {
      const x = logAnalysisOffsetX + index * logAnalysisStep;
      const y =
        logAnalysisChartHeight -
        (item.minutes / logAnalysisScaleMax) * logAnalysisChartHeight;
      return { x, y, date: item.date, minutes: item.minutes };
    });
  }, [
    logAnalysisTotals,
    logAnalysisOffsetX,
    logAnalysisStep,
    logAnalysisChartHeight,
    logAnalysisScaleMax,
  ]);

  const logAnalysisAxisLabels = useMemo(() => {
    const labels: Array<{ label: string; x: number }> = [];
    logAnalysisTotals.forEach((item, index) => {
      const isYearLabel = logAnalysisPeriod === 365 && item.date.endsWith("-01");
      const isPeriodicLabel =
        logAnalysisPeriod !== 365 && index % logAnalysisLabelEvery === 0;
      const isLastLabel = index === logAnalysisTotals.length - 1;
      if (!isYearLabel && !isPeriodicLabel && !isLastLabel) {
        return;
      }
      const label =
        logAnalysisPeriod === 365
          ? formatMonthLabel(item.date)
          : formatShortDate(item.date);
      labels.push({ label, x: logAnalysisOffsetX + index * logAnalysisStep });
    });
    return labels;
  }, [
    logAnalysisTotals,
    logAnalysisPeriod,
    logAnalysisLabelEvery,
    logAnalysisOffsetX,
    logAnalysisStep,
  ]);

  const logAnalysisCanNext = logAnalysisOffsets[logAnalysisPeriod] > 0;

  useEffect(() => {
    if (screen !== "logs") {
      return;
    }
    const frame = requestAnimationFrame(() => {
      logScrollRef.current?.scrollTo({
        x: logScrollOffset.current.x,
        y: logScrollOffset.current.y,
        animated: false,
      });
      if (!isLandscape) {
        if (logView === "table") {
          logTableScrollRef.current?.scrollTo({
            x: logTableScrollOffset.current.x,
            y: 0,
            animated: false,
          });
        } else {
          logBoardScrollRef.current?.scrollTo({
            x: logBoardScrollOffset.current.x,
            y: 0,
            animated: false,
          });
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [screen, isLandscape, logView]);

  if (!todayState) {
    return <SafeAreaView style={styles.container} />;
  }

  // 選択モード中は編集対象が曖昧になるため操作を無効化する
  const footerDisabled = selectionMode || !activeInfo;

  return (
    <SafeAreaView style={styles.container}>
      {screen === "today" ? (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: FOOTER_HEIGHT + 16 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <MenuButton onPress={() => setMenuOpen(true)} />
            </View>
            <Text style={styles.headerTitle}>{selectedDate}</Text>
            <View style={styles.headerRight}>
              <Pressable style={styles.calendarButton} onPress={openDatePicker}>
                <Ionicons name="calendar-outline" size={18} color="#111827" />
              </Pressable>
              {selectionMode ? (
                <Pressable
                  style={styles.exitSelectionButton}
                  onPress={exitSelectionMode}
                >
                  <Text style={styles.exitSelectionButtonText}>選択終了</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          {selectionMode && (
            <View style={styles.selectionBar}>
              <Text style={styles.selectionText}>
                {`選択中: ${selectedTaskIds.length}`}
              </Text>
              <Pressable
                style={[
                  styles.bulkDeleteButton,
                  selectedTaskIds.length === 0 && styles.bulkDeleteButtonDisabled,
                ]}
                onPress={confirmDeleteSelected}
                disabled={selectedTaskIds.length === 0}
              >
                <Text style={styles.bulkDeleteButtonText}>一括削除</Text>
              </Pressable>
            </View>
          )}
          {SLOT_KEYS.map((key) => {
            const slot = todayState.slots[key];
            const visibleTasks = slot.tasks.filter((task) => !task.isArchived);
            const activeTasks = visibleTasks.filter(
              (task) => task.status !== "DONE",
            );
            const completedTasks = visibleTasks.filter(
              (task) => task.status === "DONE",
            );
            const completedExpanded = completedExpandedBySlot[key];
            const incompleteEstimate =
              sumEstimateMinutesIncomplete(visibleTasks);
            const totalEstimate = sumEstimateMinutesAll(visibleTasks);
            const capacityMinutes = getCapacityMinutes(timeBoxSchedule, key);
            const overflow = Math.max(0, incompleteEstimate - capacityMinutes);
            const remainingMinutes = Math.max(
              0,
              capacityMinutes - incompleteEstimate,
            );
            return (
              <View key={key} style={styles.slotBox}>
                <View style={styles.slotHeader}>
                  <Pressable
                    style={styles.slotHeaderLeftToggle}
                    onPress={() => toggleActiveSection(key)}
                    hitSlop={8}
                  >
                    <Text style={styles.slotChevron}>
                      {activeExpandedBySlot[key] ? "▼" : "▶︎"}
                    </Text>
                    <Text style={styles.slotTitle}>{SLOT_LABELS[key]}</Text>
                  </Pressable>
                  <View style={styles.slotHeaderRight}>
                    <View style={styles.slotSummaryBox}>
                      <Text
                        style={[
                          styles.slotSummary,
                          overflow > 0 && styles.slotSummaryWarning,
                        ]}
                      >{`残り: ${overflow > 0 ? 0 : remainingMinutes}分${
                        overflow > 0 ? `（超過 +${overflow}分）` : ""
                      }`}</Text>
                      <Text
                        style={styles.slotSummary}
                      >{`合計: ${totalEstimate}分`}</Text>
                    </View>
                    <Pressable
                      style={styles.addButton}
                      onPress={() => handleAddTask(key)}
                    >
                      <Text style={styles.addButtonText}>+</Text>
                    </Pressable>
                  </View>
                </View>
                {activeExpandedBySlot[key] &&
                  activeTasks.map((task, index) => {
                  const palette = statusPalette[task.status];
                  const isDone = task.status === "DONE";
                  return (
                    <View key={task.id} style={styles.taskBox}>
                      <View style={styles.taskHeaderRow}>
                        <View
                          style={[
                            styles.statusBar,
                            { backgroundColor: palette.bar },
                          ]}
                        />
                        <View style={styles.taskHeaderBody}>
                          {selectionMode && (
                            <Pressable
                              style={styles.checkbox}
                              onPress={() => toggleSelection(task.id)}
                            >
                              <Text style={styles.checkboxText}>
                                {selectedSet.has(task.id) ? "[x]" : "[ ]"}
                              </Text>
                            </Pressable>
                          )}
                          <Pressable
                            style={[
                              styles.taskHeaderPressable,
                              task.id === activeTaskId &&
                                !selectionMode &&
                                styles.taskHeaderActive,
                            ]}
                            onPress={() =>
                              selectionMode
                                ? toggleSelection(task.id)
                                : setActiveTaskId(task.id)
                            }
                          >
                            <View style={styles.taskHeaderContent}>
                              <Text
                                style={[
                                  styles.taskHeaderTitle,
                                  isDone && styles.taskHeaderTitleDone,
                                ]}
                              >
                                {task.taskName || "未設定"}
                              </Text>
                              <Text
                                style={[
                                  styles.taskHeaderMeta,
                                  isDone && styles.taskHeaderMetaDone,
                                ]}
                              >
                                {task.tags.length > 0
                                  ? task.tags.join(", ")
                                  : NO_TAG_LABEL}
                              </Text>
                            </View>
                          </Pressable>
                          <View
                            style={[
                              styles.statusBadge,
                              { backgroundColor: palette.badgeBg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusBadgeText,
                                { color: palette.badgeText },
                              ]}
                            >
                              {statusLabel[task.status]}
                            </Text>
                          </View>
                          <View style={styles.taskActions}>
                            {task.status !== "DONE" && (
                              <Pressable
                                style={styles.deleteButton}
                                onPress={() => confirmDeleteTask(task.id)}
                              >
                                <Text style={styles.deleteButtonText}>🗑</Text>
                              </Pressable>
                            )}
                            {task.status !== "DONE" && (
                              <Pressable
                                style={styles.deleteButton}
                                onPress={() => openMoveModal(key, task.id)}
                              >
                                <Text style={styles.deleteButtonText}>移動</Text>
                              </Pressable>
                            )}
                            {!selectionMode && (
                              <Pressable
                                style={[styles.deleteButton, styles.archiveButton]}
                                onPress={() => confirmArchiveTask(key, task.id)}
                              >
                                <Text style={styles.deleteButtonText}>📦</Text>
                              </Pressable>
                            )}
                          </View>
                        </View>
                      </View>
                      {task.id === activeTaskId && !selectionMode && (
                        <View
                          style={styles.taskDetails}
                          {...swipeResponder.panHandlers}
                        >
                          <View style={styles.taskNavRow}>
                            <Text style={styles.taskTitle}>{`タスク${index + 1}`}</Text>
                            <View style={styles.navButtons}>
                              <Pressable
                                style={[
                                  styles.navButton,
                                  !canMovePrev && styles.navButtonDisabled,
                                ]}
                                onPress={() => moveActive("prev")}
                                disabled={!canMovePrev}
                              >
                                <Text style={styles.navButtonText}>↑</Text>
                              </Pressable>
                              <Pressable
                                style={[
                                  styles.navButton,
                                  !canMoveNext && styles.navButtonDisabled,
                                ]}
                                onPress={() => moveActive("next")}
                                disabled={!canMoveNext}
                              >
                                <Text style={styles.navButtonText}>↓</Text>
                              </Pressable>
                            </View>
                          </View>
                          <TextInput
                            style={styles.input}
                            placeholder="タスク名"
                            value={task.taskName}
                            onChangeText={(text) =>
                              updateTask(key, task.id, (prev) => ({
                                ...prev,
                                taskName: text,
                              }))
                            }
                          />
                          <View style={styles.row}>
                            <Text style={styles.label}>タグ</Text>
                            <View style={styles.tagDropdown}>
                              <Pressable
                                style={styles.tagDropdownButton}
                                onPress={() =>
                                  setTagDropdownTaskId(
                                    tagDropdownTaskId === task.id ? null : task.id,
                                  )
                                }
                              >
                                <Text style={styles.tagDropdownText}>
                                  {task.tags.length > 0
                                    ? task.tags.join(", ")
                                    : "タグを選択"}
                                </Text>
                              </Pressable>
                              {tagDropdownTaskId === task.id && (
                                <View style={styles.tagDropdownList}>
                                  {tagOptions.map((tag) => {
                                    const selected = task.tags.includes(tag);
                                    return (
                                      <Pressable
                                        key={tag}
                                        style={styles.tagDropdownItem}
                                        onPress={() => {
                                          toggleTaskTag(key, task.id, tag);
                                          setTagDropdownTaskId(null);
                                        }}
                                      >
                                        <Text
                                          style={[
                                            styles.tagDropdownItemText,
                                            selected &&
                                              styles.tagDropdownItemTextSelected,
                                          ]}
                                        >
                                          {tag}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          </View>
                          <View style={styles.row}>
                            <Text style={styles.label}>予測(分)</Text>
                            <TextInput
                              style={styles.inputInline}
                              keyboardType="number-pad"
                              value={String(task.estimateMinutes)}
                              onChangeText={(text) =>
                                updateTask(key, task.id, (prev) => ({
                                  ...prev,
                                  estimateMinutes: parseMinutes(text),
                                }))
                              }
                            />
                          </View>
                          <TaskDetailScreen
                            taskId={task.id}
                            onSearchToken={openSearch}
                          />
                        </View>
                      )}
                    </View>
                  );
                })}
                <View style={styles.completedSection}>
                  <Pressable
                    style={styles.completedToggleRow}
                    onPress={() =>
                      setCompletedExpandedBySlot((prev) => ({
                        ...prev,
                        [key]: !prev[key],
                      }))
                    }
                  >
                    <Text style={styles.completedToggleText}>
                      {`完了（${completedTasks.length}）${
                        completedExpanded ? "▼" : "▶︎"
                      }`}
                    </Text>
                  </Pressable>
                  {completedExpanded &&
                    (completedTasks.length === 0 ? (
                      <Text style={styles.completedEmptyText}>
                        完了タスクはありません
                      </Text>
                    ) : (
                      completedTasks.map((task) => {
                        const palette = statusPalette[task.status];
                        const completedTime = completedTimeByTaskId.get(task.id);
                        return (
                          <View key={task.id} style={styles.completedTaskRow}>
                            <View
                              style={[
                                styles.statusBar,
                                { backgroundColor: palette.bar },
                              ]}
                            />
                            <View style={styles.completedTaskBody}>
                              <View style={styles.completedTaskContent}>
                                <Text style={styles.completedTaskTitle}>
                                  {task.taskName || "未設定"}
                                </Text>
                                {completedTime && (
                                  <Text style={styles.completedTaskTime}>
                                    {`完了 ${completedTime}`}
                                  </Text>
                                )}
                              </View>
                              {!selectionMode && (
                                <Pressable
                                  style={[
                                    styles.deleteButton,
                                    styles.archiveButton,
                                  ]}
                                  onPress={() => confirmArchiveTask(key, task.id)}
                                >
                                  <Text style={styles.deleteButtonText}>📦</Text>
                                </Pressable>
                              )}
                            </View>
                          </View>
                        );
                      })
                    ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : screen === "logs" ? (
        <ScrollView
          ref={logScrollRef}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
          onScroll={(event) => {
            logScrollOffset.current = event.nativeEvent.contentOffset;
          }}
          scrollEventThrottle={16}
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <MenuButton onPress={() => setMenuOpen(true)} />
              <Pressable style={styles.backButton} onPress={() => setScreen("today")}>
                <Text style={styles.linkText}>戻る</Text>
              </Pressable>
            </View>
            <Text style={styles.headerTitle}>Logs</Text>
            <View style={styles.headerRight} />
          </View>
          <View style={styles.logAnalysisPanel}>
            <Pressable
              style={styles.logAnalysisHeader}
              onPress={() => setLogAnalysisCollapsed((prev) => !prev)}
            >
              <Text style={styles.logAnalysisTitle}>分析パネル</Text>
              <Text style={styles.logAnalysisToggle}>
                {logAnalysisCollapsed ? "▶︎" : "▼"}
              </Text>
            </Pressable>
            {!logAnalysisCollapsed && (
              <>
                <View style={styles.logAnalysisPeriodRow}>
                  {[7, 30, 365].map((period) => (
                    <Pressable
                      key={period}
                      style={[
                        styles.logAnalysisChip,
                        logAnalysisPeriod === period && styles.logAnalysisChipActive,
                      ]}
                      onPress={() =>
                        setLogAnalysisPeriod(period as 7 | 30 | 365)
                      }
                    >
                      <Text
                        style={[
                          styles.logAnalysisChipText,
                          logAnalysisPeriod === period &&
                            styles.logAnalysisChipTextActive,
                        ]}
                      >
                        {period === 7 ? "7日" : period === 30 ? "1ヶ月" : "1年"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.logAnalysisRangeRow}>
                  <Pressable
                    style={styles.logAnalysisNavButton}
                    onPress={() =>
                      setLogAnalysisOffsets((prev) => ({
                        ...prev,
                        [logAnalysisPeriod]: prev[logAnalysisPeriod] + 1,
                      }))
                    }
                  >
                    <Text style={styles.logAnalysisNavText}>◀︎</Text>
                  </Pressable>
                  <Text style={styles.logAnalysisRangeText}>
                    {logAnalysisRange.label}
                  </Text>
                  <Pressable
                    style={[
                      styles.logAnalysisNavButton,
                      !logAnalysisCanNext && styles.logAnalysisNavButtonDisabled,
                    ]}
                    onPress={() =>
                      logAnalysisCanNext &&
                      setLogAnalysisOffsets((prev) => ({
                        ...prev,
                        [logAnalysisPeriod]: Math.max(
                          0,
                          prev[logAnalysisPeriod] - 1,
                        ),
                      }))
                    }
                    disabled={!logAnalysisCanNext}
                  >
                    <Text
                      style={[
                        styles.logAnalysisNavText,
                        !logAnalysisCanNext && styles.logAnalysisNavTextDisabled,
                      ]}
                    >
                      ▶︎
                    </Text>
                  </Pressable>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.logAnalysisTagRow}
                >
                  {logAnalysisTagOptions.map((tag) => (
                    <Pressable
                      key={tag}
                      style={[
                        styles.logAnalysisChip,
                        logAnalysisTag === tag && styles.logAnalysisChipActive,
                      ]}
                      onPress={() => setLogAnalysisTag(tag)}
                    >
                      <Text
                        style={[
                          styles.logAnalysisChipText,
                          logAnalysisTag === tag &&
                            styles.logAnalysisChipTextActive,
                        ]}
                      >
                        {tag}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View
                  style={styles.logAnalysisChartContainer}
                  onLayout={(event) => {
                    const nextWidth = event.nativeEvent.layout.width;
                    if (nextWidth !== logAnalysisWidth) {
                      setLogAnalysisWidth(nextWidth);
                    }
                  }}
                >
                  <ScrollView
                    horizontal={logAnalysisChartWidth > logAnalysisWidth}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.logAnalysisChartScroll}
                  >
                    <View style={styles.logAnalysisChart}>
                      <Svg
                        width={logAnalysisChartWidth}
                        height={logAnalysisChartHeight}
                      >
                        <Line
                          x1={0}
                          y1={logAnalysisChartHeight}
                          x2={logAnalysisChartWidth}
                          y2={logAnalysisChartHeight}
                          stroke="#e5e7eb"
                          strokeWidth={1}
                        />
                        {logAnalysisPoints.length > 1 && (
                          <Polyline
                            points={logAnalysisPoints
                              .map((point) => `${point.x},${point.y}`)
                              .join(" ")}
                            fill="none"
                            stroke="#111827"
                            strokeWidth={2}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                        )}
                        {logAnalysisPeriod !== 365 &&
                          logAnalysisPoints.map((point) => (
                            <Circle
                              key={`marker-${point.date}`}
                              cx={point.x}
                              cy={point.y}
                              r={logAnalysisPeriod === 7 ? 2.4 : 1.8}
                              fill="#111827"
                            />
                          ))}
                      </Svg>
                      <View
                        style={[
                          styles.logAnalysisAxisRow,
                          { width: logAnalysisChartWidth },
                        ]}
                      >
                        {logAnalysisAxisLabels.map((item) => (
                          <Text
                            key={`label-${item.label}-${item.x}`}
                            style={[
                              styles.logAnalysisAxisLabel,
                              {
                                left: Math.max(
                                  0,
                                  Math.min(
                                    logAnalysisChartWidth - 34,
                                    Math.max(0, item.x - 17),
                                  ),
                                ),
                              },
                            ]}
                          >
                            {item.label}
                          </Text>
                        ))}
                      </View>
                    </View>
                  </ScrollView>
                </View>
                <Text style={styles.logAnalysisHint}>
                  {`最大 ${formatMinutes(logAnalysisDisplayMax)}m`}
                </Text>
              </>
            )}
          </View>
          <View style={styles.logControls}>
            {!isLandscape && (
              <View style={styles.viewToggleRow}>
                <Pressable
                  style={[
                    styles.viewToggleButton,
                    logView === "table" && styles.viewToggleButtonActive,
                  ]}
                  onPress={() => setLogView("table")}
                >
                  <Text
                    style={[
                      styles.viewToggleText,
                      logView === "table" && styles.viewToggleTextActive,
                    ]}
                  >
                    表
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.viewToggleButton,
                    logView === "board" && styles.viewToggleButtonActive,
                  ]}
                  onPress={() => setLogView("board")}
                >
                  <Text
                    style={[
                      styles.viewToggleText,
                      logView === "board" && styles.viewToggleTextActive,
                    ]}
                  >
                    ボード
                  </Text>
                </Pressable>
              </View>
            )}
            <TextInput
              style={styles.logSearchInput}
              placeholder="タスク名で検索"
              value={logQuery}
              onChangeText={setLogQuery}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {tagFilterOptions.map((tag) => (
                <Pressable
                  key={tag}
                  style={[
                    styles.filterChip,
                    logTagFilter === tag && styles.filterChipActive,
                  ]}
                  onPress={() => setLogTagFilter(tag)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      logTagFilter === tag && styles.filterChipTextActive,
                    ]}
                  >
                    {tag}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          {isLandscape ? (
            <LandscapeLogView logs={filteredLogs} />
          ) : logView === "table" ? (
            <ScrollView
              ref={logTableScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              onScroll={(event) => {
                logTableScrollOffset.current = event.nativeEvent.contentOffset;
              }}
              scrollEventThrottle={16}
            >
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeaderRow]}>
                  <Text style={[styles.tableCell, styles.tableCellDate]}>
                    日付
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellTitle]}>
                    タスク
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellTag]}>タグ</Text>
                  <Text style={[styles.tableCell, styles.tableCellNumber]}>
                    予測
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellNumber]}>
                    実績
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellNumber]}>
                    差分
                  </Text>
                </View>
                {filteredLogs.map((log) => {
                  const diff = round1(log.actualMinutes - log.estimateMinutes);
                  const diffColor =
                    diff > 0 ? "#dc2626" : diff < 0 ? "#2563eb" : "#6b7280";
                  return (
                    <View key={log.id} style={styles.tableRow}>
                      <Text style={[styles.tableCell, styles.tableCellDate]}>
                        {log.date}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableCellTitle]}>
                        {log.taskName || "未設定"}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableCellTag]}>
                        {log.tags.length > 0
                          ? log.tags.join(", ")
                          : NO_TAG_LABEL}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableCellNumber]}>
                        {formatMinutes(log.estimateMinutes)}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableCellNumber]}>
                        {formatMinutes(log.actualMinutes)}
                      </Text>
                      <Text
                        style={[
                          styles.tableCell,
                          styles.tableCellNumber,
                          { color: diffColor },
                        ]}
                      >
                        {diffLabel(diff)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            <ScrollView
              ref={logBoardScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              onScroll={(event) => {
                logBoardScrollOffset.current = event.nativeEvent.contentOffset;
              }}
              scrollEventThrottle={16}
            >
              <View style={styles.boardRow}>
                {boardTags.map((tag) => {
                  const columnLogs =
                    tag === NO_TAG_LABEL
                      ? filteredLogs.filter((log) => log.tags.length === 0)
                      : filteredLogs.filter((log) => log.tags.includes(tag));
                  return (
                    <View key={tag} style={styles.boardColumn}>
                      <Text style={styles.boardColumnTitle}>{tag}</Text>
                      {columnLogs.map((log) => {
                        const diff = round1(
                          log.actualMinutes - log.estimateMinutes,
                        );
                        const diffColor =
                          diff > 0 ? "#dc2626" : diff < 0 ? "#2563eb" : "#6b7280";
                        return (
                          <View key={log.id} style={styles.boardCard}>
                            <Text style={styles.boardCardTitle}>
                              {log.taskName || "未設定"}
                            </Text>
                            <Text style={styles.boardCardMeta}>{log.date}</Text>
                            <Text style={styles.boardCardMeta}>
                              {`予測 ${formatMinutes(
                                log.estimateMinutes,
                              )}m / 実績 ${formatMinutes(
                                log.actualMinutes,
                              )}m`}
                            </Text>
                            <Text style={[styles.boardCardMeta, { color: diffColor }]}>
                              {`差分 ${diffLabel(diff)}m`}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </ScrollView>
      ) : screen === "timeSettings" ? (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <MenuButton onPress={() => setMenuOpen(true)} />
              <Pressable
                style={styles.backButton}
                onPress={handleCancelTimeBoxSchedule}
              >
                <Text style={styles.linkText}>戻る</Text>
              </Pressable>
            </View>
            <Text style={styles.headerTitle}>タイムボックス時間設定</Text>
            <View style={styles.headerRight}>
              <Pressable onPress={handleSaveTimeBoxSchedule}>
                <Text style={styles.linkText}>保存</Text>
              </Pressable>
            </View>
          </View>
          {timeBoxError && (
            <Text style={styles.errorText}>{timeBoxError}</Text>
          )}
          <View style={styles.timeBoxList}>
            {SLOT_KEYS.map((key) => {
              const isExpanded = expandedTimeBoxes[key];
              const slotTasks = todayState.slots[key].tasks.filter(
                (task) => !task.isArchived,
              );
              return (
                <View key={key} style={styles.timeBoxSection}>
                  <Pressable
                    style={styles.timeBoxHeader}
                    onPress={() => toggleTimeBoxSection(key)}
                  >
                    <Text style={styles.timeBoxChevron}>
                      {isExpanded ? "▼" : "▶︎"}
                    </Text>
                    <View style={styles.timeBoxHeaderBody}>
                      <Text style={styles.timeBoxTitle}>{SLOT_LABELS[key]}</Text>
                      <Text style={styles.timeBoxTime}>
                        {`${timeBoxDraft[key].start} - ${timeBoxDraft[key].end}`}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={styles.scheduleRow}>
                    <Text style={styles.scheduleLabel}>{SLOT_LABELS[key]}</Text>
                    <View style={styles.scheduleInputs}>
                      <TextInput
                        style={styles.scheduleInput}
                        value={timeBoxDraft[key].start}
                        onChangeText={(text) =>
                          updateTimeBoxDraft(key, "start", text)
                        }
                        placeholder="HH:MM"
                        keyboardType="numbers-and-punctuation"
                        maxLength={5}
                      />
                      <Text style={styles.scheduleSeparator}>-</Text>
                      <TextInput
                        style={styles.scheduleInput}
                        value={timeBoxDraft[key].end}
                        onChangeText={(text) =>
                          updateTimeBoxDraft(key, "end", text)
                        }
                        placeholder="HH:MM"
                        keyboardType="numbers-and-punctuation"
                        maxLength={5}
                      />
                    </View>
                  </View>
                  {isExpanded && (
                    <View style={styles.timeBoxTasks}>
                      {slotTasks.length === 0 ? (
                        <Text style={styles.timeBoxEmpty}>
                          タスクはありません
                        </Text>
                      ) : (
                        slotTasks.map((task) => (
                          <Pressable
                            key={task.id}
                            style={styles.timeBoxTaskRow}
                            onPress={() => openTaskFromTimeBox(task.id)}
                          >
                            <Text style={styles.timeBoxTaskText}>
                              {task.taskName || "未設定"}
                            </Text>
                          </Pressable>
                        ))
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          <Pressable
            style={styles.resetButton}
            onPress={handleResetTimeBoxSchedule}
          >
            <Text style={styles.resetButtonText}>初期値に戻す</Text>
          </Pressable>
        </ScrollView>
      ) : screen === "memos" ? (
        <MemosScreen
          onBack={() => setScreen("today")}
          onOpenMenu={() => setMenuOpen(true)}
        />
      ) : screen === "notes" ? (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <MenuButton onPress={() => setMenuOpen(true)} />
              <Pressable style={styles.backButton} onPress={() => setScreen("today")}>
                <Text style={styles.linkText}>戻る</Text>
              </Pressable>
            </View>
            <Text style={styles.headerTitle}>メモ（ノート）</Text>
            <View style={styles.headerRight} />
          </View>
          <View style={styles.notesTabRow}>
            <Pressable
              style={[
                styles.notesTabButton,
                notesTab === "daily" && styles.notesTabActive,
              ]}
              onPress={() => setNotesTab("daily")}
            >
              <Text
                style={[
                  styles.notesTabText,
                  notesTab === "daily" && styles.notesTabTextActive,
                ]}
              >
                Daily
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.notesTabButton,
                notesTab === "free" && styles.notesTabActive,
              ]}
              onPress={() => setNotesTab("free")}
            >
              <Text
                style={[
                  styles.notesTabText,
                  notesTab === "free" && styles.notesTabTextActive,
                ]}
              >
                Free
              </Text>
            </Pressable>
          </View>
          {notesTab === "daily" ? (
            <View style={styles.noteSection}>
              <View style={styles.noteDateRow}>
                <Text style={styles.noteDateText}>{selectedDate}</Text>
                <Pressable onPress={openDatePicker}>
                  <Text style={styles.linkText}>日付変更</Text>
                </Pressable>
              </View>
              {dailyNoteLoading ? (
                <Text style={styles.helperText}>読み込み中...</Text>
              ) : (
                <>
                  <HighlightEditor
                    value={dailyNoteBody}
                    onChangeText={setDailyNoteBody}
                    placeholder="日記を書く"
                    textStyle={styles.noteBodyInput}
                    linkStyle={styles.noteLink}
                  />
                  <Pressable
                    style={[
                      styles.noteSaveButton,
                      dailyNoteSaving && styles.noteSaveButtonDisabled,
                    ]}
                    onPress={handleSaveDailyNote}
                    disabled={dailyNoteSaving}
                  >
                    <Text style={styles.noteSaveButtonText}>
                      {dailyNoteSaving ? "保存中" : "保存"}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : (
            <View style={styles.noteSection}>
              <Pressable style={styles.noteNewButton} onPress={handleNewFreeNote}>
                <Text style={styles.noteNewButtonText}>新規作成</Text>
              </Pressable>
              {freeNoteLoading ? (
                <Text style={styles.helperText}>読み込み中...</Text>
              ) : freeNotes.length === 0 ? (
                <Text style={styles.helperText}>ノートがありません</Text>
              ) : (
                <View style={styles.freeNoteList}>
                  {freeNotes.map((note) => (
                    <Pressable
                      key={note.id}
                      style={styles.freeNoteRow}
                      onPress={() => handleSelectFreeNote(note.id)}
                    >
                      <Text style={styles.freeNoteTitle}>
                        {note.title?.trim() || "無題"}
                      </Text>
                      <Text style={styles.freeNoteMeta}>
                        {formatDateTime(note.updatedAt)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={styles.noteEditor}>
                <TextInput
                  style={styles.noteTitleInput}
                  placeholder="タイトル（任意）"
                  value={freeNoteDraft.title}
                  onChangeText={(text) =>
                    setFreeNoteDraft((prev) => ({ ...prev, title: text }))
                  }
                />
                <HighlightEditor
                  value={freeNoteDraft.body}
                  onChangeText={(text) =>
                    setFreeNoteDraft((prev) => ({ ...prev, body: text }))
                  }
                  placeholder="本文"
                  textStyle={styles.noteBodyInput}
                  linkStyle={styles.noteLink}
                />
                <Pressable
                  style={[
                    styles.noteSaveButton,
                    freeNoteSaving && styles.noteSaveButtonDisabled,
                  ]}
                  onPress={handleSaveFreeNote}
                  disabled={freeNoteSaving}
                >
                  <Text style={styles.noteSaveButtonText}>
                    {freeNoteSaving ? "保存中" : "保存"}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      ) : screen === "tags" ? (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <MenuButton onPress={() => setMenuOpen(true)} />
              <Pressable style={styles.backButton} onPress={() => setScreen("today")}>
                <Text style={styles.linkText}>戻る</Text>
              </Pressable>
            </View>
            <Text style={styles.headerTitle}>タグアーカイブ</Text>
            <View style={styles.headerRight} />
          </View>
          <View style={styles.tagLibraryBox}>
            <Text style={styles.sectionTitle}>タグ一覧</Text>
            {tagLibrary.length === 0 ? (
              <Text style={styles.mutedText}>タグがありません</Text>
            ) : (
              tagLibrary.map((tag) => (
                <View key={tag} style={styles.tagRow}>
                  {editingTag === tag ? (
                    <>
                      <TextInput
                        style={styles.tagEditInput}
                        value={editingTagDraft}
                        onChangeText={setEditingTagDraft}
                      />
                      <Pressable
                        style={styles.tagActionButton}
                        onPress={handleSaveEditTag}
                      >
                        <Text style={styles.tagActionText}>保存</Text>
                      </Pressable>
                      <Pressable
                        style={styles.tagActionButton}
                        onPress={handleCancelEditTag}
                      >
                        <Text style={styles.tagActionText}>キャンセル</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Text style={styles.tagName}>{tag}</Text>
                      <Pressable
                        style={styles.tagActionButton}
                        onPress={() => handleStartEditTag(tag)}
                      >
                        <Text style={styles.tagActionText}>編集</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.tagActionButton, styles.tagDeleteButton]}
                        onPress={() => confirmDeleteTag(tag)}
                      >
                        <Text style={styles.tagDeleteText}>削除</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              ))
            )}
            <View style={styles.tagAddRow}>
              <TextInput
                style={styles.tagAddInput}
                placeholder="新しいタグ"
                value={tagDraft}
                onChangeText={setTagDraft}
              />
              <Pressable style={styles.tagActionButton} onPress={handleAddTag}>
                <Text style={styles.tagActionText}>追加</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <MenuButton onPress={() => setMenuOpen(true)} />
              <Pressable style={styles.backButton} onPress={() => setScreen("today")}>
                <Text style={styles.linkText}>戻る</Text>
              </Pressable>
            </View>
            <Text style={styles.headerTitle}>アーカイブ</Text>
            <View style={styles.headerRight} />
          </View>
          <View style={styles.archiveBox}>
            {archivedTasks.length === 0 ? (
              <Text style={styles.mutedText}>
                アーカイブにタスクはありません
              </Text>
            ) : (
              archivedTasks.map((item) => (
                <View key={item.task.id} style={styles.archiveRow}>
                  <View style={styles.archiveContent}>
                    <Text style={styles.archiveTitle}>
                      {item.task.taskName || "未設定"}
                    </Text>
                    <Text style={styles.archiveMeta}>
                      {`${SLOT_LABELS[item.slotKey]} / ${
                        statusLabel[item.task.status]
                      }`}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.archiveActionButton}
                    onPress={() => promptRestoreTask(item.task.id)}
                  >
                    <Text style={styles.archiveActionText}>戻す</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
      {screen === "today" && (
        <View style={styles.footer}>
          <ActionButton
            label="実行"
            onPress={() =>
              activeInfo && handleStart(activeInfo.slotKey, activeInfo.task.id)
            }
            disabled={footerDisabled}
          />
          <ActionButton
            label="中断"
            onPress={() =>
              activeInfo && handlePause(activeInfo.slotKey, activeInfo.task.id)
            }
            disabled={footerDisabled}
          />
          <ActionButton
            label="完了"
            onPress={() =>
              activeInfo &&
              handleStop(activeInfo.slotKey, activeInfo.task.id, "completed")
            }
            disabled={footerDisabled}
          />
          <ActionButton
            label="未達で終了"
            onPress={() =>
              activeInfo &&
              handleStop(activeInfo.slotKey, activeInfo.task.id, "failed")
            }
            disabled={footerDisabled}
          />
        </View>
      )}
      <Modal
        transparent
        visible={datePickerOpen}
        animationType="fade"
        onRequestClose={closeDatePicker}
      >
        <View style={styles.dateOverlay}>
          <Pressable style={styles.dateBackdrop} onPress={closeDatePicker} />
          <View style={styles.datePanel}>
            <Text style={styles.dateTitle}>日付を選択</Text>
            <View style={styles.dateShiftRow}>
              <Pressable
                style={styles.dateShiftButton}
                onPress={() => shiftDateDraft(-1)}
              >
                <Text style={styles.dateShiftText}>前日</Text>
              </Pressable>
              <Pressable
                style={styles.dateShiftButton}
                onPress={() => shiftDateDraft(1)}
              >
                <Text style={styles.dateShiftText}>翌日</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.dateInput}
              value={dateDraft}
              onChangeText={setDateDraft}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
            {dateError && <Text style={styles.errorText}>{dateError}</Text>}
            <View style={styles.dateActionRow}>
              <Pressable style={styles.dateActionButton} onPress={closeDatePicker}>
                <Text style={styles.dateActionText}>キャンセル</Text>
              </Pressable>
              <Pressable
                style={[styles.dateActionButton, styles.dateActionPrimary]}
                onPress={applyDateDraft}
              >
                <Text style={[styles.dateActionText, styles.dateActionPrimaryText]}>
                  決定
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={moveModalOpen}
        animationType="fade"
        onRequestClose={closeMoveModal}
      >
        <View style={styles.dateOverlay}>
          <Pressable style={styles.dateBackdrop} onPress={closeMoveModal} />
          <View style={styles.datePanel}>
            <Text style={styles.dateTitle}>タスクを移動</Text>
            <View style={styles.dateShiftRow}>
              <Pressable
                style={styles.dateShiftButton}
                onPress={() => shiftMoveDateDraft(-1)}
              >
                <Text style={styles.dateShiftText}>前日</Text>
              </Pressable>
              <Pressable
                style={styles.dateShiftButton}
                onPress={() => shiftMoveDateDraft(1)}
              >
                <Text style={styles.dateShiftText}>翌日</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.dateInput}
              value={moveDateDraft}
              onChangeText={setMoveDateDraft}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
            {moveDateError && <Text style={styles.errorText}>{moveDateError}</Text>}
            <View style={styles.moveSlotRow}>
              {SLOT_KEYS.map((slotKey) => {
                const active = moveTargetSlotKey === slotKey;
                return (
                  <Pressable
                    key={slotKey}
                    style={[
                      styles.moveSlotButton,
                      active && styles.moveSlotButtonActive,
                    ]}
                    onPress={() => setMoveTargetSlotKey(slotKey)}
                  >
                    <Text
                      style={[
                        styles.moveSlotText,
                        active && styles.moveSlotTextActive,
                      ]}
                    >
                      {SLOT_LABELS[slotKey]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.dateActionRow}>
              <Pressable style={styles.dateActionButton} onPress={closeMoveModal}>
                <Text style={styles.dateActionText}>キャンセル</Text>
              </Pressable>
              <Pressable
                style={[styles.dateActionButton, styles.dateActionPrimary]}
                onPress={applyMoveTask}
              >
                <Text style={[styles.dateActionText, styles.dateActionPrimaryText]}>
                  移動
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={menuOpen}
        animationType="slide"
        onRequestClose={closeMenu}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={closeMenu} />
          <View style={styles.sheetContainer} {...menuPanResponder.panHandlers}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>メニュー</Text>
            <Pressable
              style={styles.sheetItem}
              onPress={() => handleMenuNavigate("memos")}
            >
              <Text style={styles.sheetItemText}>Memo&apos;s</Text>
            </Pressable>
            <Pressable
              style={styles.sheetItem}
              onPress={() => handleMenuNavigate("notes")}
            >
              <Text style={styles.sheetItemText}>メモ（ノート）</Text>
            </Pressable>
            <Pressable
              style={styles.sheetItem}
              onPress={() => handleMenuNavigate("archive")}
            >
              <Text style={styles.sheetItemText}>アーカイブ</Text>
            </Pressable>
            <Pressable
              style={styles.sheetItem}
              onPress={() => handleMenuNavigate("timeSettings")}
            >
              <Text style={styles.sheetItemText}>タイムボックス時間設定</Text>
            </Pressable>
            <Pressable
              style={styles.sheetItem}
              onPress={() => handleMenuNavigate("tags")}
            >
              <Text style={styles.sheetItemText}>タグのアーカイブ</Text>
            </Pressable>
            <Pressable style={styles.sheetItem} onPress={handleSelectionMenu}>
              <Text style={styles.sheetItemText}>
                {selectionMode ? "選択を終了" : "タスクの選択"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.sheetItem}
              onPress={() => handleMenuNavigate("logs")}
            >
              <Text style={styles.sheetItemText}>ログの確認</Text>
            </Pressable>
            <Pressable style={styles.sheetCloseButton} onPress={closeMenu}>
              <Text style={styles.sheetCloseText}>閉じる</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <MemoSearchModal
        visible={memoSearchOpen}
        onClose={() => setMemoSearchOpen(false)}
        initialQuery={searchQuery}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    padding: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  headerLeft: {
    width: 120,
    flexDirection: "row",
    alignItems: "center",
  },
  headerRight: {
    width: 120,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
  },
  menuButton: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  backButton: {
    marginLeft: 6,
  },
  calendarButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginRight: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
  },
  selectionText: {
    fontSize: 12,
    color: "#111827",
  },
  bulkDeleteButton: {
    borderWidth: 1,
    borderColor: "#dc2626",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  bulkDeleteButtonDisabled: {
    borderColor: "#fca5a5",
    opacity: 0.5,
  },
  bulkDeleteButtonText: {
    fontSize: 12,
    color: "#dc2626",
  },
  tagLibraryBox: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  tagName: {
    flex: 1,
    fontSize: 12,
    color: "#111827",
  },
  tagActionButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 6,
  },
  tagActionText: {
    fontSize: 12,
    color: "#111827",
  },
  tagDeleteButton: {
    borderColor: "#dc2626",
  },
  tagDeleteText: {
    fontSize: 12,
    color: "#dc2626",
  },
  tagAddRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  tagAddInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    padding: 6,
  },
  tagEditInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    padding: 6,
  },
  mutedText: {
    fontSize: 12,
    color: "#6b7280",
  },
  helperText: {
    fontSize: 12,
    color: "#6b7280",
  },
  linkText: {
    fontSize: 14,
    color: "#1e3a8a",
  },
  exitSelectionButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  exitSelectionButtonText: {
    fontSize: 12,
    color: "#dc2626",
    fontWeight: "600",
  },
  errorText: {
    fontSize: 12,
    color: "#dc2626",
    marginBottom: 8,
  },
  timeBoxList: {
    marginBottom: 12,
  },
  timeBoxSection: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  timeBoxHeader: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
  },
  timeBoxChevron: {
    width: 20,
    textAlign: "center",
    fontSize: 12,
    color: "#6b7280",
  },
  timeBoxHeaderBody: {
    flex: 1,
  },
  timeBoxTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  timeBoxTime: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  timeBoxTasks: {
    marginTop: 8,
    borderTopWidth: 1,
    borderColor: "#f3f4f6",
    paddingTop: 6,
  },
  timeBoxTaskRow: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 6,
  },
  timeBoxTaskText: {
    fontSize: 13,
    color: "#111827",
  },
  timeBoxEmpty: {
    fontSize: 12,
    color: "#6b7280",
    paddingVertical: 6,
  },
  scheduleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  scheduleLabel: {
    width: 60,
    fontSize: 12,
    color: "#111827",
  },
  scheduleInputs: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  scheduleInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 12,
  },
  scheduleSeparator: {
    marginHorizontal: 6,
    fontSize: 12,
    color: "#6b7280",
  },
  resetButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  resetButtonText: {
    fontSize: 12,
    color: "#111827",
  },
  notesTabRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 4,
    marginBottom: 12,
  },
  notesTabButton: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
  },
  notesTabActive: {
    backgroundColor: "#111827",
  },
  notesTabText: {
    fontSize: 12,
    color: "#6b7280",
  },
  notesTabTextActive: {
    color: "#ffffff",
    fontWeight: "600",
  },
  noteSection: {
    marginBottom: 16,
  },
  noteDateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  noteDateText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  noteBodyInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    minHeight: 160,
    textAlignVertical: "top",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  noteLink: {
    backgroundColor: "#fef3c7",
    color: "#1f2937",
    fontWeight: "600",
  },
  noteSaveButton: {
    alignSelf: "flex-start",
    backgroundColor: "#111827",
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  noteSaveButtonDisabled: {
    opacity: 0.5,
  },
  noteSaveButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  noteNewButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#111827",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 10,
  },
  noteNewButtonText: {
    fontSize: 12,
    color: "#111827",
    fontWeight: "600",
  },
  freeNoteList: {
    marginBottom: 12,
  },
  freeNoteRow: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#f9fafb",
  },
  freeNoteTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  freeNoteMeta: {
    fontSize: 11,
    color: "#6b7280",
  },
  noteEditor: {
    borderTopWidth: 1,
    borderColor: "#e5e7eb",
    paddingTop: 12,
  },
  noteTitleInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  archiveBox: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    padding: 10,
  },
  archiveRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: "#f3f4f6",
  },
  archiveContent: {
    flex: 1,
  },
  archiveTitle: {
    fontSize: 12,
    color: "#111827",
  },
  archiveMeta: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 2,
  },
  archiveActionButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  archiveActionText: {
    fontSize: 12,
    color: "#111827",
  },
  slotBox: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
  },
  slotHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  slotHeaderLeftToggle: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
  },
  slotChevron: {
    width: 18,
    textAlign: "center",
    fontSize: 12,
    color: "#6b7280",
    marginRight: 4,
  },
  slotHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  slotSummaryBox: {
    alignItems: "flex-end",
    marginRight: 8,
  },
  slotTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  slotSummary: {
    fontSize: 11,
    color: "#6b7280",
    marginRight: 8,
  },
  slotSummaryWarning: {
    color: "#dc2626",
  },
  addButton: {
    borderWidth: 1,
    borderColor: "#111827",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  addButtonText: {
    fontSize: 16,
  },
  taskBox: {
    borderWidth: 1,
    borderColor: "#f3f4f6",
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
  },
  completedSection: {
    borderTopWidth: 1,
    borderColor: "#f3f4f6",
    paddingTop: 6,
  },
  completedToggleRow: {
    paddingVertical: 6,
  },
  completedToggleText: {
    fontSize: 12,
    color: "#111827",
  },
  completedEmptyText: {
    fontSize: 11,
    color: "#9ca3af",
    paddingVertical: 4,
  },
  completedTaskRow: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: 6,
  },
  completedTaskBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  completedTaskContent: {
    flex: 1,
  },
  completedTaskTitle: {
    fontSize: 12,
    color: "#9ca3af",
    textDecorationLine: "line-through",
  },
  completedTaskTime: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 2,
  },
  taskHeaderRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  statusBar: {
    width: 4,
    borderRadius: 2,
    marginRight: 8,
    alignSelf: "stretch",
  },
  taskHeaderBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  checkbox: {
    paddingHorizontal: 2,
    marginRight: 8,
    justifyContent: "center",
  },
  checkboxText: {
    fontSize: 12,
    color: "#111827",
  },
  taskHeaderPressable: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 4,
    justifyContent: "center",
  },
  taskHeaderActive: {
    backgroundColor: "#f9fafb",
  },
  taskHeaderContent: {},
  taskHeaderTitle: {
    fontSize: 12,
    color: "#111827",
  },
  taskHeaderTitleDone: {
    color: "#9ca3af",
    textDecorationLine: "line-through",
  },
  taskHeaderMeta: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 2,
  },
  taskHeaderMetaDone: {
    color: "#9ca3af",
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
    alignSelf: "center",
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  taskActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  deleteButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginLeft: 6,
    justifyContent: "center",
  },
  deleteButtonText: {
    fontSize: 12,
  },
  archiveButton: {
    marginLeft: 4,
  },
  taskDetails: {
    marginTop: 8,
  },
  taskTitle: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 6,
  },
  taskNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  navButtons: {
    flexDirection: "row",
  },
  navButton: {
    borderWidth: 1,
    borderColor: "#9ca3af",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 6,
  },
  searchButton: {
    backgroundColor: "#e0f2fe",
    borderColor: "#7dd3fc",
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navButtonText: {
    fontSize: 12,
  },
  searchButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0369a1",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  label: {
    width: 70,
    fontSize: 12,
    color: "#4b5563",
  },
  tagDropdown: {
    flex: 1,
  },
  tagDropdownButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  tagDropdownText: {
    fontSize: 12,
    color: "#111827",
  },
  tagDropdownList: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    marginTop: 6,
    backgroundColor: "#ffffff",
  },
  tagDropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: "#f3f4f6",
  },
  tagDropdownItemText: {
    fontSize: 12,
    color: "#111827",
  },
  tagDropdownItemTextSelected: {
    color: "#2563eb",
    fontWeight: "600",
  },
  inputInline: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    padding: 8,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: "#111827",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  actionButtonDisabled: {
    borderColor: "#d1d5db",
  },
  actionButtonText: {
    fontSize: 12,
  },
  actionButtonTextDisabled: {
    color: "#9ca3af",
  },
  logControls: {
    marginBottom: 12,
  },
  logAnalysisPanel: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#ffffff",
    marginBottom: 12,
  },
  logAnalysisHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logAnalysisTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  logAnalysisToggle: {
    fontSize: 12,
    color: "#6b7280",
  },
  logAnalysisPeriodRow: {
    flexDirection: "row",
    marginTop: 10,
    marginBottom: 6,
  },
  logAnalysisRangeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  logAnalysisTagRow: {
    alignItems: "center",
    paddingBottom: 4,
  },
  logAnalysisRangeText: {
    fontSize: 11,
    color: "#111827",
    fontWeight: "600",
    marginHorizontal: 8,
  },
  logAnalysisNavButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
  },
  logAnalysisNavButtonDisabled: {
    borderColor: "#e5e7eb",
  },
  logAnalysisNavText: {
    fontSize: 11,
    color: "#111827",
  },
  logAnalysisNavTextDisabled: {
    color: "#9ca3af",
  },
  logAnalysisChip: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  logAnalysisChipActive: {
    borderColor: "#111827",
    backgroundColor: "#111827",
  },
  logAnalysisChipText: {
    fontSize: 11,
    color: "#111827",
  },
  logAnalysisChipTextActive: {
    color: "#ffffff",
  },
  logAnalysisChartContainer: {
    marginTop: 4,
    width: "100%",
  },
  logAnalysisChartScroll: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  logAnalysisChart: {
    alignItems: "center",
  },
  logAnalysisAxisRow: {
    position: "relative",
    height: 16,
    marginTop: 4,
  },
  logAnalysisAxisLabel: {
    fontSize: 9,
    color: "#9ca3af",
    position: "absolute",
    width: 34,
    textAlign: "center",
  },
  logAnalysisHint: {
    marginTop: 6,
    fontSize: 10,
    color: "#6b7280",
  },
  viewToggleRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  viewToggleButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
  },
  viewToggleButtonActive: {
    borderColor: "#111827",
    backgroundColor: "#111827",
  },
  viewToggleText: {
    fontSize: 12,
    color: "#111827",
  },
  viewToggleTextActive: {
    color: "#ffffff",
  },
  logSearchInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  filterRow: {
    alignItems: "center",
    paddingBottom: 4,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
  },
  filterChipActive: {
    borderColor: "#111827",
    backgroundColor: "#111827",
  },
  filterChipText: {
    fontSize: 12,
    color: "#111827",
  },
  filterChipTextActive: {
    color: "#ffffff",
  },
  table: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: "#f3f4f6",
  },
  tableHeaderRow: {
    backgroundColor: "#f9fafb",
  },
  tableCell: {
    fontSize: 12,
    paddingHorizontal: 6,
    color: "#111827",
  },
  tableCellDate: {
    width: 90,
  },
  tableCellTitle: {
    width: 140,
  },
  tableCellTag: {
    width: 140,
  },
  tableCellNumber: {
    width: 70,
    textAlign: "right",
  },
  boardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  boardColumn: {
    width: 220,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    padding: 8,
    marginRight: 12,
  },
  boardColumnTitle: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
  },
  boardCard: {
    borderWidth: 1,
    borderColor: "#f3f4f6",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  boardCardTitle: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  boardCardMeta: {
    fontSize: 11,
    color: "#4b5563",
    marginBottom: 2,
  },
  logLandscapeTable: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    overflow: "hidden",
  },
  logLandscapeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderColor: "#f3f4f6",
  },
  logLandscapeHeaderRow: {
    alignItems: "center",
    backgroundColor: "#f9fafb",
  },
  logLandscapeHeaderCell: {
    fontSize: 11,
    color: "#6b7280",
    fontWeight: "600",
  },
  logLandscapeHeaderMetric: {
    textAlign: "right",
  },
  logLandscapeMetaCell: {
    flex: 2.2,
    paddingRight: 8,
  },
  logLandscapeMetricCell: {
    flex: 1,
    paddingHorizontal: 6,
  },
  logLandscapeDiffCell: {
    flex: 1.2,
    paddingLeft: 6,
  },
  logLandscapeTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
    flexShrink: 1,
  },
  logLandscapeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  logLandscapeTags: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 6,
    flexShrink: 0,
  },
  logLandscapeTagChip: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#f9fafb",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 4,
  },
  logLandscapeTagText: {
    fontSize: 10,
    color: "#6b7280",
  },
  logLandscapeTagChipMuted: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#f8fafc",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 4,
  },
  logLandscapeTagTextMuted: {
    fontSize: 10,
    color: "#9ca3af",
  },
  logLandscapeMeta: {
    fontSize: 10,
    color: "#6b7280",
  },
  logLandscapeValue: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    textAlign: "right",
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e5e7eb",
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  sheetItem: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  sheetItemText: {
    fontSize: 14,
    color: "#111827",
  },
  sheetCloseButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingVertical: 8,
  },
  sheetCloseText: {
    fontSize: 12,
    color: "#6b7280",
  },
  dateOverlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    padding: 24,
  },
  dateBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  datePanel: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
  },
  dateTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 12,
  },
  dateShiftRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  dateShiftButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  dateShiftText: {
    fontSize: 12,
    color: "#111827",
  },
  dateInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginBottom: 8,
  },
  dateActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  dateActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dateActionText: {
    fontSize: 13,
    color: "#111827",
  },
  dateActionPrimary: {
    backgroundColor: "#111827",
    borderRadius: 8,
    marginLeft: 8,
  },
  dateActionPrimaryText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  moveSlotRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
  },
  moveSlotButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  moveSlotButtonActive: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  moveSlotText: {
    fontSize: 12,
    color: "#111827",
  },
  moveSlotTextActive: {
    color: "#1d4ed8",
    fontWeight: "600",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: FOOTER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
});
