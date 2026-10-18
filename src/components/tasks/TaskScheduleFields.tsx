import React from 'react';
import { Pressable, Text, TextInput, View, StyleSheet } from 'react-native';
import type { TaskPlanning, TaskReminder } from '../../types/taskPlanning';
import type { SlotKey, TimeBoxSchedule } from '../../types/timer';
import { NO_REMINDER, UNDATED_TASKS, validDate, localDate, slotAt, scheduledPatch } from '../../features/taskPlanning/planningCore';
import { SLOT_KEYS, SLOT_LABELS } from '../../types/timer';

export type ScheduleDraft = { date: string; slot: SlotKey; start: string; end: string; endDate: string; repeat: NonNullable<TaskPlanning['repeat']>; reminder: TaskReminder; reminderDate: string; reminderTime: string };
export const clockText = (at: number | null | undefined) => at == null ? '' : new Date(at).toTimeString().slice(0, 5);
export const scheduleDraft = (value: TaskPlanning, date: string, slot: SlotKey): ScheduleDraft => ({
  date: date === UNDATED_TASKS ? '' : date, slot, start: clockText(value.plannedStartAt), end: clockText(value.plannedEndAt),
  endDate: value.plannedEndAt == null ? (date === UNDATED_TASKS ? '' : date) : localDate(value.plannedEndAt),
  repeat: value.repeat ?? 'none', reminder: value.reminder ?? { ...NO_REMINDER }, reminderDate: value.reminder?.at == null ? '' : localDate(value.reminder.at), reminderTime: clockText(value.reminder?.at),
});
const parseTime = (date: string, time: string, snap = true) => {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('日付はYYYY-MM-DD、時刻はHH:MMで入力してください。');
  if (snap && Number(time.slice(3)) % 5 !== 0) throw new Error('時刻は5分刻みで入力してください。');
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
    if (reminder.mode === 'custom') reminder.at = parseTime(draft.reminderDate, draft.reminderTime, false);
    else if (plannedStartAt == null) throw new Error('開始時刻または個別の通知日時を設定してください。');
  }
  return { date: draft.date || UNDATED_TASKS, slot: plannedStartAt == null ? draft.slot : slotAt(schedule, plannedStartAt),
    planning: { plannedStartAt, plannedEndAt, repeat: draft.repeat, repeatAnchorDate: draft.repeat === 'none' ? null : draft.date || null, reminder },
    ...(plannedStartAt != null && plannedEndAt != null ? { estimateMinutes: (plannedEndAt - plannedStartAt) / 60000 } : {}) };
}
export default function TaskScheduleFields({ draft, onChange, disabled = false }: { draft: ScheduleDraft; onChange: (draft: ScheduleDraft) => void; disabled?: boolean }) {
  const update = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  const input = (label: string, value: string, change: (text: string) => void, placeholder: string) => <View style={s.row}><Text style={s.label}>{label}</Text><TextInput editable={!disabled} accessibilityLabel={label} style={s.input} value={value} onChangeText={change} placeholder={placeholder} autoCapitalize="none" /></View>;
  return <View style={s.root}>
    {input('日付（空欄＝未定）', draft.date, date => update({ date, endDate: !draft.endDate || draft.endDate === draft.date ? date : draft.endDate }), 'YYYY-MM-DD')}
    <View style={s.row}>{SLOT_KEYS.map(slot => <Pressable disabled={disabled} accessibilityRole="button" key={slot} onPress={() => update({ slot })} style={[s.chip, draft.slot === slot && s.selected]}><Text>{SLOT_LABELS[slot]}</Text></Pressable>)}</View>
    <Text style={s.hint}>時刻設定時は開始時刻に対応するボックスへ所属します。予定の長さが見積時間になります。</Text>
    {input('開始', draft.start, start => update({ start }), 'HH:MM')}
    {input('終了日', draft.endDate, endDate => update({ endDate }), 'YYYY-MM-DD')}
    {input('終了', draft.end, end => update({ end }), 'HH:MM')}
    <Pressable disabled={disabled} onPress={() => update({ start: '', end: '' })} style={s.chip}><Text>予定時間を解除</Text></Pressable>
    <Text style={s.label}>繰り返し</Text><View style={s.row}>{(['none','daily','weekly','monthly','yearly'] as const).map((repeat, index) => <Pressable disabled={disabled} key={repeat} onPress={() => update({ repeat })} style={[s.chip, draft.repeat === repeat && s.selected]}><Text>{['なし','毎日','毎週','毎月','毎年'][index]}</Text></Pressable>)}</View>
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draft.reminder.enabled }} onPress={() => update({ reminder: { ...draft.reminder, enabled: !draft.reminder.enabled } })} style={s.row}><Text style={s.label}>{draft.reminder.enabled ? '☑' : '☐'} リマインダー</Text></Pressable>
    {draft.reminder.enabled ? <>
      <View style={s.row}>{[0,5,10,15,30,60].map(offsetMinutes => <Pressable key={offsetMinutes} onPress={() => update({ reminder: { ...draft.reminder, mode: 'start', offsetMinutes } })} style={[s.chip, draft.reminder.mode === 'start' && draft.reminder.offsetMinutes === offsetMinutes && s.selected]}><Text>{offsetMinutes ? `${offsetMinutes}分前` : '開始時刻'}</Text></Pressable>)}
        <Pressable onPress={() => update({ reminder: { ...draft.reminder, mode: 'custom' } })} style={[s.chip, draft.reminder.mode === 'custom' && s.selected]}><Text>個別日時</Text></Pressable></View>
      {draft.reminder.mode === 'custom' ? <>{input('通知日', draft.reminderDate, reminderDate => update({ reminderDate }), 'YYYY-MM-DD')}{input('通知時刻', draft.reminderTime, reminderTime => update({ reminderTime }), 'HH:MM')}</> : null}
      <Text style={s.hint}>端末の通知が許可されている場合に届きます。繰り返し予定を個別に変更した場合は、定期的にアプリを開いて通知を更新してください。</Text>
    </> : null}
  </View>;
}
const s = StyleSheet.create({ root: { gap: 8, paddingVertical: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, label: { color: '#374151', fontSize: 14 }, input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, minHeight: 44, minWidth: 135, padding: 8, flex: 1, color: '#111827' }, chip: { padding: 10, backgroundColor: '#f3f4f6', borderRadius: 8, minHeight: 40 }, selected: { backgroundColor: '#dbeafe', borderColor: '#2563eb', borderWidth: 1 }, hint: { color: '#6b7280', fontSize: 12 } });
