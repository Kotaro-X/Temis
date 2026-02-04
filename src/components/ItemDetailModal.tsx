import React, { useEffect, useMemo, useState } from "react";
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

import { getSearchItemById } from "../services/searchIndex";
import { SearchItem, SearchItemKind } from "../types/SearchItem";
import LinkText from "./LinkText";

type Props = {
  visible: boolean;
  itemId: string | null;
  kind: SearchItemKind | null;
  keyword: string;
  onClose: () => void;
  onSearch: (word: string) => void;
};

const ItemDetailModal = ({
  visible,
  itemId,
  kind,
  keyword,
  onClose,
  onSearch,
}: Props) => {
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<SearchItem | null>(null);

  useEffect(() => {
    if (!visible || !itemId || !kind) {
      setItem(null);
      return;
    }
    let active = true;
    setLoading(true);
    getSearchItemById(kind, itemId)
      .then((result) => {
        if (active) {
          setItem(result);
        }
      })
      .catch(() => {
        if (active) {
          setItem(null);
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

  const title = useMemo(() => item?.title ?? "", [item]);

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
          <Text style={styles.title}>詳細</Text>
          <View style={styles.headerRight} />
        </View>
        <ScrollView contentContainerStyle={styles.container}>
          {loading ? (
            <Text style={styles.helperText}>読み込み中...</Text>
          ) : !item ? (
            <Text style={styles.helperText}>データが見つかりません</Text>
          ) : (
            <>
              <Text style={styles.itemTitle}>{title}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.itemDate}>{item.date}</Text>
                <View
                  style={[
                    styles.badge,
                    item.kind === "task" ? styles.badgeTask : styles.badgeNote,
                  ]}
                >
                  <Text style={styles.badgeText}>{item.kind}</Text>
                </View>
              </View>
              {item.body ? (
                <LinkText
                  body={item.body}
                  style={styles.bodyText}
                  activeKey={keyword}
                  onPressLink={(word) => onSearch(word)}
                />
              ) : (
                <Text style={styles.helperText}>本文がありません</Text>
              )}
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
  badgeText: {
    fontSize: 10,
    color: "#1f2937",
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#111827",
  },
});

export default ItemDetailModal;
