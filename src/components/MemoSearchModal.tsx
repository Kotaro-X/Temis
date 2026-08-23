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

import {
  searchAllMemos,
  searchAllMemosSemantically,
  SearchMemo,
} from "../services/searchIndex";
import type { MemoNavigation } from "../screens/MemoScreen";
import { AppLanguage, t } from "../i18n";

type Props = {
  visible: boolean;
  onClose: () => void;
  navigation: MemoNavigation;
  initialQuery?: string;
  language: AppLanguage;
};

type SearchMode = "keyword" | "ai";

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
  const [mode, setMode] = useState<SearchMode>("keyword");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults([]);
      setLoading(false);
      setError(null);
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
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    const handler = setTimeout(() => {
      const search = mode === "ai" ? searchAllMemosSemantically : searchAllMemos;
      search(trimmed)
        .then((items) => {
          if (active) {
            setResults(items);
            setError(null);
          }
        })
        .catch(() => {
          if (active) {
            setResults([]);
            setError(
              mode === "ai"
                ? language === "en"
                  ? "AI search is unavailable. Sign in and try again."
                  : "AI検索を利用できません。ログイン後にもう一度お試しください。"
                : language === "en"
                  ? "Search failed. Please try again."
                  : "検索に失敗しました。もう一度お試しください。",
            );
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
  }, [language, mode, query, visible]);

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

  if (!visible) {
    return null;
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
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
          <View style={styles.modeSelector}>
            <Pressable
              style={[styles.modeButton, mode === "keyword" && styles.modeButtonActive]}
              onPress={() => setMode("keyword")}
            >
              <Text style={[styles.modeText, mode === "keyword" && styles.modeTextActive]}>
                {language === "en" ? "Keyword" : "キーワード"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeButton, mode === "ai" && styles.modeButtonActive]}
              onPress={() => setMode("ai")}
            >
              <Text style={[styles.modeText, mode === "ai" && styles.modeTextActive]}>
                {language === "en" ? "AI Search" : "AI検索"}
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            placeholder={
              mode === "ai"
                ? language === "en"
                  ? "Search in natural language"
                  : "自然な言葉で検索"
                : language === "en"
                  ? "Search by keyword"
                  : "単語で検索"
            }
            value={query}
            onChangeText={setQuery}
          />
          {mode === "ai" ? (
            <Text style={styles.disclosureText}>
              {language === "en"
                ? "AI search sends memo text and your query to OpenAI to create search embeddings."
                : "AI検索では、検索用の埋め込み生成のためメモ本文と検索語を OpenAI API に送信します。"}
            </Text>
          ) : null}
          {loading ? (
            <Text style={styles.helperText}>{language === "en" ? "Searching..." : "検索中..."}</Text>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
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
  modeSelector: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  modeButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 999,
    minHeight: 36,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  modeButtonActive: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  modeText: {
    fontSize: 12,
    color: "#4b5563",
  },
  modeTextActive: {
    color: "#1d4ed8",
    fontWeight: "600",
  },
  disclosureText: {
    color: "#6b7280",
    fontSize: 11,
    lineHeight: 16,
    marginTop: -4,
    marginBottom: 12,
  },
  helperText: {
    fontSize: 12,
    color: "#6b7280",
  },
  errorText: {
    fontSize: 12,
    color: "#b91c1c",
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
