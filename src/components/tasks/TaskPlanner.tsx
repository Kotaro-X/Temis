import { useAppUI } from '../../context/AppUIContext';
import TaskItem from './TaskItem';
import sharedStyles from '../../styles/workspaceSharedStyles';
import { projectTaskOwner, projectTaskState } from '../../services/collaboration/projectTaskCore';
import { movePlanningOccurrence, performPlanningAction, type PlanningAction } from '../../features/taskPlanning/taskOperations';
import type { TaskState } from '../../types/task';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, View, StyleSheet } from 'react-native';
import { useTaskPlanning } from '../../features/taskPlanning/TaskPlanningProvider';
import { useAppSettings } from '../../context/AppSettingsContext';
import { useCollaboration } from '../../context/CollaborationContext';
import storage from '../../services/account/accountWorkspace';
import { getWorkspaceEpoch } from '../../services/account/workspaceEpoch';
import { mutatePlannedTask } from '../../repositories/taskRepository';
import { updateProjectTask } from '../../services/collaboration/collaborationService';
import { addDays, localDate, occurrencePatch, occurrencesForDates, scheduledPatch, slotAt, UNDATED_TASKS, weekDates, type PlanningOccurrence } from '../../features/taskPlanning/planningCore';
import { SLOT_KEYS, SLOT_LABELS, type SlotKey } from '../../types/timer';
import TaskTimeline from './TaskTimeline';
import TaskMoveModal from './TaskMoveModal';
import TaskPlanningEditor from './TaskPlanningEditor';

type Editor = { item: PlanningOccurrence | null; date: string; minute?: number; slot?: SlotKey; projectId?: string };
export default function TaskPlanner({ projectId, selectedDate, selectionMode = false, onDraggingChange }: { onDraggingChange?: (dragging: boolean) => void; projectId?: string; selectedDate: string; selectionMode?: boolean }) {
  const store = useTaskPlanning(); const { timeBoxSchedule, tr, statusLabel, noTagLabel, untitledLabel } = useAppSettings(); const { profile, overflowProjects } = useCollaboration();
  const [view, setView] = useState<'box' | 'timeline'>('box'); const [range, setRange] = useState<'day' | 'week'>('day');
  const { selectDateFromCalendar: setDate } = useAppUI(); const date = selectedDate; const [editor, setEditor] = useState<Editor | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ morning: true, forenoon: true, afternoon: true, night: true, undated: false });
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false); const [bulkDate, setBulkDate] = useState(selectedDate); const [bulkSlot, setBulkSlot] = useState<SlotKey>('morning'); const [bulkError, setBulkError] = useState<string | null>(null);
  useEffect(() => { setSelectedKeys([]); setBulkMoveOpen(false); }, [selectionMode, selectedDate]);
  const [swipeKey, setSwipeKey] = useState<string | null>(null); const actionLock = useRef(false);
  const [loaded, setLoaded] = useState(false); const placing = useRef(false);
  const preferenceKey = `task-planner-view:${projectId ?? 'private'}`;
  const role = projectId ? overflowProjects.find(item => item.project.id === projectId)?.role : undefined;
  const canCreate = !projectId || role === 'owner' || role === 'member';
  useEffect(() => { let active = true; setLoaded(false); void storage.getItem(preferenceKey).then(raw => { if (!active) return; if (raw) { const value = JSON.parse(raw); setView(value.view === 'timeline' ? 'timeline' : 'box'); setRange(value.range === 'week' ? 'week' : 'day'); } setLoaded(true); }).catch(() => { if (active) setLoaded(true); }); return () => { active = false; }; }, [preferenceKey]);
  useEffect(() => { if (loaded) void storage.setItem(preferenceKey, JSON.stringify({ view, range })).catch(() => Alert.alert('表示設定を保存できませんでした')); }, [preferenceKey, view, range, loaded]);
  const items = useMemo(() => store.items.filter(item => {
    if (projectId) return item.projectId === projectId;
    if (!item.projectId) return true;
    const record = store.projects.find(record => `project:${record.task.id}` === item.id);
    return record && projectTaskOwner(record.task) === profile?.userId;
  }), [store.items, store.projects, profile?.userId, projectId]);
  const dates = range === 'week' && view === 'timeline' ? weekDates(date) : [date];
  const occurrences = occurrencesForDates(items, dates);
  const undated: PlanningOccurrence[] = items.filter(item => item.date === UNDATED_TASKS && !item.archived).map(item => ({ ...item, key: `${item.id}@undated`, occurrenceDate: UNDATED_TASKS }));
  const toggleSelection = (item: PlanningOccurrence) => { if (item.editable === false) return; setSelectedKeys(previous => previous.includes(item.key) ? previous.filter(key => key !== item.key) : [...previous,item.key]); };
  const edit = (item: PlanningOccurrence) => { if (selectionMode) { toggleSelection(item); return; } setEditor({ item, date: item.date, projectId: item.projectId }); };
  useEffect(() => {
    if (!store.requestedTaskId) return;
    const item = items.find(item => item.id === store.requestedTaskId); if (!item) return;
    const target = occurrencesForDates([item], [item.date === UNDATED_TASKS ? date : item.date])[0] ?? { ...item, key: item.id, occurrenceDate: item.date };
    setEditor({ item: target, date: item.date, projectId: item.projectId }); store.clearRequestedTask();
  }, [store.requestedTaskId, items]); // eslint-disable-line react-hooks/exhaustive-deps
  const place = async (item: PlanningOccurrence, start: number, end: number) => {
    if (placing.current || item.editable === false) return; placing.current = true;
    const epoch = getWorkspaceEpoch();
    try {
      const patch = scheduledPatch(start, end), date = localDate(start), slot = slotAt(timeBoxSchedule, start);
      if (item.projectId) {
        const record = store.projects.find(record => `project:${record.task.id}` === item.id); if (!record) throw new Error('Projectタスクが見つかりません。');
        await updateProjectTask(record.task.id, record.task.repeat && record.task.repeat !== 'none' ? occurrencePatch({}, item.occurrenceDate, { ...patch, date, slot }) : { ...patch, privateDate: date, privateSlotKey: slot });
      } else await mutatePlannedTask(item.id, current => current.task.repeat && current.task.repeat !== 'none'
        ? { ...current, task: { ...current.task, ...occurrencePatch(current.task, item.occurrenceDate, { ...patch, date, slot }) } }
        : { date, slotKey: slot, task: { ...current.task, ...patch } });
      if (epoch === getWorkspaceEpoch()) await store.refresh();
    } catch (cause) { if (epoch === getWorkspaceEpoch()) Alert.alert('予定を変更できません', cause instanceof Error ? cause.message : '再試行してください。'); }
    finally { placing.current = false; }
  };
  const action = async (item: PlanningOccurrence, operation: PlanningAction) => {
    if (actionLock.current) return; actionLock.current = true;
    try { await performPlanningAction(item, operation); setSwipeKey(null); await store.refresh(); }
    catch (cause) { Alert.alert('更新できません', cause instanceof Error ? cause.message : '再試行してください。'); }
    finally { actionLock.current = false; }
  };
  const row = (item: PlanningOccurrence) => {
    const shared = store.projects.find(record => `project:${record.task.id}` === item.id);
    const source = shared ? projectTaskState(shared.task) : store.privateRecords.find(record => record.task.id === item.id)?.task;
    if (!source) return null;
    const task: TaskState = { ...source, taskName: item.title, estimateMinutes: item.estimateMinutes, tags: item.occurrenceOverrides?.[item.occurrenceDate]?.tags ?? source.tags, elapsedMinutes: item.elapsedMinutes ?? source.elapsedMinutes, startAt: item.startAt ?? null, status: item.completed ? 'DONE' : item.executionStatus === 'DONE' ? 'TODO' : item.executionStatus ?? (source.status === 'DONE' ? 'TODO' : source.status) };
    const palette = { TODO: { bar: '#9ca3af', badgeBg: '#f3f4f6', badgeText: '#374151' }, IN_PROGRESS: { bar: '#2563eb', badgeBg: '#dbeafe', badgeText: '#1e40af' }, PAUSED: { bar: '#f59e0b', badgeBg: '#fef3c7', badgeText: '#92400e' }, DONE: { bar: '#16a34a', badgeBg: '#dcfce7', badgeText: '#166534' } }[task.status];
    const invoke = (operation: PlanningAction) => { void action(item, operation); };
    return <View key={item.key} style={{ marginVertical: 5 }}>
      <TaskItem styles={sharedStyles} tr={tr} task={task} noTagLabel={noTagLabel} untitledLabel={untitledLabel} statusLabel={statusLabel[task.status]} palette={palette}
        draggable={false} isOpen={swipeKey === item.key} onOpen={() => setSwipeKey(item.key)} onClose={() => setSwipeKey(null)} onPress={() => { setSwipeKey(null); edit(item); }}
        selectionMode={selectionMode} selected={selectedKeys.includes(item.key)} onToggleSelection={() => toggleSelection(item)} completed={item.completed}
        onStart={() => invoke('start')} onPause={() => invoke('pause')} onDone={() => invoke('done')}
        executionActions={item.editable === false ? <Text>閲覧のみ</Text> : item.completed ? <Pressable style={s.button} onPress={() => invoke('reopen')}><Text>未完了に戻す</Text></Pressable> : undefined}
        swipeEnabled={item.editable !== false} actions={item.editable === false ? [] : [
          { label: '日時・通知', onPress: () => edit(item), style: sharedStyles.swipeMoveButton },
          { label: 'アーカイブ', onPress: () => invoke('archive'), style: sharedStyles.swipeArchiveButton },
          { label: '削除', onPress: () => Alert.alert('タスクを削除', item.repeat && item.repeat !== 'none' ? 'この回を削除しますか？' : 'このタスクを削除しますか？', [{ text: 'キャンセル', style: 'cancel' }, { text: '削除', style: 'destructive', onPress: () => invoke('delete') }]), style: sharedStyles.swipeDeleteButton },
        ]} />
      <Text style={s.meta}>{item.plannedStartAt != null ? `${new Date(item.plannedStartAt).toTimeString().slice(0,5)}–${new Date(item.plannedEndAt!).toTimeString().slice(0,5)}` : '時間未設定'}{item.repeat && item.repeat !== 'none' ? ' · 繰り返し' : ''}{shared ? ` · ${shared.project.name} · 担当者: ${projectTaskOwner(shared.task) === profile?.userId ? 'あなた' : projectTaskOwner(shared.task) ?? '未割り当て'}` : ''}</Text>
    </View>;
  };
  const selectedItems = [...occurrences, ...undated].filter(item => selectedKeys.includes(item.key));
  const bulk = async (operation: 'delete' | 'move') => {
    if (actionLock.current || !selectedItems.length) return; actionLock.current = true; const epoch = getWorkspaceEpoch();
    try {
      for (const item of selectedItems) { if (epoch !== getWorkspaceEpoch()) return; if (operation === 'delete') await performPlanningAction(item,'delete'); else await movePlanningOccurrence(item,bulkDate,bulkSlot,timeBoxSchedule); }
      if (epoch !== getWorkspaceEpoch()) return; setSelectedKeys([]); setBulkMoveOpen(false); await store.refresh();
    } catch (cause) { const message = cause instanceof Error ? cause.message : '再試行してください。'; setBulkError(message); Alert.alert('更新できません',message); }
    finally { actionLock.current = false; }
  };
  const dateControls = <View style={s.dateControls}><Pressable accessibilityLabel="前へ" style={s.button} onPress={() => setDate(addDays(date, range === 'week' && view === 'timeline' ? -7 : -1))}><Text>‹</Text></Pressable><Text style={s.date}>{date}</Text><Pressable accessibilityLabel="次へ" style={s.button} onPress={() => setDate(addDays(date, range === 'week' && view === 'timeline' ? 7 : 1))}><Text>›</Text></Pressable><Pressable style={s.button} onPress={() => setDate(localDate(Date.now()))}><Text>今日</Text></Pressable></View>;
  return <View style={{ flex: 1 }}>
    {selectionMode ? <View style={s.toolbar}><Text>選択中: {selectedItems.length}</Text><Pressable disabled={!selectedItems.length} style={s.button} onPress={() => { setBulkDate(date); setBulkError(null); setBulkMoveOpen(true); }}><Text>移動</Text></Pressable><Pressable disabled={!selectedItems.length} style={s.button} onPress={() => Alert.alert('選択したタスクを削除','繰り返しタスクは選択した回だけを削除します。',[{ text:'キャンセル',style:'cancel' },{ text:'削除',style:'destructive',onPress:() => { void bulk('delete'); } }])}><Text>削除</Text></Pressable><Pressable style={s.button} onPress={() => setSelectedKeys([])}><Text>選択解除</Text></Pressable></View> : null}
    <View style={s.toolbar}>{(['box','timeline'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: value === view }} style={[s.button, view === value && s.active]} onPress={() => setView(value)}><Text>{value === 'box' ? 'ボックス' : 'タイムライン'}</Text></Pressable>)}
      {view === 'timeline' ? (['day','week'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: range === value }} style={[s.button, range === value && s.active]} onPress={() => setRange(value)}><Text>{value === 'day' ? '日' : '週'}</Text></Pressable>) : null}
    </View>
    {view === 'box' ? dateControls : null}
    {store.error ? <Text accessibilityRole="alert" style={{ color: '#b91c1c' }}>{store.error}</Text> : null}
    {view === 'timeline' ? <TaskTimeline headerControls={dateControls} onPage={direction => setDate(addDays(date, direction * (range === 'week' ? 7 : 1)))} selectedKeys={selectedKeys} onDraggingChange={onDraggingChange} dates={dates} items={occurrences} undated={undated} schedule={timeBoxSchedule} onEdit={edit} onCreate={(date, minute) => setEditor({ item: null, date, minute, projectId })} onPlace={(...args) => { void place(...args); }} canCreate={canCreate} /> : <>
      {[...SLOT_KEYS, 'undated' as const].map(slot => {
        const entries = slot === 'undated' ? undated : occurrences.filter(item => item.date === date && item.slot === slot);
        return <View key={slot} style={s.box}><View style={s.toolbar}><Pressable style={{ flex: 1, padding: 10 }} accessibilityRole="button" accessibilityState={{ expanded: expanded[slot] }} onPress={() => setExpanded(previous => ({ ...previous, [slot]: !previous[slot] }))}><Text style={s.heading}>{expanded[slot] ? '▾' : '▸'} {slot === 'undated' ? '日付未定' : `${SLOT_LABELS[slot]} ${timeBoxSchedule[slot].start}–${timeBoxSchedule[slot].end}`} ({entries.length})</Text></Pressable>{canCreate ? <Pressable style={s.button} onPress={() => setEditor({ item: null, date: slot === 'undated' ? UNDATED_TASKS : date, slot: slot === 'undated' ? 'morning' : slot, projectId })}><Text>＋</Text></Pressable> : null}</View>
          {expanded[slot] ? <>{entries.map(row)}{!entries.length ? <Text style={s.meta}>タスクはありません</Text> : null}</> : null}</View>;
      })}
    </>}
    <TaskMoveModal styles={sharedStyles} visible={bulkMoveOpen} title="選択したタスクを移動（予定の時刻は維持）" cancelLabel="キャンセル" confirmLabel="保存" prevLabel="前日" nextLabel="翌日" dateDraft={bulkDate} onChangeDateDraft={setBulkDate} dateError={bulkError}
      slotOptions={SLOT_KEYS.map(key => ({ key,label:`時間未設定: ${SLOT_LABELS[key]}`,active:key === bulkSlot,onPress:() => setBulkSlot(key) }))} onPrevDate={() => setBulkDate(addDays(bulkDate,-1))} onNextDate={() => setBulkDate(addDays(bulkDate,1))} onClose={() => !actionLock.current && setBulkMoveOpen(false)} onConfirm={() => { void bulk('move'); }} />
    {editor ? <TaskPlanningEditor key={`${editor.item?.key ?? 'new'}:${editor.date}:${editor.minute ?? ''}`} item={editor.item} projectId={editor.projectId} initialDate={editor.date} initialMinute={editor.minute} initialSlot={editor.slot} onClose={() => setEditor(null)} /> : null}
  </View>;
}
const s = StyleSheet.create({ toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginVertical: 2 }, dateControls: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }, button: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#f3f4f6', borderRadius: 6, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' }, active: { backgroundColor: '#dbeafe', borderWidth: 1, borderColor: '#2563eb' }, date: { fontSize: 14, color: '#111827' }, box: { borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 8, marginVertical: 8, backgroundColor: '#fff' }, heading: { fontSize: 16, fontWeight: '600', color: '#111827' }, card: { backgroundColor: '#f9fafb', padding: 12, borderRadius: 8, marginVertical: 4 }, task: { fontSize: 16, color: '#111827' }, meta: { color: '#6b7280', fontSize: 12, paddingVertical: 5 } });
