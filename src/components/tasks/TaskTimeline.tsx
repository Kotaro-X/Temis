import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SLOT_KEYS, SLOT_LABELS, type TimeBoxSchedule } from '../../types/timer';
import { addDays, initialDuration, layoutIntervals, localDate, snapMinutes, timeMinutes, type PlanningOccurrence } from '../../features/taskPlanning/planningCore';

type DragMode = 'move' | 'start' | 'end';
type Props = { selectedKeys?: string[]; onDraggingChange?: (dragging: boolean) => void; dates: string[]; items: PlanningOccurrence[]; undated: PlanningOccurrence[]; schedule: TimeBoxSchedule;
  onEdit: (item: PlanningOccurrence) => void; onCreate: (date: string, minute?: number) => void;
  onPlace: (item: PlanningOccurrence, start: number, end: number) => void; canCreate: boolean };
function DragTile({ item, children, onEdit, onBegin, onMove, onEnd, mode = 'move', style }: {
  item: PlanningOccurrence; children: React.ReactNode; onEdit: () => void; onBegin: (item: PlanningOccurrence, mode: DragMode, x: number, y: number) => void;
  onMove: (x: number, y: number) => void; onEnd: (cancel?: boolean) => void; mode?: DragMode; style?: object;
}) {
  const armed = useRef(false); const acquired = useRef(false); const callbacks = useRef({ onMove, onEnd }); callbacks.current = { onMove, onEnd };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: () => armed.current,
    onPanResponderGrant: () => { acquired.current = true; },
    onPanResponderMove: (_event, gesture) => callbacks.current.onMove(gesture.moveX, gesture.moveY),
    onPanResponderRelease: () => { if (armed.current) callbacks.current.onEnd(); armed.current = false; acquired.current = false; },
    onPanResponderTerminate: () => { armed.current = false; callbacks.current.onEnd(true); },
    onPanResponderTerminationRequest: () => false,
  }), []);
  return <View {...responder.panHandlers} style={[mode === 'move' ? { flex: 1 } : { height: 14, flexShrink: 1 }, style]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${item.title} ${mode === 'move' ? '長押しで予定を移動' : mode === 'start' ? '開始を変更' : '終了を変更'}`} disabled={item.editable === false && mode !== 'move'}
      delayLongPress={250} onPress={onEdit} onLongPress={event => { if (item.editable === false) return; armed.current = true; onBegin(item, mode, event.nativeEvent.pageX, event.nativeEvent.pageY); }}
      onPressOut={() => { if (armed.current && !acquired.current) { armed.current = false; callbacks.current.onEnd(true); } }} style={{ flex: 1, minHeight: mode === 'move' ? 12 : 8 }}>
      {children}
    </Pressable>
  </View>;
}
export default function TaskTimeline(props: Props) {
  const { dates, items, undated, schedule, onEdit, onCreate, onPlace, canCreate, onDraggingChange } = props;
  const { height: windowHeight } = useWindowDimensions();
  const [viewportHeight, setViewportHeight] = useState(400);
  const [drawerCompact, setDrawerCompact] = useState(false);
  const [width, setWidth] = useState(350); const columnWidth = dates.length === 1 ? Math.max(220, width - 48) : 160;
  const [drawer, setDrawer] = useState<string | null>(null); const [drawerDate, setDrawerDate] = useState(dates[0]);
  const [preview, setPreview] = useState<{ item: PlanningOccurrence; start: number; end: number } | null>(null);
  const active = useRef<{ item: PlanningOccurrence; mode: DragMode; initialX: number; initialY: number; start: number; end: number; initialScroll: number; touchOffset: number } | null>(null);
  const timeAxis = useRef<ScrollView>(null); const viewport = useRef<View>(null); const vertical = useRef<ScrollView>(null); const horizontal = useRef<ScrollView>(null); const headerScroll = useRef<ScrollView>(null);
  const offsets = useRef({ x: 0, y: 0 }); const bounds = useRef({ x: 0, y: 0, height: 400 }); const pointer = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false); const previewRef = useRef(preview); previewRef.current = preview;
  const measure = () => viewport.current?.measureInWindow((x, y, _w, height) => { bounds.current = { x, y, height }; const available = Math.max(240, Math.min(460, windowHeight - y - 100)); setViewportHeight(previous => Math.abs(previous - available) > 1 ? available : previous); });
  const project = (x: number, y: number) => {
    const b = bounds.current, a = active.current; if (!a) return;
    const column = Math.max(0, Math.min(dates.length - 1, Math.floor((x - b.x + offsets.current.x - 48) / columnWidth)));
    let start = a.start, end = a.end;
    if (a.mode === 'move') {
      const minute = Math.max(0, Math.min(1435, snapMinutes(y - b.y + offsets.current.y - a.touchOffset)));
      start = new Date(`${dates[column]}T00:00:00`).getTime() + minute * 60000; end = start + a.end - a.start;
    } else {
      const delta = snapMinutes(y - a.initialY + offsets.current.y - a.initialScroll) * 60000;
      if (a.mode === 'start') start = Math.min(a.end - 300000, a.start + delta);
      else end = Math.max(a.start + 300000, a.end + delta);
    }
    const next = { item: a.item, start, end }; previewRef.current = next; setPreview(next);
  };
  const projectRef = useRef(project); projectRef.current = project;
  useEffect(() => { onDraggingChange?.(dragging); return () => onDraggingChange?.(false); }, [dragging, onDraggingChange]);
  useEffect(() => {
    if (!dragging) return;
    const timer = setInterval(() => {
      const { x, y, height } = bounds.current; const p = pointer.current;
      const dy = p.y < y + 55 ? -8 : p.y > y + height - 55 ? 8 : 0;
      const dx = dates.length > 1 ? p.x < x + 65 ? -6 : p.x > x + width - 35 ? 6 : 0 : 0;
      if (dy) { offsets.current.y = Math.max(0, Math.min(1440 - height, offsets.current.y + dy)); vertical.current?.scrollTo({ y: offsets.current.y, animated: false }); }
      if (dx) { offsets.current.x = Math.max(0, Math.min(48 + columnWidth * dates.length - width, offsets.current.x + dx)); horizontal.current?.scrollTo({ x: offsets.current.x, animated: false }); }
      if (dy || dx) projectRef.current(p.x, p.y);
    }, 30);
    return () => clearInterval(timer);
  }, [dragging, columnWidth, dates.length, width]);
  useEffect(() => { active.current = null; setDragging(false); setPreview(null); }, [dates.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const begin = (item: PlanningOccurrence, mode: DragMode, x: number, y: number) => {
    const start = item.plannedStartAt ?? new Date(`${dates[0]}T09:00:00`).getTime();
    active.current = { item, mode, initialX: x, initialY: y, start, end: item.plannedEndAt ?? start + initialDuration(item.estimateMinutes) * 60000, initialScroll: offsets.current.y, touchOffset: 0 };
    pointer.current = { x, y }; setDrawerCompact(false); setDragging(true);
    viewport.current?.measureInWindow((bx, by, _w, height) => { bounds.current = { x: bx, y: by, height }; if (active.current && mode === 'move' && item.plannedStartAt != null && y >= by && y <= by + height) { const d = new Date(item.plannedStartAt); active.current.touchOffset = y - by + offsets.current.y - d.getHours() * 60 - d.getMinutes(); } project(x, y); });
  };
  const move = (x: number, y: number) => { setDrawerCompact(true); pointer.current = { x, y }; measure(); project(x, y); };
  const end = (cancel = false) => {
    const value = previewRef.current; const p = pointer.current, b = bounds.current;
    active.current = null; setDragging(false); setDrawerCompact(false); setPreview(null); previewRef.current = null;
    if (!cancel && value && p.x >= b.x && p.x <= b.x + width && p.y >= b.y && p.y <= b.y + b.height) onPlace(value.item, value.start, value.end);
  };
  const tile = (item: PlanningOccurrence, child: React.ReactNode, mode: DragMode = 'move') => <DragTile item={item} mode={mode} onEdit={() => onEdit(item)} onBegin={begin} onMove={move} onEnd={end}>{child}</DragTile>;
  const displayed = preview ? [...items.filter(item => item.key !== preview.item.key), { ...preview.item, plannedStartAt: preview.start, plannedEndAt: preview.end, date: localDate(preview.start) }] : items;
  const drawerItems = drawer === 'undated' ? undated : items.filter(item => item.date === drawerDate && item.slot === drawer);
  return <View style={{ flex: 1, minHeight: 540 }} onLayout={event => { setWidth(event.nativeEvent.layout.width); measure(); }}>
    <View style={s.buttons}>{SLOT_KEYS.map(slot => <Pressable key={slot} style={s.button} onPress={() => { setDrawerDate(dates[0]); setDrawer(drawer === slot ? null : slot); }}><Text>{SLOT_LABELS[slot]} {schedule[slot].start}–{schedule[slot].end}</Text></Pressable>)}
      <Pressable style={s.button} onPress={() => setDrawer(drawer === 'undated' ? null : 'undated')}><Text>日付未定 {undated.length}</Text></Pressable></View>
    {drawer ? <View style={s.drawer}><Text style={s.label}>{drawer === 'undated' ? '日付未定' : `${drawerDate} ${SLOT_LABELS[drawer as keyof typeof SLOT_LABELS]}`} · 長押しで時間軸へ</Text>
      {dates.length > 1 && drawer !== 'undated' ? <View style={s.buttons}>{dates.map(day => <Pressable key={day} style={s.button} onPress={() => setDrawerDate(day)}><Text>{day === drawerDate ? '● ' : ''}{day.slice(5)}</Text></Pressable>)}</View> : null}
      <ScrollView style={{ maxHeight: drawerCompact ? 48 : 170 }} scrollEnabled={!dragging}>{drawerItems.map(item => <View key={item.key} style={[s.drawerRow, props.selectedKeys?.includes(item.key) && { borderWidth: 2, borderColor: '#2563eb' }]}>{tile(item, <Text style={s.label}>{item.completed ? '✓ ' : ''}{item.title || '無題'} {item.plannedStartAt ? new Date(item.plannedStartAt).toTimeString().slice(0,5) : '時間未設定'}</Text>)}</View>)}
        {!drawerItems.length ? <Text style={s.hint}>タスクはありません</Text> : null}</ScrollView>
      {canCreate ? <Pressable style={s.button} onPress={() => onCreate(drawer === 'undated' ? 'undated' : drawerDate)}><Text>＋ タスクを追加</Text></Pressable> : null}</View> : null}
    {preview ? <Text accessibilityLiveRegion="polite" style={s.preview}>{localDate(preview.start)} {new Date(preview.start).toTimeString().slice(0,5)} – {localDate(preview.end)} {new Date(preview.end).toTimeString().slice(0,5)}</Text> : null}
    <ScrollView ref={headerScroll} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}><View style={{ flexDirection: 'row', paddingLeft: 48 }}>{dates.map(date => <Text key={date} style={[s.day, { width: columnWidth }]}>{date.slice(5)} {['日','月','火','水','木','金','土'][new Date(`${date}T12:00:00`).getDay()]}</Text>)}</View></ScrollView>
    <View ref={viewport} style={{ height: viewportHeight }} onLayout={measure}>
      <ScrollView ref={vertical} nestedScrollEnabled scrollEnabled={!dragging} onScroll={event => { offsets.current.y = event.nativeEvent.contentOffset.y; timeAxis.current?.scrollTo({ y: offsets.current.y, animated: false }); }} scrollEventThrottle={16}>
        <ScrollView ref={horizontal} horizontal nestedScrollEnabled scrollEnabled={!dragging} onScroll={event => { offsets.current.x = event.nativeEvent.contentOffset.x; headerScroll.current?.scrollTo({ x: offsets.current.x, animated: false }); }} scrollEventThrottle={16}>
          <View style={{ width: 48 + columnWidth * dates.length, height: 1440, flexDirection: 'row' }}>
            <View style={{ width: 48 }}>{Array.from({ length: 24 }, (_, h) => <Text key={h} style={[s.hour, { top: h * 60 }]}>{String(h).padStart(2,'0')}:00</Text>)}</View>
            {dates.map(date => {
              const midnight = new Date(`${date}T00:00:00`).getTime(); const next = new Date(`${addDays(date,1)}T00:00:00`).getTime();
              const intervals = layoutIntervals(displayed.filter(item => item.plannedStartAt != null && item.plannedEndAt != null && item.plannedStartAt < next && item.plannedEndAt > midnight).map(item => ({ ...item, start: Math.max(0, (item.plannedStartAt! - midnight) / 60000), end: Math.min(1440, (item.plannedEndAt! - midnight) / 60000) })));
              return <View key={date} style={{ width: columnWidth, height: 1440, borderLeftWidth: 1, borderColor: '#d1d5db' }}>
                {SLOT_KEYS.map((slot, index) => <Pressable key={slot} onPress={() => { setDrawerDate(date); setDrawer(drawer === slot && drawerDate === date ? null : slot); }} style={{ position: 'absolute', left: 0, right: 0, top: timeMinutes(schedule[slot].start), height: Math.max(0, timeMinutes(schedule[slot].end) - timeMinutes(schedule[slot].start)), backgroundColor: ['#fef9ed','#eff6ff','#f0fdf4','#faf5ff'][index] }}><Text style={s.boxLabel}>{SLOT_LABELS[slot]}</Text></Pressable>)}
                {Array.from({ length: 48 }, (_, half) => <Pressable key={half} disabled={!canCreate || dragging} onPress={event => onCreate(date, Math.max(0, Math.min(1435, snapMinutes(half * 30 + event.nativeEvent.locationY))))} style={{ position: 'absolute', top: half * 30, height: 30, left: 0, right: 0, borderTopWidth: half % 2 === 0 ? 1 : 0.5, borderColor: '#e5e7eb' }} />)}
                {SLOT_KEYS.map(slot => <Pressable key={`label-${slot}`} style={{ position: 'absolute', top: timeMinutes(schedule[slot].start), left: 0, zIndex: 2, padding: 4, backgroundColor: '#ffffffcc' }} onPress={() => { setDrawerDate(date); setDrawer(drawer === slot && drawerDate === date ? null : slot); }}><Text style={s.boxLabel}>{SLOT_LABELS[slot]} ▾</Text></Pressable>)}
                {intervals.map(item => <View key={item.key} style={[s.event, { top: item.start, height: Math.max(20, item.end - item.start), left: item.column * columnWidth / item.columns + 2, width: columnWidth / item.columns - 4, opacity: item.completed ? 0.55 : 1, borderWidth: preview?.item.key === item.key || props.selectedKeys?.includes(item.key) ? 2 : 0 }]}>
                  {item.editable !== false ? tile(item, <View style={s.handle} />, 'start') : null}
                  {tile(item, <Text numberOfLines={2} style={s.eventText}>{item.completed ? '✓ ' : ''}{item.title || '無題'} {new Date(item.plannedStartAt!).toTimeString().slice(0,5)}</Text>)}
                  {item.editable !== false ? tile(item, <View style={s.handle} />, 'end') : null}
                </View>)}
              </View>;
            })}
          </View>
        </ScrollView>
      </ScrollView>
      <ScrollView ref={timeAxis} pointerEvents="none" scrollEnabled={false} showsVerticalScrollIndicator={false} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 48, backgroundColor: '#fff' }}><View style={{ height: 1440 }}>{Array.from({ length: 24 }, (_, h) => <Text key={h} style={[s.hour, { top: h * 60 }]}>{String(h).padStart(2, '0')}:00</Text>)}</View></ScrollView>
    </View>
    <Text style={s.hint}>長押しで移動 · 上下のハンドルを長押しして伸縮 · 5分刻み</Text>
  </View>;
}
const s = StyleSheet.create({ buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8 }, button: { padding: 10, borderRadius: 8, backgroundColor: '#eef2ff', minHeight: 40 }, drawer: { padding: 10, borderWidth: 1, borderColor: '#dbeafe', borderRadius: 10 }, drawerRow: { minHeight: 44, padding: 8, backgroundColor: '#f9fafb', marginVertical: 3 }, label: { color: '#111827', fontSize: 14 }, hint: { color: '#6b7280', padding: 6, fontSize: 12 }, preview: { padding: 8, backgroundColor: '#dbeafe', color: '#1e40af' }, day: { height: 38, padding: 8, backgroundColor: '#fff', textAlign: 'center', color: '#111827' }, hour: { position: 'absolute', fontSize: 10, color: '#6b7280' }, boxLabel: { fontSize: 11, color: '#6b7280', padding: 3 }, event: { position: 'absolute', borderRadius: 5, backgroundColor: '#bfdbfe', borderColor: '#2563eb', overflow: 'hidden', justifyContent: 'space-between' }, eventText: { fontSize: 12, color: '#1e3a8a', paddingHorizontal: 5 }, handle: { width: 28, height: 3, backgroundColor: '#60a5fa', alignSelf: 'center', marginVertical: 5, borderRadius: 2 } });
