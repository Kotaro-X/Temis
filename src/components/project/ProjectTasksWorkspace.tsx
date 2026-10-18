import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import TaskScreen from "../../screens/TaskScreen";
import styles from "../../styles/workspaceSharedStyles";
import Modal from "../common/KeyboardAwareModal";
import PrivateProjectTaskItem from "../private-project/PrivateProjectTaskItem";
import ProjectTaskEditor, { projectTaskPalette } from "./ProjectTaskEditor";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useAppUI } from "../../context/AppUIContext";
import { useCollaboration } from "../../context/CollaborationContext";
import { deleteProjectTask, listProjectCreatorProfiles, subscribeProjectTasks, updateProjectTask, type MyProjectTask } from "../../services/collaboration/collaborationService";
import { projectTaskOwner } from "../../services/collaboration/projectTaskCore";
import { getProjectTaskPrivateDate, getProjectTaskPrivateSlot, toLocalDateString } from "../../utils/projectTaskPlacement";
import { buildTodaySections } from "../../hooks/tasks/taskSelectors";
import { getSlotLabel } from "../../i18n";
import { SLOT_KEYS, type SlotKey } from "../../types";
import type { Project, ProjectTask } from "../../types/collaboration";

export default function ProjectTasksWorkspace({ project, active }: { project: Project; active: boolean; contentPaddingTop: number }) {
  const insets = useSafeAreaInsets();
  const { profile } = useCollaboration();
  const userId = profile?.userId;
  const { tr, trf, appLanguage, noTagLabel, untitledLabel, statusLabel, timeBoxSchedule } = useAppSettings();
  const { selectedDate, openDatePicker, openMenu } = useAppUI();
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeExpanded, setActiveExpanded] = useState<Record<SlotKey, boolean>>({ morning: true, forenoon: true, afternoon: true, night: true });
  const [completedExpanded, setCompletedExpanded] = useState<Record<SlotKey, boolean>>({ morning: false, forenoon: false, afternoon: false, night: false });
  const [addSlot, setAddSlot] = useState<SlotKey | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [moveIds, setMoveIds] = useState<string[]>([]);
  const [moveDate, setMoveDate] = useState(selectedDate);
  const [moveSlot, setMoveSlot] = useState<SlotKey>("morning");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTasks([]); setSelected([]); setSelectionMode(false); setAddSlot(null); setMoveIds([]); setArchiveOpen(false); setLoading(true);
    if (!active || !userId) return;
    let alive = true;
    const unsubscribe = subscribeProjectTasks(project.id, next => {
      if (!alive) return;
      setTasks(next.filter(task => (task.kind ?? "task") === "task")); setLoading(false); setError(null);
      void listProjectCreatorProfiles(next.map(task => projectTaskOwner(task))).then(profiles => {
        if (alive) setNames(Object.fromEntries(profiles.map(p => [p.userId, p.displayName || `@${p.username}`])));
      });
    }, cause => { if (alive) { setTasks([]); setError(cause.message); setLoading(false); setAddSlot(null); setArchiveOpen(false); } });
    return () => { alive = false; unsubscribe(); };
  }, [active, project.id, userId, reload]);
  useEffect(() => { setSelected([]); setSelectionMode(false); setMoveIds([]); }, [selectedDate]);
  useEffect(() => { setSelected(previous => previous.filter(id => tasks.some(task => `project:${task.id}` === id && !task.isArchived))); }, [tasks]);
  const ownerLabel = (task: ProjectTask) => {
    const owner = projectTaskOwner(task);
    return !owner ? "未割り当て" : owner === profile?.userId ? "あなた" : names[owner] || `メンバー ${owner.slice(0, 8)}`;
  };
  const grouped = Object.fromEntries(SLOT_KEYS.map(slot => [slot, tasks.filter(task => !task.isArchived && getProjectTaskPrivateDate(task) === selectedDate && getProjectTaskPrivateSlot(task, timeBoxSchedule) === slot)
    .map(task => ({ task, project, ownerLabel: ownerLabel(task) }))])) as Record<SlotKey, MyProjectTask[]>;
  const sections = buildTodaySections({ date: selectedDate,
    slots: { morning: { tasks: [] }, forenoon: { tasks: [] }, afternoon: { tasks: [] }, night: { tasks: [] } } }, timeBoxSchedule);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); }
    catch (cause) { Alert.alert("更新できません", cause instanceof Error ? cause.message : "再試行してください。"); }
    finally { setBusy(false); }
  };
  const shift = (days: number) => { const d = new Date(`${moveDate}T00:00:00`); if (!Number.isNaN(d.getTime())) { d.setDate(d.getDate() + days); setMoveDate(toLocalDateString(d.getTime())); } };
  const base = { styles, tr, getSlotLabel: (slot: SlotKey) => getSlotLabel(appLanguage, slot), sections, activeTaskId: null,
    noTagLabel, untitledLabel, statusLabel, statusPalette: projectTaskPalette, selectionMode, selectedSet,
    activeExpandedBySlot: activeExpanded, completedExpandedBySlot: completedExpanded, completedTimeByTaskId: new Map<string, string>(),
    onToggleActive: (slot: SlotKey) => setActiveExpanded(prev => ({ ...prev, [slot]: !prev[slot] })),
    onToggleCompleted: (slot: SlotKey) => setCompletedExpanded(prev => ({ ...prev, [slot]: !prev[slot] })),
    onAddTask: setAddSlot, onToggleSelection: (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(value => value !== id) : [...prev, id]),
    onStart: () => {}, onPause: () => {}, onDone: () => {} };
  return <View style={{ flex: 1 }}>
    {error ? <Text accessibilityRole="alert" style={{ color: "#b91c1c", padding: 16 }}>{error}</Text> : null}
    <TaskScreen planningProjectId={project.id} planningSelectedDate={selectedDate} styles={styles} insetsTop={insets.top} title={selectedDate}
      headerLeft={<Pressable onPress={openMenu} style={styles.menuButton}><Ionicons name="menu" size={20} /></Pressable>}
      headerRight={<View style={{ flexDirection: "row", gap: 10 }}><Pressable onPress={openDatePicker}><Ionicons name="calendar-outline" size={20} /></Pressable><Pressable onPress={() => setArchiveOpen(true)}><Ionicons name="archive-outline" size={20} /></Pressable><Pressable onPress={() => { setSelectionMode(value => !value); setSelected([]); }}><Text>{selectionMode ? "終了" : "選択"}</Text></Pressable></View>}
      contentPaddingTop={insets.top + 40} footerPaddingBottom={90} refreshing={loading} onRefresh={() => setReload(value => value + 1)}
      trf={trf} routineSuggestions={[]} currentSlotLabel="" onAddSuggestion={() => {}} onDismissSuggestion={() => {}}
      onOpenTaskDetail={() => {}} onDeleteTask={() => {}} onArchiveTask={() => {}} onOpenMoveModal={() => {}}
      onDeleteSelectedTasks={() => { void run(async () => { await Promise.all(selected.map(id => deleteProjectTask(id.slice(8)))); setSelected([]); setSelectionMode(false); }); }}
      onOpenMoveSelectedModal={ids => { setMoveDate(selectedDate); setMoveError(null); setMoveIds(ids); }}
      onMoveTaskToSlot={(_from, id, slot) => { void run(() => updateProjectTask(id.slice(8), { privateSlotKey: slot })); }}
      taskListBaseProps={base} projectTasksBySlot={grouped} onProjectTaskChanged={() => {}} timeBoxSchedule={timeBoxSchedule}
      moveModalProps={{ styles, visible: moveIds.length > 0, title: "選択したタスクを移動", cancelLabel: tr("common.cancel"), confirmLabel: "保存", prevLabel: tr("date.prev"), nextLabel: tr("date.next"),
        dateDraft: moveDate, onChangeDateDraft: setMoveDate, dateError: moveError, slotOptions: SLOT_KEYS.map(slot => ({ key: slot, label: getSlotLabel(appLanguage, slot), active: moveSlot === slot, onPress: () => setMoveSlot(slot) })),
        onPrevDate: () => shift(-1), onNextDate: () => shift(1), onClose: () => !busy && setMoveIds([]), onConfirm: () => {
          const d = new Date(`${moveDate}T00:00:00`);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(moveDate) || Number.isNaN(d.getTime()) || toLocalDateString(d.getTime()) !== moveDate) { setMoveError("日付を確認してください。"); return; }
          void run(async () => { await Promise.all(moveIds.map(id => updateProjectTask(id.slice(8), { privateDate: moveDate, privateSlotKey: moveSlot }))); setMoveIds([]); setSelected([]); setSelectionMode(false); });
        } }} />
    {addSlot ? <ProjectTaskEditor project={project} task={null} initialDate={selectedDate} initialSlot={addSlot} onClose={() => setAddSlot(null)} onChanged={() => {}} /> : null}
    <Modal visible={archiveOpen} animationType="slide" onRequestClose={() => setArchiveOpen(false)}><View style={{ flex: 1, paddingTop: 56 }}>
      <Pressable style={styles.dateActionButton} onPress={() => setArchiveOpen(false)}><Text>戻る</Text></Pressable><Text style={styles.headerTitle}>アーカイブ</Text>
      <ScrollView contentContainerStyle={styles.content}>{tasks.filter(task => task.isArchived).map(task => <PrivateProjectTaskItem key={task.id} item={{ project, task }} styles={styles} tr={tr} noTagLabel={noTagLabel} untitledLabel={untitledLabel} statusLabel={statusLabel} statusPalette={projectTaskPalette} timeBoxSchedule={timeBoxSchedule} ownerLabel={ownerLabel(task)} onChanged={() => {}} />)}</ScrollView>
    </View></Modal>
  </View>;
}
