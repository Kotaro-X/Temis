import type { TaskPlanning, TaskReminder } from '../../types/taskPlanning.ts';
import type { SlotKey, TimeBoxSchedule } from '../../types/timer.ts';
import { NO_REMINDER, UNDATED_TASKS, validDate, localDate, slotAt, scheduledPatch } from './planningCore.ts';

export type ScheduleDraft = { date: string; slot: SlotKey; start: string; end: string; endDate: string; repeat: NonNullable<TaskPlanning['repeat']>; reminder: TaskReminder; reminderDate: string; reminderTime: string };
export const clockText = (at: number | null | undefined) => at == null ? '' : new Date(at).toTimeString().slice(0, 5);
export const scheduleDraft = (value: TaskPlanning, date: string, slot: SlotKey): ScheduleDraft => ({
  date: date === UNDATED_TASKS ? '' : date, slot, start: clockText(value.plannedStartAt), end: clockText(value.plannedEndAt),
  endDate: value.plannedEndAt == null ? (date === UNDATED_TASKS ? '' : date) : localDate(value.plannedEndAt),
  repeat: value.repeat ?? 'none', reminder: value.reminder ?? { ...NO_REMINDER }, reminderDate: value.reminder?.at == null ? '' : localDate(value.reminder.at), reminderTime: clockText(value.reminder?.at),
});
const parseTime = (date: string, time: string) => {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('日付はYYYY-MM-DD、時刻はHH:MMで入力してください。');
  return new Date(`${date}T${time}:00`).getTime();
};
export function parseSchedule(draft: ScheduleDraft, schedule: TimeBoxSchedule) {
  if (draft.date && !validDate(draft.date)) throw new Error('実在する日付を入力してください。');
  if (Boolean(draft.start) !== Boolean(draft.end)) throw new Error('開始と終了を両方設定してください。');
  let plannedStartAt: number | null = null, plannedEndAt: number | null = null;
  if (draft.start) { plannedStartAt = parseTime(draft.date, draft.start); plannedEndAt = parseTime(draft.endDate || draft.date, draft.end); scheduledPatch(plannedStartAt, plannedEndAt); }
  if (draft.repeat !== 'none' && !draft.date) throw new Error('繰り返しには開始日を設定してください。');
  const reminder = { ...draft.reminder };
  if (reminder.enabled) {
    if (reminder.mode === 'custom') reminder.at = parseTime(draft.reminderDate, draft.reminderTime);
    else if (plannedStartAt == null) throw new Error('開始時刻または個別の通知日時を設定してください。');
  }
  return { date: draft.date || UNDATED_TASKS, slot: plannedStartAt == null ? draft.slot : slotAt(schedule, plannedStartAt),
    planning: { plannedStartAt, plannedEndAt, repeat: draft.repeat, repeatAnchorDate: draft.repeat === 'none' ? null : draft.date || null, reminder },
    ...(plannedStartAt != null && plannedEndAt != null ? { estimateMinutes: (plannedEndAt - plannedStartAt) / 60000 } : {}) };
}
