import React, { useMemo, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import TaskItem from "../tasks/TaskItem";
import { useCollaboration } from "../../context/CollaborationContext";
import { updateProjectTask, type MyProjectTask } from "../../services/collaboration/collaborationService";
import { syncProjectTaskMemo } from "../../services/collaboration/projectTaskMemoService";
import type { ProjectTaskStatus } from "../../types/collaboration";
import { SLOT_KEYS, SLOT_LABELS, type SlotKey, type TaskState, type TaskStatus } from "../../types";
import { getProjectTaskPrivateDate, getProjectTaskPrivateSlot } from "../../utils/projectTaskPlacement";

type Props = {
  item: MyProjectTask;
  styles: Record<string, any>;
  tr: (key: string) => string;
  noTagLabel: string;
  untitledLabel: string;
  statusLabel: Record<TaskStatus, string>;
  statusPalette: Record<TaskStatus, { bar: string; badgeBg: string; badgeText: string }>;
  timeBoxSchedule: Record<SlotKey, { start: string; end: string }>;
  onChanged: () => void;
};

const statusForProjectTask: Record<ProjectTaskStatus, TaskStatus> = {
  todo: "TODO",
  in_progress: "IN_PROGRESS",
  paused: "PAUSED",
  completed: "DONE",
};

const statusLabels: Record<ProjectTaskStatus, string> = {
  todo: "未着手",
  in_progress: "進行中",
  paused: "一時停止",
  completed: "完了",
};

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
};

const PrivateProjectTaskItem = ({
  item,
  styles,
  tr,
  noTagLabel,
  untitledLabel,
  statusLabel,
  statusPalette,
  timeBoxSchedule,
  onChanged,
}: Props) => {
  const { profile } = useCollaboration();
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [estimate, setEstimate] = useState("25");
  const [projectStatus, setProjectStatus] = useState<ProjectTaskStatus>("todo");
  const [privateDate, setPrivateDate] = useState("");
  const [privateSlotKey, setPrivateSlotKey] = useState<SlotKey>("morning");
  const status = statusForProjectTask[item.task.status];
  const task = useMemo<TaskState>(() => ({
    id: `project:${item.task.id}`,
    taskName: `${item.project.name}｜${item.task.title}`,
    tags: item.task.tags ?? [],
    estimateMinutes: item.task.estimateMinutes ?? 25,
    elapsedMinutes: 0,
    status,
    isArchived: item.task.isArchived ?? false,
    startAt: null,
  }), [item, status]);

  const openEditor = () => {
    setTitle(item.task.title);
    setDescription(item.task.description ?? "");
    setTags((item.task.tags ?? []).join("、"));
    setEstimate(String(item.task.estimateMinutes ?? 25));
    setProjectStatus(item.task.status);
    setPrivateDate(getProjectTaskPrivateDate(item.task));
    setPrivateSlotKey(getProjectTaskPrivateSlot(item.task, timeBoxSchedule));
    setEditorOpen(true);
  };

  const save = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    if (!isValidDate(privateDate)) {
      Alert.alert("日付を確認してください", "Private表示日は YYYY-MM-DD 形式で入力してください。");
      return;
    }
    try {
      setSaving(true);
      if (!profile) throw new Error("Googleでログインしてからタスクを保存してください。");
      const savedTask = await updateProjectTask(item.task.id, {
        title: trimmedTitle,
        description: description.trim() || null,
        tags: tags.split(/[、,]/).map((tag) => tag.trim()).filter(Boolean),
        estimateMinutes: Math.max(0, Number.parseInt(estimate, 10) || 0),
        status: projectStatus,
        privateDate,
        privateSlotKey,
      });
      const relatedMemoId = await syncProjectTaskMemo({ task: savedTask, profile });
      if (relatedMemoId !== savedTask.relatedMemoId) {
        await updateProjectTask(savedTask.id, { relatedMemoId });
      }
      setEditorOpen(false);
      onChanged();
    } catch (cause) {
      Alert.alert("更新できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (nextStatus: ProjectTaskStatus) => {
    if (saving || nextStatus === item.task.status) return;
    try {
      setSaving(true);
      await updateProjectTask(item.task.id, { status: nextStatus });
      onChanged();
    } catch (cause) {
      Alert.alert("更新できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TaskItem
        styles={styles}
        tr={tr}
        task={task}
        noTagLabel={noTagLabel}
        untitledLabel={untitledLabel}
        statusLabel={statusLabel[status]}
        palette={statusPalette[status]}
        isOpen={false}
        onOpen={() => undefined}
        onClose={() => undefined}
        onPress={openEditor}
        onStart={() => void updateStatus("in_progress")}
        onPause={() => void updateStatus("paused")}
        onDone={() => void updateStatus("completed")}
        actions={[]}
        completed={status === "DONE"}
        swipeEnabled={false}
        draggable={false}
      />
      <Modal visible={editorOpen} animationType="slide" onRequestClose={() => !saving && setEditorOpen(false)}>
        <View style={editorStyles.container}>
          <View style={editorStyles.header}>
            <Pressable disabled={saving} onPress={() => setEditorOpen(false)}><Text style={editorStyles.cancel}>キャンセル</Text></Pressable>
            <Text style={editorStyles.title}>プロジェクトタスクを編集</Text>
            <Pressable disabled={saving || !title.trim()} onPress={() => void save()}><Text style={[editorStyles.done, (saving || !title.trim()) && editorStyles.disabled]}>{saving ? "保存中" : "完了"}</Text></Pressable>
          </View>
          <Text style={editorStyles.projectName}>{item.project.name}</Text>
          <TextInput style={editorStyles.input} value={title} onChangeText={setTitle} placeholder="タスク名" autoFocus />
          <TextInput style={editorStyles.input} value={tags} onChangeText={setTags} placeholder="タグ（、または , 区切り）" />
          <TextInput style={editorStyles.input} value={estimate} onChangeText={setEstimate} keyboardType="number-pad" placeholder="予測（分）" />
          <TextInput style={editorStyles.memo} value={description} onChangeText={setDescription} placeholder="メモ" multiline textAlignVertical="top" />
          <Text style={editorStyles.label}>状態</Text>
          <View style={editorStyles.row}>{(Object.keys(statusLabels) as ProjectTaskStatus[]).map((candidate) => <Pressable key={candidate} style={[editorStyles.option, projectStatus === candidate && editorStyles.optionActive]} onPress={() => setProjectStatus(candidate)}><Text style={[editorStyles.optionText, projectStatus === candidate && editorStyles.optionTextActive]}>{statusLabels[candidate]}</Text></Pressable>)}</View>
          <Text style={editorStyles.label}>Private表示日</Text>
          <TextInput style={editorStyles.input} value={privateDate} onChangeText={setPrivateDate} placeholder="YYYY-MM-DD" />
          <Text style={editorStyles.label}>Private時間帯</Text>
          <View style={editorStyles.row}>{SLOT_KEYS.map((slotKey) => <Pressable key={slotKey} style={[editorStyles.option, privateSlotKey === slotKey && editorStyles.optionActive]} onPress={() => setPrivateSlotKey(slotKey)}><Text style={[editorStyles.optionText, privateSlotKey === slotKey && editorStyles.optionTextActive]}>{SLOT_LABELS[slotKey]}</Text></Pressable>)}</View>
        </View>
      </Modal>
    </>
  );
};

const editorStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff", padding: 20, paddingTop: 72 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  title: { color: "#111827", fontSize: 18, fontWeight: "700" },
  cancel: { color: "#4b5563", fontSize: 15, fontWeight: "600" },
  done: { color: "#2563eb", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  projectName: { marginBottom: 12, color: "#6b7280", fontSize: 13 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, color: "#111827", fontSize: 16, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 12 },
  memo: { minHeight: 130, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, color: "#111827", fontSize: 15, padding: 12 },
  label: { marginTop: 16, marginBottom: 8, color: "#374151", fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  optionActive: { backgroundColor: "#111827", borderColor: "#111827" },
  optionText: { color: "#4b5563", fontSize: 12, fontWeight: "600" },
  optionTextActive: { color: "#ffffff" },
});

export default PrivateProjectTaskItem;
