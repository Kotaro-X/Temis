import { registerEnvironmentSaveHandler } from '../../services/environment/switchLifecycle';
import { saveRecoveryDraft, loadRecoveryDraft, clearRecoveryDraft } from '../../services/environment/recoveryDrafts';
import sharedStyles from '../../styles/workspaceSharedStyles';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Modal from '../common/KeyboardAwareModal';
import TaskScheduleFields, { clockText, parseSchedule, scheduleDraft } from './TaskScheduleFields';
import TaskDetailView from './TaskDetailView';
import TaskMemoFields from './TaskMemoFields';
import TaskTagPickerModal from './TaskTagPickerModal';
import { useAppSettings } from '../../context/AppSettingsContext';
import { useAppUI } from '../../context/AppUIContext';
import { getProjectTaskPrivateDate, getProjectTaskPrivateSlot } from '../../utils/projectTaskPlacement';
import { useCollaboration } from '../../context/CollaborationContext';
import { useTaskPlanning } from '../../features/taskPlanning/TaskPlanningProvider';
import { getWorkspaceEpoch } from '../../services/account/workspaceEpoch';
import { updateProjectTask, createProjectTask, listProjectMembers, listProjectCreatorProfiles } from '../../services/collaboration/collaborationService';
import { changedProjectTaskFields, projectTaskOwner, projectTaskState } from '../../services/collaboration/projectTaskCore';
import { loadMemoByTaskId, updateMemo } from '../../repositories/memoRepository';
import { createEmptyTask } from '../../../storage';
import { writePlannedTask, mutatePlannedTask } from '../../repositories/taskRepository';
import { saveProjectReminder } from '../../features/taskPlanning/projectReminders';
import { requestTaskReminderPermission } from '../../features/taskPlanning/useTaskReminders';
import { initialDuration, localDate, normalizePlanning, NO_REMINDER, occurrencePatch, UNDATED_TASKS, type PlanningOccurrence } from '../../features/taskPlanning/planningCore';
import type { TaskState, SlotKey, TaskStatus } from '../../types';
import type { ProjectTask } from '../../types/collaboration';
import { performPlanningAction } from '../../features/taskPlanning/taskOperations';

const statusPalette = {
  TODO: { bar: '#9ca3af', badgeBg: '#f3f4f6', badgeText: '#374151' }, IN_PROGRESS: { bar: '#2563eb', badgeBg: '#dbeafe', badgeText: '#1e40af' },
  PAUSED: { bar: '#f59e0b', badgeBg: '#fef3c7', badgeText: '#92400e' }, DONE: { bar: '#16a34a', badgeBg: '#dcfce7', badgeText: '#166534' },
};
export default function TaskPlanningEditor({ item, projectId, initialDate, initialMinute, initialSlot = 'morning', onClose }: {
  item: PlanningOccurrence | null; projectId?: string; initialDate: string; initialMinute?: number; initialSlot?: SlotKey; onClose: () => void;
}) {
  const store = useTaskPlanning(); const { profile } = useCollaboration();
  const { tr, statusLabel, untitledLabel, timeBoxSchedule, tagOptions, appLanguage } = useAppSettings();
  const { openMemoSearch } = useAppUI(); const insets = useSafeAreaInsets();
  const privateRecord = store.privateRecords.find(record => record.task.id === item?.id);
  const sharedRecord = store.projects.find(record => `project:${record.task.id}` === item?.id);
  const sharedBaseline = useRef<ProjectTask | undefined>(sharedRecord ? { ...sharedRecord.task, description: sharedRecord.task.description ?? '', tags: sharedRecord.task.tags ?? [], estimateMinutes: sharedRecord.task.estimateMinutes ?? 25,
    assigneeUserId: projectTaskOwner(sharedRecord.task), privateDate: getProjectTaskPrivateDate(sharedRecord.task) === UNDATED_TASKS ? null : getProjectTaskPrivateDate(sharedRecord.task), privateSlotKey: getProjectTaskPrivateSlot(sharedRecord.task, timeBoxSchedule), plannedStartAt: sharedRecord.task.plannedStartAt ?? null, plannedEndAt: sharedRecord.task.plannedEndAt ?? null, repeat: sharedRecord.task.repeat ?? 'none', repeatAnchorDate: sharedRecord.task.repeatAnchorDate ?? null } : undefined);
  const source = sharedRecord ? projectTaskState(sharedRecord.task) : privateRecord?.task;
  const privateBaseline = useRef(source);
  const [task, setTask] = useState<TaskState>(() => ({ ...(source ?? createEmptyTask()), ...(!item && initialMinute != null ? { estimateMinutes: 30 } : {}), ...(item ? { taskName: item.title, tags: item.occurrenceOverrides?.[item.occurrenceDate]?.tags ?? source?.tags ?? [], estimateMinutes: item.estimateMinutes, elapsedMinutes: item.elapsedMinutes ?? source?.elapsedMinutes ?? 0, startAt: item.startAt ?? null, status: item.completed ? 'DONE' : item.executionStatus ?? source?.status ?? 'TODO' } : {}) }));
  const [schedule, setSchedule] = useState(() => {
    const value = scheduleDraft(item ?? {}, item?.date ?? initialDate, item?.slot ?? initialSlot);
    if (!item && initialMinute != null && initialDate !== UNDATED_TASKS) {
      const start = new Date(`${initialDate}T00:00:00`).getTime() + initialMinute * 60000;
      return scheduleDraft({ plannedStartAt: start, plannedEndAt: start + 1800000 }, initialDate, initialSlot);
    }
    return value;
  });
  const bodyEdited = useRef(false);
  const [body, setBody] = useState(item?.occurrenceOverrides?.[item.occurrenceDate]?.memo ?? sharedRecord?.task.description ?? '');
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [assignee, setAssignee] = useState<string | null>(sharedRecord ? projectTaskOwner(sharedRecord.task) : profile?.userId ?? null);
  const [tagOpen, setTagOpen] = useState(false); const [scope, setScope] = useState<'this' | 'all'>('this');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const createdProjectId = useRef<string | null>(null);
  const lock = useRef(false); const epoch = useRef(getWorkspaceEpoch()); const alive = useRef(true);
  const readOnly = item?.editable === false;
  const recoveryId = `task-planning:${projectId ?? 'private'}:${item?.key ?? 'new'}`;
  const draftRef = useRef({ task, schedule, body, assignee, scope }); draftRef.current = { task, schedule, body, assignee, scope };
  useEffect(() => registerEnvironmentSaveHandler(async () => {}, () => saveRecoveryDraft(recoveryId, { title: draftRef.current.task.taskName, body: JSON.stringify(draftRef.current) })), [recoveryId]);
  useEffect(() => {
    let active = true;
    void loadRecoveryDraft(recoveryId).then(saved => {
      if (!active || !saved || bodyEdited.current) return;
      const recovered = JSON.parse(saved.body) as typeof draftRef.current;
      if (!recovered.task || typeof recovered.task.taskName !== 'string' || !recovered.schedule) return;
      bodyEdited.current = true; setTask(recovered.task); setSchedule(recovered.schedule); setBody(recovered.body); setAssignee(recovered.assignee); setScope(recovered.scope);
    }).catch(() => setError('下書きを読み込めませんでした。'));
    return () => { active = false; };
  }, [recoveryId]);
  useEffect(() => {
    let active = true; alive.current = true;
    const occurrenceMemo = item?.occurrenceOverrides?.[item.occurrenceDate]?.memo;
    if (occurrenceMemo !== undefined) setBody(occurrenceMemo);
    else if (privateRecord) void (async () => { const specific = item && source?.repeat && source.repeat !== 'none' ? await loadMemoByTaskId(`${privateRecord.task.id}@${item.occurrenceDate}`) : null; return specific ?? await loadMemoByTaskId(privateRecord.task.id); })().then(memo => { if (active && !bodyEdited.current) setBody(memo?.body ?? ''); }).catch(cause => setError(cause.message));
    if (projectId) void listProjectMembers(projectId).then(async next => { const profiles = await listProjectCreatorProfiles(next.map(member => member.userId)); if (active) setMembers(next.map(member => ({ id: member.userId, name: profiles.find(p => p.userId === member.userId)?.displayName || member.userId }))); }).catch(cause => setError(cause.message));
    return () => { active = false; alive.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (action: () => Promise<void>, close = true) => {
    if (lock.current || epoch.current !== getWorkspaceEpoch()) return;
    lock.current = true; setBusy(true); setError(null);
    try { await action(); if (alive.current && epoch.current === getWorkspaceEpoch()) { if (close) { await clearRecoveryDraft(recoveryId); onClose(); } } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '保存できませんでした。'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const save = () => { void run(async () => {
    if (!task.taskName.trim() || task.taskName.trim().length > 1000) throw new Error('タスク名を1〜1000文字で入力してください。');
    if (!Number.isFinite(task.estimateMinutes) || task.estimateMinutes < 0 || task.estimateMinutes > 100000) throw new Error('見積時間は0〜100000分で入力してください。');
    const parsed = parseSchedule(schedule, timeBoxSchedule);
    const recurring = item && source?.repeat && source.repeat !== 'none';
    if (parsed.planning.reminder.enabled) await requestTaskReminderPermission();
    if (epoch.current !== getWorkspaceEpoch()) throw new Error('アカウントが切り替わりました。');
    if (projectId) {
      let id = sharedRecord?.task.id ?? createdProjectId.current;
      if (!readOnly) {
        const patch = { title: task.taskName.trim(), description: body, tags: task.tags, estimateMinutes: parsed.estimateMinutes ?? task.estimateMinutes,
          assigneeUserId: assignee, privateDate: parsed.date === UNDATED_TASKS ? null : parsed.date, privateSlotKey: parsed.slot,
          plannedStartAt: parsed.planning.plannedStartAt ?? null, plannedEndAt: parsed.planning.plannedEndAt ?? null,
          repeat: parsed.planning.repeat, repeatAnchorDate: recurring && scope === 'all' && schedule.date === item?.date ? sharedRecord?.task.repeatAnchorDate ?? sharedRecord?.task.privateDate ?? schedule.date : parsed.planning.repeatAnchorDate };
        if (recurring && scope === 'all' && schedule.date === item?.date && sharedRecord) {
          patch.privateDate = sharedRecord.task.privateDate ?? null;
          if (patch.plannedStartAt != null && patch.plannedEndAt != null) { const duration = patch.plannedEndAt - patch.plannedStartAt; patch.plannedStartAt = new Date(`${patch.repeatAnchorDate}T${new Date(patch.plannedStartAt).toTimeString().slice(0,8)}`).getTime(); patch.plannedEndAt = patch.plannedStartAt + duration; }
        }
        if (id && recurring && scope === 'this') {
          await updateProjectTask(id, occurrencePatch({}, item.occurrenceDate, { date: parsed.date, slot: parsed.slot, plannedStartAt: patch.plannedStartAt ?? null, plannedEndAt: patch.plannedEndAt ?? null, estimateMinutes: patch.estimateMinutes, completed: task.status === 'DONE', title: patch.title, memo: body, tags: task.tags }));
        } else if (id) await updateProjectTask(id, sharedBaseline.current ? changedProjectTaskFields(sharedBaseline.current, { ...sharedBaseline.current, ...patch }) : patch);
        else { const created = await createProjectTask({ ...patch, projectId, kind: 'task', status: 'todo' }); id = created.id; createdProjectId.current = id; sharedBaseline.current = created; }
      }
      if (id) await saveProjectReminder(id, parsed.planning.reminder);
    } else if (item) {
      await mutatePlannedTask(item.id, current => {
        if (recurring && scope === 'this') return { ...current, task: { ...current.task, reminder: parsed.planning.reminder,
          ...occurrencePatch(current.task, item.occurrenceDate, { date: parsed.date, slot: parsed.slot, plannedStartAt: parsed.planning.plannedStartAt ?? null, plannedEndAt: parsed.planning.plannedEndAt ?? null, estimateMinutes: parsed.estimateMinutes ?? task.estimateMinutes, completed: task.status === 'DONE', title: task.taskName.trim(), tags: task.tags }) } };
        const planning = { ...parsed.planning };
        const sameDate = recurring && scope === 'all' && schedule.date === item.date;
        if (sameDate) { planning.repeatAnchorDate = current.task.repeatAnchorDate ?? current.date; if (planning.plannedStartAt != null && planning.plannedEndAt != null) { const duration = planning.plannedEndAt - planning.plannedStartAt; planning.plannedStartAt = new Date(`${planning.repeatAnchorDate}T${new Date(planning.plannedStartAt).toTimeString().slice(0,8)}`).getTime(); planning.plannedEndAt = planning.plannedStartAt + duration; } }
        const baseline = privateBaseline.current ?? current.task;
        const initialPlanning = { ...normalizePlanning(baseline), reminder: baseline.reminder ?? NO_REMINDER };
        const planningChanges = Object.fromEntries(Object.entries(planning).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(initialPlanning[key as keyof typeof initialPlanning])));
        return { date: sameDate || schedule.date === item.date ? current.date : parsed.date, slotKey: schedule.slot !== item.slot || planningChanges.plannedStartAt !== undefined ? parsed.slot : current.slotKey,
          task: { ...current.task, ...planningChanges,
            ...(task.taskName.trim() !== (item.title ?? baseline.taskName) ? { taskName: task.taskName.trim() } : {}),
            ...(JSON.stringify(task.tags) !== JSON.stringify(item.occurrenceOverrides?.[item.occurrenceDate]?.tags ?? baseline.tags) ? { tags: task.tags } : {}),
            ...((parsed.estimateMinutes ?? task.estimateMinutes) !== item.estimateMinutes ? { estimateMinutes: parsed.estimateMinutes ?? task.estimateMinutes } : {}) } };
      });
      if (!recurring || scope === 'all') { if (bodyEdited.current) await updateMemo(item.id, body); }
      else if (bodyEdited.current) await updateMemo(`${item.id}@${item.occurrenceDate}`, body);
    } else {
      await writePlannedTask({ ...task, taskName: task.taskName.trim(), ...parsed.planning, estimateMinutes: parsed.estimateMinutes ?? task.estimateMinutes }, parsed.date, parsed.slot);
      if (body.trim()) await updateMemo(task.id, body);
    }
    await store.refresh();
  }); };
  const transition = (status: TaskStatus) => {
    if (!item) { Alert.alert('タスクを保存してください', '保存後に開始・完了できます。'); return; }
    void run(async () => {
      await performPlanningAction(item, status === 'IN_PROGRESS' ? 'start' : status === 'PAUSED' ? 'pause' : status === 'DONE' ? 'done' : 'reopen');
      setTask(previous => ({ ...previous, status })); await store.refresh();
    }, false);
  };
  return <Modal visible animationType="slide" onRequestClose={() => !busy && onClose()}><View style={{ flex: 1, paddingTop: insets.top, backgroundColor: '#fff' }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16 }}><Pressable disabled={busy} onPress={onClose}><Text>キャンセル</Text></Pressable><Text>{projectId ? 'Project タスク' : 'タスク'}</Text><Pressable disabled={busy} onPress={save}><Text style={{ color: '#2563eb' }}>{busy ? '保存中…' : '保存'}</Text></Pressable></View>
    {error ? <Text accessibilityRole="alert" style={{ color: '#b91c1c', padding: 12 }}>{error}</Text> : null}
    <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} pointerEvents={busy ? 'none' : 'auto'}>
      <View pointerEvents={readOnly ? 'none' : 'auto'}>
        <TaskDetailView styles={sharedStyles} tr={tr} task={task} slotKey={schedule.slot} untitledLabel={untitledLabel} statusLabel={statusLabel} statusPalette={statusPalette}
          onOpenTagPicker={() => setTagOpen(true)} onUpdateTaskName={taskName => setTask(previous => ({ ...previous, taskName }))} onUpdateTaskEstimate={value => {
            const estimateMinutes = Number(value) || 0; setTask(previous => ({ ...previous, estimateMinutes }));
            if (schedule.start && schedule.date && estimateMinutes > 0) { const start = new Date(`${schedule.date}T${schedule.start}:00`).getTime(); if (Number.isFinite(start)) { const end = start + initialDuration(estimateMinutes) * 60000; setSchedule(previous => ({ ...previous, endDate: localDate(end), end: clockText(end) })); } }
          }}
          onStart={() => transition('IN_PROGRESS')} onPause={() => transition('PAUSED')} onDone={() => transition('DONE')}>
          {projectId ? <><Text>担当者</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{[{ id: null, name: '未割り当て' }, ...members].map(member => <Pressable key={member.id ?? 'none'} onPress={() => setAssignee(member.id)} style={{ padding: 10, backgroundColor: member.id === assignee ? '#dbeafe' : '#f3f4f6' }}><Text>{member.name}</Text></Pressable>)}</View></> : null}
          <TaskMemoFields body={body} setBody={value => { bodyEdited.current = true; setBody(value); }} language={appLanguage} onSearchToken={openMemoSearch} />
        </TaskDetailView>
      </View>
      {source?.repeat && source.repeat !== 'none' ? <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 12 }}>{(['this','all'] as const).map(value => <Pressable disabled={readOnly} key={value} onPress={() => setScope(value)}><Text>{scope === value ? '●' : '○'} {value === 'this' ? 'その回だけ' : '全体'}</Text></Pressable>)}</View> : null}
      {readOnly ? <Text>共有予定の編集権限がありません。自分の通知は設定できます。</Text> : null}
      {item && !readOnly ? <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 12 }}><Pressable disabled={busy} onPress={() => transition(task.status === 'DONE' ? 'TODO' : 'DONE')}><Text>{task.status === 'DONE' ? '未完了に戻す' : '完了にする'}</Text></Pressable><Pressable disabled={busy} onPress={() => { void run(() => performPlanningAction(item, 'archive')); }}><Text>アーカイブ</Text></Pressable><Pressable disabled={busy} onPress={() => Alert.alert('タスクを削除', item.repeat && item.repeat !== 'none' ? 'この回を削除しますか？' : 'このタスクを削除しますか？', [{ text: 'キャンセル', style: 'cancel' }, { text: '削除', style: 'destructive', onPress: () => { void run(() => performPlanningAction(item, 'delete')); } }])}><Text style={{ color: '#b91c1c' }}>削除</Text></Pressable></View> : null}
      <TaskScheduleFields draft={schedule} onChange={next => { setSchedule(next); try { const parsed = parseSchedule(next, timeBoxSchedule); if (parsed.estimateMinutes != null) setTask(previous => ({ ...previous, estimateMinutes: parsed.estimateMinutes! })); } catch { /* Preserve incomplete input until save. */ } }} disabled={readOnly} />
      {schedule.reminder.enabled && store.notificationWarning ? <Text style={{ color: '#92400e' }}>{store.notificationWarning}</Text> : null}
    </ScrollView>
    <TaskTagPickerModal styles={sharedStyles} visible={tagOpen} title="タグ" closeLabel="閉じる" tagOptions={tagOptions} selectedTags={task.tags} onClose={() => setTagOpen(false)} onToggleTag={tag => setTask(previous => ({ ...previous, tags: previous.tags.includes(tag) ? previous.tags.filter(value => value !== tag) : [...previous.tags, tag] }))} />
  </View></Modal>;
}
