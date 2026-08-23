import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useSubscription } from "../context/SubscriptionContext";
import {
  completeGuildReport,
  listGuildReports,
  setGuildPostModeration,
} from "../services/guild/guildService";
import { hasStaffFreeAccess } from "../services/subscription/staffAccess";
import type { GuildModerationReport } from "../types/guild";

type Props = {
  visible: boolean;
  contentPaddingTop: number;
  onBack: () => void;
};

const formatDate = (value: number | null) =>
  value
    ? new Date(value).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })
    : "";

const GuildAdminScreen = ({ visible, contentPaddingTop, onBack }: Props) => {
  const { accessGrant } = useSubscription();
  const [reports, setReports] = useState<GuildModerationReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completingReportId, setCompletingReportId] = useState<string | null>(null);
  const isStaff = hasStaffFreeAccess(accessGrant);

  const loadReports = useCallback(async (refresh = false) => {
    if (!isStaff) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setReports(await listGuildReports());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "通報を読み込めませんでした。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isStaff]);

  useEffect(() => {
    if (visible) void loadReports();
  }, [loadReports, visible]);

  const moderateFromReport = async (report: GuildModerationReport, makeVisible: boolean) => {
    try {
      await setGuildPostModeration(
        report.postId,
        makeVisible,
        makeVisible ? null : "通報を確認中",
      );
      setReports((current) => current.map((item) => (
        item.id === report.id
          ? {
            ...item,
            post: item.post
              ? {
                ...item.post,
                moderation: {
                  ...item.post.moderation,
                  visibility: makeVisible ? "visible" : "hidden",
                },
              }
              : null,
          }
          : item
      )));
    } catch (cause) {
      Alert.alert(
        "投稿の表示を変更できません",
        cause instanceof Error ? cause.message : "もう一度お試しください。",
      );
    }
  };

  const completeReport = async (report: GuildModerationReport) => {
    if (completingReportId) return;
    setCompletingReportId(report.id);
    try {
      await completeGuildReport(report.id);
      setReports((current) => current.filter((item) => item.id !== report.id));
    } catch (cause) {
      Alert.alert(
        "通報を完了できません",
        cause instanceof Error ? cause.message : "もう一度お試しください。",
      );
    } finally {
      setCompletingReportId(null);
    }
  };

  if (!visible) return null;
  if (!isStaff) return null;

  return (
    <View style={[styles.screen, { paddingTop: contentPaddingTop }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onBack}>
          <Text style={styles.back}>ギルドへ</Text>
        </Pressable>
        <Text style={styles.title}>運営画面</Text>
        <View style={styles.headerSpacer} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#2563eb" /></View>
      ) : error && reports.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void loadReports()}><Text style={styles.retry}>再試行</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadReports(true)} />}
          contentContainerStyle={reports.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<Text style={styles.empty}>通報はありません。</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.author}>通報: {item.reason}</Text>
              <Text style={styles.meta}>対象ユーザー: {item.reportedUserId} ・ {formatDate(item.createdAt)}</Text>
              {item.post ? (
                <View style={styles.post}>
                  <Text style={styles.postAuthor}>投稿者: {item.post.authorDisplayName}</Text>
                  <Text style={styles.postBody}>{item.post.body}</Text>
                  <Text style={styles.meta}>
                    投稿の状態: {item.post.status} / {item.post.moderation.visibility === "visible" ? "表示中" : "非表示"}
                  </Text>
                </View>
              ) : (
                <Text style={styles.missingPost}>対象の投稿は見つかりません。</Text>
              )}
              <Text style={styles.meta}>通知: {item.notificationStatus} / 対応: {item.status}</Text>
              <Pressable style={styles.action} onPress={() => void moderateFromReport(item, false)}>
                <Text style={styles.actionText}>投稿を非表示</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => void moderateFromReport(item, true)}>
                <Text style={styles.actionText}>表示へ戻す</Text>
              </Pressable>
              <Pressable
                style={[styles.completeAction, completingReportId === item.id && styles.actionDisabled]}
                onPress={() => void completeReport(item)}
                disabled={completingReportId !== null}
              >
                <Text style={styles.completeActionText}>
                  {completingReportId === item.id ? "完了中…" : "対応を完了"}
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  header: { height: 54, paddingHorizontal: 16, alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  headerSpacer: { width: 48 },
  title: { color: "#111827", fontSize: 19, fontWeight: "800" },
  back: { color: "#2563eb", fontWeight: "700", paddingVertical: 8 },
  list: { padding: 16, gap: 10 },
  emptyList: { flexGrow: 1, justifyContent: "center", padding: 24 },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, padding: 12, gap: 7 },
  author: { fontSize: 14, color: "#111827", fontWeight: "800" },
  meta: { color: "#6b7280", fontSize: 12 },
  post: { backgroundColor: "#f8fafc", borderRadius: 8, padding: 10, gap: 5 },
  postAuthor: { color: "#374151", fontSize: 12, fontWeight: "700" },
  postBody: { color: "#111827", fontSize: 14, lineHeight: 21 },
  missingPost: { color: "#b45309", fontSize: 12 },
  action: { borderRadius: 9, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#bfdbfe" },
  actionText: { color: "#1d4ed8", fontWeight: "700", textAlign: "center" },
  completeAction: { borderRadius: 9, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: "#dcfce7", borderWidth: 1, borderColor: "#86efac" },
  completeActionText: { color: "#166534", fontWeight: "700", textAlign: "center" },
  actionDisabled: { opacity: 0.55 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  empty: { color: "#6b7280", textAlign: "center" },
  error: { color: "#b91c1c", textAlign: "center" },
  retry: { color: "#2563eb", fontWeight: "700", padding: 8 },
});

export default GuildAdminScreen;
