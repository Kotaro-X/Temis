import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  listMyProjectTasks,
  updateProjectTask,
  type MyProjectTask,
} from "../../services/collaboration/collaborationService";
import type { ProjectTaskStatus } from "../../types/collaboration";

type Props = {
  kind: "task" | "todo";
};

const STATUS_LABEL: Record<ProjectTaskStatus, string> = {
  todo: "未着手",
  in_progress: "進行中",
  paused: "一時停止",
  completed: "完了",
};

const ProjectOwnedTaskList = ({ kind }: Props) => {
  const [items, setItems] = useState<MyProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MyProjectTask | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectTaskStatus>("todo");
  const [saving, setSaving] = useState(false);

  const label = kind === "todo" ? "ToDo" : "タスク";
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setItems(await listMyProjectTasks(kind));
    } catch (cause) {
      // Signing out only hides project-owned content; personal content remains available.
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openEditor = (item: MyProjectTask) => {
    setEditing(item);
    setTitle(item.task.title);
    setDescription(item.task.description ?? "");
    setStatus(item.task.status);
  };

  const save = async () => {
    if (!editing || !title.trim()) return;
    try {
      setSaving(true);
      const task = editing.task;
      await updateProjectTask(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        status,
        tags: task.tags ?? [],
        estimateMinutes: task.estimateMinutes ?? 25,
        isArchived: task.isArchived ?? false,
        priority: task.priority ?? null,
        dueAt: task.dueAt ?? null,
        assigneeUserId: task.assigneeUserId ?? null,
        relatedMemoId: task.relatedMemoId ?? null,
      });
      setEditing(null);
      await refresh();
    } catch (cause) {
      Alert.alert("保存できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ActivityIndicator style={styles.loading} />;
  if (items.length === 0) return null;

  return (
    <>
      <View style={styles.section}>
        <Text style={styles.title}>プロジェクトで作成した{label}</Text>
        <Text style={styles.caption}>自分が作成した項目はPrivateからも編集できます。</Text>
        {items.map((item) => (
          <Pressable key={item.task.id} style={styles.row} onPress={() => openEditor(item)}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.task.title || "無題"}</Text>
              <Text style={styles.meta}>{item.project.name} · {STATUS_LABEL[item.task.status]}</Text>
            </View>
            <Text style={styles.edit}>編集</Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={editing !== null} animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.editor}>
          <View style={styles.editorHeader}>
            <Pressable onPress={() => setEditing(null)}><Text style={styles.cancel}>キャンセル</Text></Pressable>
            <Text style={styles.editorTitle}>{label}を編集</Text>
            <Pressable disabled={saving || !title.trim()} onPress={() => void save()}><Text style={[styles.save, (saving || !title.trim()) && styles.disabled]}>{saving ? "保存中" : "完了"}</Text></Pressable>
          </View>
          {editing ? <Text style={styles.projectName}>{editing.project.name}</Text> : null}
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder={`${label}名`} autoFocus />
          <TextInput style={styles.memo} value={description} onChangeText={setDescription} placeholder="メモ" multiline textAlignVertical="top" />
          <View style={styles.statusRow}>
            {(Object.keys(STATUS_LABEL) as ProjectTaskStatus[]).map((candidate) => <Pressable key={candidate} style={[styles.statusButton, status === candidate && styles.statusButtonActive]} onPress={() => setStatus(candidate)}><Text style={[styles.statusText, status === candidate && styles.statusTextActive]}>{STATUS_LABEL[candidate]}</Text></Pressable>)}
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  loading: { marginVertical: 18 },
  section: { marginTop: 24, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#d1d5db", paddingTop: 14 },
  title: { color: "#374151", fontSize: 14, fontWeight: "700" },
  caption: { marginTop: 4, color: "#6b7280", fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb", paddingVertical: 13 },
  rowText: { flex: 1 }, rowTitle: { color: "#111827", fontSize: 15, fontWeight: "600" }, meta: { marginTop: 3, color: "#6b7280", fontSize: 12 }, edit: { color: "#2563eb", fontSize: 13, fontWeight: "600" },
  editor: { flex: 1, backgroundColor: "#ffffff", padding: 20, paddingTop: 72 },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }, editorTitle: { color: "#111827", fontSize: 18, fontWeight: "700" }, cancel: { color: "#4b5563", fontSize: 15 }, save: { color: "#2563eb", fontSize: 15, fontWeight: "700" }, disabled: { opacity: 0.4 },
  projectName: { marginBottom: 12, color: "#6b7280", fontSize: 13 }, input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, color: "#111827", fontSize: 16, paddingHorizontal: 12, paddingVertical: 11 }, memo: { minHeight: 180, marginTop: 14, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, color: "#111827", fontSize: 15, padding: 12 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 }, statusButton: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 }, statusButtonActive: { borderColor: "#111827", backgroundColor: "#111827" }, statusText: { color: "#4b5563", fontSize: 12, fontWeight: "600" }, statusTextActive: { color: "#ffffff" },
});

export default ProjectOwnedTaskList;
