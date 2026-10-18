import React, { useState } from 'react';
import { Keyboard, Pressable, Text, View, StyleSheet } from 'react-native';
import SchedulePicker from './SchedulePicker';
import type { ScheduleDraft } from '../../features/taskPlanning/scheduleDraft';
import { SLOT_KEYS, SLOT_LABELS } from '../../types/timer';
export { clockText, parseSchedule, scheduleDraft, type ScheduleDraft } from '../../features/taskPlanning/scheduleDraft';

export default function TaskScheduleFields({ draft, onChange, disabled = false }: { draft: ScheduleDraft; onChange: (draft: ScheduleDraft) => void; disabled?: boolean }) {
  const update = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  const [picker, setPicker] = useState<{ label: string; value: string; kind: 'date' | 'time'; change: (value: string) => void; clear?: boolean } | null>(null);
  const input = (label: string, value: string, change: (text: string) => void, placeholder: string) => {
    const kind = placeholder === 'HH:MM' ? 'time' : 'date';
    const personal = label.startsWith('通知');
    return <View style={s.fieldRow}><Text style={s.fieldLabel}>{label}</Text><Pressable disabled={disabled && !personal} accessibilityRole="button" accessibilityLabel={`${label} ${value || '未定'}`} style={s.input} onPress={() => { Keyboard.dismiss(); setPicker({ label, value, kind, change, clear: label === '日付' }); }}><Text style={{ color: value ? '#111827' : '#9ca3af', fontSize: 16 }}>{value || '未定'}</Text></Pressable></View>;
  };
  return <View style={s.root}>
    {input('日付', draft.date, date => update({ date, endDate: !draft.endDate || draft.endDate === draft.date ? date : draft.endDate, ...(!date ? { start: '', end: '', repeat: 'none' as const } : {}) }), 'YYYY-MM-DD')}
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
    {picker ? <SchedulePicker kind={picker.kind} label={picker.label} value={picker.value} allowClear={picker.clear} onCancel={() => setPicker(null)} onSelect={value => { picker.change(value); setPicker(null); }} /> : null}
  </View>;
}
const s = StyleSheet.create({ root: { gap: 8, paddingVertical: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, label: { color: '#374151', fontSize: 14 }, fieldRow: { flexDirection: 'row', gap: 12, alignItems: 'center' }, fieldLabel: { width: 64, color: '#374151', fontSize: 14 }, input: { justifyContent: 'center', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, minHeight: 44, minWidth: 135, padding: 8, flex: 1, color: '#111827' }, chip: { padding: 10, backgroundColor: '#f3f4f6', borderRadius: 8, minHeight: 40 }, selected: { backgroundColor: '#dbeafe', borderColor: '#2563eb', borderWidth: 1 }, hint: { color: '#6b7280', fontSize: 12 } });
