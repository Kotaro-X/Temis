import React, { useMemo } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppLanguage } from "../i18n";
import {
  WikiReferenceItem,
  WikiReferenceSource,
} from "../services/wikiReferenceService";

export type WikiReferenceFilter = "all" | WikiReferenceSource;

type Props = {
  visible: boolean;
  token: string | null;
  items: WikiReferenceItem[];
  loading: boolean;
  filter: WikiReferenceFilter;
  language: AppLanguage;
  onClose: () => void;
  onChangeFilter: (next: WikiReferenceFilter) => void;
  onSelectItem: (memoId: string) => void;
};

const FILTERS: WikiReferenceFilter[] = ["all", "note", "task", "tankyu"];

const labelForFilter = (filter: WikiReferenceFilter, language: AppLanguage) => {
  if (language === "en") {
    if (filter === "all") {
      return "All";
    }
    if (filter === "note") {
      return "Memo";
    }
    if (filter === "task") {
      return "Task";
    }
    return "Tankyu";
  }
  if (filter === "all") {
    return "全て";
  }
  if (filter === "note") {
    return "メモ";
  }
  if (filter === "task") {
    return "タスク";
  }
  return "探究";
};

const labelForSource = (source: WikiReferenceSource, language: AppLanguage) => {
  if (language === "en") {
    if (source === "note") {
      return "Memo";
    }
    if (source === "task") {
      return "Task";
    }
    return "Tankyu";
  }
  if (source === "note") {
    return "メモ";
  }
  if (source === "task") {
    return "タスク";
  }
  return "探究";
};

const WikiReferenceOverlay = ({
  visible,
  token,
  items,
  loading,
  filter,
  language,
  onClose,
  onChangeFilter,
  onSelectItem,
}: Props) => {
  const filteredItems = useMemo(() => {
    if (filter === "all") {
      return items;
    }
    return items.filter((item) => item.source === filter);
  }, [filter, items]);

  const title =
    language === "en"
      ? `Linked by ((${token ?? ""}))`
      : `((` + (token ?? "") + `)) を含むメモ`;

  const emptyLabel = language === "en" ? "No matching memos" : "該当メモがありません";
  const loadingLabel = language === "en" ? "Loading..." : "読み込み中...";

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>
                {language === "en" ? "Close" : "閉じる"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.filterRow}>
            {FILTERS.map((item) => {
              const active = filter === item;
              return (
                <Pressable
                  key={item}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => onChangeFilter(item)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      active && styles.filterChipTextActive,
                    ]}
                  >
                    {labelForFilter(item, language)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {loading ? (
            <Text style={styles.helperText}>{loadingLabel}</Text>
          ) : filteredItems.length === 0 ? (
            <Text style={styles.helperText}>{emptyLabel}</Text>
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listBody}>
              {filteredItems.map((item) => (
                <Pressable
                  key={item.memoId}
                  style={styles.item}
                  onPress={() => onSelectItem(item.memoId)}
                >
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.itemDate}>{item.date}</Text>
                  </View>
                  {item.preview ? (
                    <Text style={styles.itemPreview} numberOfLines={2}>
                      {item.preview}
                    </Text>
                  ) : null}
                  <Text style={styles.itemMeta}>
                    {labelForSource(item.source, language)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.28)",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  panel: {
    height: "90%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginRight: 12,
  },
  closeButton: {
    minHeight: 36,
    justifyContent: "center",
  },
  closeText: {
    fontSize: 12,
    color: "#2563eb",
    fontWeight: "600",
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 14,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  filterChipActive: {
    borderColor: "#3730a3",
    backgroundColor: "#eef2ff",
  },
  filterChipText: {
    fontSize: 12,
    color: "#4b5563",
    fontWeight: "600",
  },
  filterChipTextActive: {
    color: "#3730a3",
  },
  helperText: {
    fontSize: 12,
    color: "#6b7280",
  },
  list: {
    flexGrow: 0,
  },
  listBody: {
    paddingBottom: 8,
  },
  item: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#f9fafb",
    marginBottom: 10,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginRight: 10,
  },
  itemDate: {
    fontSize: 11,
    color: "#6b7280",
  },
  itemPreview: {
    fontSize: 12,
    lineHeight: 18,
    color: "#4b5563",
    marginBottom: 6,
  },
  itemMeta: {
    fontSize: 11,
    color: "#6b7280",
  },
});

export default WikiReferenceOverlay;
