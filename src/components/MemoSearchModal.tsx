import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { searchAllMemos, SearchMemo } from "../services/searchIndex";
import { upsertMemoForTask } from "../db/memoRepo";
import { upsertDailyNote, upsertFreeNote } from "../db/noteRepo";
import LinkText from "./LinkText";

type Props = {
  visible: boolean;
  onClose: () => void;
  initialQuery?: string;
};

const MemoSearchModal = ({ visible, onClose, initialQuery }: Props) => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchMemo[]>([]);
  const [mode, setMode] = useState<"list" | "detail">("list");
  const [selectedMemo, setSelectedMemo] = useState<SearchMemo | null>(null);
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [searchTrigger, setSearchTrigger] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editableText, setEditableText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults([]);
      setLoading(false);
      setMode("list");
      setSelectedMemo(null);
      setActiveWord(null);
      setSearchTrigger(0);
      setIsEditing(false);
      setEditableText("");
      setSaving(false);
      return;
    }
    setQuery(initialQuery ?? "");
    setMode("list");
    setSelectedMemo(null);
    setActiveWord(initialQuery?.trim() || null);
  }, [visible, initialQuery]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setMode("list");
      setSelectedMemo(null);
      return;
    }
    let active = true;
    setLoading(true);
    setMode("list");
    setSelectedMemo(null);
    const handler = setTimeout(() => {
      searchAllMemos(trimmed)
        .then((items) => {
          if (active) {
            setResults(items);
          }
        })
        .catch(() => {
          if (active) {
            setResults([]);
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(handler);
    };
  }, [query, visible, searchTrigger]);

  useEffect(() => {
    if (mode === "detail" && selectedMemo) {
      setEditableText(selectedMemo.memoText);
      setIsEditing(false);
      setSaving(false);
    }
  }, [mode, selectedMemo]);

  const handlePressLink = (word: string) => {
    const trimmed = word.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed !== activeWord) {
      setActiveWord(trimmed);
    }
    setMode("list");
    setSelectedMemo(null);
    setResults([]);
    setLoading(true);
    if (trimmed === query.trim()) {
      setSearchTrigger((prev) => prev + 1);
    } else {
      setQuery(trimmed);
    }
  };

  const handleEdit = () => {
    if (!selectedMemo) {
      return;
    }
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (!selectedMemo) {
      return;
    }
    setEditableText(selectedMemo.memoText);
    setIsEditing(false);
  };

  const applySavedText = (nextText: string) => {
    if (!selectedMemo) {
      return;
    }
    const updated = { ...selectedMemo, memoText: nextText };
    setSelectedMemo(updated);
    setResults((prev) =>
      prev.map((item) => (item.key === updated.key ? updated : item)),
    );
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedMemo || saving) {
      return;
    }
    setSaving(true);
    try {
      if (selectedMemo.source === "task") {
        if (!selectedMemo.taskId) {
          return;
        }
        await upsertMemoForTask(selectedMemo.taskId, editableText);
        applySavedText(editableText);
        return;
      }
      if (selectedMemo.noteType === "daily") {
        await upsertDailyNote(selectedMemo.date, editableText);
        applySavedText(editableText);
        return;
      }
      if (selectedMemo.noteType === "free") {
        if (!selectedMemo.noteId) {
          return;
        }
        await upsertFreeNote({
          id: selectedMemo.noteId,
          title: selectedMemo.noteTitle ?? null,
          body: editableText,
        });
        applySavedText(editableText);
      }
    } finally {
      setSaving(false);
    }
  };

  const buildSnippet = (text: string, maxLength = 100) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    return `${trimmed.slice(0, maxLength)}...`;
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={onClose}>
            <Ionicons name="chevron-back" size={18} color="#2563eb" />
            <Text style={styles.backText}>戻る</Text>
          </Pressable>
          <Text style={styles.title}>メモ検索</Text>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>閉じる</Text>
          </Pressable>
        </View>
        <View style={styles.container}>
          <TextInput
            style={styles.input}
            placeholder="単語で検索"
            value={query}
            onChangeText={setQuery}
          />
          {mode === "detail" && selectedMemo ? (
            <View style={styles.detailBox}>
              <View style={styles.detailActionRow}>
                <Pressable
                  style={styles.backButtonInline}
                  onPress={() => setMode("list")}
                >
                  <Text style={styles.backTextInline}>一覧へ戻る</Text>
                </Pressable>
                {isEditing ? (
                  <View style={styles.editActions}>
                    <Pressable
                      style={styles.editButton}
                      onPress={handleCancelEdit}
                    >
                      <Text style={styles.editButtonText}>キャンセル</Text>
                    </Pressable>
                    <Pressable
                      style={styles.editButton}
                      onPress={handleSaveEdit}
                      disabled={saving}
                    >
                      <Text style={styles.editButtonText}>
                        {saving ? "保存中" : "保存"}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={styles.editButton}
                    onPress={handleEdit}
                  >
                    <Text style={styles.editButtonText}>編集</Text>
                  </Pressable>
                )}
              </View>
              <Text style={styles.detailTitle}>{selectedMemo.taskTitle}</Text>
              <Text style={styles.detailMeta}>{selectedMemo.date}</Text>
              <ScrollView style={styles.detailBody}>
                {isEditing ? (
                  <TextInput
                    style={styles.detailEditor}
                    value={editableText}
                    onChangeText={setEditableText}
                    multiline
                    textAlignVertical="top"
                  />
                ) : (
                  <LinkText
                    body={editableText}
                    style={styles.detailText}
                    onPressLink={handlePressLink}
                  />
                )}
              </ScrollView>
            </View>
          ) : loading ? (
            <Text style={styles.helperText}>検索中...</Text>
          ) : results.length === 0 ? (
            <Text style={styles.helperText}>該当メモがありません</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.listBody}>
              {results.map((item) => (
                <Pressable
                  key={item.key}
                  style={[
                    styles.item,
                    item.taskId
                      ? styles.itemBorderTask
                      : item.memoText
                        ? styles.itemBorderMemo
                        : null,
                  ]}
                  onPress={() => {
                    setSelectedMemo(item);
                    setMode("detail");
                  }}
                >
                  <Text style={styles.itemSnippet}>
                    {buildSnippet(item.memoText)}
                  </Text>
                  <Text style={styles.itemMetaText}>
                    {item.date}
                    {item.taskTitle ? ` · ${item.taskTitle}` : ""}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    width: 72,
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  backText: {
    color: "#2563eb",
    fontSize: 12,
    marginLeft: 2,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  closeButton: {
    width: 72,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "flex-end",
  },
  closeText: {
    color: "#2563eb",
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  helperText: {
    fontSize: 12,
    color: "#6b7280",
  },
  listBody: {
    paddingBottom: 4,
  },
  item: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#f9fafb",
    marginBottom: 12,
  },
  itemBorderTask: {
    borderColor: "#3B82F6",
  },
  itemBorderMemo: {
    borderColor: "#22C55E",
  },
  itemSnippet: {
    fontSize: 12,
    color: "#111827",
    marginBottom: 6,
  },
  itemMetaText: {
    fontSize: 11,
    color: "#6b7280",
  },
  detailBox: {
    flex: 1,
  },
  detailActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  editActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  editButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginLeft: 6,
  },
  editButtonText: {
    fontSize: 12,
    color: "#2563eb",
  },
  backButtonInline: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  backTextInline: {
    fontSize: 12,
    color: "#2563eb",
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  detailMeta: {
    fontSize: 11,
    color: "#6b7280",
    marginBottom: 10,
  },
  detailBody: {
    flex: 1,
  },
  detailText: {
    fontSize: 12,
    color: "#111827",
    lineHeight: 18,
  },
  detailEditor: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    fontSize: 12,
    color: "#111827",
    lineHeight: 18,
    minHeight: 120,
  },
});

export default MemoSearchModal;
