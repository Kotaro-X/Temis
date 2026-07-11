import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAppRefresh } from "./AppRefreshContext";
import { useTodos } from "../hooks/useTodos";
import {
  TODO_REPEAT_OPTIONS,
  buildCalendarMonthCells,
  buildTodoEntriesForDate,
  buildTodoListEntries,
  createEmptyTodoDraft,
  getTodoListRangeEndDate,
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
import { useTodoCrudActions } from "../hooks/todos/useTodoCrudActions";
import { useTodoNotifications } from "../hooks/todos/useTodoNotifications";
import {
  applyTodoWorkspaceDeactivationPolicy,
  isTodoComposerClosed,
  isTodoDraftEmpty,
} from "../hooks/todos/todoWorkspacePolicy";
import type { AppLanguage } from "../i18n";
import { getDefaultTagsForLanguage } from "../tagLocalization";
import type { SimpleTodoItem, Tag } from "../types";

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

  const { cancelTodoNotifications, rescheduleTodoNotification } =
    useTodoNotifications({
      simpleTodos,
      setSimpleTodos,
      persistTodos,
      storageReady,
      tr,
      untitledLabel,
    });

  const {
    openTodoCreate,
    closeTodoCreate,
    openTodoEdit,
    addSimpleTodo,
    applyTodoEdit,
    toggleTodoDraftTag,
    setTodoDraftRepeat,
    toggleSimpleTodoDone,
    deleteSimpleTodo,
  } = useTodoCrudActions({
    simpleTodos,
    persistTodos,
    todoCreateOpen,
    setTodoCreateOpen,
    todoEditingContext,
    setTodoEditingContext,
    todoDraft,
    setTodoDraft,
    openSwipeTodoId,
    setOpenSwipeTodoId,
    todoDatePickerOpen,
    setTodoDatePickerOpen,
    todoTimePickerOpen,
    setTodoTimePickerOpen,
    todoDateError,
    setTodoDateError,
    cancelTodoNotifications,
    rescheduleTodoNotification,
  });

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
