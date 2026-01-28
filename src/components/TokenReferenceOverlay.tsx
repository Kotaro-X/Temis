import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { findMemosByToken, MemoSearchHit } from "../db/memoRepo";

type Props = {
  visible: boolean;
  token: string | null;
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

const TokenReferenceOverlay = ({
  visible,
  token,
  onClose,
  onSelectTaskId,
}: Props) => {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MemoSearchHit[]>([]);

  useEffect(() => {
    if (!visible || !token) {
      return;
    }
    let active = true;
    setLoading(true);
    findMemosByToken(token)
      .then((results) => {
        if (active) {
          setItems(results);
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
  }, [visible, token]);

  const headerLabel = useMemo(
    () => (token ? `((${token}))` : ""),
    [token],
  );

  return (
    <Modal transparent visible={visible} animationType="fade">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.panel} onPress={() => null}>
          <View style={styles.header}>
            <Text style={styles.title}>{headerLabel}</Text>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>閉じる</Text>
            </Pressable>
          </View>
          {loading ? (
            <Text style={styles.helperText}>読み込み中...</Text>
          ) : items.length === 0 ? (
            <Text style={styles.helperText}>該当メモがありません</Text>
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listBody}>
              {items.map((item) => (
                <Pressable
                  key={item.memoId}
                  style={styles.item}
                  onPress={() => {
                    onSelectTaskId?.(item.taskId);
                    onClose();
                  }}
                >
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemTitle}>{item.taskTitle}</Text>
                    <Text style={styles.itemDate}>
                      {formatDateTime(item.updatedAt)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    justifyContent: "flex-start",
  },
  panel: {
    marginTop: 24,
    marginHorizontal: 16,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    maxHeight: "70%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  closeButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closeText: {
    fontSize: 12,
    color: "#2563eb",
  },
  helperText: {
    fontSize: 12,
    color: "#6b7280",
  },
  list: {
    flexGrow: 0,
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
    marginBottom: 10,
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
});

export default TokenReferenceOverlay;
