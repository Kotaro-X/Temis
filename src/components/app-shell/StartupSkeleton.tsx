import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppSettings } from "../../context/AppSettingsContext";
import { useAppUI } from "../../context/AppUIContext";
import appChromeStyles from "../../styles/appChromeStyles";
import TabIcon from "./TabIcon";

/** A data-free preview while account/workspace ownership is being restored. */
export default function StartupSkeleton() {
  const { appLanguage, tr } = useAppSettings();
  const { rootScreen } = useAppUI();
  const memos = rootScreen === "memos";
  const en = appLanguage === "en";
  return (
    <SafeAreaView
      style={styles.screen}
      accessibilityLabel={en ? "Loading Temis…" : "Temisを読み込み中…"}
      accessibilityState={{ busy: true }}
    >
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.screen}>
        <View style={styles.header}>
          <View style={[styles.block, styles.menu]} />
          <Text style={styles.title}>{tr(memos ? "tab.memos" : "tab.tasks")}</Text>
          <View style={[styles.block, styles.circle]} />
        </View>
        <View style={styles.filters}>
          {[76, 60, 84].map((width, index) => <View key={index} style={[styles.block, styles.filter, { width }]} />)}
        </View>
        <View style={styles.content}>
          <View style={[styles.block, styles.section]} />
          {[0, 1, 2, 3, 4].map(index => (
            <View key={index} style={styles.card}>
              {!memos ? <View style={[styles.block, styles.checkbox]} /> : null}
              <View style={styles.lines}>
                <View style={[styles.block, styles.line, { width: index % 2 ? "62%" : "82%" }]} />
                <View style={[styles.block, styles.caption]} />
                {memos ? <View style={[styles.block, styles.line, { width: "90%" }]} /> : null}
              </View>
            </View>
          ))}
        </View>
        <View style={styles.tabs}>
          <View style={appChromeStyles.tabBar}>
            {(["tasks", "memos", "commons"] as const).map(name => (
              <View key={name} style={appChromeStyles.tabButton}>
                <TabIcon name={name} color="#9ca3af" />
                <Text style={appChromeStyles.tabLabel}>{name === "commons" ? "Commons" : tr(name === "tasks" ? "tab.tasks" : "tab.memos")}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  block: { backgroundColor: "#e5e7eb", borderRadius: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 18, height: 52 },
  menu: { width: 24, height: 18 },
  title: { flex: 1, fontSize: 22, fontWeight: "700", color: "#111827" },
  circle: { width: 30, height: 30, borderRadius: 15 },
  filters: { flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingVertical: 12 },
  filter: { height: 30, borderRadius: 15 },
  content: { flex: 1, overflow: "hidden", paddingHorizontal: 18, paddingTop: 12 },
  section: { height: 14, width: 100, marginBottom: 18 },
  card: { flexDirection: "row", gap: 12, paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f3f4f6" },
  checkbox: { width: 20, height: 20, borderRadius: 6 },
  lines: { flex: 1, gap: 12 },
  line: { height: 14 },
  caption: { width: "38%", height: 10, backgroundColor: "#f0f1f3" },
  tabs: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
});
