import React, { useEffect, useMemo, useState } from "react";
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

import {
  MemoSearchHit,
  searchMemosByTaskTitle,
  searchMemosByToken,
} from "../db/memoRepo";

type SearchMode = "task" | "token";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelectTaskId?: (taskId: string) => void;
};

const pad2 = (num: number) => String(num).padStart(2, "0");

const formatDateTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const MemoSearchModal = ({ visible, onClose, onSelectTaskId }: Props) => {
  const [mode, setMode] = useState<SearchMode>("task");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MemoSearchHit[]>([]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults([]);
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const handler = setTimeout(() => {
      const search = mode === "task"
        ? searchMemosByTaskTitle(trimmed)
        : searchMemosByToken(trimmed);
      search
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
  }, [query, mode, visible]);

  const modeLabel = useMemo(
    () => (mode === "task" ? "タスク名" : "Token"),
    [mode],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
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
          <View style={styles.segmentRow}>
            <Pressable
              style={[styles.segmentButton, mode === "task" && styles.segmentActive]}
              onPress={() => setMode("task")}
            >
              <Text
                style={[
                  styles.segmentText,
                  mode === "task" && styles.segmentTextActive,
                ]}
              >
                タスク名
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, mode === "token" && styles.segmentActive]}
              onPress={() => setMode("token")}
            >
              <Text
                style={[
                  styles.segmentText,
                  mode === "token" && styles.segmentTextActive,
                ]}
              >
                Token
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            placeholder={`${modeLabel}で検索`}
            value={query}
            onChangeText={setQuery}
          />
          {loading ? (
            <Text style={styles.helperText}>検索中...</Text>
          ) : results.length === 0 ? (
            <Text style={styles.helperText}>該当メモがありません</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.listBody}>
              {results.map((item) => (
                <Pressable
                  key={item.memoId}
                  style={styles.item}
                  onPress={() => onSelectTaskId?.(item.taskId)}
                >
                <View style={styles.itemHeader}>
                  <Text style={styles.itemTitle}>{item.taskTitle}</Text>
                  <Text style={styles.itemDate}>
                    {formatDateTime(item.updatedAt)}
                  </Text>
                </View>
                <Text style={styles.itemPreview}>{item.preview}</Text>
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
  segmentRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 4,
    marginBottom: 12,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
  },
  segmentActive: {
    backgroundColor: "#111827",
  },
  segmentText: {
    fontSize: 12,
    color: "#6b7280",
  },
  segmentTextActive: {
    color: "#ffffff",
    fontWeight: "600",
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
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    flexShrink: 1,
    marginRight: 8,
  },
  itemDate: {
    fontSize: 11,
    color: "#6b7280",
  },
  itemPreview: {
    fontSize: 12,
    color: "#374151",
  },
});

export default MemoSearchModal;
