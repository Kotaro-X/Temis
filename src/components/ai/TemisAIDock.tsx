import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";

type Props = {
  expanded: boolean;
  expandedTop?: number;
  query: string;
  placeholder: string;
  searchLabel: string;
  searchDisabled: boolean;
  onChangeQuery: (value: string) => void;
  onSearch: () => void;
  onToggle: () => void;
  badge?: React.ReactNode;
  inputProps?: Omit<TextInputProps, "onChangeText" | "placeholder" | "value">;
  children?: React.ReactNode;
};

export default function TemisAIDock({
  expanded,
  expandedTop,
  query,
  placeholder,
  searchLabel,
  searchDisabled,
  onChangeQuery,
  onSearch,
  onToggle,
  badge,
  inputProps,
  children,
}: Props) {
  return (
    <View style={[
      styles.dock,
      expanded && styles.expanded,
      expanded && expandedTop != null ? { top: expandedTop } : null,
    ]}>
      <Pressable accessibilityRole="button" style={styles.header} onPress={onToggle}>
        <View style={styles.titleRow}>
          <Ionicons name="sparkles" size={16} color="#111827" />
          <Text style={styles.title}>Temis AI</Text>
          {badge}
        </View>
        <Ionicons name={expanded ? "chevron-down" : "chevron-up"} size={16} color="#111827" />
      </Pressable>
      <View style={styles.inputRow}>
        <TextInput
          {...inputProps}
          style={[styles.input, inputProps?.style]}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          value={query}
          onChangeText={onChangeQuery}
          onSubmitEditing={onSearch}
          returnKeyType="search"
        />
        <Pressable style={[styles.searchButton, searchDisabled && styles.searchButtonDisabled]} onPress={onSearch} disabled={searchDisabled}>
          <Text style={styles.searchButtonText}>{searchLabel}</Text>
        </Pressable>
      </View>
      {expanded ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  expanded: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 14, fontWeight: "700", color: "#111827" },
  inputRow: { flexDirection: "row", alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#111827",
  },
  searchButton: {
    marginLeft: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#111827",
  },
  searchButtonDisabled: { opacity: 0.45 },
  searchButtonText: { fontSize: 12, color: "#ffffff", fontWeight: "700" },
  body: {
    flex: 1,
    minHeight: 0,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 10,
  },
});
