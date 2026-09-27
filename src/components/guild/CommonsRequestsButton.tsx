import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useCollaboration } from "../../context/CollaborationContext";
import { projectInvitationErrorMessage } from "../../services/freemium/freemiumErrors";
import {
  getProfile,
  respondToConnectionRequest,
  respondToProjectInvitation,
  subscribeToIncomingConnections,
  subscribeToIncomingInvitations,
} from "../../services/collaboration/collaborationService";
import type { Connection, ProjectInvitation } from "../../types/collaboration";

// Mounted only while Commons is visible; the parent keys this by account.
export default function CommonsRequestsButton() {
  const { refresh } = useCollaboration();
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState({ connections: false, invitations: false });
  const [errors, setErrors] = useState({ connections: "", invitations: "" });
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoaded({ connections: false, invitations: false });
    setErrors({ connections: "", invitations: "" });
    const stopConnections = subscribeToIncomingConnections((items) => {
      if (!active) return;
      setConnections(items);
      setLoaded((state) => ({ ...state, connections: true }));
    }, () => {
      if (!active) return;
      setConnections([]);
      setErrors((state) => ({ ...state, connections: "繋がり申請を読み込めませんでした。" }));
    });
    const stopInvitations = subscribeToIncomingInvitations((items) => {
      if (!active) return;
      setInvitations(items);
      setLoaded((state) => ({ ...state, invitations: true }));
    }, () => {
      if (!active) return;
      setInvitations([]);
      setErrors((state) => ({ ...state, invitations: "スカウトを読み込めませんでした。" }));
    });
    return () => { active = false; stopConnections(); stopInvitations(); };
  }, [retry]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const ids = [...new Set([...connections.map((item) => item.requesterUserId), ...invitations.map((item) => item.inviterUserId)])];
    void Promise.all(ids.map(async (id) => {
      try {
        const profile = await getProfile(id);
        return [id, profile?.displayName || (profile?.username ? `@${profile.username}` : `ユーザー ${id}`)] as const;
      } catch { return [id, `ユーザー ${id}（プロフィール非公開・取得不可）`] as const; }
    })).then((entries) => { if (active) setNames(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [connections, invitations, open]);

  const respond = async (kind: "connection" | "invitation", id: string, accept: boolean) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(`${kind}:${id}`);
    try {
      if (kind === "connection") {
        await respondToConnectionRequest(id, accept);
        if (mounted.current) setConnections((items) => items.filter((item) => item.requesterUserId !== id));
      } else {
        await respondToProjectInvitation(id, accept);
        if (mounted.current) setInvitations((items) => items.filter((item) => item.id !== id));
        void refresh();
      }
      if (!mounted.current) return;
      Alert.alert(accept ? (kind === "connection" ? "繋がりを承認しました" : "プロジェクトに参加しました") : "辞退しました");
      // Refresh project membership when the inbox closes, keeping other requests visible.
    } catch (cause) {
      if (mounted.current) Alert.alert("応答できません", kind === "invitation" ? projectInvitationErrorMessage(cause) : "通信状態と申請の状態を確認して再試行してください。");
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  const close = () => { if (!locked.current) { setOpen(false); void refresh(); } };
  const count = connections.length + invitations.length;
  const hasError = !!(errors.connections || errors.invitations);
  const actions = (kind: "connection" | "invitation", id: string, expired = false) => (
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" disabled={!!busy} style={[styles.secondary, busy && styles.disabled]} onPress={() => void respond(kind, id, false)}><Text>辞退</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={!!busy || expired} style={[styles.primary, (busy || expired) && styles.disabled]} onPress={() => void respond(kind, id, true)}>
        {busy === `${kind}:${id}` ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{kind === "connection" ? "繋がりを承認" : "参加を承認"}</Text>}
      </Pressable>
    </View>
  );
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`繋がり申請・スカウト、${count}件${hasError ? "、読み込みエラー" : ""}`} style={styles.icon} onPress={() => setOpen(true)}>
      <Ionicons name="person-add" size={25} color="#111" />
      {count > 0 || hasError ? <View style={styles.badge}><Text style={styles.badgeText}>{hasError ? "!" : count > 99 ? "99+" : count}</Text></View> : null}
    </Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={close}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen}>
          <View style={styles.header}><Text style={styles.title}>繋がり申請・スカウト</Text><Pressable accessibilityRole="button" accessibilityLabel="申請一覧を閉じる" disabled={!!busy} style={styles.icon} onPress={close}><Ionicons name="close" size={26} color="#111" /></Pressable></View>
          <ScrollView contentContainerStyle={styles.content}>
            {hasError ? <View style={styles.card}><Text style={styles.error}>{[errors.connections, errors.invitations].filter(Boolean).join("\n")}</Text><Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setRetry((value) => value + 1)}><Text>再読み込み</Text></Pressable></View> : null}
            <Text style={styles.section}>繋がり申請</Text>
            {!loaded.connections && !errors.connections ? <ActivityIndicator /> : null}
            {loaded.connections && !connections.length ? <Text style={styles.caption}>届いている繋がり申請はありません。</Text> : null}
            {connections.map((item) => <View key={item.id} style={styles.card}><Text style={styles.name}>{names[item.requesterUserId] ?? "ユーザー情報を読み込み中…"}</Text><Text style={styles.caption}>繋がり申請が届いています。</Text>{actions("connection", item.requesterUserId)}</View>)}
            <Text style={styles.section}>プロジェクトへのスカウト</Text>
            {!loaded.invitations && !errors.invitations ? <ActivityIndicator /> : null}
            {loaded.invitations && !invitations.length ? <Text style={styles.caption}>届いているスカウトはありません。</Text> : null}
            {invitations.map((item) => {
              const expired = item.expiresAt != null && item.expiresAt <= Date.now();
              return <View key={item.id} style={styles.card}><Text style={styles.name}>{item.projectName || `プロジェクト ID: ${item.projectId}`}</Text><Text style={styles.caption}>招待者: {names[item.inviterUserId] ?? "読み込み中…"}</Text><Text style={styles.caption}>参加権限: {item.role === "viewer" ? "閲覧のみ" : "メンバー"}{expired ? " · 有効期限切れ" : ""}</Text>{actions("invitation", item.id, expired)}</View>;
            })}
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 0, right: 0, minWidth: 18, height: 18, paddingHorizontal: 3, borderRadius: 9, backgroundColor: "#111", borderWidth: 1, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  title: { flex: 1, flexShrink: 1, fontSize: 19, fontWeight: "700", color: "#111" },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  section: { fontSize: 17, fontWeight: "700", color: "#111", marginTop: 12 },
  card: { padding: 16, borderWidth: 1, borderColor: "#ddd", borderRadius: 14, gap: 10 },
  name: { fontSize: 16, fontWeight: "600", color: "#111" },
  caption: { color: "#555", fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 10 },
  primary: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#111", borderRadius: 10, justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "600" },
  secondary: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, borderColor: "#ccc", borderWidth: 1, borderRadius: 10, alignSelf: "flex-start" },
  disabled: { opacity: 0.4 },
  error: { color: "#b91c1c" },
});
