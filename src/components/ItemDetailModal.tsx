import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { MemoNavigation } from "../screens/MemoScreen";
import { getMemoByTaskId } from "../db/memoRepo";
import { getDailyNoteByDate, getNoteById } from "../db/noteRepo";
import {
  buildNoteDocumentId,
  buildTankyuDocumentId,
} from "../services/indexTextBuilder";
import { getSearchItemById } from "../services/searchIndex";
import { SearchItem, SearchItemKind } from "../types/SearchItem";
import { AppLanguage, t } from "../i18n";

type Props = {
  visible: boolean;
  itemId: string | null;
  kind: SearchItemKind | null;
  navigation: MemoNavigation;
  onClose: () => void;
  language?: AppLanguage;
};

const ItemDetailModal = ({
  visible,
  itemId,
  kind,
  navigation,
  onClose,
  language = "ja",
}: Props) => {
  const tr = (key: string) => t(language, key);
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<SearchItem | null>(null);
  const [memoId, setMemoId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !itemId || !kind) {
      setItem(null);
      setMemoId(null);
      return;
    }
    let active = true;
    setLoading(true);
    const resolveMemoId = async () => {
      if (kind === "task") {
        const memo = await getMemoByTaskId(itemId);
        return memo?.id ?? null;
      }
      if (kind === "tankyu") {
        return buildTankyuDocumentId(itemId);
      }
      const note = (await getNoteById(itemId)) ?? (await getDailyNoteByDate(itemId));
      return note ? buildNoteDocumentId(note.id) : null;
    };
    Promise.all([getSearchItemById(kind, itemId), resolveMemoId()])
      .then(([result, resolvedMemoId]) => {
        if (active) {
          setItem(result);
          setMemoId(resolvedMemoId);
        }
      })
      .catch(() => {
        if (active) {
          setItem(null);
          setMemoId(null);
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
  }, [visible, itemId, kind]);

  const openMemo = () => {
    if (!memoId) {
      return;
    }
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
          <Text style={styles.title}>{language === "en" ? "Detail" : "詳細"}</Text>
          <View style={styles.headerRight} />
        </View>
        <ScrollView contentContainerStyle={styles.container}>
          {loading ? (
            <Text style={styles.helperText}>{tr("common.loading")}</Text>
          ) : !item ? (
            <Text style={styles.helperText}>
              {language === "en" ? "Data not found" : "データが見つかりません"}
            </Text>
          ) : (
            <>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.itemDate}>{item.date}</Text>
                <View
                  style={[
                    styles.badge,
                    item.kind === "task"
                      ? styles.badgeTask
                      : item.kind === "tankyu"
                        ? styles.badgeTankyu
                        : styles.badgeNote,
                  ]}
                >
                  <Text style={styles.badgeText}>{item.kind}</Text>
                </View>
              </View>
              <Pressable
                style={[styles.openButton, !memoId && styles.openButtonDisabled]}
                onPress={openMemo}
                disabled={!memoId}
              >
                <Text style={styles.openButtonText}>
                  {language === "en" ? "Open memo" : "メモを開く"}
                </Text>
              </Pressable>
              {!memoId ? (
                <Text style={styles.helperText}>{tr("memo.notFound")}</Text>
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#ffffff",
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
  headerRight: {
    width: 72,
  },
  container: {
    padding: 16,
  },
  helperText: {
    fontSize: 12,
    color: "#6b7280",
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  itemDate: {
    fontSize: 12,
    color: "#6b7280",
    marginRight: 8,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeTask: {
    backgroundColor: "#e0f2fe",
  },
  badgeNote: {
    backgroundColor: "#fef3c7",
  },
  badgeTankyu: {
    backgroundColor: "#dcfce7",
  },
  badgeText: {
    fontSize: 10,
    color: "#1f2937",
  },
  openButton: {
    borderWidth: 1,
    borderColor: "#111827",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  openButtonDisabled: {
    opacity: 0.5,
  },
  openButtonText: {
    fontSize: 12,
    color: "#111827",
    fontWeight: "600",
  },
});

export default ItemDetailModal;
