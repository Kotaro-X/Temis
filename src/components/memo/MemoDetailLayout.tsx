import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import type { AppLanguage } from "../../i18n";

export function MemoDetailLayout({ children, controls, title = "Note", onBack, onDelete, busy = false, obscured = false, language }: {
  children: React.ReactNode; controls?: React.ReactNode; title?: string; onBack: () => void;
  onDelete?: () => void; busy?: boolean; obscured?: boolean; language: AppLanguage;
}) {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics} accessibilityElementsHidden={obscured} importantForAccessibility={obscured ? 'no-hide-descendants' : 'auto'} pointerEvents={obscured ? 'none' : 'auto'}><SafeAreaView style={memoDetailStyles.safeArea}>
    <View style={memoDetailStyles.header}>
      <Pressable style={memoDetailStyles.backButton} onPress={onBack} disabled={busy}><Ionicons name="chevron-back" size={18} color="#2563eb" /><Text style={memoDetailStyles.backText}>{language === "en" ? "Back" : "戻る"}</Text></Pressable>
      <Text style={memoDetailStyles.headerTitle}>{title}</Text>
      {onDelete ? <Pressable style={memoDetailStyles.deleteButton} onPress={onDelete} disabled={busy}><Text style={memoDetailStyles.deleteText}>{language === "en" ? "Delete" : "消去"}</Text></Pressable> : <View style={{ width: 64 }} />}
    </View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentInsetAdjustmentBehavior="never" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {controls}
      <View style={memoDetailStyles.content}>{children}</View>
    </ScrollView>
  </SafeAreaView></SafeAreaProvider>;
}
export const memoDetailStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#ffffff", position: "relative" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 },
  backButton: { flexDirection: "row", alignItems: "center", width: 72, minHeight: 44, paddingVertical: 8 },
  backText: { color: "#2563eb", fontSize: 12, marginLeft: 2 },
  headerTitle: { flex: 1, flexShrink: 1, textAlign: "center", fontSize: 18, fontWeight: "600", color: "#111827" },
  deleteButton: { minWidth: 64, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: "#6b7280", alignItems: "center" },
  deleteText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  content: { flexGrow: 1, padding: 16, minWidth: 0 },
  title: { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 4 },
  meta: { fontSize: 12, color: "#6b7280", marginBottom: 12 },
  scope: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 12 },
  scopeText: { color: "#374151", fontSize: 12, fontWeight: "600" },
});
