import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type DeletedItemView = {
  key: string;
  title: string;
  kindLabel: string;
  detail: string | null;
  deletedAtLabel: string;
  expiresAtLabel: string;
};

type Props = {
  items: DeletedItemView[];
  loading: boolean;
  restoringItemKey: string | null;
  onRestore: (itemKey: string) => void;
  labels?: {
    empty: string;
    loading: string;
    restore: string;
    restoring: string;
  };
};

const DeletedItemsSection = ({
  items,
  loading,
  restoringItemKey,
  onRestore,
  labels,
}: Props) => {
  const text = {
    empty: labels?.empty ?? "削除済みデータはありません",
    loading: labels?.loading ?? "読み込み中...",
    restore: labels?.restore ?? "復旧",
    restoring: labels?.restoring ?? "復旧中...",
  };

  if (loading && items.length === 0) {
    return <Text style={styles.mutedText}>{text.loading}</Text>;
  }

  if (items.length === 0) {
    return <Text style={styles.mutedText}>{text.empty}</Text>;
  }

  return (
    <View style={styles.list}>
      {items.map((item) => {
        const isRestoring = restoringItemKey === item.key;
        return (
          <View key={item.key} style={styles.card}>
            <View style={styles.meta}>
              <Text style={styles.kind}>{item.kindLabel}</Text>
              <Text style={styles.title}>{item.title}</Text>
              {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
              <Text style={styles.caption}>{item.deletedAtLabel}</Text>
              <Text style={styles.caption}>{item.expiresAtLabel}</Text>
            </View>
            <Pressable
              style={[styles.restoreButton, isRestoring && styles.restoreButtonDisabled]}
              disabled={isRestoring}
              onPress={() => onRestore(item.key)}
            >
              <Text style={styles.restoreButtonText}>
                {isRestoring ? text.restoring : text.restore}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  card: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  meta: {
    gap: 4,
  },
  kind: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  detail: {
    fontSize: 12,
    color: "#374151",
  },
  caption: {
    fontSize: 11,
    color: "#6b7280",
  },
  mutedText: {
    fontSize: 12,
    color: "#6b7280",
  },
  restoreButton: {
    alignSelf: "flex-start",
    backgroundColor: "#111827",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  restoreButtonDisabled: {
    backgroundColor: "#9ca3af",
  },
  restoreButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ffffff",
  },
});

export type { Props as DeletedItemsSectionProps, DeletedItemView };
export default DeletedItemsSection;
