import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Keyboard } from "react-native";

import { saveDownloadCompleteNoticeShown } from "../../storage";
import { useAppUIBootstrap } from "../hooks/app/useAppUIBootstrap";
import { useAppSettings } from "./AppSettingsContext";
import {
  APP_WORKSPACE_TRANSITION_POLICY,
  transitionAppRootScreen,
  type AppRootScreen,
  type MemoWorkspaceTabKey,
  type AppWorkspaceNavigationState,
  type MemoWorkspaceScreenKey,
  type SettingsWorkspaceScreenKey,
  type TaskWorkspaceScreenKey,
} from "../types/appNavigation";

type CalendarDayCell = {
  iso: string;
  day: number;
  inCurrentMonth: boolean;
};

type AppUIContextValue = {
  rootScreen: AppRootScreen;
  selectedDate: string;
  menuOpen: boolean;
  datePickerOpen: boolean;
  dateDraft: string;
  dateError: string | null;
  datePickerMonth: Date;
  calendarWeekdayLabels: string[];
  calendarMonthLabel: string;
  calendarCells: CalendarDayCell[];
  downloadCompleteNoticeOpen: boolean;
  taskScreen: TaskWorkspaceScreenKey;
  memoScreen: MemoWorkspaceScreenKey;
  memoTab: MemoWorkspaceTabKey;
  settingsScreen: SettingsWorkspaceScreenKey;
  memoDetailId: string | null;
  memoSearchOpen: boolean;
  memoSearchQuery: string;
  openTasks: (screen?: TaskWorkspaceScreenKey) => void;
  openTaskToday: () => void;
  openTaskLogs: () => void;
  openTaskArchive: () => void;
  setTaskScreen: React.Dispatch<React.SetStateAction<TaskWorkspaceScreenKey>>;
  openTodo: () => void;
  openMemos: (screen?: MemoWorkspaceScreenKey) => void;
  openMemoHome: () => void;
  openMemoNotes: () => void;
  openMemoResearch: () => void;
  setMemoScreen: React.Dispatch<React.SetStateAction<MemoWorkspaceScreenKey>>;
  setMemoTab: React.Dispatch<React.SetStateAction<MemoWorkspaceTabKey>>;
  openSettings: (screen?: SettingsWorkspaceScreenKey) => void;
  openSettingsHome: () => void;
  openSettingsSync: () => void;
  openSettingsAccount: () => void;
  openSettingsTimeBoxes: () => void;
  openSettingsTags: () => void;
  openSettingsDeletedItems: () => void;
  setSettingsScreen: React.Dispatch<
    React.SetStateAction<SettingsWorkspaceScreenKey>
  >;
  openMemoDetail: (memoId: string) => void;
  closeMemoDetail: () => void;
  openMemoSearch: (query: string) => void;
  closeMemoSearch: () => void;
  openMenu: () => void;
  closeMenu: () => void;
  openDatePicker: () => void;
  closeDatePicker: () => void;
  jumpToToday: () => void;
  shiftDateDraft: (delta: number) => void;
  shiftDatePickerMonth: (delta: number) => void;
  setDateDraft: React.Dispatch<React.SetStateAction<string>>;
  selectDateFromCalendar: (isoDate: string) => void;
  applyDateDraft: () => void;
  dismissDownloadCompleteNotice: () => Promise<void>;
};

const AppUIContext = createContext<AppUIContextValue | null>(null);

const pad2 = (num: number) => String(num).padStart(2, "0");

const toDateString = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;

const getDaysInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate();

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

const buildCalendarMonthCells = (monthDate: Date): CalendarDayCell[] => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const firstWeekday = firstDayOfMonth.getDay();
  const daysInMonth = getDaysInMonth(year, month);
  const prevMonthDays = getDaysInMonth(year, month - 1);
  const cells: CalendarDayCell[] = [];

  for (let index = 0; index < 42; index += 1) {
    const offset = index - firstWeekday;
    if (offset < 0) {
      const day = prevMonthDays + offset + 1;
      const date = new Date(year, month - 1, day);
      cells.push({ iso: toDateString(date), day, inCurrentMonth: false });
      continue;
    }
    if (offset >= daysInMonth) {
      const day = offset - daysInMonth + 1;
      const date = new Date(year, month + 1, day);
      cells.push({ iso: toDateString(date), day, inCurrentMonth: false });
      continue;
    }
    const day = offset + 1;
    const date = new Date(year, month, day);
    cells.push({ iso: toDateString(date), day, inCurrentMonth: true });
  }

  return cells;
};

export const AppUIProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { appLanguage, languagePickerOpen, tr } = useAppSettings();
  const [rootScreen, setRootScreen] = useState<AppRootScreen>("tasks");
  const [taskScreen, setTaskScreen] = useState<TaskWorkspaceScreenKey>("today");
  const [memoScreen, setMemoScreen] = useState<MemoWorkspaceScreenKey>("memo");
  const [memoTab, setMemoTab] = useState<MemoWorkspaceTabKey>("all");
  const [settingsScreen, setSettingsScreen] =
    useState<SettingsWorkspaceScreenKey>("settings");
  const [memoDetailId, setMemoDetailId] = useState<string | null>(null);
  const [memoSearchOpen, setMemoSearchOpen] = useState(false);
  const [memoSearchQuery, setMemoSearchQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>(
    toDateString(new Date()),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState(selectedDate);
  const [dateError, setDateError] = useState<string | null>(null);
  const [datePickerMonth, setDatePickerMonth] = useState<Date>(() => {
    const parsed = parseDateString(toDateString(new Date())) ?? new Date();
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  });
  const [downloadCompleteNoticeOpen, setDownloadCompleteNoticeOpen] =
    useState(false);
  const [downloadNoticePending, setDownloadNoticePending] = useState(false);

  useAppUIBootstrap({
    languagePickerOpen,
    downloadNoticePending,
    toDateString,
    setSelectedDate,
    setDateDraft,
    setDateError,
    setDownloadNoticePending,
    setDownloadCompleteNoticeOpen,
  });

  const closeMemoDetail = useCallback(() => {
    setMemoDetailId(null);
  }, []);

  const closeMemoSearch = useCallback(() => {
    setMemoSearchOpen(false);
  }, []);

  const switchRootScreen = useCallback(
    (nextRoot: AppRootScreen) => {
      Keyboard.dismiss();
      const currentState: AppWorkspaceNavigationState = {
        rootScreen,
        taskScreen,
        memoScreen,
        memoTab,
        settingsScreen,
        memoDetailId,
        memoSearchOpen,
        memoSearchQuery,
      };
      const nextState = transitionAppRootScreen(currentState, nextRoot);
      if (nextState === currentState) {
        return;
      }
      if (nextState.taskScreen !== taskScreen) {
        setTaskScreen(nextState.taskScreen);
      }
      if (nextState.settingsScreen !== settingsScreen) {
        setSettingsScreen(nextState.settingsScreen);
      }
      if (nextState.memoTab !== memoTab) {
        setMemoTab(nextState.memoTab);
      }
      if (nextState.memoDetailId !== memoDetailId) {
        setMemoDetailId(nextState.memoDetailId);
      }
      setRootScreen(nextState.rootScreen);
    },
    [
      memoDetailId,
      memoScreen,
      memoTab,
      memoSearchOpen,
      memoSearchQuery,
      rootScreen,
      settingsScreen,
      taskScreen,
    ],
  );

  const openMenu = useCallback(() => {
    Keyboard.dismiss();
    setMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const openDatePicker = useCallback(() => {
    const parsed = parseDateString(selectedDate) ?? new Date();
    setDatePickerMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    setDateDraft(selectedDate);
    setDateError(null);
    setDatePickerOpen(true);
  }, [selectedDate]);

  const closeDatePicker = useCallback(() => {
    setDatePickerOpen(false);
  }, []);

  const jumpToToday = useCallback(() => {
    const today = toDateString(new Date());
    setSelectedDate(today);
    setDateDraft(today);
    setDateError(null);
    setDatePickerOpen(false);
  }, []);

  const shiftDateDraft = useCallback((delta: number) => {
    const base = parseDateString(dateDraft) ?? parseDateString(selectedDate);
    const date = base ?? new Date();
    const next = new Date(date);
    next.setDate(next.getDate() + delta);
    setDateDraft(toDateString(next));
    setDateError(null);
  }, [dateDraft, selectedDate]);

  const shiftDatePickerMonth = useCallback((delta: number) => {
    setDatePickerMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }, []);

  const selectDateFromCalendar = useCallback((isoDate: string) => {
    setSelectedDate(isoDate);
    setDateDraft(isoDate);
    setDateError(null);
    setDatePickerOpen(false);
  }, []);

  const applyDateDraft = useCallback(() => {
    const parsed = parseDateString(dateDraft);
    if (!parsed) {
      setDateError(tr("validation.invalidDate"));
      return;
    }
    setSelectedDate(toDateString(parsed));
    setDatePickerOpen(false);
  }, [dateDraft, tr]);

  const dismissDownloadCompleteNotice = useCallback(async () => {
    setDownloadCompleteNoticeOpen(false);
    await saveDownloadCompleteNoticeShown();
  }, []);

  const openTasks = useCallback((screen?: TaskWorkspaceScreenKey) => {
    if (screen) {
      setTaskScreen(screen);
    }
    switchRootScreen("tasks");
  }, [switchRootScreen]);

  const openTaskToday = useCallback(() => {
    setTaskScreen("today");
    switchRootScreen("tasks");
  }, [switchRootScreen]);

  const openTaskLogs = useCallback(() => {
    setTaskScreen("logs");
    switchRootScreen("tasks");
  }, [switchRootScreen]);

  const openTaskArchive = useCallback(() => {
    setTaskScreen("archive");
    switchRootScreen("tasks");
  }, [switchRootScreen]);

  const openTodo = useCallback(() => {
    switchRootScreen("todo");
  }, [switchRootScreen]);

  const openMemos = useCallback((screen?: MemoWorkspaceScreenKey) => {
    if (screen) {
      setMemoScreen(screen);
      if (screen === "notes") {
        setMemoTab("note");
      }
    }
    switchRootScreen("memos");
  }, [switchRootScreen]);

  const openMemoHome = useCallback(() => {
    setMemoScreen("memo");
    setMemoTab("all");
    switchRootScreen("memos");
  }, [switchRootScreen]);

  const openMemoNotes = useCallback(() => {
    setMemoScreen("notes");
    setMemoTab("note");
    switchRootScreen("memos");
  }, [switchRootScreen]);

  const openMemoResearch = useCallback(() => {
    setMemoScreen("research");
    switchRootScreen("memos");
  }, [switchRootScreen]);

  const openSettings = useCallback((screen?: SettingsWorkspaceScreenKey) => {
    setSettingsScreen(screen ?? APP_WORKSPACE_TRANSITION_POLICY.settings.rootScreen);
    switchRootScreen("settings");
  }, [switchRootScreen]);

  const openSettingsHome = useCallback(() => {
    setSettingsScreen(APP_WORKSPACE_TRANSITION_POLICY.settings.rootScreen);
    switchRootScreen("settings");
  }, [switchRootScreen]);

  const openSettingsSync = useCallback(() => {
    setSettingsScreen("sync");
    switchRootScreen("settings");
  }, [switchRootScreen]);

  const openSettingsAccount = useCallback(() => {
    setSettingsScreen("account");
    switchRootScreen("settings");
  }, [switchRootScreen]);

  const openSettingsTimeBoxes = useCallback(() => {
    setSettingsScreen("timeSettings");
    switchRootScreen("settings");
  }, [switchRootScreen]);

  const openSettingsTags = useCallback(() => {
    setSettingsScreen("tags");
    switchRootScreen("settings");
  }, [switchRootScreen]);

  const openSettingsDeletedItems = useCallback(() => {
    setSettingsScreen("deletedItems");
    switchRootScreen("settings");
  }, [switchRootScreen]);

  const openMemoDetail = useCallback((nextMemoId: string) => {
    setMemoDetailId(nextMemoId);
  }, []);

  const openMemoSearch = useCallback((query: string) => {
    setMemoSearchQuery(query);
    setMemoSearchOpen(true);
  }, []);

  const calendarWeekdayLabels = appLanguage === "en"
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["日", "月", "火", "水", "木", "金", "土"];
  const calendarMonthLabel = `${datePickerMonth.getFullYear()}-${pad2(
    datePickerMonth.getMonth() + 1,
  )}`;
  const calendarCells = useMemo(
    () => buildCalendarMonthCells(datePickerMonth),
    [datePickerMonth],
  );

  const value = useMemo<AppUIContextValue>(
    () => ({
      rootScreen,
      selectedDate,
      menuOpen,
      datePickerOpen,
      dateDraft,
      dateError,
      datePickerMonth,
      calendarWeekdayLabels,
      calendarMonthLabel,
      calendarCells,
      downloadCompleteNoticeOpen,
      taskScreen,
      memoScreen,
      memoTab,
      settingsScreen,
      memoDetailId,
      memoSearchOpen,
      memoSearchQuery,
      openTasks,
      openTaskToday,
      openTaskLogs,
      openTaskArchive,
      setTaskScreen,
      openTodo,
      openMemos,
      openMemoHome,
      openMemoNotes,
      openMemoResearch,
      setMemoScreen,
      setMemoTab,
      openSettings,
      openSettingsHome,
      openSettingsSync,
      openSettingsAccount,
      openSettingsTimeBoxes,
      openSettingsTags,
      openSettingsDeletedItems,
      setSettingsScreen,
      openMemoDetail,
      closeMemoDetail,
      openMemoSearch,
      closeMemoSearch,
      openMenu,
      closeMenu,
      openDatePicker,
      closeDatePicker,
      jumpToToday,
      shiftDateDraft,
      shiftDatePickerMonth,
      setDateDraft,
      selectDateFromCalendar,
      applyDateDraft,
      dismissDownloadCompleteNotice,
    }),
    [
      applyDateDraft,
      calendarCells,
      calendarMonthLabel,
      calendarWeekdayLabels,
      closeDatePicker,
      closeMenu,
      closeMemoDetail,
      closeMemoSearch,
      dateDraft,
      dateError,
      datePickerMonth,
      datePickerOpen,
      dismissDownloadCompleteNotice,
      downloadCompleteNoticeOpen,
      jumpToToday,
      memoDetailId,
      memoScreen,
      memoTab,
      memoSearchOpen,
      memoSearchQuery,
      menuOpen,
      openDatePicker,
      openMemoDetail,
      openMemos,
      openMemoHome,
      openMemoNotes,
      openMemoResearch,
      openMemoSearch,
      openMenu,
      openSettings,
      openSettingsHome,
      openSettingsSync,
      openSettingsAccount,
      openSettingsDeletedItems,
      openSettingsTags,
      openSettingsTimeBoxes,
      openTaskArchive,
      openTaskLogs,
      openTasks,
      openTaskToday,
      openTodo,
      rootScreen,
      selectedDate,
      selectDateFromCalendar,
      settingsScreen,
      shiftDateDraft,
      shiftDatePickerMonth,
      taskScreen,
    ],
  );

  return <AppUIContext.Provider value={value}>{children}</AppUIContext.Provider>;
};

export const useAppUI = () => {
  const context = useContext(AppUIContext);
  if (!context) {
    throw new Error("useAppUI must be used within AppUIProvider");
  }
  return context;
};
