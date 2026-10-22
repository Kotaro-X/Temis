import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { edgePaging, emptyEdgeHold } from '../../features/taskPlanning/edgePaging';
import { SLOT_KEYS, SLOT_LABELS, type TimeBoxSchedule } from '../../types/timer';
import { addDays, initialDuration, layoutIntervals, localDate, snapMinutes, timeMinutes, type PlanningOccurrence } from '../../features/taskPlanning/planningCore';

type DragMode = 'move' | 'start' | 'end';
type Props = { headerControls?: React.ReactNode; onPage: (direction: number) => void; selectedKeys?: string[]; onDraggingChange?: (dragging: boolean) => void; dates: string[]; items: PlanningOccurrence[]; undated: PlanningOccurrence[]; schedule: TimeBoxSchedule;
  onEdit: (item: PlanningOccurrence) => void; onCreate: (date: string, minute?: number) => void;
  onPlace: (item: PlanningOccurrence, start: number, end: number) => void; canCreate: boolean };
function DragTile({ item, children, onEdit, onBegin, onEnd, mode = 'move', style, isAcquired }: {
  isAcquired: () => boolean; item: PlanningOccurrence; children: React.ReactNode; onEdit: () => void; onBegin: (item: PlanningOccurrence, mode: DragMode, x: number, y: number) => void;
  onEnd: (cancel?: boolean) => void; mode?: DragMode; style?: object;
}) {
  const armed = useRef(false);
  return <View style={[mode === 'move' ? { flex: 1 } : { height: 14, flexShrink: 1 }, style]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${item.title} ${mode === 'move' ? '長押しで予定を移動' : mode === 'start' ? '開始を変更' : '終了を変更'}`} disabled={item.editable === false && mode !== 'move'}
      delayLongPress={250} onPress={onEdit} onLongPress={event => { if (item.editable === false) return; armed.current = true; onBegin(item, mode, event.nativeEvent.pageX, event.nativeEvent.pageY); }}
      onPressOut={() => { if (armed.current && !isAcquired()) { armed.current = false; onEnd(true); } }} style={{ flex: 1, minHeight: mode === 'move' ? 12 : 8 }}>
      {children}
    </Pressable>
  </View>;
}
export default function TaskTimeline(props: Props) {
  const { dates, items, undated, schedule, onEdit, onCreate, onPlace, canCreate, onDraggingChange, onPage } = props;
  const { height: windowHeight } = useWindowDimensions();
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(scale);
  const [pinching, setPinching] = useState(false);
  const pinch = useRef<{ distance: number; scale: number; minute: number } | null>(null);
  const axisWidth = 36;
  const [viewportHeight, setViewportHeight] = useState(400);
  const [width, setWidth] = useState(350); const columnWidth = dates.length === 1 ? Math.max(220, width - axisWidth) : 160;
  const [drawer, setDrawer] = useState<string | null>(null); const [drawerDate, setDrawerDate] = useState(dates[0]);
  const [preview, setPreview] = useState<{ item: PlanningOccurrence; start: number; end: number } | null>(null);
  const active = useRef<{ item: PlanningOccurrence; mode: DragMode; initialX: number; initialY: number; start: number; end: number; initialScroll: number; touchOffset: number } | null>(null);
  const timeAxis = useRef<ScrollView>(null); const viewport = useRef<View>(null); const vertical = useRef<ScrollView>(null); const horizontal = useRef<ScrollView>(null); const headerScroll = useRef<ScrollView>(null);
  const offsets = useRef({ x: 0, y: 0 }); const bounds = useRef({ x: 0, y: 0, height: 400 }); const pointer = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false); const previewRef = useRef(preview); previewRef.current = preview;
  const measure = () => viewport.current?.measureInWindow((x, y, _w, height) => { bounds.current = { x, y, height }; const available = Math.max(160, windowHeight - y - 90); setViewportHeight(previous => Math.abs(previous - available) > 1 ? available : previous); });
  const edge = useRef(emptyEdgeHold()); const paging = useRef(false); const acquired = useRef(false);
  const pageRef = useRef(onPage); pageRef.current = onPage;
  const project = (x: number, y: number) => {
    const b = bounds.current, a = active.current; if (!a) return;
    const column = Math.max(0, Math.min(dates.length - 1, Math.floor((x - b.x + offsets.current.x - axisWidth) / columnWidth)));
    let start = a.start, end = a.end;
    if (a.mode === 'move') {
      const minute = Math.max(0, Math.min(1435, snapMinutes((y - b.y + offsets.current.y - a.touchOffset) / scale)));
      start = new Date(`${dates[column]}T00:00:00`).getTime() + minute * 60000; end = start + a.end - a.start;
    } else {
      const delta = snapMinutes((y - a.initialY + offsets.current.y - a.initialScroll) / scale) * 60000;
      if (a.mode === 'start') start = Math.min(a.end - 300000, a.start + delta);
      else end = Math.max(a.start + 300000, a.end + delta);
    }
    const next = { item: a.item, start, end }; previewRef.current = next; setPreview(next);
  };
  const projectRef = useRef(project); projectRef.current = project;
  useEffect(() => { onDraggingChange?.(dragging || pinching); return () => onDraggingChange?.(false); }, [dragging, pinching, onDraggingChange]);
  useEffect(() => {
    if (!dragging) return;
    const timer = setInterval(() => {
      const { x, y, height } = bounds.current; const p = pointer.current;
      const dy = p.y < y + 55 ? -8 : p.y > y + height - 55 ? 8 : 0;
      const dx = dates.length > 1 ? p.x < x + 65 ? -6 : p.x > x + width - 35 ? 6 : 0 : 0;
      if (dy) { offsets.current.y = Math.max(0, Math.min(1440 * scale - height, offsets.current.y + dy)); vertical.current?.scrollTo({ y: offsets.current.y, animated: false }); }
      const maxX = Math.max(0, axisWidth + columnWidth * dates.length - width);
      if (dx) { offsets.current.x = Math.max(0, Math.min(maxX, offsets.current.x + dx)); horizontal.current?.scrollTo({ x: offsets.current.x, animated: false }); }
      const direction = active.current?.mode === 'move' && p.y >= y && p.y <= y + height ? p.x < x + axisWidth ? -1 : p.x > x + width - 35 ? 1 : 0 : 0;
      const boundary = direction < 0 ? offsets.current.x <= 0 : offsets.current.x >= maxX;
      const result = edgePaging(edge.current, direction, boundary, Date.now()); edge.current = result.state;
      if (result.page) { paging.current = true; pageRef.current(result.page); }
      if (dy || dx) projectRef.current(p.x, p.y);
    }, 30);
    return () => clearInterval(timer);
  }, [dragging, columnWidth, dates.length, width, scale]);
  useEffect(() => {
    if (paging.current && active.current) {
      paging.current = false;
      const maxX = Math.max(0, axisWidth + columnWidth * dates.length - width);
      offsets.current.x = edge.current.direction < 0 ? maxX : 0;
      horizontal.current?.scrollTo({ x: offsets.current.x, animated: false });
      headerScroll.current?.scrollTo({ x: offsets.current.x, animated: false });
      projectRef.current(pointer.current.x, pointer.current.y);
    } else { active.current = null; setDragging(false); setPreview(null); previewRef.current = null; }
  }, [dates.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const begin = (item: PlanningOccurrence, mode: DragMode, x: number, y: number) => {
    if (pinch.current) return;
    const start = item.plannedStartAt ?? new Date(`${dates[0]}T09:00:00`).getTime();
    active.current = { item, mode, initialX: x, initialY: y, start, end: item.plannedEndAt ?? start + initialDuration(item.estimateMinutes) * 60000, initialScroll: offsets.current.y, touchOffset: 0 };
    edge.current = emptyEdgeHold(); acquired.current = false; pointer.current = { x, y }; setDragging(true);
    viewport.current?.measureInWindow((bx, by, _w, height) => { bounds.current = { x: bx, y: by, height }; if (active.current && mode === 'move' && item.plannedStartAt != null && y >= by && y <= by + height) { const d = new Date(item.plannedStartAt); active.current.touchOffset = y - by + offsets.current.y - (d.getHours() * 60 + d.getMinutes()) * scale; } project(x, y); });
  };
  const move = (x: number, y: number) => { pointer.current = { x, y }; measure(); project(x, y); };
  const end = (cancel = false) => {
    const value = previewRef.current; const p = pointer.current, b = bounds.current;
    acquired.current = false; edge.current = emptyEdgeHold(); active.current = null; setDragging(false); setPreview(null); previewRef.current = null;
    if (!cancel && value && p.x >= b.x && p.x <= b.x + width && p.y >= b.y && p.y <= b.y + b.height) onPlace(value.item, value.start, value.end);
  };
  const tile = (item: PlanningOccurrence, child: React.ReactNode, mode: DragMode = 'move') => <DragTile isAcquired={() => acquired.current} item={item} mode={mode} onEdit={() => onEdit(item)} onBegin={begin} onEnd={end}>{child}</DragTile>;
  const zoom = (event: GestureResponderEvent) => {
    const touches = event.nativeEvent.touches;
    if (touches.length < 2) return;
    const [first, second] = touches;
    const distance = Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
    const center = Math.max(0, Math.min(bounds.current.height, (first.pageY + second.pageY) / 2 - bounds.current.y));
    if (!pinch.current) {
      end(true);
      pinch.current = { distance: Math.max(1, distance), scale: scaleRef.current, minute: (offsets.current.y + center) / scaleRef.current };
      setPinching(true);
    }
    const next = Math.max(0.5, Math.min(3, pinch.current.scale * distance / pinch.current.distance));
    scaleRef.current = next;
    setScale(next);
    offsets.current.y = Math.max(0, Math.min(Math.max(0, 1440 * next - bounds.current.height), pinch.current.minute * next - center));
  };
  useEffect(() => {
    vertical.current?.scrollTo({ y: offsets.current.y, animated: false });
    timeAxis.current?.scrollTo({ y: offsets.current.y, animated: false });
  }, [scale]);
  const finishGesture = (cancel = false) => {
    if (pinch.current) { pinch.current = null; setPinching(false); }
    else end(cancel);
  };
  const handlers = useRef({ move, finishGesture, zoom }); handlers.current = { move, finishGesture, zoom };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: event => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponderCapture: event => event.nativeEvent.touches.length >= 2 || Boolean(active.current),
    onPanResponderGrant: event => { acquired.current = true; handlers.current.zoom(event); },
    onPanResponderMove: (event, gesture) => {
      if (event.nativeEvent.touches.length >= 2) handlers.current.zoom(event);
      else if (!pinch.current) handlers.current.move(gesture.moveX, gesture.moveY);
    },
    onPanResponderRelease: () => handlers.current.finishGesture(),
    onPanResponderTerminate: () => handlers.current.finishGesture(true),
    onPanResponderTerminationRequest: () => false,
  }), []);
  const displayed = preview ? [...items.filter(item => item.key !== preview.item.key), { ...preview.item, plannedStartAt: preview.start, plannedEndAt: preview.end, date: localDate(preview.start) }] : items;
  const drawerItems = drawer === 'undated' ? undated : items.filter(item => item.date === drawerDate && item.slot === drawer && item.plannedStartAt == null);
  return <View style={{ flex: 1 }} onLayout={event => { setWidth(event.nativeEvent.layout.width); measure(); }}>
    <View style={s.buttons}>{props.headerControls}</View>
    <Modal visible={drawer !== null} transparent animationType="fade" onRequestClose={() => setDrawer(null)}>
      <View style={s.modalBackdrop}><View style={s.drawer} accessibilityViewIsModal>
        <View style={s.modalHeader}><Text style={[s.label, { flex: 1 }]}>{drawer === 'undated' ? '日付未定' : `${drawerDate} 【${SLOT_LABELS[drawer as keyof typeof SLOT_LABELS] ?? ''}】時間未設定のタスク`}</Text>
          <Pressable accessibilityRole="button" style={s.button} onPress={() => setDrawer(null)}><Text>閉じる</Text></Pressable></View>
        <ScrollView style={{ maxHeight: windowHeight * 0.6 }}>{drawerItems.map(item => <Pressable accessibilityRole="button" key={item.key} style={[s.drawerRow, props.selectedKeys?.includes(item.key) && { borderWidth: 2, borderColor: '#2563eb' }]} onPress={() => { setDrawer(null); onEdit(item); }}><Text style={s.label}>{item.completed ? '✓ ' : ''}{item.title || '無題'}</Text></Pressable>)}
          {!drawerItems.length ? <Text style={s.hint}>タスクはありません</Text> : null}</ScrollView>
      </View></View>
    </Modal>
    {preview ? <Text accessibilityLiveRegion="polite" style={s.preview}>{localDate(preview.start)} {new Date(preview.start).toTimeString().slice(0,5)} – {localDate(preview.end)} {new Date(preview.end).toTimeString().slice(0,5)}</Text> : null}
    <ScrollView ref={headerScroll} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}><View style={{ flexDirection: 'row', paddingLeft: axisWidth }}>{dates.map(date => <Text key={date} style={[s.day, { width: columnWidth }]}>{date.slice(5)} {['日','月','火','水','木','金','土'][new Date(`${date}T12:00:00`).getDay()]}</Text>)}</View></ScrollView>
    <View {...responder.panHandlers} ref={viewport} style={{ height: viewportHeight }} onLayout={measure}>
      <ScrollView ref={vertical} nestedScrollEnabled scrollEnabled={!dragging && !pinching} onScroll={event => { offsets.current.y = event.nativeEvent.contentOffset.y; timeAxis.current?.scrollTo({ y: offsets.current.y, animated: false }); }} scrollEventThrottle={16}>
        <ScrollView ref={horizontal} horizontal nestedScrollEnabled scrollEnabled={!dragging && !pinching} onScroll={event => { offsets.current.x = event.nativeEvent.contentOffset.x; headerScroll.current?.scrollTo({ x: offsets.current.x, animated: false }); }} scrollEventThrottle={16}>
          <View style={{ width: axisWidth + columnWidth * dates.length, height: 1440 * scale, flexDirection: 'row' }}>
            <View style={{ width: axisWidth }}>{Array.from({ length: 24 }, (_, h) => <Text key={h} style={[s.hour, { top: h * 60 * scale }]}>{String(h).padStart(2,'0')}:00</Text>)}</View>
            {dates.map(date => {
              const midnight = new Date(`${date}T00:00:00`).getTime(); const next = new Date(`${addDays(date,1)}T00:00:00`).getTime();
              const intervals = layoutIntervals(displayed.filter(item => item.plannedStartAt != null && item.plannedEndAt != null && item.plannedStartAt < next && item.plannedEndAt > midnight).map(item => ({ ...item, start: Math.max(0, (item.plannedStartAt! - midnight) / 60000), end: Math.min(1440, (item.plannedEndAt! - midnight) / 60000) })));
              return <View key={date} style={{ width: columnWidth, height: 1440 * scale, borderLeftWidth: 1, borderColor: '#d1d5db' }}>
                {SLOT_KEYS.map((slot, index) => <Pressable key={slot} onPress={() => { setDrawerDate(date); setDrawer(drawer === slot && drawerDate === date ? null : slot); }} style={{ position: 'absolute', left: 0, right: 0, top: timeMinutes(schedule[slot].start) * scale, height: Math.max(0, timeMinutes(schedule[slot].end) - timeMinutes(schedule[slot].start)) * scale, backgroundColor: ['#fef9ed','#eff6ff','#f0fdf4','#faf5ff'][index] }}><Text style={s.boxLabel}>{SLOT_LABELS[slot]}</Text></Pressable>)}
                {Array.from({ length: 48 }, (_, half) => <Pressable key={half} disabled={!canCreate || dragging || pinching} onPress={event => onCreate(date, Math.max(0, Math.min(1435, snapMinutes(half * 30 + event.nativeEvent.locationY / scale))))} style={{ position: 'absolute', top: half * 30 * scale, height: 30 * scale, left: 0, right: 0, borderTopWidth: half % 2 === 0 ? 1 : 0.5, borderColor: '#e5e7eb' }} />)}
                {SLOT_KEYS.map(slot => <Pressable key={`label-${slot}`} accessibilityRole="button" style={{ position: 'absolute', top: timeMinutes(schedule[slot].start) * scale, right: 0, maxWidth: '100%', zIndex: 2, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, backgroundColor: '#ffffffdd', borderRadius: 6 }} onPress={() => { setDrawerDate(date); setDrawer(drawer === slot && drawerDate === date ? null : slot); }}><Text style={[s.boxLabel, { textAlign: 'right' }]}>【{SLOT_LABELS[slot]}】時間未設定のタスク</Text></Pressable>)}
                {intervals.map(item => <View key={item.key} style={[s.event, { top: item.start * scale, height: Math.max(20, (item.end - item.start) * scale), left: item.column * columnWidth / item.columns + 2, width: columnWidth / item.columns - 4, opacity: item.completed ? 0.55 : 1, borderWidth: preview?.item.key === item.key || props.selectedKeys?.includes(item.key) ? 2 : 0 }]}>
                  {item.editable !== false ? tile(item, <View style={s.handle} />, 'start') : null}
                  {tile(item, <Text numberOfLines={2} style={s.eventText}>{item.completed ? '✓ ' : ''}{item.title || '無題'} {new Date(item.plannedStartAt!).toTimeString().slice(0,5)}</Text>)}
                  {item.editable !== false ? tile(item, <View style={s.handle} />, 'end') : null}
                </View>)}
              </View>;
            })}
          </View>
        </ScrollView>
      </ScrollView>
      <ScrollView ref={timeAxis} pointerEvents="none" scrollEnabled={false} showsVerticalScrollIndicator={false} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: axisWidth, backgroundColor: '#fff' }}><View style={{ height: 1440 * scale }}>{Array.from({ length: 24 }, (_, h) => <Text key={h} style={[s.hour, { top: h * 60 * scale }]}>{String(h).padStart(2, '0')}:00</Text>)}</View></ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel={`日付未定 ${undated.length}件`} style={[s.button, s.undated]} onPress={() => setDrawer('undated')}><Text>日付未定 {undated.length}</Text></Pressable>
    </View>
  </View>;
}
const s = StyleSheet.create({ undated: { position: 'absolute', right: 8, bottom: 8, minHeight: 40, borderWidth: 1, borderColor: '#c7d2fe', zIndex: 5 }, buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center', paddingVertical: 2 }, button: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#eef2ff', minHeight: 32, alignItems: 'center', justifyContent: 'center' }, modalBackdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#00000066' }, modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }, drawer: { padding: 16, backgroundColor: '#fff', borderRadius: 12, maxHeight: '85%' }, drawerRow: { minHeight: 44, padding: 8, backgroundColor: '#f9fafb', marginVertical: 3 }, label: { color: '#111827', fontSize: 14 }, hint: { color: '#6b7280', padding: 6, fontSize: 12 }, preview: { padding: 8, backgroundColor: '#dbeafe', color: '#1e40af' }, day: { height: 28, padding: 4, backgroundColor: '#fff', textAlign: 'center', color: '#111827' }, hour: { position: 'absolute', fontSize: 10, color: '#6b7280' }, boxLabel: { fontSize: 11, color: '#6b7280', padding: 3 }, event: { position: 'absolute', borderRadius: 5, backgroundColor: '#bfdbfe', borderColor: '#2563eb', overflow: 'hidden', justifyContent: 'space-between' }, eventText: { fontSize: 12, color: '#1e3a8a', paddingHorizontal: 5 }, handle: { width: 28, height: 3, backgroundColor: '#60a5fa', alignSelf: 'center', marginVertical: 5, borderRadius: 2 } });
