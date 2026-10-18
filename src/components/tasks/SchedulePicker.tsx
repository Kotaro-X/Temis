import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { addDays, localDate, validDate } from '../../features/taskPlanning/planningCore';

const ROW = 44;
function Wheel({ values, value, onChange, label }: { values: number[]; value: number; onChange: (value: number) => void; label: string }) {
  const ref = useRef<ScrollView>(null);
  const index = Math.max(0, values.indexOf(value));
  return <View style={{ width: 100, height: ROW * 5 }}>
    <View pointerEvents="none" style={s.selection} />
    <ScrollView ref={ref} accessibilityLabel={label} showsVerticalScrollIndicator={false} snapToInterval={ROW} decelerationRate="fast" contentContainerStyle={{ paddingVertical: ROW * 2 }}
      onLayout={() => ref.current?.scrollTo({ y: index * ROW, animated: false })}
      onScroll={event => onChange(values[Math.max(0, Math.min(values.length - 1, Math.round(event.nativeEvent.contentOffset.y / ROW)))])} scrollEventThrottle={16}>
      {values.map((number, i) => <Pressable key={number} accessibilityRole="button" accessibilityLabel={`${number}${label}`} onPress={() => { onChange(number); ref.current?.scrollTo({ y: i * ROW, animated: true }); }} style={s.wheelRow}><Text style={{ fontSize: 26, color: number === value ? '#111827' : '#9ca3af' }}>{String(number).padStart(2, '0')}</Text></Pressable>)}
    </ScrollView>
  </View>;
}
export default function SchedulePicker({ kind, label, value, allowClear, onCancel, onSelect }: { kind: 'date' | 'time'; label: string; value: string; allowClear?: boolean; onCancel: () => void; onSelect: (value: string) => void }) {
  const initialDate = validDate(value) ? value : localDate(Date.now());
  const [month, setMonth] = useState(initialDate.slice(0, 7));
  const [hour, setHour] = useState(/^\d{2}:\d{2}$/.test(value) ? Number(value.slice(0, 2)) : 9);
  const [minute, setMinute] = useState(/^\d{2}:\d{2}$/.test(value) ? Math.min(55, Math.round(Number(value.slice(3)) / 5) * 5) : 0);
  const first = `${month}-01`; const weekday = new Date(`${first}T12:00:00`).getDay();
  const moveMonth = (delta: number) => { const d = new Date(`${first}T12:00:00`); d.setMonth(d.getMonth() + delta); setMonth(localDate(d.getTime()).slice(0, 7)); };
  return <Modal transparent animationType="fade" onRequestClose={onCancel}>
    <View style={s.backdrop}><Pressable accessibilityLabel="閉じる" style={StyleSheet.absoluteFill} onPress={onCancel} />
      <View accessibilityViewIsModal style={s.card}>
        <View style={s.header}><Pressable onPress={onCancel} style={s.action}><Text style={s.blue}>キャンセル</Text></Pressable><Text style={s.title}>{label}</Text>{kind === 'time' ? <Pressable onPress={() => onSelect(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)} style={s.action}><Text style={s.blue}>決定</Text></Pressable> : <View style={s.action} />}</View>
        {kind === 'time' ? <View style={s.wheels}><Wheel values={Array.from({ length: 24 }, (_, i) => i)} value={hour} onChange={setHour} label="時" /><Text style={{ fontSize: 24 }}>:</Text><Wheel values={Array.from({ length: 12 }, (_, i) => i * 5)} value={minute} onChange={setMinute} label="分" /></View> : <>
          <View style={s.header}><Pressable accessibilityLabel="前の月" onPress={() => moveMonth(-1)} style={s.action}><Text style={s.blue}>‹</Text></Pressable><Text style={s.title}>{month.replace('-', '年')}月</Text><Pressable accessibilityLabel="次の月" onPress={() => moveMonth(1)} style={s.action}><Text style={s.blue}>›</Text></Pressable></View>
          <View style={s.grid}>{['日', '月', '火', '水', '木', '金', '土'].map(day => <Text key={day} style={s.weekday}>{day}</Text>)}{Array.from({ length: 42 }, (_, i) => { const date = addDays(first, i - weekday); const inMonth = date.startsWith(month); return <Pressable key={date} accessibilityRole="button" accessibilityLabel={date} accessibilityState={{ selected: date === value }} onPress={() => onSelect(date)} style={[s.cell, date === value && s.chosen]}><Text style={{ color: date === value ? '#fff' : inMonth ? '#111827' : '#9ca3af' }}>{Number(date.slice(8))}</Text></Pressable>; })}</View>
          {allowClear ? <Pressable onPress={() => onSelect('')} style={s.clear}><Text style={s.blue}>未定に戻す</Text></Pressable> : null}
        </>}
      </View>
    </View>
  </Modal>;
}
const s = StyleSheet.create({ backdrop: { flex: 1, backgroundColor: '#0005', justifyContent: 'center', padding: 20 }, card: { backgroundColor: '#fff', borderRadius: 18, padding: 12, maxWidth: 420, width: '100%', alignSelf: 'center' }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }, action: { minWidth: 64, paddingVertical: 12, alignItems: 'center' }, blue: { color: '#2563eb', fontSize: 16 }, title: { fontSize: 17, fontWeight: '600', color: '#111827' }, wheels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, wheelRow: { height: ROW, alignItems: 'center', justifyContent: 'center' }, selection: { position: 'absolute', top: ROW * 2, left: 0, right: 0, height: ROW, borderRadius: 8, backgroundColor: '#f3f4f6' }, grid: { flexDirection: 'row', flexWrap: 'wrap' }, weekday: { width: '14.2857%', textAlign: 'center', paddingVertical: 10, color: '#6b7280' }, cell: { width: '14.2857%', height: 42, justifyContent: 'center', alignItems: 'center', borderRadius: 20 }, chosen: { backgroundColor: '#2563eb' }, clear: { alignItems: 'center', padding: 14 } });
