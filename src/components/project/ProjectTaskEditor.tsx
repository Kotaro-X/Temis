import { registerEnvironmentSaveHandler } from "../../services/environment/switchLifecycle";
import { saveRecoveryDraft, loadRecoveryDraft, clearRecoveryDraft } from "../../services/environment/recoveryDrafts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Pressable, ScrollView, Text, TextInput, View, StyleSheet, Platform } from "react-native";
import Modal from "../common/KeyboardAwareModal";
import TaskDetailView from "../tasks/TaskDetailView";
import TaskTagPickerModal from "../tasks/TaskTagPickerModal";
import TaskMemoFields from "../tasks/TaskMemoFields";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useAppUI } from "../../context/AppUIContext";
import { useCollaboration } from "../../context/CollaborationContext";
import styles from "../../styles/workspaceSharedStyles";
import { createProjectTask, listProjectMembers, listProjectCreatorProfiles, updateProjectTask, subscribeProjectTasks } from "../../services/collaboration/collaborationService";
import { changedProjectTaskFields, projectTaskOwner, projectTaskState } from "../../services/collaboration/projectTaskCore";
import { getProjectTaskPrivateDate, getProjectTaskPrivateSlot, toLocalDateString } from "../../utils/projectTaskPlacement";
import type { Project, ProjectTask, ProjectTaskStatus } from "../../types/collaboration";
import { SLOT_KEYS, SLOT_LABELS } from "../../types";

export const projectTaskPalette = {
  TODO: { bar: "#9ca3af", badgeBg: "#f3f4f6", badgeText: "#374151" },
  IN_PROGRESS: { bar: "#2563eb", badgeBg: "#dbeafe", badgeText: "#1e40af" },
  PAUSED: { bar: "#f59e0b", badgeBg: "#fef3c7", badgeText: "#92400e" },
  DONE: { bar: "#16a34a", badgeBg: "#dcfce7", badgeText: "#166534" },
};
type Props = { initialDate?: string; initialSlot?: (typeof SLOT_KEYS)[number]; project: Project; task: ProjectTask | null; onClose: () => void; onChanged: () => void };
export default function ProjectTaskEditor(props: Props) {
  const { profile } = useCollaboration();
  return <ProjectTaskEditorSession key={`${profile?.userId}:${props.project.id}:${props.task?.id ?? "new"}`} {...props} />;
}
function ProjectTaskEditorSession({ project, task, onClose, onChanged, initialDate, initialSlot }: Props) {
  const insets = useSafeAreaInsets();
  const { openMemoSearch } = useAppUI();
  const { profile } = useCollaboration();
  const { tr, statusLabel, untitledLabel, tagOptions, timeBoxSchedule, appLanguage } = useAppSettings();
  const initial = useRef({ title: task?.title ?? "", description: task?.description ?? "", tags: task?.tags ?? [],
    estimateMinutes: task?.estimateMinutes ?? 25, assigneeUserId: task ? projectTaskOwner(task) : profile?.userId ?? null,
    privateDate: task ? getProjectTaskPrivateDate(task) : initialDate ?? toLocalDateString(Date.now()),
    privateSlotKey: task ? getProjectTaskPrivateSlot(task, timeBoxSchedule) : initialSlot ?? SLOT_KEYS[0] });
  const [draft, setDraft] = useState(initial.current);
  // Input handlers update this synchronously, so a save press reads the latest text
  // even when React has not yet committed the corresponding render.
  const draftRef = useRef(initial.current);
  const changeDraft = (patch: Partial<typeof draft>) => {
    draftRef.current = { ...draftRef.current, ...patch };
    setDraft(draftRef.current);
  };
  const recoveryId = `project-task:${project.id}:${task?.id ?? 'new'}`;
  useEffect(() => registerEnvironmentSaveHandler(async () => {}, () => saveRecoveryDraft(recoveryId, { title: draftRef.current.title, body: JSON.stringify(draftRef.current) })), [recoveryId]);
  useEffect(() => {
    let active = true;
    void loadRecoveryDraft(recoveryId).then(saved => {
      if (!active || !saved || draftRef.current !== initial.current) return;
      const restored = JSON.parse(saved.body) as typeof draft;
      if (typeof restored.title !== 'string' || typeof restored.description !== 'string' || !Array.isArray(restored.tags)) return;
      draftRef.current = restored; setDraft(restored);
    }).catch(() => Alert.alert('下書きを読み込めませんでした'));
    return () => { active = false; };
  }, [recoveryId]);
  const [latest, setLatest] = useState(task);
  const [newStatus, setNewStatus] = useState<ProjectTaskStatus>("todo");
  const newStatusRef = useRef<ProjectTaskStatus>("todo");
  const [saving, setSaving] = useState(false);
  const operationLock = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [memberError, setMemberError] = useState(false);
  const createdAt = useRef(Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void listProjectMembers(project.id).then(async next => {
      const profiles = await listProjectCreatorProfiles(next.map(member => member.userId));
      if (alive.current) setMembers(next.map(member => ({ id: member.userId,
        name: profiles.find(p => p.userId === member.userId)?.displayName || (member.userId === profile?.userId ? profile.displayName : `メンバー ${member.userId.slice(0, 8)}`) })));
    }).catch(() => { if (alive.current) setMemberError(true); });
    const unsubscribe = task ? subscribeProjectTasks(project.id, tasks => {
      if (!alive.current) return;
      const current = tasks.find(item => item.id === task.id);
      if (!current) { onClose(); return; }
      setLatest(current);
      const incoming = { title: current.title, description: current.description ?? "", tags: current.tags ?? [],
        estimateMinutes: current.estimateMinutes ?? 25, assigneeUserId: projectTaskOwner(current),
        privateDate: getProjectTaskPrivateDate(current), privateSlotKey: getProjectTaskPrivateSlot(current, timeBoxSchedule) };
      const baseline = initial.current;
      initial.current = incoming;
      const merged = { ...draftRef.current };
      for (const key of Object.keys(incoming) as (keyof typeof incoming)[]) {
        if (JSON.stringify(merged[key]) === JSON.stringify(baseline[key])) {
          Object.assign(merged, { [key]: incoming[key] });
        }
      }
      draftRef.current = merged;
      setDraft(merged);
    }, () => { if (alive.current) { Alert.alert("読み込めません", "Projectへのアクセスを確認してください。"); onClose(); } }) : () => {};
    return () => { alive.current = false; unsubscribe(); };
  // A session owns its initial callbacks and is remounted on scope changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, task?.id, profile?.userId]);
  const run = async (action: () => Promise<unknown>, close = false) => {
    // React state alone cannot guard two taps within the same render.
    if (operationLock.current || !alive.current) return;
    operationLock.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await action();
      if (alive.current) {
        if (close) { await clearRecoveryDraft(recoveryId); onClose(); }
        onChanged();
      }
    } catch (error) {
      if (alive.current) {
        const message = error instanceof Error ? error.message : "再試行してください。";
        setSaveError(message);
        Alert.alert("保存できません", message);
      }
    } finally {
      operationLock.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const closeEditor = () => { if (!operationLock.current) onClose(); };
  const save = () => {
    if (operationLock.current) return;
    const currentDraft = draftRef.current;
    if (!currentDraft.title.trim()) { setSaveError("タスク名を入力してください。"); return; }
    const date = new Date(`${currentDraft.privateDate}T00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDraft.privateDate) || Number.isNaN(date.getTime()) || toLocalDateString(date.getTime()) !== currentDraft.privateDate) {
      setSaveError("日付は YYYY-MM-DD形式で実在する日付を入力してください。"); return;
    }
    const next = { ...currentDraft, title: currentDraft.title.trim(), estimateMinutes: Math.max(0, currentDraft.estimateMinutes) };
    void run(() => task ? updateProjectTask(task.id, changedProjectTaskFields(initial.current, next)) :
      createProjectTask({ projectId: project.id, kind: "task", status: newStatusRef.current, ...next }), true);
  };
  const status = (next: ProjectTaskStatus) => { if (task) void run(() => updateProjectTask(task.id, { status: next })); else { newStatusRef.current = next; setNewStatus(next); } };
  const record: ProjectTask = { ...(latest ?? { id: "new", ownerUserId: profile?.userId ?? null, creatorUserId: profile?.userId ?? null,
    projectId: project.id, status: newStatus, createdAt: createdAt.current, updatedAt: createdAt.current, completedAt: null }), ...draft };
  const state = projectTaskState(record);
  return <Modal visible animationType="slide" onRequestClose={closeEditor}>
    <View style={{ flex: 1, backgroundColor: "white", paddingTop: insets.top + 8 }}>
      <View style={editorStyles.header}>
        <View style={editorStyles.headerSide}>
          <Pressable accessibilityRole="button" accessibilityLabel={tr("common.cancel")} accessibilityState={{ disabled: saving }} disabled={saving} hitSlop={8} style={editorStyles.actionButton} onPress={closeEditor}>
            <Text style={[editorStyles.actionText, saving && editorStyles.disabledText]}>{tr("common.cancel")}</Text>
          </Pressable>
        </View>
        <Text numberOfLines={1} ellipsizeMode="tail" style={editorStyles.title}>{project.name}</Text>
        <View style={[editorStyles.headerSide, editorStyles.headerSideRight]}>
          <Pressable accessibilityRole="button" accessibilityLabel="タスクを保存" accessibilityHint={!draft.title.trim() ? "タスク名を入力してください" : undefined} accessibilityState={{ disabled: saving || !draft.title.trim(), busy: saving }}
            disabled={saving || !draft.title.trim()} hitSlop={8} style={editorStyles.actionButton} onPress={save}>
            <Text style={[editorStyles.saveText, (saving || !draft.title.trim()) && editorStyles.disabledText]}>{saving ? "保存中…" : "完了"}</Text>
          </Pressable>
        </View>
      </View>
      {!draft.title.trim() ? <Text style={editorStyles.helper}>タスク名を入力すると保存できます。</Text> : null}
      {saveError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={editorStyles.error}>{saveError}</Text> : null}
      <ScrollView
        style={editorStyles.scroll}
        pointerEvents={saving ? "none" : "auto"}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}
      >
        <TaskDetailView styles={styles} tr={tr} task={state} slotKey={draft.privateSlotKey} untitledLabel={untitledLabel}
          statusLabel={statusLabel} statusPalette={projectTaskPalette} onOpenTagPicker={() => { Keyboard.dismiss(); setTagOpen(true); }}
          onUpdateTaskName={title => changeDraft({ title })}
          onUpdateTaskEstimate={value => changeDraft({ estimateMinutes: Number.parseInt(value, 10) || 0 })}
          onStart={() => status("in_progress")} onPause={() => status("paused")} onDone={() => status("completed")}>
          <View style={styles.row}>
            <Text style={styles.label}>担当者</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="担当者を選択"
              accessibilityState={{ expanded: ownerOpen }}
              style={[styles.inputInline, editorStyles.assigneeButton, ownerOpen && editorStyles.assigneeButtonExpanded]}
              onPress={() => { Keyboard.dismiss(); setOwnerOpen(previous => !previous); }}
            >
              <Text numberOfLines={1} style={editorStyles.assigneeText}>{members.find(m => m.id === draft.assigneeUserId)?.name ?? (draft.assigneeUserId ? "メンバー" : "未割り当て")}</Text>
              <Text accessible={false} style={editorStyles.assigneeChevron}>{ownerOpen ? "▴" : "▾"}</Text>
            </Pressable>
          </View>
          <View style={styles.row}><Text style={styles.label}>日付</Text><TextInput style={styles.inputInline} value={draft.privateDate} onChangeText={privateDate => changeDraft({ privateDate })} placeholder="YYYY-MM-DD" /></View>
          <View style={[styles.row, { flexWrap: "wrap" }]}>{SLOT_KEYS.map(slot => <Pressable key={slot} style={styles.dateActionButton} onPress={() => changeDraft({ privateSlotKey: slot })}><Text style={{ color: slot === draft.privateSlotKey ? "#2563eb" : "#4b5563" }}>{SLOT_LABELS[slot]}</Text></Pressable>)}</View>
          <TaskMemoFields body={draft.description} setBody={description => changeDraft({ description })} language={appLanguage} onSearchToken={openMemoSearch} />
        </TaskDetailView>
      </ScrollView>
      <TaskTagPickerModal styles={styles} visible={tagOpen} title={tr("task.tags")} closeLabel={tr("common.cancel")} tagOptions={tagOptions} selectedTags={draft.tags}
        onToggleTag={tag => changeDraft({ tags: draftRef.current.tags.includes(tag) ? draftRef.current.tags.filter(t => t !== tag) : [...draftRef.current.tags, tag] })} onClose={() => setTagOpen(false)} />
      <Modal transparent visible={ownerOpen} onRequestClose={() => setOwnerOpen(false)}>
        <View style={styles.dateOverlay}><Pressable style={styles.dateBackdrop} onPress={() => setOwnerOpen(false)} /><View style={styles.datePanel}>
          <Text style={styles.dateTitle}>担当者</Text>{memberError ? <Text>メンバーを読み込めません。画面を開き直してください。</Text> : null}
          <ScrollView>{[{ id: null, name: "未割り当て" }, ...members].map(member => <Pressable key={member.id ?? "none"} style={styles.dateActionButton} onPress={() => { changeDraft({ assigneeUserId: member.id }); setOwnerOpen(false); }}><Text>{member.name}{draft.assigneeUserId === member.id ? " ✓" : ""}</Text></Pressable>)}</ScrollView>
        </View></View>
      </Modal>
    </View>
  </Modal>;
}

const editorStyles = StyleSheet.create({
  scroll: { flex: 1 },
  assigneeButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#ffffff" },
  assigneeButtonExpanded: { borderColor: "#2563eb" },
  assigneeText: { flex: 1, minWidth: 0, color: "#111827", fontSize: 16 },
  assigneeChevron: { color: "#6b7280", fontSize: 16, marginLeft: 8 },
  header: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  headerSide: { width: 88, flexShrink: 0, alignItems: "flex-start" },
  headerSideRight: { alignItems: "flex-end" },
  title: { flex: 1, minWidth: 0, fontSize: 18, fontWeight: "600", textAlign: "center", color: "#111827" },
  actionButton: { minWidth: 64, minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 4 },
  actionText: { color: "#374151", fontSize: 16 },
  saveText: { color: "#2563eb", fontSize: 16, fontWeight: "600" },
  disabledText: { color: "#9ca3af" },
  helper: { color: "#6b7280", fontSize: 13, paddingHorizontal: 16, paddingTop: 8 },
  error: { color: "#b91c1c", fontSize: 13, paddingHorizontal: 16, paddingTop: 8 },
});
