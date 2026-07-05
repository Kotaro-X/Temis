import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from "react-native";

import type { TaskFiltersProps } from "../../components/tasks/TaskFilters";
import type { TaskLogListProps } from "../../components/tasks/TaskLogList";
import { getDefaultTagsForLanguage } from "../../tagLocalization";
import styles from "../../styles/workspaceSharedStyles";
import type { LogEntry, Tag } from "../../types";
import type { AppLanguage } from "../../i18n";

const ALL_TAG_FILTER = "すべて";
const NO_TAG_LABEL = "タグなし";
const LOG_ANALYSIS_Y_AXIS_WIDTH = 36;
const LOG_ANALYSIS_X_AXIS_HEIGHT = 22;
const LOG_ANALYSIS_CHART_TOP_PADDING = 10;
const LOG_ANALYSIS_CHART_RIGHT_PADDING = 8;
const LOG_ANALYSIS_Y_TICK_COUNT = 4;

type DailyTotal = {
  date: string;
  minutes: number;
};

type AnalysisChartPoint = {
  x: number;
  y: number;
  date: string;
};

type AnalysisXAxisLabel = {
  key: string;
  x: number;
  label: string;
  anchor: "start" | "middle" | "end";
};

type AnalysisYAxisTick = {
  key: string;
  y: number;
  label: string;
};

type UseTaskLogStateArgs = {
  logs: LogEntry[];
  tagLibrary: Tag[];
  appLanguage: AppLanguage;
  noTagLabel: string;
  untitledLabel: string;
  tr: (key: string) => string;
  isLandscape: boolean;
  height: number;
  active: boolean;
};

export type UseTaskLogStateResult = {
  filtersProps: TaskFiltersProps;
  logListProps: TaskLogListProps;
  scrollRef: RefObject<ScrollView | null>;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  syncTagRename: (current: Tag, next: Tag) => void;
  syncTagArchive: (tag: Tag) => void;
};

const pad2 = (num: number) => String(num).padStart(2, "0");
const round1 = (num: number) => Math.round(num * 10) / 10;

const toDateString = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;

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

const formatAxisMinutes = (value: number) => {
  const rounded = round1(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const getNiceAxisMax = (value: number) => {
  if (value <= 0) {
    return 0;
  }
  if (value <= 10) {
    return Math.ceil(value);
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  if (normalized <= 1) {
    return 1 * magnitude;
  }
  if (normalized <= 2) {
    return 2 * magnitude;
  }
  if (normalized <= 5) {
    return 5 * magnitude;
  }
  return 10 * magnitude;
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
): DailyTotal[] => {
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

export const useTaskLogState = ({
  logs,
  tagLibrary,
  appLanguage,
  noTagLabel,
  untitledLabel,
  tr,
  isLandscape,
  height,
  active,
}: UseTaskLogStateArgs): UseTaskLogStateResult => {
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
  const logScrollRef = useRef<ScrollView | null>(null);
  const logScrollOffset = useRef({ x: 0, y: 0 });
  const logTableScrollRef = useRef<ScrollView | null>(null);
  const logTableScrollOffset = useRef({ x: 0, y: 0 });
  const logBoardScrollRef = useRef<ScrollView | null>(null);
  const logBoardScrollOffset = useRef({ x: 0, y: 0 });

  const last7Logs = useMemo(() => {
    const today = new Date();
    const last7Dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - index);
      return toDateString(date);
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
  }, [last7Logs, tagLibrary]);

  const logAnalysisTagOptions = useMemo(() => {
    const options = [
      ALL_TAG_FILTER,
      ...(tagLibrary.length > 0
        ? tagLibrary
        : getDefaultTagsForLanguage(appLanguage)),
    ];
    const hasNoTag = logs.some((log) => log.tags.length === 0);
    if (hasNoTag && !options.includes(NO_TAG_LABEL)) {
      options.push(NO_TAG_LABEL);
    }
    return options;
  }, [appLanguage, logs, tagLibrary]);

  const logAnalysisChartHeight = Math.max(180, Math.round(height * 0.28));

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
      };
    }
    if (logAnalysisPeriod === 30) {
      const offset = logAnalysisOffsets[30];
      const anchor = new Date(today.getFullYear(), today.getMonth() - offset, 1);
      const daysInMonth = getDaysInMonth(
        anchor.getFullYear(),
        anchor.getMonth(),
      );
      const end =
        offset === 0
          ? today
          : new Date(anchor.getFullYear(), anchor.getMonth(), daysInMonth);
      return {
        dateList: buildDateRange(anchor, end),
        label: formatMonth(anchor),
      };
    }
    const offset = logAnalysisOffsets[365];
    const year = today.getFullYear() - offset;
    const start = new Date(year, 0, 1);
    const end = offset === 0 ? today : new Date(year, 11, 31);
    return {
      dateList: buildDateRange(start, end),
      label: `${year}/01 – ${year}/12`,
    };
  }, [logAnalysisOffsets, logAnalysisPeriod]);

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
  }, [filteredLogs, tagLibrary]);

  const logAnalysisTotals = useMemo(
    () =>
      buildDailyTotalsForDates(
        logs,
        logAnalysisRange.dateList,
        logAnalysisTag,
      ),
    [logAnalysisRange.dateList, logAnalysisTag, logs],
  );

  const logAnalysisDisplayMax = useMemo(() => {
    let max = 0;
    for (const item of logAnalysisTotals) {
      max = Math.max(max, item.minutes);
    }
    return max;
  }, [logAnalysisTotals]);

  const logAnalysisScaleMax = useMemo(
    () => getNiceAxisMax(logAnalysisDisplayMax),
    [logAnalysisDisplayMax],
  );

  const logAnalysisPlot = useMemo(() => {
    const plotLeft = LOG_ANALYSIS_Y_AXIS_WIDTH;
    const plotRight = LOG_ANALYSIS_CHART_RIGHT_PADDING;
    const plotTop = LOG_ANALYSIS_CHART_TOP_PADDING;
    const plotBottom = LOG_ANALYSIS_X_AXIS_HEIGHT;
    const plotWidth = Math.max(1, logAnalysisWidth - plotLeft - plotRight);
    const plotHeight = Math.max(1, logAnalysisChartHeight - plotTop - plotBottom);
    return {
      plotLeft,
      plotRight,
      plotTop,
      plotBottom,
      plotWidth,
      plotHeight,
    };
  }, [logAnalysisChartHeight, logAnalysisWidth]);

  const logAnalysisPoints = useMemo(() => {
    const divisor = logAnalysisScaleMax > 0 ? logAnalysisScaleMax : 1;
    const lastIndex = logAnalysisTotals.length - 1;
    return logAnalysisTotals.map((item, index) => {
      const xRatio = lastIndex <= 0 ? 0.5 : index / lastIndex;
      const yRatio = Math.max(0, Math.min(1, item.minutes / divisor));
      const x = logAnalysisPlot.plotLeft + xRatio * logAnalysisPlot.plotWidth;
      const y =
        logAnalysisPlot.plotTop +
        (1 - yRatio) * logAnalysisPlot.plotHeight;
      return { x, y, date: item.date, minutes: item.minutes };
    });
  }, [logAnalysisPlot, logAnalysisScaleMax, logAnalysisTotals]);

  const logAnalysisXAxisLabels = useMemo(() => {
    const lastIndex = logAnalysisTotals.length - 1;
    if (lastIndex < 0) {
      return [];
    }
    const indexSet = new Set<number>([0, lastIndex]);
    if (logAnalysisPeriod === 7) {
      for (let index = 0; index <= lastIndex; index += 1) {
        indexSet.add(index);
      }
    } else if (logAnalysisPeriod === 30) {
      for (let index = 0; index <= lastIndex; index += 5) {
        indexSet.add(index);
      }
    } else {
      logAnalysisTotals.forEach((item, index) => {
        if (item.date.endsWith("-01")) {
          indexSet.add(index);
        }
      });
    }
    return [...indexSet]
      .sort((a, b) => a - b)
      .map((index) => {
        const item = logAnalysisTotals[index];
        const label =
          logAnalysisPeriod === 365
            ? formatMonthLabel(item.date)
            : formatShortDate(item.date);
        const anchor: AnalysisXAxisLabel["anchor"] =
          index === 0 ? "start" : index === lastIndex ? "end" : "middle";
        return {
          key: `x-${item.date}`,
          x: logAnalysisPoints[index]?.x ?? logAnalysisPlot.plotLeft,
          label,
          anchor,
        };
      });
  }, [
    logAnalysisPeriod,
    logAnalysisPlot.plotLeft,
    logAnalysisPoints,
    logAnalysisTotals,
  ]);

  const logAnalysisYAxisTicks = useMemo(() => {
    const intervals = Math.max(1, LOG_ANALYSIS_Y_TICK_COUNT - 1);
    return Array.from({ length: LOG_ANALYSIS_Y_TICK_COUNT }, (_, index) => {
      const ratio = index / intervals;
      const value = logAnalysisScaleMax * (1 - ratio);
      return {
        key: `y-${index}`,
        y: logAnalysisPlot.plotTop + ratio * logAnalysisPlot.plotHeight,
        label: `${formatAxisMinutes(value)}m`,
      };
    });
  }, [logAnalysisPlot, logAnalysisScaleMax]);

  const logAnalysisShowMarkers = logAnalysisTotals.length <= 60;
  const logAnalysisMarkerRadius = logAnalysisPeriod === 7 ? 2.2 : 1.6;
  const logAnalysisCanNext = logAnalysisOffsets[logAnalysisPeriod] > 0;

  useEffect(() => {
    if (!active) {
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
  }, [active, isLandscape, logView]);

  const filtersProps = useMemo<TaskFiltersProps>(
    () => ({
      styles,
      tr,
      isLandscape,
      logView,
      onChangeLogView: setLogView,
      logQuery,
      onChangeLogQuery: setLogQuery,
      tagFilterOptions,
      logTagFilter,
      onChangeLogTagFilter: setLogTagFilter,
      noTagLabel,
      allTagFilter: ALL_TAG_FILTER,
      noTagKey: NO_TAG_LABEL,
    }),
    [
      isLandscape,
      logQuery,
      logTagFilter,
      logView,
      noTagLabel,
      styles,
      tagFilterOptions,
      tr,
    ],
  );

  const logListProps = useMemo<TaskLogListProps>(
    () => ({
      styles,
      tr,
      language: appLanguage,
      isLandscape,
      logView,
      filteredLogs,
      noTagLabel,
      untitledLabel,
      boardTags,
      logAnalysisCollapsed,
      onToggleAnalysis: () => setLogAnalysisCollapsed((prev) => !prev),
      logAnalysisPeriod,
      onChangePeriod: setLogAnalysisPeriod,
      onPrevRange: () =>
        setLogAnalysisOffsets((prev) => ({
          ...prev,
          [logAnalysisPeriod]: prev[logAnalysisPeriod] + 1,
        })),
      onNextRange: () =>
        logAnalysisCanNext &&
        setLogAnalysisOffsets((prev) => ({
          ...prev,
          [logAnalysisPeriod]: Math.max(0, prev[logAnalysisPeriod] - 1),
        })),
      logAnalysisRangeLabel: logAnalysisRange.label,
      logAnalysisCanNext,
      logAnalysisTagOptions,
      logAnalysisTag,
      onChangeAnalysisTag: setLogAnalysisTag,
      allTagFilter: ALL_TAG_FILTER,
      noTagKey: NO_TAG_LABEL,
      logAnalysisChartHeight,
      logAnalysisWidth,
      onLayoutChart: (width: number) => {
        if (width !== logAnalysisWidth) {
          setLogAnalysisWidth(width);
        }
      },
      logAnalysisPlot,
      logAnalysisPoints,
      logAnalysisXAxisLabels,
      logAnalysisYAxisTicks,
      logAnalysisShowMarkers,
      logAnalysisMarkerRadius,
      logAnalysisTotals,
      logAnalysisDisplayMax,
      tableScrollRef: logTableScrollRef,
      boardScrollRef: logBoardScrollRef,
      onTableScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        logTableScrollOffset.current = event.nativeEvent.contentOffset;
      },
      onBoardScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        logBoardScrollOffset.current = event.nativeEvent.contentOffset;
      },
    }),
    [
      appLanguage,
      boardTags,
      filteredLogs,
      isLandscape,
      logAnalysisCanNext,
      logAnalysisChartHeight,
      logAnalysisCollapsed,
      logAnalysisDisplayMax,
      logAnalysisMarkerRadius,
      logAnalysisPeriod,
      logAnalysisPlot,
      logAnalysisPoints,
      logAnalysisRange.label,
      logAnalysisShowMarkers,
      logAnalysisTag,
      logAnalysisTagOptions,
      logAnalysisTotals,
      logAnalysisWidth,
      logAnalysisXAxisLabels,
      logAnalysisYAxisTicks,
      logView,
      noTagLabel,
      styles,
      tr,
      untitledLabel,
    ],
  );

  return {
    filtersProps,
    logListProps,
    scrollRef: logScrollRef,
    onScroll: (event) => {
      logScrollOffset.current = event.nativeEvent.contentOffset;
    },
    syncTagRename: (current: Tag, next: Tag) => {
      setLogTagFilter((prev) => (prev === current ? next : prev));
      setLogAnalysisTag((prev) => (prev === current ? next : prev));
    },
    syncTagArchive: (tag: Tag) => {
      setLogTagFilter((prev) => (prev === tag ? ALL_TAG_FILTER : prev));
      setLogAnalysisTag((prev) => (prev === tag ? ALL_TAG_FILTER : prev));
    },
  };
};
