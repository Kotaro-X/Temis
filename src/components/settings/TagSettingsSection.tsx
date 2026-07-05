import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Tag } from "../../../types";

type Props = {
  activeTags: Tag[];
  archivedTags: Tag[];
  onAddTag: (name: string) => void;
  onRenameTag: (current: Tag, nextName: string) => boolean;
  onArchiveTag: (tag: Tag) => void;
  onUnarchiveTag: (tag: Tag) => void;
  initialArchivedCollapsed?: boolean;
  labels?: {
    activeTitle: string;
    noActive: string;
    save: string;
    cancel: string;
    edit: string;
    archive: string;
    newTagPlaceholder: string;
    add: string;
    archivedTitle: string;
    noArchived: string;
    restore: string;
  };
};

const TagSettingsSection = ({
  activeTags,
  archivedTags,
  onAddTag,
  onRenameTag,
  onArchiveTag,
  onUnarchiveTag,
  initialArchivedCollapsed = true,
  labels,
}: Props) => {
  const text = {
    activeTitle: labels?.activeTitle ?? "タグ一覧",
    noActive: labels?.noActive ?? "タグがありません",
    save: labels?.save ?? "保存",
    cancel: labels?.cancel ?? "キャンセル",
    edit: labels?.edit ?? "編集",
    archive: labels?.archive ?? "アーカイブ",
    newTagPlaceholder: labels?.newTagPlaceholder ?? "新しいタグ",
    add: labels?.add ?? "追加",
    archivedTitle: labels?.archivedTitle ?? "アーカイブ済み　タブ一覧",
    noArchived: labels?.noArchived ?? "アーカイブ済みタグはありません",
    restore: labels?.restore ?? "復帰",
  };
  const [tagDraft, setTagDraft] = useState("");
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [archivedCollapsed, setArchivedCollapsed] = useState(
    initialArchivedCollapsed,
  );

  useEffect(() => {
    setArchivedCollapsed(initialArchivedCollapsed);
  }, [initialArchivedCollapsed]);

  const activeTagSet = useMemo(() => new Set(activeTags), [activeTags]);
  const archivedTagSet = useMemo(() => new Set(archivedTags), [archivedTags]);

  const handleAdd = () => {
    const name = tagDraft.trim();
    if (!name) {
      setTagDraft("");
      return;
    }
    if (activeTagSet.has(name)) {
      setTagDraft("");
      return;
    }
    if (archivedTagSet.has(name)) {
      onUnarchiveTag(name);
      setTagDraft("");
      return;
    }
    onAddTag(name);
    setTagDraft("");
  };

  const handleStartEdit = (tag: Tag) => {
    setEditingTag(tag);
    setEditingDraft(tag);
  };

  const handleCancelEdit = () => {
    setEditingTag(null);
    setEditingDraft("");
  };

  const handleSaveEdit = () => {
    if (!editingTag) {
      return;
    }
    const ok = onRenameTag(editingTag, editingDraft);
    if (ok) {
      handleCancelEdit();
    }
  };

  const handleArchive = (tag: Tag) => {
    if (editingTag === tag) {
      handleCancelEdit();
    }
    onArchiveTag(tag);
  };

  return (
    <View>
      <Text style={styles.subTitle}>{text.activeTitle}</Text>
      <View style={styles.tagBox}>
        {activeTags.length === 0 ? (
          <Text style={styles.mutedText}>{text.noActive}</Text>
        ) : (
          activeTags.map((tag) => (
            <View key={tag} style={styles.tagRow}>
              {editingTag === tag ? (
                <>
                  <TextInput
                    style={styles.tagEditInput}
                    value={editingDraft}
                    onChangeText={setEditingDraft}
                  />
                  <Pressable
                    style={styles.tagActionButton}
                    onPress={handleSaveEdit}
                  >
                    <Text style={styles.tagActionText}>{text.save}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.tagActionButton}
                    onPress={handleCancelEdit}
                  >
                    <Text style={styles.tagActionText}>{text.cancel}</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.tagName}>{tag}</Text>
                  <Pressable
                    style={styles.tagActionButton}
                    onPress={() => handleStartEdit(tag)}
                  >
                    <Text style={styles.tagActionText}>{text.edit}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.tagActionButton}
                    onPress={() => handleArchive(tag)}
                  >
                    <Text style={styles.tagActionText}>{text.archive}</Text>
                  </Pressable>
                </>
              )}
            </View>
          ))
        )}
        <View style={styles.tagAddRow}>
          <TextInput
            style={styles.tagAddInput}
            placeholder={text.newTagPlaceholder}
            value={tagDraft}
            onChangeText={setTagDraft}
          />
          <Pressable style={styles.tagActionButton} onPress={handleAdd}>
            <Text style={styles.tagActionText}>{text.add}</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={styles.archiveHeader}
        onPress={() => setArchivedCollapsed((prev) => !prev)}
      >
        <Text style={styles.subTitle}>{text.archivedTitle}</Text>
        <Text style={styles.archiveChevron}>{archivedCollapsed ? "▶︎" : "▼"}</Text>
      </Pressable>
      {!archivedCollapsed && (
        <View style={styles.tagBox}>
          {archivedTags.length === 0 ? (
            <Text style={styles.mutedText}>{text.noArchived}</Text>
          ) : (
            archivedTags.map((tag) => (
              <View key={tag} style={styles.tagRow}>
                <Text style={styles.tagName}>{tag}</Text>
                <Pressable
                  style={styles.tagActionButton}
                  onPress={() => onUnarchiveTag(tag)}
                >
                  <Text style={styles.tagActionText}>{text.restore}</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  subTitle: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    color: "#111827",
  },
  tagBox: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  tagName: {
    flex: 1,
    fontSize: 12,
    color: "#111827",
  },
  tagActionButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 6,
  },
  tagActionText: {
    fontSize: 12,
    color: "#111827",
  },
  tagAddRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  tagAddInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    padding: 6,
  },
  tagEditInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    padding: 6,
  },
  mutedText: {
    fontSize: 12,
    color: "#6b7280",
  },
  archiveHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  archiveChevron: {
    fontSize: 12,
    color: "#6b7280",
  },
});

export type { Props as TagSettingsSectionProps };
export default TagSettingsSection;
