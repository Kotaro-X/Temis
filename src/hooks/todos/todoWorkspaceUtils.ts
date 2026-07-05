import type { SimpleTodoItem, Tag, TodoRepeat } from "../../types";

const pad2 = (num: number) => String(num).padStart(2, "0");

export const TIME_PICKER_ITEM_HEIGHT = 44;
const TIME_PICKER_VISIBLE_ROWS = 5;
export const TIME_PICKER_SIDE_PADDING =
  ((TIME_PICKER_VISIBLE_ROWS - 1) / 2) * TIME_PICKER_ITEM_HEIGHT;

export const TODO_REPEAT_OPTIONS: Array<Exclude<TodoRepeat, "none">> = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
];

export type CalendarDayCell = {
  iso: string;
  day: number;
  inCurrentMonth: boolean;
};

export type TodoEditScope = "single" | "series";
export type TodoListRange = "today" | "week" | "month";

export type TodoListEntry = {
  key: string;
  todo: SimpleTodoItem;
  seriesMaster: SimpleTodoItem | null;
  seriesId: string | null;
  occurrenceDate: string | null;
  displayDate: string | null;
  displayTime: string | null;
  isRecurringSeries: boolean;
};

export type TodoEditContext = {
  todoId: string;
  seriesId: string | null;
  occurrenceDate: string | null;
  isRecurringSeries: boolean;
};

export type TodoDraft = {
  text: string;
  memo: string;
  reminderDate: string;
  reminderTime: string;
  repeat: TodoRepeat;
  tags: Tag[];
};

export const createEmptyTodoDraft = (): TodoDraft => ({
  text: "",
  memo: "",
  reminderDate: "",
  reminderTime: "",
  repeat: "none",
  tags: [],
});

export const toDateString = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;

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

export const parseDateString = (value: string): Date | null => {
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

const getDaysInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate();

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const addMonthsClamped = (date: Date, months: number) => {
  const targetYear = date.getFullYear();
  const targetMonth = date.getMonth() + months;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(date.getDate(), lastDay));
};

const addYearsClamped = (date: Date, years: number) => {
  const targetYear = date.getFullYear() + years;
  const targetMonth = date.getMonth();
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(date.getDate(), lastDay));
};

const addRepeatInterval = (date: Date, repeat: TodoRepeat, count: number) => {
  switch (repeat) {
    case "daily":
      return addDays(date, count);
    case "weekly":
      return addDays(date, count * 7);
    case "monthly":
      return addMonthsClamped(date, count);
    case "yearly":
      return addYearsClamped(date, count);
    default:
      return new Date(date);
  }
};

export const getRepeatBadgeLabel = (repeat: TodoRepeat) => {
  switch (repeat) {
    case "daily":
      return "毎日";
    case "weekly":
      return "毎週";
    case "monthly":
      return "毎月";
    case "yearly":
      return "毎年";
    default:
      return "";
  }
};

export const getTodoListRangeEndDate = (
  baseDateISO: string,
  range: TodoListRange,
) => {
  const baseDate = parseDateString(baseDateISO) ?? new Date();
  if (range === "today") {
    return baseDateISO;
  }
  if (range === "week") {
    return toDateString(addDays(baseDate, 6));
  }
  return toDateString(addDays(addMonthsClamped(baseDate, 1), -1));
};

export const isRecurringSeriesMaster = (todo: SimpleTodoItem) =>
  todo.repeat !== "none" && Boolean(todo.reminderDate) && !todo.occurrenceDate;

export const getTodoSeriesId = (todo: SimpleTodoItem) =>
  todo.seriesId ?? (isRecurringSeriesMaster(todo) ? todo.id : null);

export const getTodoSeriesAnchorDate = (todo: SimpleTodoItem) =>
  todo.seriesAnchorDate ?? (isRecurringSeriesMaster(todo) ? todo.reminderDate : null);

export const getTodoNotificationIds = (todo: SimpleTodoItem) => {
  if (todo.notificationIds.length > 0) {
    return todo.notificationIds;
  }
  return todo.notificationId ? [todo.notificationId] : [];
};

const isActiveTodoItem = (todo: SimpleTodoItem) => !todo.isDeleted;

const buildTodoListEntry = ({
  todo,
  seriesMaster,
  occurrenceDate,
  displayDate,
}: {
  todo: SimpleTodoItem;
  seriesMaster?: SimpleTodoItem | null;
  occurrenceDate?: string | null;
  displayDate?: string | null;
}): TodoListEntry => ({
  key: occurrenceDate ? `${todo.id}:${occurrenceDate}` : todo.id,
  todo,
  seriesMaster: seriesMaster ?? null,
  seriesId: getTodoSeriesId(seriesMaster ?? todo),
  occurrenceDate: occurrenceDate ?? todo.occurrenceDate ?? todo.reminderDate,
  displayDate: displayDate ?? todo.reminderDate,
  displayTime: todo.reminderTime,
  isRecurringSeries: Boolean(
    (seriesMaster && isRecurringSeriesMaster(seriesMaster)) ||
      (!seriesMaster && isRecurringSeriesMaster(todo)),
  ),
});

export const buildTodoEntriesForDate = (
  items: SimpleTodoItem[],
  startDateISO: string,
  endDateISO: string,
) => {
  const startDate = parseDateString(startDateISO);
  const endDate = parseDateString(endDateISO);
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
    return [];
  }

  const overrides = new Map<string, SimpleTodoItem>();
  for (const todo of items) {
    if (!todo.occurrenceDate) {
      continue;
    }
    const seriesId = getTodoSeriesId(todo);
    if (!seriesId) {
      continue;
    }
    overrides.set(`${seriesId}:${todo.occurrenceDate}`, todo);
  }

  const entries: TodoListEntry[] = [];
  for (const todo of items) {
    if (!isActiveTodoItem(todo)) {
      continue;
    }
    if (todo.occurrenceDate) {
      const displayDate = todo.reminderDate;
      if (!displayDate || displayDate < startDateISO || displayDate > endDateISO) {
        continue;
      }
      const master =
        todo.seriesId
          ? items.find(
              (candidate) =>
                getTodoSeriesId(candidate) === todo.seriesId &&
                isRecurringSeriesMaster(candidate),
            ) ?? null
          : null;
      entries.push(
        buildTodoListEntry({
          todo,
          seriesMaster: master,
          occurrenceDate: todo.occurrenceDate,
          displayDate,
        }),
      );
      continue;
    }

    if (isRecurringSeriesMaster(todo)) {
      const seriesId = getTodoSeriesId(todo);
      const anchorDateISO = getTodoSeriesAnchorDate(todo);
      const anchorDate = anchorDateISO ? parseDateString(anchorDateISO) : null;
      if (!seriesId || !anchorDate) {
        continue;
      }
      let offset = 0;
      while (true) {
        const occurrence = addRepeatInterval(anchorDate, todo.repeat, offset);
        const occurrenceDateISO = toDateString(occurrence);
        if (occurrenceDateISO > endDateISO) {
          break;
        }
        if (occurrenceDateISO >= startDateISO && !overrides.has(`${seriesId}:${occurrenceDateISO}`)) {
          entries.push(
            buildTodoListEntry({
              todo,
              seriesMaster: todo,
              occurrenceDate: occurrenceDateISO,
              displayDate: occurrenceDateISO,
            }),
          );
        }
        offset += 1;
      }
      continue;
    }

    const displayDate = todo.reminderDate;
    if (!displayDate || displayDate < startDateISO || displayDate > endDateISO) {
      continue;
    }
    entries.push(buildTodoListEntry({ todo, displayDate }));
  }
  return entries;
};

export const buildTodoListEntries = (
  items: SimpleTodoItem[],
  baseDateISO: string,
  rangeEndDateISO: string,
) => {
  const handledSeries = new Set<string>();
  const mastersBySeriesId = new Map<string, SimpleTodoItem>();
  const overridesBySeriesDate = new Map<string, SimpleTodoItem>();

  for (const todo of items) {
    const seriesId = getTodoSeriesId(todo);
    if (seriesId && isRecurringSeriesMaster(todo) && isActiveTodoItem(todo)) {
      mastersBySeriesId.set(seriesId, todo);
    }
    if (seriesId && todo.occurrenceDate) {
      overridesBySeriesDate.set(`${seriesId}:${todo.occurrenceDate}`, todo);
    }
  }

  const dated: TodoListEntry[] = [];
  for (const [seriesId, master] of mastersBySeriesId.entries()) {
    handledSeries.add(seriesId);
    const anchorDateISO = getTodoSeriesAnchorDate(master);
    const anchorDate = anchorDateISO ? parseDateString(anchorDateISO) : null;
    if (!anchorDate) {
      continue;
    }
    let nextDate = new Date(anchorDate);
    while (true) {
      const nextDateISO = toDateString(nextDate);
      const override = overridesBySeriesDate.get(`${seriesId}:${nextDateISO}`);
      if (nextDateISO >= baseDateISO && (!override || !override.isDeleted)) {
        break;
      }
      nextDate = addRepeatInterval(nextDate, master.repeat, 1);
    }
    const nextDateISO = toDateString(nextDate);
    if (nextDateISO > rangeEndDateISO) {
      continue;
    }
    const override = overridesBySeriesDate.get(`${seriesId}:${nextDateISO}`);
    if (override) {
      dated.push(
        buildTodoListEntry({
          todo: override,
          seriesMaster: master,
          occurrenceDate: override.occurrenceDate,
          displayDate: override.reminderDate ?? nextDateISO,
        }),
      );
      continue;
    }
    dated.push(
      buildTodoListEntry({
        todo: master,
        seriesMaster: master,
        occurrenceDate: nextDateISO,
        displayDate: nextDateISO,
      }),
    );
  }

  for (const todo of items) {
    if (!isActiveTodoItem(todo)) {
      continue;
    }
    if (todo.occurrenceDate) {
      const seriesId = getTodoSeriesId(todo);
      if (seriesId && handledSeries.has(seriesId)) {
        continue;
      }
      if (
        !todo.reminderDate ||
        todo.reminderDate < baseDateISO ||
        todo.reminderDate > rangeEndDateISO
      ) {
        continue;
      }
      dated.push(buildTodoListEntry({ todo, displayDate: todo.reminderDate }));
      continue;
    }
    if (isRecurringSeriesMaster(todo)) {
      continue;
    }
    if (
      todo.reminderDate &&
      (todo.reminderDate < baseDateISO || todo.reminderDate > rangeEndDateISO)
    ) {
      continue;
    }
    if (todo.reminderDate) {
      dated.push(buildTodoListEntry({ todo, displayDate: todo.reminderDate }));
    }
  }

  const unscheduled = items
    .filter(
      (todo) =>
        !todo.reminderDate && !todo.occurrenceDate && !isRecurringSeriesMaster(todo),
    )
    .map((todo) =>
      buildTodoListEntry({ todo, displayDate: null, occurrenceDate: null }),
    );

  return [...dated, ...unscheduled].sort((a, b) => {
    const aDate = a.displayDate ?? "9999-99-99";
    const bDate = b.displayDate ?? "9999-99-99";
    if (aDate !== bDate) {
      return aDate.localeCompare(bDate);
    }
    const aTime = a.displayTime ?? "99:99";
    const bTime = b.displayTime ?? "99:99";
    if (aTime !== bTime) {
      return aTime.localeCompare(bTime);
    }
    if (a.todo.isDone !== b.todo.isDone) {
      return Number(a.todo.isDone) - Number(b.todo.isDone);
    }
    return b.todo.createdAt - a.todo.createdAt;
  });
};

export const buildCalendarMonthCells = (monthDate: Date): CalendarDayCell[] => {
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

export const compareTodoItems = (a: SimpleTodoItem, b: SimpleTodoItem) => {
  const aDate = a.reminderDate ?? "9999-99-99";
  const bDate = b.reminderDate ?? "9999-99-99";
  if (aDate !== bDate) {
    return aDate.localeCompare(bDate);
  }
  const aTime = a.reminderTime ?? "99:99";
  const bTime = b.reminderTime ?? "99:99";
  if (aTime !== bTime) {
    return aTime.localeCompare(bTime);
  }
  if (a.isDone !== b.isDone) {
    return Number(a.isDone) - Number(b.isDone);
  }
  return b.createdAt - a.createdAt;
};

export const pruneCompletedSimpleTodos = (
  items: SimpleTodoItem[],
  nowDateISO: string,
) =>
  items.filter((item) => {
    if (!item.isDone || item.doneAt === null) {
      return true;
    }
    return toDateString(new Date(item.doneAt)) === nowDateISO;
  });
