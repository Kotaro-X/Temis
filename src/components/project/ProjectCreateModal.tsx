import React, { useEffect, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useCollaboration } from "../../context/CollaborationContext";
import type { Project } from "../../types/collaboration";

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
};

const ProjectCreateModal = ({ visible, onClose, onCreated }: Props) => {
  const { addProject } = useCollaboration();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName("");
    setDescription("");
  }, [visible]);

  const create = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const project = await addProject({
        name,
        description,
        icon: null,
        tags: [],
      });
      onCreated(project);
    } catch (cause) {
      Alert.alert(
        "作成できません",
        cause instanceof Error ? cause.message : "プロジェクトの作成に失敗しました。",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Text style={styles.title}>新規プロジェクトを作成</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="プロジェクト名" />
          <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} placeholder="説明（任意）" multiline />
          <View style={styles.actions}>
            <Pressable onPress={onClose} disabled={saving}><Text style={styles.cancel}>キャンセル</Text></Pressable>
            <Pressable style={[styles.create, (!name.trim() || saving) && styles.disabled]} onPress={() => void create()} disabled={!name.trim() || saving}>
              <Text style={styles.createText}>{saving ? "作成中…" : "作成"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(15,23,42,0.35)" },
  modal: { borderRadius: 16, padding: 20, gap: 14, backgroundColor: "#fff" },
  title: { color: "#111827", fontSize: 18, fontWeight: "800" },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: "#111827" },
  multiline: { minHeight: 100, textAlignVertical: "top" },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 18 },
  cancel: { color: "#4b5563", fontWeight: "600" },
  create: { borderRadius: 9, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#2563eb" },
  createText: { color: "#fff", fontWeight: "800" },
  disabled: { opacity: 0.5 },
});

export default ProjectCreateModal;
