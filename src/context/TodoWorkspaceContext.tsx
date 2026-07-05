import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Platform } from "react-native";
import { nanoid } from "nanoid/non-secure";

import { useAppRefresh } from "./AppRefreshContext";
import { useTodos } from "../hooks/useTodos";
import {
  TODO_REPEAT_OPTIONS,
  buildCalendarMonthCells,
  buildTodoEntriesForDate,
  buildTodoListEntries,
  createEmptyTodoDraft,
  getTodoListRangeEndDate,
  getTodoNotificationIds,
  getTodoSeriesAnchorDate,
  getTodoSeriesId,
  isRecurringSeriesMaster,
  parseDateString,
  parseTimeString,
  pruneCompletedSimpleTodos,
  toDateString,
  type CalendarDayCell,
  type TodoDraft,
  type TodoEditContext,
  type TodoEditScope,
  type TodoListEntry,
  type TodoListRange,
} from "../hooks/todos/todoWorkspaceUtils";
import {
  applyTodoWorkspaceDeactivationPolicy,
  createClosedTodoComposerState,
  isTodoComposerClosed,
  isTodoDraftEmpty,
} from "../hooks/todos/todoWorkspacePolicy";
import type { AppLanguage } from "../i18n";
import { getDefaultTagsForLanguage } from "../tagLocalization";
import * as todoRepository from "../repositories/todoRepository";
import type { SimpleTodoItem, Tag } from "../types";

let NotificationsModule: any = null;
try {
  NotificationsModule = require("expo-notifications");
} catch (_error) {
  NotificationsModule = null;
}

type TodoWorkspaceContextValue = {
  simpleTodos: SimpleTodoItem[];
  tagOptions: Tag[];
  calendarWeekdayLabels: string[];
  todoViewMode: "list" | "calendar";
  setTodoViewMode: (mode: "list" | "calendar") => void;
  todoListRange: TodoListRange;
  setTodoListRange: (range: TodoListRange) => void;
  todoCalendarMonth: Date;
  setTodoCalendarMonth: React.Dispatch<React.SetStateAction<Date>>;
  todoCalendarSelectedDate: string;
  setTodoCalendarSelectedDate: React.Dispatch<React.SetStateAction<string>>;
  todoCreateOpen: boolean;
  todoEditingContext: TodoEditContext | null;
  todoDraft: TodoDraft;
  setTodoDraft: React.Dispatch<React.SetStateAction<TodoDraft>>;
  openSwipeTodoId: string | null;
  setOpenSwipeTodoId: React.Dispatch<React.SetStateAction<string | null>>;
  todoDatePickerOpen: boolean;
  todoDateDraft: string;
  setTodoDateDraft: React.Dispatch<React.SetStateAction<string>>;
  todoDateError: string | null;
  todoCalendarMonthLabel: string;
  todoCalendarCells: CalendarDayCell[];
  todoTimePickerOpen: boolean;
  todoHourDraft: number;
  todoMinuteDraft: number;
  setTodoHourDraft: React.Dispatch<React.SetStateAction<number>>;
  setTodoMinuteDraft: React.Dispatch<React.SetStateAction<number>>;
  todoScreenCalendarMonthLabel: string;
  todoScreenCalendarCells: CalendarDayCell[];
  todoListEntries: TodoListEntry[];
  todoCountsByDate: Map<string, number>;
  selectedDateTodos: TodoListEntry[];
  unscheduledTodos: TodoListEntry[];
  hourOptions: number[];
  minuteOptions: number[];
  repeatOptions: Array<Exclude<SimpleTodoItem["repeat"], "none">>;
  refreshTodos: () => Promise<void>;
  openTodoCreate: () => void;
  closeTodoCreate: () => void;
  openTodoEdit: (entry: TodoListEntry) => void;
  addSimpleTodo: () => void;
  applyTodoEdit: (scope: TodoEditScope) => void;
  toggleTodoDraftTag: (tag: Tag) => void;
  setTodoDraftRepeat: (repeat: Exclude<SimpleTodoItem["repeat"], "none">) => void;
  toggleSimpleTodoDone: (entry: TodoListEntry) => void;
  deleteSimpleTodo: (entry: TodoListEntry, scope?: TodoEditScope) => void;
  openTodoDatePicker: () => void;
  closeTodoDatePicker: () => void;
  shiftTodoDateDraft: (delta: number) => void;
  shiftTodoDatePickerMonth: (delta: number) => void;
  selectTodoDateFromCalendar: (isoDate: string) => void;
  applyTodoDateDraft: () => void;
  selectTodoCalendarCell: (cell: CalendarDayCell) => void;
  openTodoTimePicker: () => void;
  closeTodoTimePicker: () => void;
  applyTodoTimeDraft: () => void;
  handleHourPickerScrollEnd: (offsetY: number, itemHeight: number) => void;
  handleMinutePickerScrollEnd: (offsetY: number, itemHeight: number) => void;
};

type ProviderProps = {
  active: boolean;
  selectedDate: string;
  storageReady: boolean;
  tagLibrary: Tag[];
  language: AppLanguage;
  tr: (key: string) => string;
  untitledLabel: string;
  children: React.ReactNode;
};

const TodoWorkspaceContext = createContext<TodoWorkspaceContextValue | null>(null);

export const TodoWorkspaceProvider = ({
  active,
  selectedDate,
  storageReady,
  tagLibrary,
  language,
  tr,
  untitledLabel,
  children,
}: ProviderProps) => {
  const { registerRefreshHandler } = useAppRefresh();
  const {
    todos: simpleTodos,
    setTodos: setSimpleTodos,
    loadTodos,
    persistTodos,
  } = useTodos();
  const [todoViewMode, setTodoViewMode] = useState<"list" | "calendar">("list");
  const [todoListRange, setTodoListRange] = useState<TodoListRange>("today");
  const [todoCalendarMonth, setTodoCalendarMonth] = useState<Date>(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [todoCalendarSelectedDate, setTodoCalendarSelectedDate] = useState(
    toDateString(new Date()),
  );
  const [todoCreateOpen, setTodoCreateOpen] = useState(false);
  const [todoEditingContext, setTodoEditingContext] =
    useState<TodoEditContext | null>(null);
  const [todoDraft, setTodoDraft] = useState<TodoDraft>(createEmptyTodoDraft);
  const [openSwipeTodoId, setOpenSwipeTodoId] = useState<string | null>(null);
  const [todoDatePickerOpen, setTodoDatePickerOpen] = useState(false);
  const [todoDateDraft, setTodoDateDraft] = useState("");
  const [todoDateError, setTodoDateError] = useState<string | null>(null);
  const [todoDatePickerMonth, setTodoDatePickerMonth] = useState<Date>(() => {
    const parsed = parseDateString(toDateString(new Date())) ?? new Date();
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  });
  const [todoTimePickerOpen, setTodoTimePickerOpen] = useState(false);
  const [todoHourDraft, setTodoHourDraft] = useState(0);
  const [todoMinuteDraft, setTodoMinuteDraft] = useState(0);
  const todoDateRef = useRef(toDateString(new Date()));
  const todoNotificationUnavailableRef = useRef(false);
  const todoNotificationBootstrappedRef = useRef(false);

  const refreshTodos = useCallback(async () => {
    const loaded = await loadTodos();
    const today = toDateString(new Date());
    const pruned = pruneCompletedSimpleTodos(loaded, today);
    setSimpleTodos(pruned);
    if (pruned.length !== loaded.length) {
      await persistTodos(pruned);
    }
  }, [loadTodos, persistTodos, setSimpleTodos]);

  useEffect(() => {
    void refreshTodos();
  }, [refreshTodos]);

  useEffect(
    () => registerRefreshHandler("todos", refreshTodos),
    [refreshTodos, registerRefreshHandler],
  );

  useEffect(() => {
    if (!NotificationsModule?.setNotificationHandler) {
      return;
    }
    NotificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android" || !NotificationsModule?.setNotificationChannelAsync) {
      return;
    }
    void NotificationsModule.setNotificationChannelAsync("todo-reminders", {
      name: "ToDo reminders",
      importance: NotificationsModule?.AndroidImportance?.HIGH ?? 4,
      sound: "default",
      enableVibrate: true,
      vibrationPattern: [0, 250, 250, 250],
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const today = toDateString(new Date());
      if (today === todoDateRef.current) {
        return;
      }
      todoDateRef.current = today;
      setSimpleTodos((prev) => {
        const next = pruneCompletedSimpleTodos(prev, today);
        if (next.length !== prev.length) {
          void persistTodos(next);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [persistTodos, setSimpleTodos]);

  useEffect(() => {
    if (active) {
      return;
    }
    const currentState = {
      openSwipeTodoId,
      todoCreateOpen,
      todoEditingContext,
      todoDraft,
      todoDatePickerOpen,
      todoTimePickerOpen,
      todoDateError,
    };
    if (openSwipeTodoId === null && isTodoComposerClosed(currentState)) {
      return;
    }
    const nextState = applyTodoWorkspaceDeactivationPolicy(currentState);
    setOpenSwipeTodoId(nextState.openSwipeTodoId);
    if (todoCreateOpen !== nextState.todoCreateOpen) {
      setTodoCreateOpen(nextState.todoCreateOpen);
    }
    if (todoEditingContext !== nextState.todoEditingContext) {
      setTodoEditingContext(nextState.todoEditingContext);
    }
    if (!isTodoDraftEmpty(todoDraft)) {
      setTodoDraft(nextState.todoDraft);
    }
    if (todoDatePickerOpen !== nextState.todoDatePickerOpen) {
      setTodoDatePickerOpen(nextState.todoDatePickerOpen);
    }
    if (todoTimePickerOpen !== nextState.todoTimePickerOpen) {
      setTodoTimePickerOpen(nextState.todoTimePickerOpen);
    }
    if (todoDateError !== nextState.todoDateError) {
      setTodoDateError(nextState.todoDateError);
    }
  }, [
    active,
    openSwipeTodoId,
    todoCreateOpen,
    todoDateError,
    todoDatePickerOpen,
    todoDraft,
    todoEditingContext,
    todoTimePickerOpen,
  ]);

  const cancelTodoNotifications = useCallback(async (notificationIds: string[]) => {
    if (
      notificationIds.length === 0 ||
      !NotificationsModule?.cancelScheduledNotificationAsync
    ) {
      return;
    }
    await Promise.all(
      notificationIds.map(async (notificationId) => {
        try {
          await NotificationsModule.cancelScheduledNotificationAsync(notificationId);
        } catch {
          // Keep app flow even if cancellation fails.
        }
      }),
    );
  }, []);

  const ensureTodoNotificationPermission = useCallback(async () => {
    if (!NotificationsModule?.getPermissionsAsync) {
      return false;
    }
    const isGranted = (value: any) =>
      Boolean(
        value?.granted ||
          value?.status === "granted" ||
          value?.ios?.status === NotificationsModule?.IosAuthorizationStatus?.PROVISIONAL ||
          value?.ios?.status === NotificationsModule?.IosAuthorizationStatus?.EPHEMERAL,
      );
    const current = await NotificationsModule.getPermissionsAsync();
    if (isGranted(current)) {
      return true;
    }
    if (NotificationsModule?.requestPermissionsAsync) {
      const requested = await NotificationsModule.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      return isGranted(requested);
    }
    return false;
  }, []);

  const scheduleTodoNotification = useCallback(
    async (
      text: string,
      reminderDate: string | null,
      reminderTime: string | null,
      repeat: SimpleTodoItem["repeat"],
    ) => {
      if (!NotificationsModule?.scheduleNotificationAsync) {
        return null;
      }
      if (!reminderDate || !reminderTime) {
        return null;
      }
      const date = parseDateString(reminderDate);
      const totalMinutes = parseTimeString(reminderTime);
      if (!date || totalMinutes === null || totalMinutes >= 24 * 60) {
        return null;
      }
      const reminderHour = Math.floor(totalMinutes / 60);
      const reminderMinute = totalMinutes % 60;
      const at = new Date(date);
      at.setHours(reminderHour, reminderMinute, 0, 0);
      if (repeat === "none" && at.getTime() <= Date.now()) {
        return null;
      }
      const granted = await ensureTodoNotificationPermission();
      if (!granted) {
        Alert.alert(tr("todo.notificationDenied"));
        return null;
      }
      let trigger: Record<string, unknown>;
      if (repeat === "daily") {
        trigger = {
          type: NotificationsModule?.SchedulableTriggerInputTypes?.DAILY ?? "daily",
          hour: reminderHour,
          minute: reminderMinute,
        };
      } else if (repeat === "weekly") {
        trigger = {
          type: NotificationsModule?.SchedulableTriggerInputTypes?.WEEKLY ?? "weekly",
          weekday: date.getDay() + 1,
          hour: reminderHour,
          minute: reminderMinute,
        };
      } else if (repeat === "monthly") {
        trigger = {
          type: NotificationsModule?.SchedulableTriggerInputTypes?.MONTHLY ?? "monthly",
          day: date.getDate(),
          hour: reminderHour,
          minute: reminderMinute,
        };
      } else if (repeat === "yearly") {
        trigger = {
          type: NotificationsModule?.SchedulableTriggerInputTypes?.YEARLY ?? "yearly",
          month: date.getMonth(),
          day: date.getDate(),
          hour: reminderHour,
          minute: reminderMinute,
        };
      } else {
        trigger = {
          type: NotificationsModule?.SchedulableTriggerInputTypes?.DATE ?? "date",
          date: at,
        };
      }
      try {
        return await NotificationsModule.scheduleNotificationAsync({
          content: {
            title: tr("todo.reminderTitle"),
            body: `${tr("todo.reminderBody")} ${text || untitledLabel}`,
            sound: "default",
            ...(Platform.OS === "android" ? { channelId: "todo-reminders" } : {}),
          },
          trigger,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[todo-notification] failed to schedule: ${message}`);
        return null;
      }
    },
    [ensureTodoNotificationPermission, tr, untitledLabel],
  );

  const rescheduleTodoNotification = useCallback(
    async (todo: SimpleTodoItem) => {
      if (!NotificationsModule?.scheduleNotificationAsync) {
        if (
          todo.reminderDate &&
          todo.reminderTime &&
          !todoNotificationUnavailableRef.current
        ) {
          todoNotificationUnavailableRef.current = true;
          Alert.alert(tr("todo.notificationUnavailable"));
        }
        return;
      }
      await cancelTodoNotifications(getTodoNotificationIds(todo));
      if (todo.isDone || todo.isDeleted) {
        setSimpleTodos((prev) => {
          const next = prev.map((item) =>
            item.id === todo.id
              ? { ...item, notificationId: null, notificationIds: [] }
              : item,
          );
          void persistTodos(next);
          return next;
        });
        return;
      }
      const notificationId = await scheduleTodoNotification(
        todo.text,
        todo.reminderDate,
        todo.reminderTime,
        todo.repeat,
      );
      setSimpleTodos((prev) => {
        const next = prev.map((item) =>
          item.id === todo.id
            ? {
                ...item,
                notificationId,
                notificationIds: notificationId ? [notificationId] : [],
              }
            : item,
        );
        void persistTodos(next);
        return next;
      });
    },
    [cancelTodoNotifications, persistTodos, scheduleTodoNotification, setSimpleTodos, tr],
  );

  useEffect(() => {
    if (todoNotificationBootstrappedRef.current || !storageReady) {
      return;
    }
    todoNotificationBootstrappedRef.current = true;
    if (!NotificationsModule?.scheduleNotificationAsync) {
      return;
    }
    let cancelled = false;
    const bootstrapTodoNotifications = async () => {
      let scheduledIds = new Set<string>();
      if (NotificationsModule?.getAllScheduledNotificationsAsync) {
        try {
          const scheduled =
            await NotificationsModule.getAllScheduledNotificationsAsync();
          scheduledIds = new Set(
            scheduled
              .map((entry: { identifier?: unknown }) => entry.identifier)
              .filter((value: unknown): value is string => typeof value === "string"),
          );
        } catch {
          // Continue without preloaded identifiers.
        }
      }
      const next = [...simpleTodos];
      let changed = false;
      for (let i = 0; i < next.length; i += 1) {
        const todo = next[i];
        const hasReminder = Boolean(todo.reminderDate && todo.reminderTime);
        const notificationIds = getTodoNotificationIds(todo);
        if (!hasReminder || todo.isDone || todo.isDeleted) {
          if (notificationIds.length > 0) {
            await cancelTodoNotifications(notificationIds);
            next[i] = { ...todo, notificationId: null, notificationIds: [] };
            changed = true;
          }
          continue;
        }
        const date = parseDateString(todo.reminderDate ?? "");
        const totalMinutes = parseTimeString(todo.reminderTime ?? "");
        if (!date || totalMinutes === null || totalMinutes >= 24 * 60) {
          if (notificationIds.length > 0) {
            await cancelTodoNotifications(notificationIds);
            next[i] = { ...todo, notificationId: null, notificationIds: [] };
            changed = true;
          }
          continue;
        }
        if (todo.repeat === "none") {
          const at = new Date(date);
          at.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
          if (at.getTime() <= Date.now()) {
            if (notificationIds.length > 0) {
              await cancelTodoNotifications(notificationIds);
              next[i] = { ...todo, notificationId: null, notificationIds: [] };
              changed = true;
            }
            continue;
          }
        }
        if (
          notificationIds.length > 0 &&
          notificationIds.every((notificationId) => scheduledIds.has(notificationId))
        ) {
          continue;
        }
        if (notificationIds.length > 0) {
          await cancelTodoNotifications(notificationIds);
        }
        const notificationId = await scheduleTodoNotification(
          todo.text,
          todo.reminderDate,
          todo.reminderTime,
          todo.repeat,
        );
        const nextNotificationIds = notificationId ? [notificationId] : [];
        if (
          notificationId !== todo.notificationId ||
          nextNotificationIds.join(",") !== notificationIds.join(",")
        ) {
          next[i] = {
            ...todo,
            notificationId,
            notificationIds: nextNotificationIds,
          };
          changed = true;
          if (notificationId) {
            scheduledIds.add(notificationId);
          }
        }
      }
      if (!cancelled && changed) {
        setSimpleTodos(next);
        void persistTodos(next);
      }
    };
    void bootstrapTodoNotifications();
    return () => {
      cancelled = true;
    };
  }, [
    cancelTodoNotifications,
    persistTodos,
    scheduleTodoNotification,
    setSimpleTodos,
    simpleTodos,
    storageReady,
  ]);

  const updateSimpleTodos = useCallback(
    (next: SimpleTodoItem[]) => {
      void persistTodos(next);
    },
    [persistTodos],
  );

  const openTodoCreate = useCallback(() => {
    setOpenSwipeTodoId(null);
    setTodoEditingContext(null);
    setTodoDraft(createEmptyTodoDraft());
    setTodoCreateOpen(true);
  }, []);

  const closeTodoComposer = useCallback(() => {
    if (
      isTodoComposerClosed({
        todoCreateOpen,
        todoEditingContext,
        todoDraft,
        todoDatePickerOpen,
        todoTimePickerOpen,
        todoDateError,
      })
    ) {
      return;
    }
    const nextState = createClosedTodoComposerState();
    if (todoCreateOpen !== nextState.todoCreateOpen) {
      setTodoCreateOpen(nextState.todoCreateOpen);
    }
    if (todoEditingContext !== nextState.todoEditingContext) {
      setTodoEditingContext(nextState.todoEditingContext);
    }
    if (!isTodoDraftEmpty(todoDraft)) {
      setTodoDraft(nextState.todoDraft);
    }
    if (todoDatePickerOpen !== nextState.todoDatePickerOpen) {
      setTodoDatePickerOpen(nextState.todoDatePickerOpen);
    }
    if (todoTimePickerOpen !== nextState.todoTimePickerOpen) {
      setTodoTimePickerOpen(nextState.todoTimePickerOpen);
    }
    if (todoDateError !== nextState.todoDateError) {
      setTodoDateError(nextState.todoDateError);
    }
  }, [
    todoCreateOpen,
    todoDateError,
    todoDatePickerOpen,
    todoDraft,
    todoEditingContext,
    todoTimePickerOpen,
  ]);

  const closeTodoCreate = useCallback(() => {
    closeTodoComposer();
  }, [closeTodoComposer]);

  const openTodoEdit = useCallback(
    (entry: TodoListEntry) => {
      const target = simpleTodos.find((item) => item.id === entry.todo.id);
      if (!target) {
        return;
      }
      setOpenSwipeTodoId(null);
      setTodoEditingContext({
        todoId: target.id,
        seriesId: entry.seriesId,
        occurrenceDate: entry.occurrenceDate,
        isRecurringSeries: entry.isRecurringSeries,
      });
      setTodoDraft({
        text: target.text,
        memo: target.memo,
        reminderDate: entry.displayDate ?? target.reminderDate ?? "",
        reminderTime: target.reminderTime ?? "",
        repeat: entry.seriesMaster?.repeat ?? target.repeat,
        tags: [...target.tags],
      });
      setTodoCreateOpen(true);
    },
    [simpleTodos],
  );

  const addSimpleTodo = useCallback(() => {
    const text = todoDraft.text.trim();
    const item = todoRepository.createTodo({
      text,
      memo: todoDraft.memo.trim(),
      tags: [...todoDraft.tags],
      reminderDate: todoDraft.reminderDate.trim() || null,
      reminderTime: todoDraft.reminderTime.trim() || null,
      repeat: todoDraft.repeat,
    });
    updateSimpleTodos([item, ...simpleTodos]);
    closeTodoComposer();
    void rescheduleTodoNotification(item);
  }, [
    closeTodoComposer,
    rescheduleTodoNotification,
    simpleTodos,
    todoDraft,
    updateSimpleTodos,
  ]);

  const findRecurringSeriesMasterBySeriesId = useCallback(
    (seriesId: string | null) => {
      if (!seriesId) {
        return null;
      }
      return (
        simpleTodos.find(
          (item) => getTodoSeriesId(item) === seriesId && isRecurringSeriesMaster(item),
        ) ?? null
      );
    },
    [simpleTodos],
  );

  const finalizeTodoEdit = useCallback(() => {
    closeTodoComposer();
  }, [closeTodoComposer]);

  const applyTodoEdit = useCallback(
    (scope: TodoEditScope) => {
      if (!todoEditingContext) {
        return;
      }
      const target = simpleTodos.find((item) => item.id === todoEditingContext.todoId);
      if (!target) {
        return;
      }
      const nextText = todoDraft.text.trim();
      const nextMemo = todoDraft.memo.trim();
      const nextReminderDate = todoDraft.reminderDate.trim() || null;
      const nextReminderTime = todoDraft.reminderTime.trim() || null;

      if (
        scope === "single" &&
        todoEditingContext.isRecurringSeries &&
        todoEditingContext.occurrenceDate
      ) {
        if (target.occurrenceDate) {
          const nextItem: SimpleTodoItem = {
            ...target,
            text: nextText,
            memo: nextMemo,
            tags: [...todoDraft.tags],
            reminderDate: nextReminderDate,
            reminderTime: nextReminderTime,
            notificationId: null,
            notificationIds: [],
            isDeleted: false,
          };
          updateSimpleTodos(
            simpleTodos.map((item) => (item.id === target.id ? nextItem : item)),
          );
          finalizeTodoEdit();
          void rescheduleTodoNotification(nextItem);
          return;
        }

        const seriesId = todoEditingContext.seriesId ?? target.id;
        const overrideItem: SimpleTodoItem = {
          id: nanoid(),
          text: nextText,
          memo: nextMemo,
          tags: [...todoDraft.tags],
          isDone: false,
          createdAt: Date.now(),
          doneAt: null,
          reminderDate: nextReminderDate ?? todoEditingContext.occurrenceDate,
          reminderTime: nextReminderTime,
          repeat: "none",
          notificationId: null,
          notificationIds: [],
          seriesId,
          seriesAnchorDate: getTodoSeriesAnchorDate(target),
          occurrenceDate: todoEditingContext.occurrenceDate,
          isDeleted: false,
        };
        updateSimpleTodos([overrideItem, ...simpleTodos]);
        finalizeTodoEdit();
        void rescheduleTodoNotification(overrideItem);
        return;
      }

      const seriesMaster =
        findRecurringSeriesMasterBySeriesId(todoEditingContext.seriesId) ??
        (isRecurringSeriesMaster(target) ? target : null);
      const seriesId = getTodoSeriesId(seriesMaster ?? target);

      const nextMaster: SimpleTodoItem = {
        ...(seriesMaster ?? target),
        text: nextText,
        memo: nextMemo,
        tags: [...todoDraft.tags],
        reminderDate: nextReminderDate,
        reminderTime: nextReminderTime,
        repeat: todoDraft.repeat,
        notificationId: null,
        notificationIds: [],
        seriesId:
          todoDraft.repeat !== "none"
            ? seriesId ?? (seriesMaster ?? target).id
            : null,
        seriesAnchorDate: todoDraft.repeat !== "none" ? nextReminderDate : null,
        occurrenceDate: null,
        isDeleted: false,
        isDone: todoDraft.repeat !== "none" ? false : (seriesMaster ?? target).isDone,
        doneAt: todoDraft.repeat !== "none" ? null : (seriesMaster ?? target).doneAt,
      };

      const nextTodos = simpleTodos
        .filter((item) => {
          if (item.id === target.id && target.occurrenceDate) {
            return false;
          }
          if (
            todoDraft.repeat === "none" &&
            seriesId &&
            getTodoSeriesId(item) === seriesId &&
            item.id !== (seriesMaster ?? target).id
          ) {
            return false;
          }
          return true;
        })
        .map((item) => (item.id === nextMaster.id ? nextMaster : item));

      if (!nextTodos.some((item) => item.id === nextMaster.id)) {
        nextTodos.unshift(nextMaster);
      }

      updateSimpleTodos(nextTodos);
      finalizeTodoEdit();
      void rescheduleTodoNotification(nextMaster);
    },
    [
      finalizeTodoEdit,
      findRecurringSeriesMasterBySeriesId,
      rescheduleTodoNotification,
      simpleTodos,
      todoDraft,
      todoEditingContext,
      updateSimpleTodos,
    ],
  );

  const toggleTodoDraftTag = useCallback((tag: Tag) => {
    setTodoDraft((prev) => {
      const exists = prev.tags.includes(tag);
      return {
        ...prev,
        tags: exists
          ? prev.tags.filter((item) => item !== tag)
          : [...prev.tags, tag],
      };
    });
  }, []);

  const setTodoDraftRepeat = useCallback(
    (repeat: Exclude<SimpleTodoItem["repeat"], "none">) => {
      setTodoDraft((prev) => ({
        ...prev,
        repeat: prev.repeat === repeat ? "none" : repeat,
      }));
    },
    [],
  );

  const updateSimpleTodo = useCallback(
    (
      todoId: string,
      updater: (item: SimpleTodoItem) => SimpleTodoItem,
    ) => {
      const target = simpleTodos.find((item) => item.id === todoId);
      if (!target) {
        return;
      }
      const nextItem = updater(target);
      updateSimpleTodos(
        simpleTodos.map((item) => (item.id === todoId ? nextItem : item)),
      );
      if (
        target.reminderDate !== nextItem.reminderDate ||
        target.reminderTime !== nextItem.reminderTime ||
        target.isDone !== nextItem.isDone ||
        target.repeat !== nextItem.repeat ||
        target.notificationIds.join(",") !== nextItem.notificationIds.join(",")
      ) {
        void rescheduleTodoNotification(nextItem);
      }
    },
    [rescheduleTodoNotification, simpleTodos, updateSimpleTodos],
  );

  const toggleSimpleTodoDone = useCallback(
    (entry: TodoListEntry) => {
      if (openSwipeTodoId === entry.todo.id) {
        setOpenSwipeTodoId(null);
        return;
      }
      if (entry.isRecurringSeries && entry.occurrenceDate) {
        if (entry.todo.occurrenceDate) {
          updateSimpleTodo(entry.todo.id, (item) => ({
            ...item,
            isDone: !item.isDone,
            doneAt: item.isDone ? null : Date.now(),
          }));
          return;
        }
        const overrideItem: SimpleTodoItem = {
          id: nanoid(),
          text: entry.todo.text,
          memo: entry.todo.memo,
          tags: [...entry.todo.tags],
          isDone: true,
          createdAt: Date.now(),
          doneAt: Date.now(),
          reminderDate: entry.displayDate,
          reminderTime: entry.displayTime,
          repeat: "none",
          notificationId: null,
          notificationIds: [],
          seriesId: entry.seriesId,
          seriesAnchorDate: getTodoSeriesAnchorDate(entry.todo),
          occurrenceDate: entry.occurrenceDate,
          isDeleted: false,
        };
        updateSimpleTodos([overrideItem, ...simpleTodos]);
        void rescheduleTodoNotification(overrideItem);
        return;
      }
      updateSimpleTodo(entry.todo.id, (item) => ({
        ...item,
        isDone: !item.isDone,
        doneAt: item.isDone ? null : Date.now(),
      }));
    },
    [openSwipeTodoId, rescheduleTodoNotification, simpleTodos, updateSimpleTodo, updateSimpleTodos],
  );

  const deleteSimpleTodo = useCallback(
    (entry: TodoListEntry, scope: TodoEditScope = "series") => {
      const target = simpleTodos.find((item) => item.id === entry.todo.id);
      if (!target) {
        return;
      }
      if (scope === "single" && entry.isRecurringSeries && entry.occurrenceDate) {
        if (target.occurrenceDate) {
          void cancelTodoNotifications(getTodoNotificationIds(target));
          updateSimpleTodos(simpleTodos.filter((item) => item.id !== target.id));
          setOpenSwipeTodoId((prev) => (prev === target.id ? null : prev));
          return;
        }
        const deletedOverride: SimpleTodoItem = {
          id: nanoid(),
          text: target.text,
          memo: target.memo,
          tags: [...target.tags],
          isDone: false,
          createdAt: Date.now(),
          doneAt: null,
          reminderDate: entry.displayDate,
          reminderTime: entry.displayTime,
          repeat: "none",
          notificationId: null,
          notificationIds: [],
          seriesId: entry.seriesId,
          seriesAnchorDate: getTodoSeriesAnchorDate(target),
          occurrenceDate: entry.occurrenceDate,
          isDeleted: true,
        };
        updateSimpleTodos([deletedOverride, ...simpleTodos]);
        setOpenSwipeTodoId((prev) => (prev === target.id ? null : prev));
        return;
      }
      const seriesId = getTodoSeriesId(target);
      const removedItems = simpleTodos.filter((item) => {
        if (item.id === target.id) {
          return true;
        }
        return Boolean(
          seriesId &&
            isRecurringSeriesMaster(target) &&
            getTodoSeriesId(item) === seriesId,
        );
      });
      void Promise.all(
        removedItems.map((item) =>
          cancelTodoNotifications(getTodoNotificationIds(item)),
        ),
      );
      updateSimpleTodos(
        simpleTodos.filter(
          (item) => !removedItems.some((removed) => removed.id === item.id),
        ),
      );
      setOpenSwipeTodoId((prev) => (prev === target.id ? null : prev));
    },
    [cancelTodoNotifications, simpleTodos, updateSimpleTodos],
  );

  const openTodoDatePicker = useCallback(() => {
    const parsed = parseDateString(todoDraft.reminderDate) ?? new Date();
    setTodoDatePickerMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    setTodoDateDraft(todoDraft.reminderDate || toDateString(parsed));
    setTodoDateError(null);
    setTodoDatePickerOpen(true);
  }, [todoDraft.reminderDate]);

  const closeTodoDatePicker = useCallback(() => {
    setTodoDatePickerOpen(false);
  }, []);

  const shiftTodoDateDraft = useCallback((delta: number) => {
    const base = parseDateString(todoDateDraft) ?? new Date();
    const next = new Date(base);
    next.setDate(next.getDate() + delta);
    setTodoDateDraft(toDateString(next));
    setTodoDateError(null);
  }, [todoDateDraft]);

  const shiftTodoDatePickerMonth = useCallback((delta: number) => {
    setTodoDatePickerMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1),
    );
  }, []);

  const selectTodoDateFromCalendar = useCallback((isoDate: string) => {
    setTodoDateDraft(isoDate);
    setTodoDateError(null);
  }, []);

  const applyTodoDateDraft = useCallback(() => {
    const parsed = parseDateString(todoDateDraft);
    if (!parsed) {
      setTodoDateError(tr("validation.invalidDate"));
      return;
    }
    const normalized = toDateString(parsed);
    setTodoDraft((prev) => ({ ...prev, reminderDate: normalized }));
    setTodoDatePickerOpen(false);
  }, [todoDateDraft, tr]);

  const selectTodoCalendarCell = useCallback((cell: CalendarDayCell) => {
    setTodoCalendarSelectedDate(cell.iso);
    if (!cell.inCurrentMonth) {
      const parsed = parseDateString(cell.iso);
      if (parsed) {
        setTodoCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
      }
    }
  }, []);

  const openTodoTimePicker = useCallback(() => {
    const parsed = parseTimeString(todoDraft.reminderTime);
    if (parsed !== null) {
      setTodoHourDraft(Math.floor(parsed / 60));
      setTodoMinuteDraft(parsed % 60);
    } else {
      const nowTime = new Date();
      setTodoHourDraft(nowTime.getHours());
      setTodoMinuteDraft(nowTime.getMinutes());
    }
    setTodoTimePickerOpen(true);
  }, [todoDraft.reminderTime]);

  const closeTodoTimePicker = useCallback(() => {
    setTodoTimePickerOpen(false);
  }, []);

  const applyTodoTimeDraft = useCallback(() => {
    const normalized = `${String(todoHourDraft).padStart(2, "0")}:${String(
      todoMinuteDraft,
    ).padStart(2, "0")}`;
    setTodoDraft((prev) => ({ ...prev, reminderTime: normalized }));
    setTodoTimePickerOpen(false);
  }, [todoHourDraft, todoMinuteDraft]);

  const handleHourPickerScrollEnd = useCallback((offsetY: number, itemHeight: number) => {
    const index = Math.round(offsetY / itemHeight);
    const clamped = Math.max(0, Math.min(23, index));
    setTodoHourDraft(clamped);
  }, []);

  const handleMinutePickerScrollEnd = useCallback((offsetY: number, itemHeight: number) => {
    const index = Math.round(offsetY / itemHeight);
    const clamped = Math.max(0, Math.min(59, index));
    setTodoMinuteDraft(clamped);
  }, []);

  const tagOptions = useMemo(
    () =>
      tagLibrary.length > 0
        ? tagLibrary
        : getDefaultTagsForLanguage(language),
    [language, tagLibrary],
  );
  const calendarWeekdayLabels = useMemo(
    () =>
      language === "en"
        ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        : ["日", "月", "火", "水", "木", "金", "土"],
    [language],
  );
  const todoCalendarMonthLabel = useMemo(
    () =>
      `${todoDatePickerMonth.getFullYear()}-${String(
        todoDatePickerMonth.getMonth() + 1,
      ).padStart(2, "0")}`,
    [todoDatePickerMonth],
  );
  const todoCalendarCells = useMemo(
    () => buildCalendarMonthCells(todoDatePickerMonth),
    [todoDatePickerMonth],
  );
  const todoScreenCalendarMonthLabel = useMemo(
    () =>
      `${todoCalendarMonth.getFullYear()}-${String(
        todoCalendarMonth.getMonth() + 1,
      ).padStart(2, "0")}`,
    [todoCalendarMonth],
  );
  const todoScreenCalendarCells = useMemo(
    () => buildCalendarMonthCells(todoCalendarMonth),
    [todoCalendarMonth],
  );
  const todoListRangeEndDate = useMemo(
    () => getTodoListRangeEndDate(selectedDate, todoListRange),
    [selectedDate, todoListRange],
  );
  const todoListEntries = useMemo(
    () => buildTodoListEntries(simpleTodos, selectedDate, todoListRangeEndDate),
    [selectedDate, simpleTodos, todoListRangeEndDate],
  );
  const todoCountsByDate = useMemo(() => {
    const counts = new Map<string, number>();
    const firstDate = todoScreenCalendarCells[0]?.iso;
    const lastDate = todoScreenCalendarCells[todoScreenCalendarCells.length - 1]?.iso;
    if (!firstDate || !lastDate) {
      return counts;
    }
    for (const todo of buildTodoEntriesForDate(simpleTodos, firstDate, lastDate)) {
      if (!todo.displayDate) {
        continue;
      }
      counts.set(todo.displayDate, (counts.get(todo.displayDate) ?? 0) + 1);
    }
    return counts;
  }, [simpleTodos, todoScreenCalendarCells]);
  const selectedDateTodos = useMemo(
    () =>
      buildTodoEntriesForDate(
        simpleTodos,
        todoCalendarSelectedDate,
        todoCalendarSelectedDate,
      ),
    [simpleTodos, todoCalendarSelectedDate],
  );
  const unscheduledTodos = useMemo(
    () => todoListEntries.filter((todo) => !todo.displayDate),
    [todoListEntries],
  );
  const hourOptions = useMemo(
    () => Array.from({ length: 24 }, (_, index) => index),
    [],
  );
  const minuteOptions = useMemo(
    () => Array.from({ length: 60 }, (_, index) => index),
    [],
  );

  const value = useMemo<TodoWorkspaceContextValue>(
    () => ({
      simpleTodos,
      tagOptions,
      calendarWeekdayLabels,
      todoViewMode,
      setTodoViewMode,
      todoListRange,
      setTodoListRange,
      todoCalendarMonth,
      setTodoCalendarMonth,
      todoCalendarSelectedDate,
      setTodoCalendarSelectedDate,
      todoCreateOpen,
      todoEditingContext,
      todoDraft,
      setTodoDraft,
      openSwipeTodoId,
      setOpenSwipeTodoId,
      todoDatePickerOpen,
      todoDateDraft,
      setTodoDateDraft,
      todoDateError,
      todoCalendarMonthLabel,
      todoCalendarCells,
      todoTimePickerOpen,
      todoHourDraft,
      todoMinuteDraft,
      setTodoHourDraft,
      setTodoMinuteDraft,
      todoScreenCalendarMonthLabel,
      todoScreenCalendarCells,
      todoListEntries,
      todoCountsByDate,
      selectedDateTodos,
      unscheduledTodos,
      hourOptions,
      minuteOptions,
      repeatOptions: TODO_REPEAT_OPTIONS,
      refreshTodos,
      openTodoCreate,
      closeTodoCreate,
      openTodoEdit,
      addSimpleTodo,
      applyTodoEdit,
      toggleTodoDraftTag,
      setTodoDraftRepeat,
      toggleSimpleTodoDone,
      deleteSimpleTodo,
      openTodoDatePicker,
      closeTodoDatePicker,
      shiftTodoDateDraft,
      shiftTodoDatePickerMonth,
      selectTodoDateFromCalendar,
      applyTodoDateDraft,
      selectTodoCalendarCell,
      openTodoTimePicker,
      closeTodoTimePicker,
      applyTodoTimeDraft,
      handleHourPickerScrollEnd,
      handleMinutePickerScrollEnd,
    }),
    [
      addSimpleTodo,
      applyTodoDateDraft,
      applyTodoEdit,
      applyTodoTimeDraft,
      calendarWeekdayLabels,
      closeTodoCreate,
      closeTodoDatePicker,
      closeTodoTimePicker,
      deleteSimpleTodo,
      handleHourPickerScrollEnd,
      handleMinutePickerScrollEnd,
      hourOptions,
      minuteOptions,
      openSwipeTodoId,
      openTodoCreate,
      openTodoDatePicker,
      openTodoEdit,
      openTodoTimePicker,
      refreshTodos,
      selectedDateTodos,
      selectTodoCalendarCell,
      selectTodoDateFromCalendar,
      setTodoDraftRepeat,
      shiftTodoDateDraft,
      shiftTodoDatePickerMonth,
      simpleTodos,
      tagOptions,
      todoCalendarCells,
      todoCalendarMonth,
      todoCalendarMonthLabel,
      todoCalendarSelectedDate,
      todoCountsByDate,
      todoCreateOpen,
      todoDateDraft,
      todoDateError,
      todoDatePickerOpen,
      todoDraft,
      todoEditingContext,
      todoHourDraft,
      todoListEntries,
      todoListRange,
      todoMinuteDraft,
      todoScreenCalendarCells,
      todoScreenCalendarMonthLabel,
      todoTimePickerOpen,
      todoViewMode,
      toggleSimpleTodoDone,
      toggleTodoDraftTag,
      unscheduledTodos,
    ],
  );

  return (
    <TodoWorkspaceContext.Provider value={value}>
      {children}
    </TodoWorkspaceContext.Provider>
  );
};

export const useTodoWorkspace = () => {
  const context = useContext(TodoWorkspaceContext);
  if (!context) {
    throw new Error("useTodoWorkspace must be used within TodoWorkspaceProvider");
  }
  return context;
};

export type { TodoWorkspaceContextValue };
