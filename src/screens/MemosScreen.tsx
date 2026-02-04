import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { loadAllTodayStates } from "../../storage";
import { listAllMemos } from "../db/memoRepo";
import { listAllNotes } from "../db/noteRepo";
import LinkText from "../components/LinkText";
import {
  normalizeKey,
  normalizeParens,
  tokenizeLinks,
} from "../utils/linkTokenize";
import { normalizeSearchToken } from "../utils/wikiLink";
import { upsertMemoForTask } from "../db/memoRepo";
import { upsertDailyNote, upsertFreeNote } from "../db/noteRepo";

type MemoItem = {
  key: string;
  date: string;
  memoTitle: string;
  memoText: string;
  taskTitle: string;
  source: "task" | "note";
  taskId?: string;
  noteId?: string;
  noteType?: "daily" | "free";
  noteTitle?: string | null;
};

type Section = {
  title: string;
  data: MemoItem[];
};

type Props = {
  onBack: () => void;
  onOpenMenu: () => void;
};

const pad2 = (num: number) => String(num).padStart(2, "0");

const toDateString = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;

const dateFromTimestamp = (timestamp: number) =>
  toDateString(new Date(timestamp));

const buildMemoTitle = (text: string, maxLength = 60) => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "メモ";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
};

const buildTaskIndex = async () => {
  const states = await loadAllTodayStates();
  const taskIndex = new Map<string, { title: string; date: string }>();
  for (const state of states) {
    for (const slot of Object.values(state.slots)) {
      for (const task of slot.tasks) {
        if (!task.id) {
          continue;
        }
        const title = task.taskName || "未設定";
        const existing = taskIndex.get(task.id);
        if (!existing || state.date > existing.date) {
          taskIndex.set(task.id, { title, date: state.date });
        }
      }
    }
  }
  return taskIndex;
};

const buildMemoItems = async (): Promise<MemoItem[]> => {
  const [taskIndex, memos, notes] = await Promise.all([
    buildTaskIndex(),
    listAllMemos(),
    listAllNotes(),
  ]);
  const items: MemoItem[] = [];
  for (const memo of memos) {
    const info = taskIndex.get(memo.taskId);
    const date = info?.date ?? dateFromTimestamp(memo.updatedAt);
    items.push({
      key: `task:${memo.id}`,
      date,
      memoTitle: buildMemoTitle(memo.body),
      memoText: memo.body,
      taskTitle: info?.title ?? "未設定",
      source: "task",
      taskId: memo.taskId,
    });
  }
  for (const note of notes) {
    const date = note.date ?? dateFromTimestamp(note.updatedAt);
    const memoTitle =
      note.type === "free"
        ? note.title?.trim() || "無題"
        : "Daily";
    items.push({
      key: `note:${note.id}`,
      date,
      memoTitle,
      memoText: note.body,
      taskTitle: "メモ",
      source: "note",
      noteId: note.id,
      noteType: note.type,
      noteTitle: note.title ?? null,
    });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date));
};

const extractLinkQuery = (input: string) => {
  const normalized = normalizeParens(input);
  const start = normalized.lastIndexOf("((");
  if (start === -1) {
    return { isActive: false, query: "" };
  }
  const after = normalized.slice(start + 2);
  if (after.includes("))")) {
    return { isActive: false, query: "" };
  }
  return { isActive: true, query: after };
};

const MemosScreen = ({ onBack, onOpenMenu }: Props) => {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MemoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMemo, setSelectedMemo] = useState<MemoItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editableText, setEditableText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    buildMemoItems()
      .then((loaded) => {
        if (active) {
          setItems(loaded);
        }
      })
      .catch(() => {
        if (active) {
          setItems([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedMemo) {
      setEditableText(selectedMemo.memoText);
      setIsEditing(false);
      setSaving(false);
    }
  }, [selectedMemo]);

  const linkIndex = useMemo(() => {
    const index = new Map<string, { label: string; count: number }>();
    for (const item of items) {
      const parts = tokenizeLinks(item.memoText);
      for (const part of parts) {
        if (part.type !== "link") {
          continue;
        }
        const token = part.value.trim();
        if (!token) {
          continue;
        }
        const key = normalizeKey(token);
        if (!key) {
          continue;
        }
        const existing = index.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          index.set(key, { label: token, count: 1 });
        }
      }
    }
    return index;
  }, [items]);

  const activeLinkQuery = useMemo(() => extractLinkQuery(query), [query]);

  const suggestions = useMemo(() => {
    if (!activeLinkQuery.isActive) {
      return [];
    }
    const entries = Array.from(linkIndex.entries()).map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
    }));
    if (entries.length === 0) {
      return [];
    }
    const needle = normalizeKey(activeLinkQuery.query);
    if (!needle) {
      return entries
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }
    const prefixMatches: typeof entries = [];
    const containsMatches: typeof entries = [];
    for (const entry of entries) {
      if (entry.key.startsWith(needle)) {
        prefixMatches.push(entry);
      } else if (entry.key.includes(needle)) {
        containsMatches.push(entry);
      }
    }
    prefixMatches.sort((a, b) => b.count - a.count);
    containsMatches.sort((a, b) => b.count - a.count);
    return [...prefixMatches, ...containsMatches].slice(0, 10);
  }, [activeLinkQuery, linkIndex]);

  const filteredItems = useMemo(() => {
    const rawInput = normalizeParens(query).trim();
    if (!rawInput) {
      return items;
    }
    const normalizedQuery = normalizeSearchToken(rawInput).toLowerCase();
    const rawQuery = rawInput.toLowerCase();
    const keys = normalizedQuery === rawQuery
      ? [rawQuery]
      : [normalizedQuery, rawQuery];
    return items.filter((item) => {
      const title = normalizeParens(item.memoTitle).toLowerCase();
      const body = normalizeParens(item.memoText).toLowerCase();
      return keys.some((key) => key && (title.includes(key) || body.includes(key)));
    });
  }, [items, query]);

  const sections = useMemo<Section[]>(() => {
    const grouped = new Map<string, MemoItem[]>();
    for (const item of filteredItems) {
      if (!grouped.has(item.date)) {
        grouped.set(item.date, []);
      }
      grouped.get(item.date)?.push(item);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([title, data]) => ({ title, data }));
  }, [filteredItems]);

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
    const nextTitle =
      selectedMemo.source === "task"
        ? buildMemoTitle(nextText)
        : selectedMemo.memoTitle;
    const updated = { ...selectedMemo, memoText: nextText, memoTitle: nextTitle };
    setSelectedMemo(updated);
    setItems((prev) =>
      prev.map((item) =>
        item.key === updated.key
          ? {
              ...item,
              memoText: nextText,
              memoTitle:
                item.source === "task" ? buildMemoTitle(nextText) : item.memoTitle,
            }
          : item,
      ),
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.menuButton} onPress={onOpenMenu}>
            <Ionicons name="menu" size={20} color="#111827" />
          </Pressable>
          <Pressable style={styles.backButton} onPress={onBack}>
            <Text style={styles.linkText}>戻る</Text>
          </Pressable>
        </View>
        <Text style={styles.headerTitle}>Memo&apos;s</Text>
        <View style={styles.headerRight} />
      </View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="メモを検索"
          value={query}
          onChangeText={setQuery}
        />
        {activeLinkQuery.isActive && suggestions.length > 0 ? (
          <View style={styles.suggestionPanel}>
            <ScrollView>
              {suggestions.map((item) => (
                <Pressable
                  key={item.key}
                  style={styles.suggestionRow}
                  onPress={() => setQuery(`((${item.label}))`)}
                >
                  <Text style={styles.suggestionText}>
                    {`((${item.label}))`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
      {loading ? (
        <Text style={styles.helperText}>読み込み中...</Text>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.listBody}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionTitle}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <Pressable
              style={styles.item}
              onPress={() => setSelectedMemo(item)}
            >
              <Text style={styles.itemTitle}>{item.memoTitle}</Text>
              <Text style={styles.itemMeta}>
                {item.taskTitle || "メモ"}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.helperText}>メモがありません</Text>
          }
        />
      )}
      <Modal
        visible={!!selectedMemo}
        animationType="slide"
        onRequestClose={() => setSelectedMemo(null)}
      >
        <SafeAreaView style={styles.detailContainer}>
          <View style={styles.detailHeader}>
            <Pressable
              style={styles.backButton}
              onPress={() => setSelectedMemo(null)}
            >
              <Ionicons name="chevron-back" size={18} color="#2563eb" />
              <Text style={styles.linkText}>戻る</Text>
            </Pressable>
            <Text style={styles.detailTitle}>メモ詳細</Text>
            <View style={styles.headerRight}>
              {isEditing ? (
                <View style={styles.editActions}>
                  <Pressable style={styles.editButton} onPress={handleCancelEdit}>
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
                <Pressable style={styles.editButton} onPress={handleEdit}>
                  <Text style={styles.editButtonText}>編集</Text>
                </Pressable>
              )}
            </View>
          </View>
          {selectedMemo ? (
            <ScrollView contentContainerStyle={styles.detailBody}>
              <Text style={styles.detailHeading}>{selectedMemo.memoTitle}</Text>
              <Text style={styles.detailMeta}>
                {selectedMemo.date}
                {selectedMemo.taskTitle ? ` · ${selectedMemo.taskTitle}` : ""}
              </Text>
              {isEditing ? (
                <TextInput
                  style={styles.detailEditor}
                  value={editableText}
                  onChangeText={setEditableText}
                  multiline
                  textAlignVertical="top"
                />
              ) : (
                <LinkText body={editableText} style={styles.detailText} />
              )}
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  headerLeft: {
    width: 120,
    flexDirection: "row",
    alignItems: "center",
  },
  headerRight: {
    width: 120,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  menuButton: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  backButton: {
    marginLeft: 6,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  linkText: {
    color: "#2563eb",
    fontSize: 12,
    marginLeft: 2,
  },
  searchRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 10,
  },
  suggestionPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    maxHeight: 200,
  },
  suggestionRow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  suggestionText: {
    fontSize: 12,
    color: "#111827",
  },
  helperText: {
    paddingHorizontal: 16,
    fontSize: 12,
    color: "#6b7280",
  },
  listBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 12,
    marginBottom: 6,
  },
  item: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#f9fafb",
    marginBottom: 10,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  itemMeta: {
    fontSize: 11,
    color: "#6b7280",
  },
  detailContainer: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  detailTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  detailBody: {
    padding: 16,
  },
  detailHeading: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6,
  },
  detailMeta: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 12,
  },
  detailText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#111827",
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
  detailEditor: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    lineHeight: 20,
    color: "#111827",
    minHeight: 160,
  },
});

export default MemosScreen;
