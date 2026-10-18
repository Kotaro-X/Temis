import type { TaskPlanning, TaskReminder, TaskOccurrenceOverride } from '../../types/taskPlanning.ts';
import type { SlotKey, TimeBoxSchedule } from '../../types/timer.ts';
import { SLOT_KEYS } from '../../types/timer.ts';
import type { SimpleTodoItem } from '../../types/todo.ts';
import type { TaskState } from '../../types/task.ts';

/** A real storage bucket, never interpreted as a calendar date. */
export const UNDATED_TASKS = 'undated';
export const NO_REMINDER: TaskReminder = { enabled: false, mode: 'start', offsetMinutes: 0, at: null };
export const localDate = (value: number | Date) => {
  const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && localDate(new Date(`${date}T12:00:00`)) === date;
export const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return localDate(d); };
export const weekDates = (date: string) => Array.from({ length: 7 }, (_, i) => addDays(date, i));
export const snapMinutes = (minutes: number) => Math.round(minutes / 5) * 5;
export const initialDuration = (minutes?: number) => minutes && minutes > 0 ? Math.max(5, Math.ceil(minutes / 5) * 5) : 30;
export const timeMinutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
export const slotAt = (schedule: TimeBoxSchedule, at: number): SlotKey => {
  const d = new Date(at); const minute = d.getHours() * 60 + d.getMinutes();
  const sorted = [...SLOT_KEYS].sort((a, b) => timeMinutes(schedule[a].start) - timeMinutes(schedule[b].start));
  return sorted.find(key => minute >= timeMinutes(schedule[key].start) && minute < timeMinutes(schedule[key].end))
    ?? [...sorted].reverse().find(key => minute >= timeMinutes(schedule[key].start)) ?? sorted[sorted.length - 1];
};
export const scheduledPatch = (start: number, end: number) => {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 300000 || end - start > 100000 * 60000) throw new Error('終了は開始の5分以上後に設定してください。');
  return { plannedStartAt: start, plannedEndAt: end, estimateMinutes: (end - start) / 60000 };
};
export const normalizeOccurrenceOverrides = (value: unknown): Record<string, TaskOccurrenceOverride> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 1000).flatMap(([day, raw]) => {
    if (!validDate(day) || !raw || typeof raw !== 'object') return [];
    const entry = raw as TaskOccurrenceOverride;
    if (!(validDate(entry.date) || entry.date === UNDATED_TASKS) || !SLOT_KEYS.includes(entry.slot) || !Number.isFinite(entry.estimateMinutes) || entry.estimateMinutes < 0) return [];
    const start = entry.plannedStartAt, end = entry.plannedEndAt;
    if (!(start == null && end == null || Number.isFinite(start) && Number.isFinite(end) && end! - start! >= 300000)) return [];
    return [[day, { date: entry.date, slot: entry.slot, estimateMinutes: entry.estimateMinutes, plannedStartAt: start ?? null, plannedEndAt: end ?? null,
      ...(typeof entry.title === 'string' ? { title: entry.title } : {}), ...(typeof entry.memo === 'string' ? { memo: entry.memo } : {}),
      ...(Array.isArray(entry.tags) ? { tags: entry.tags.filter(tag => typeof tag === 'string') } : {}),
      ...(typeof entry.completed === 'boolean' ? { completed: entry.completed } : {}), ...(typeof entry.deleted === 'boolean' ? { deleted: entry.deleted } : {}),
      ...(['TODO','IN_PROGRESS','PAUSED','DONE'].includes(entry.executionStatus ?? '') ? { executionStatus: entry.executionStatus } : {}),
      ...(typeof entry.elapsedMinutes === 'number' && Number.isFinite(entry.elapsedMinutes) ? { elapsedMinutes: Math.max(0, entry.elapsedMinutes) } : {}),
      ...(entry.startAt === null || typeof entry.startAt === 'number' && Number.isFinite(entry.startAt) ? { startAt: entry.startAt } : {}),
    }]];
  }));
};
export const normalizePlanning = (value: TaskPlanning): TaskPlanning => {
  const start = value.plannedStartAt, end = value.plannedEndAt;
  const scheduled = typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end) && end > start;
  return { plannedStartAt: scheduled ? start : null, plannedEndAt: scheduled ? end : null,
    repeat: ['daily','weekly','monthly','yearly'].includes(value.repeat ?? '') ? value.repeat : 'none',
    repeatAnchorDate: value.repeatAnchorDate ?? null, occurrenceOverrides: normalizeOccurrenceOverrides(value.occurrenceOverrides),
    ...(value.reminder ? { reminder: value.reminder } : {}), ...(value.migratedTodoId ? { migratedTodoId: value.migratedTodoId } : {}) };
};
export type PlanningItem = TaskPlanning & { id: string; title: string; date: string; slot: SlotKey; estimateMinutes: number; tags?: string[]; executionStatus?: 'TODO' | 'IN_PROGRESS' | 'PAUSED' | 'DONE'; elapsedMinutes?: number; startAt?: number | null; completed: boolean; archived?: boolean; editable?: boolean; projectId?: string };
export type PlanningOccurrence = PlanningItem & { key: string; occurrenceDate: string };
export const repeatsOn = (item: TaskPlanning, anchor: string, date: string) => {
  if (!validDate(anchor) || date < anchor) return false;
  if (date === anchor) return true;
  const a = new Date(`${anchor}T12:00:00`), d = new Date(`${date}T12:00:00`);
  switch (item.repeat) {
    case 'daily': return true;
    case 'weekly': return a.getDay() === d.getDay();
    case 'monthly': return a.getDate() === d.getDate();
    case 'yearly': return a.getMonth() === d.getMonth() && a.getDate() === d.getDate();
    default: return false;
  }
};
export const occurrencesForDates = (items: PlanningItem[], dates: string[]): PlanningOccurrence[] => {
  const visible = new Set(dates); const result: PlanningOccurrence[] = [];
  for (const item of items) {
    if (item.archived || item.date === UNDATED_TASKS) continue;
    const anchor = item.repeat && item.repeat !== 'none' ? item.repeatAnchorDate ?? item.date : item.date;
    // Include an earlier start when an overnight event intersects a visible day.
    const lookback = Math.max(1, Math.min(70, Math.ceil(((item.plannedEndAt ?? 0) - (item.plannedStartAt ?? 0)) / 86400000)));
    const candidates = new Set([item.date, ...dates.flatMap(date => Array.from({ length: lookback + 1 }, (_, index) => addDays(date, -index))), ...Object.keys(item.occurrenceOverrides ?? {})]);
    for (const day of candidates) {
      if (!repeatsOn(item, anchor, day)) continue;
      const override = item.occurrenceOverrides?.[day];
      if (override?.deleted) continue;
      const offset = item.plannedStartAt != null ? new Date(`${day}T${new Date(item.plannedStartAt).toTimeString().slice(0, 8)}`).getTime() : null;
      const baseEnd = offset != null && item.plannedEndAt != null && item.plannedStartAt != null ? offset + item.plannedEndAt - item.plannedStartAt : null;
      const occurrence = { ...item, ...(item.repeat && item.repeat !== 'none' && day !== anchor ? { executionStatus: 'TODO' as const, elapsedMinutes: 0, startAt: null } : {}), date: day, plannedStartAt: offset, plannedEndAt: baseEnd, completed: item.repeat && item.repeat !== 'none' ? day === anchor && item.completed : item.completed,
        ...override, key: `${item.id}@${day}`, occurrenceDate: day };
      if (visible.has(occurrence.date) || (occurrence.plannedEndAt != null && dates.some(date => {
        const start = new Date(`${date}T00:00:00`).getTime(); return occurrence.plannedStartAt! < new Date(`${addDays(date, 1)}T00:00:00`).getTime() && occurrence.plannedEndAt! > start;
      }))) result.push(occurrence);
    }
  }
  return result;
};
export const occurrencePatch = (source: TaskPlanning, date: string, patch: TaskOccurrenceOverride) => ({ occurrenceOverrides: { ...source.occurrenceOverrides, [date]: { ...source.occurrenceOverrides?.[date], ...patch } } });
export const reminderTime = (item: TaskPlanning, reminder = item.reminder): number | null => !reminder?.enabled ? null : reminder.mode === 'custom' ? reminder.at : item.plannedStartAt == null ? null : item.plannedStartAt - reminder.offsetMinutes * 60000;
export const todoTaskId = (id: string) => `todo-task:${id}`;
export const convertTodo = (todo: SimpleTodoItem): TaskState => {
  const at = todo.reminderDate && validDate(todo.reminderDate) && /^([01]\d|2[0-3]):[0-5]\d$/.test(todo.reminderTime ?? '') ? new Date(`${todo.reminderDate}T${todo.reminderTime}:00`).getTime() : null;
  return ({
  id: todoTaskId(todo.id), taskName: todo.text, tags: todo.tags, estimateMinutes: 0, elapsedMinutes: 0,
  status: todo.isDone ? 'DONE' : 'TODO', isArchived: false, startAt: null,
  ...normalizePlanning({ repeat: todo.repeat, repeatAnchorDate: todo.seriesAnchorDate ?? todo.reminderDate, migratedTodoId: todo.id }),
  reminder: { enabled: at != null, mode: 'custom', offsetMinutes: 0,
    at },
});
};
/** Greedy interval partitioning, with one shared width per connected overlap group. */
export const layoutIntervals = <T extends { key: string; start: number; end: number }>(items: T[]) => {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end); const result: (T & { column: number; columns: number })[] = [];
  let group: typeof result = [], ends: number[] = [];
  const flush = () => { group.forEach(item => { item.columns = ends.length; }); result.push(...group); group = []; ends = []; };
  for (const item of sorted) {
    if (group.length && item.start >= Math.max(...ends)) flush();
    let column = ends.findIndex(end => end <= item.start); if (column < 0) column = ends.length;
    ends[column] = item.end; group.push({ ...item, column, columns: 1 });
  }
  flush(); return result;
};

/** Preserve recorded time when another task/occurrence takes over the single Private timer. */
export const pauseOtherTaskTimers = (task: TaskState, now: number, keepRoot = false, keepOccurrence: string | null = null): TaskState => {
  let next = task;
  if (task.status === 'IN_PROGRESS' && !keepRoot) next = { ...next, status: 'PAUSED', startAt: null, elapsedMinutes: task.elapsedMinutes + (task.startAt == null ? 0 : Math.max(0, now - task.startAt) / 60000) };
  for (const [day, occurrence] of Object.entries(task.occurrenceOverrides ?? {})) {
    if (occurrence.executionStatus !== 'IN_PROGRESS' || day === keepOccurrence) continue;
    next = { ...next, occurrenceOverrides: { ...next.occurrenceOverrides, [day]: { ...occurrence, executionStatus: 'PAUSED', startAt: null,
      elapsedMinutes: (occurrence.elapsedMinutes ?? 0) + (occurrence.startAt == null ? 0 : Math.max(0, now - occurrence.startAt) / 60000) } } };
  }
  return next;
};
