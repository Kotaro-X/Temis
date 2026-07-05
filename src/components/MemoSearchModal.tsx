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
import type { MemoNavigation } from "../screens/MemoScreen";
import { AppLanguage, t } from "../i18n";

type Props = {
  visible: boolean;
  onClose: () => void;
  navigation: MemoNavigation;
  initialQuery?: string;
  language: AppLanguage;
};

const MemoSearchModal = ({
  visible,
  onClose,
  initialQuery,
  navigation,
  language,
}: Props) => {
  const tr = (key: string) => t(language, key);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchMemo[]>([]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults([]);
      setLoading(false);
      return;
    }
    setQuery(initialQuery ?? "");
  }, [visible, initialQuery]);

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
  }, [query, visible]);

  const buildSnippet = (text: string, maxLength = 100) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    return `${trimmed.slice(0, maxLength)}...`;
  };

  const sourceLabel = (source: SearchMemo["source"]) => {
    if (source === "task") {
      return language === "en" ? "Task" : "タスク";
    }
    if (source === "note") {
      return language === "en" ? "Note" : "メモ";
    }
    return language === "en" ? "Tankyu" : "探究";
  };

  const openMemoDetail = (memoId: string) => {
    navigation.push("MemoDetail", { id: memoId });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={onClose}>
            <Ionicons name="chevron-back" size={18} color="#2563eb" />
            <Text style={styles.backText}>{tr("common.back")}</Text>
          </Pressable>
          <Text style={styles.title}>{language === "en" ? "Memo Search" : "メモ検索"}</Text>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>{tr("common.close")}</Text>
          </Pressable>
        </View>
        <View style={styles.container}>
          <TextInput
            style={styles.input}
            placeholder={language === "en" ? "Search by keyword" : "単語で検索"}
            value={query}
            onChangeText={setQuery}
          />
          {loading ? (
            <Text style={styles.helperText}>{language === "en" ? "Searching..." : "検索中..."}</Text>
          ) : results.length === 0 ? (
            <Text style={styles.helperText}>
              {language === "en" ? "No matching memos" : "該当メモがありません"}
            </Text>
          ) : (
            <ScrollView contentContainerStyle={styles.listBody}>
              {results.map((item) => (
                <Pressable
                  key={item.key}
                  style={styles.item}
                  onPress={() => openMemoDetail(item.key)}
                >
                  <Text style={styles.itemSnippet}>
                    {buildSnippet(item.memoText)}
                  </Text>
                  <Text style={styles.itemMetaText}>
                    {item.date}
                    {item.taskTitle ? ` · ${item.taskTitle}` : ""}
                    {` · ${sourceLabel(item.source)}`}
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
  itemSnippet: {
    fontSize: 12,
    color: "#111827",
    marginBottom: 6,
  },
  itemMetaText: {
    fontSize: 11,
    color: "#6b7280",
  },
});

export default MemoSearchModal;
