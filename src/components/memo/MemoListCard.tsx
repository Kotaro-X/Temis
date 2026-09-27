import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  title: string;
  meta: string[];
  onPress: () => void;
  onDelete?: () => void;
  deleting?: boolean;
};

const MemoListCard = ({ title, meta, onPress, onDelete, deleting = false }: Props) => (
  <View style={styles.card}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}を開く`}
      style={styles.content}
      onPress={onPress}
      disabled={deleting}
    >
      <Text style={styles.title}>{title}</Text>
      {meta.map((line, index) => (
        <Text key={`${index}:${line}`} numberOfLines={1} style={styles.meta}>{line}</Text>
      ))}
    </Pressable>
    {onDelete ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}を消去`}
        style={[styles.deleteButton, deleting && styles.deleteButtonDisabled]}
        onPress={onDelete}
        disabled={deleting}
      >
        <Ionicons name="trash-outline" size={16} color="#111827" />
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#f9fafb",
    marginBottom: 10,
  },
  content: { flex: 1, paddingRight: 8 },
  title: { fontSize: 13, fontWeight: "600", color: "#111827", marginBottom: 4 },
  meta: { fontSize: 11, color: "#6b7280", marginTop: 2 },
  deleteButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  deleteButtonDisabled: { opacity: 0.45 },
});

export default MemoListCard;
