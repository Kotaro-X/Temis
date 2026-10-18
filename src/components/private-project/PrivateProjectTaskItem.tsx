import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import TaskItem, { type TaskDragPreview } from "../tasks/TaskItem";
import TaskMoveModal from "../tasks/TaskMoveModal";
import ProjectTaskEditor from "../project/ProjectTaskEditor";
import { updateProjectTask, deleteProjectTask, type MyProjectTask } from "../../services/collaboration/collaborationService";
import { projectTaskOwner, projectTaskState } from "../../services/collaboration/projectTaskCore";
import { getProjectTaskPrivateDate, getProjectTaskPrivateSlot, toLocalDateString } from "../../utils/projectTaskPlacement";
import { SLOT_KEYS, SLOT_LABELS, type SlotKey, type TaskStatus } from "../../types";
import type { ProjectTaskStatus } from "../../types/collaboration";

type Props = {
  item: MyProjectTask; styles: Record<string, any>; tr: (key: string) => string;
  noTagLabel: string; untitledLabel: string; statusLabel: Record<TaskStatus, string>;
  statusPalette: Record<TaskStatus, { bar: string; badgeBg: string; badgeText: string }>;
  timeBoxSchedule: Record<SlotKey, { start: string; end: string }>; onChanged: () => void;
  isOpen?: boolean; onOpenSwipe?: () => void; onCloseSwipe?: () => void;
  ownerLabel?: string; selectionMode?: boolean; selected?: boolean; onToggleSelection?: () => void;
  onDragStart?: (preview: TaskDragPreview) => void; onDragMove?: (x: number, y: number) => void;
  onDragEnd?: () => void; onDragStateChange?: (dragging: boolean) => void; onDrop?: (pageY: number) => void;
};
export default function PrivateProjectTaskItem(props: Props) {
  const { item, styles, tr, noTagLabel, untitledLabel, statusLabel, statusPalette, timeBoxSchedule, onChanged } = props;
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [swipeOpen, setSwipeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [date, setDate] = useState(getProjectTaskPrivateDate(item.task));
  const [slot, setSlot] = useState(getProjectTaskPrivateSlot(item.task, timeBoxSchedule));
  const [dateError, setDateError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const task = projectTaskState(item.task);
  const run = async (action: () => Promise<unknown>) => {
    if (saving) return;
    setSaving(true);
    try { await action(); if (alive.current) { setSwipeOpen(false); props.onCloseSwipe?.(); setMoveOpen(false); onChanged(); } }
    catch (cause) { if (alive.current) Alert.alert("更新できません", cause instanceof Error ? cause.message : "再試行してください。"); }
    finally { if (alive.current) setSaving(false); }
  };
  const updateStatus = (status: ProjectTaskStatus) => { void run(() => updateProjectTask(item.task.id, { status })); };
  const openMove = () => { setDate(getProjectTaskPrivateDate(item.task)); setSlot(getProjectTaskPrivateSlot(item.task, timeBoxSchedule)); setDateError(null); setMoveOpen(true); };
  const shiftDate = (days: number) => { const value = new Date(`${date}T00:00:00`); if (!Number.isNaN(value.getTime())) { value.setDate(value.getDate() + days); setDate(toLocalDateString(value.getTime())); } };
  const move = () => {
    const value = new Date(`${date}T00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(value.getTime()) || toLocalDateString(value.getTime()) !== date) { setDateError("日付を確認してください。"); return; }
    void run(() => updateProjectTask(item.task.id, { privateDate: date, privateSlotKey: slot, ...(item.task.isArchived ? { isArchived: false, status: "todo" as const } : {}) }));
  };
  const confirmDelete = () => Alert.alert(tr("task.deleteConfirmTitle"), tr("task.deleteConfirmBody"), [
    { text: tr("common.cancel"), style: "cancel" }, { text: tr("common.delete"), style: "destructive", onPress: () => { void run(() => deleteProjectTask(item.task.id)); } },
  ]);
  return <View style={{ marginTop: 10, opacity: saving ? 0.6 : 1 }} pointerEvents={saving ? "none" : "auto"}>
    <TaskItem styles={styles} tr={tr} task={task} noTagLabel={noTagLabel} untitledLabel={untitledLabel}
      statusLabel={statusLabel[task.status]} palette={statusPalette[task.status]} isOpen={props.isOpen ?? swipeOpen}
      onOpen={() => { setSwipeOpen(true); props.onOpenSwipe?.(); }} onClose={() => { setSwipeOpen(false); props.onCloseSwipe?.(); }}
      onPress={() => {
        if (props.selectionMode) { props.onToggleSelection?.(); return; }
        if (props.isOpen ?? swipeOpen) { setSwipeOpen(false); props.onCloseSwipe?.(); return; }
        setEditorOpen(true);
      }}
      onStart={() => updateStatus("in_progress")} onPause={() => updateStatus("paused")} onDone={() => updateStatus("completed")}
      executionActions={item.task.isArchived ? <Pressable style={styles.startButton} onPress={openMove}><Text style={styles.startButtonText}>復元</Text></Pressable> : undefined}
      selectionMode={props.selectionMode} selected={props.selected} onToggleSelection={props.onToggleSelection}
      onDragStart={props.onDragStart} onDragMove={props.onDragMove} onDragEnd={props.onDragEnd}
      onDragStateChange={props.onDragStateChange} onDrop={props.onDrop} draggable={Boolean(props.onDrop)}
      completed={task.status === "DONE"} completedTime={item.task.completedAt ? new Date(item.task.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null}
      actions={[
        { label: item.task.isArchived ? "復元" : tr("task.move"), onPress: openMove, style: styles.swipeMoveButton },
        ...(!item.task.isArchived ? [{ label: tr("task.archive"), onPress: () => { void run(() => updateProjectTask(item.task.id, { isArchived: true })); }, style: styles.swipeArchiveButton }] : []),
        { label: tr("task.delete"), onPress: confirmDelete, style: styles.swipeDeleteButton },
      ]} />
    <Text style={styles.mutedText}>{item.project.name} · 担当者: {props.ownerLabel ?? item.ownerLabel ?? (projectTaskOwner(item.task) ? "あなた" : "未割り当て")}</Text>
    {editorOpen ? <ProjectTaskEditor project={item.project} task={item.task} onClose={() => setEditorOpen(false)} onChanged={onChanged} /> : null}
    <TaskMoveModal styles={styles} visible={moveOpen} title={item.task.isArchived ? "タスクを復元" : tr("task.move")} cancelLabel={tr("common.cancel")} confirmLabel="保存" prevLabel="前日" nextLabel="翌日"
      dateDraft={date} onChangeDateDraft={setDate} dateError={dateError} slotOptions={SLOT_KEYS.map(key => ({ key, label: SLOT_LABELS[key], active: slot === key, onPress: () => setSlot(key) }))}
      onPrevDate={() => shiftDate(-1)} onNextDate={() => shiftDate(1)} onClose={() => !saving && setMoveOpen(false)} onConfirm={move} />
  </View>;
}
