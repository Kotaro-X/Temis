import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { nanoid } from "nanoid/non-secure";
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import Modal from "../common/KeyboardAwareModal";
import MemoTextEditor from "../inputs/MemoTextEditor";
import { useCollaboration } from "../../context/CollaborationContext";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useAppUI } from "../../context/AppUIContext";
import { useAppRefresh } from "../../context/AppRefreshContext";
import { accountWorkspace } from "../../services/account/accountWorkspace";
import { getWorkspaceEpoch } from "../../services/account/workspaceEpoch";
import { widgetMemoRequests } from "../../features/widgetMemo/widgetMemoRequests";
import { newWidgetMemoDraft } from "../../features/widgetMemo/widgetMemoCore";
import { createWidgetMemoSession } from "../../features/widgetMemo/widgetMemoService";
import { saveEnvironmentDrafts } from "../../services/environment/switchLifecycle";

export const renderWidgetMemoOverlay = (hostId: string) => <WidgetMemoEntry hostId={hostId} />;

export default function WidgetMemoEntry({ hostId = "root" }: { hostId?: string }) {
  const pending = useSyncExternalStore(widgetMemoRequests.subscribe, widgetMemoRequests.getSnapshot);
  return pending && hostId === widgetMemoRequests.getHost() ? <WidgetMemoComposer key={`${accountWorkspace.scope()}:${getWorkspaceEpoch()}`} /> : null;
}

function WidgetMemoComposer() {
  const { profile, projects, overflowProjects, projectStatus } = useCollaboration();
  const { appLanguage } = useAppSettings();
  const { openPrivateWorkspace, openProjectWorkspace, openMemoNotes, closeMemoDetail, closeMemoSearch, closeMenu } = useAppUI();
  const { touchDomains } = useAppRefresh();
  const en = appLanguage === "en";
  const [draft, setDraft] = useState(() => newWidgetMemoDraft(nanoid()));
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const writableProjects = profile ? projects.filter(project => !project.deletedAt && overflowProjects.some(item =>
    item.project.id === project.id && (item.role === "owner" || item.role === "member"))) : [];
  const writableRef = useRef(writableProjects);
  writableRef.current = writableProjects;
  const [session] = useState(() => createWidgetMemoSession(profile, id => writableRef.current.some(project => project.id === id)));
  const frozen = busy || session.locked();
  const selectedProject = projects.find(project => project.id === draft.projectId);
  const destination = draft.projectId ? selectedProject?.name ?? (en ? "Selected Project" : "選択したProject") : "Private";

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; widgetMemoRequests.dismiss(); };
  }, []);

  const cancel = () => {
    if (lock.current) return;
    if (!draft.title.trim() && !draft.body.trim()) { widgetMemoRequests.dismiss(); return; }
    const status = session.status();
    Alert.alert(en ? "Close memo?" : "メモを閉じますか？", status === "draft"
      ? (en ? "Discard this unsaved memo?" : "保存していない入力内容を破棄します。")
      : (en ? "This memo may already be saved. Retry saving to confirm before closing." : "メモが保存されている可能性があります。保存を再試行すると状態を確認できます。"), [
      { text: en ? "Keep writing" : "入力に戻る", style: "cancel" },
      { text: en ? "Close" : "閉じる", style: "destructive", onPress: widgetMemoRequests.dismiss },
    ]);
  };
  const save = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const saved = await session.save(draft);
      if (!alive.current || !saved) return;
      // Existing memo editors may remain underneath this entry point. Flush
      // their autosave queues before navigation closes their modal.
      await saveEnvironmentDrafts();
      if (!alive.current) return;
      session.assertActive();
      closeMemoDetail(); closeMemoSearch(); closeMenu();
      if (draft.projectId) openProjectWorkspace(draft.projectId);
      else openPrivateWorkspace();
      openMemoNotes(); touchDomains(["memos"]);
      widgetMemoRequests.dismiss();
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : (en ? "Could not save. Try again." : "保存できませんでした。再試行してください。"));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return <Modal visible suppressOverlay animationType="slide" onRequestClose={cancel}>
    <SafeAreaProvider initialMetrics={initialWindowMetrics}><SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={cancel}><Text style={styles.action}>{en ? "Cancel" : "キャンセル"}</Text></Pressable>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.heading}>{en ? "New memo" : "新規メモ"}</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || (!draft.title.trim() && !draft.body.trim()), busy }} disabled={busy || (!draft.title.trim() && !draft.body.trim())} style={[styles.button, (busy || (!draft.title.trim() && !draft.body.trim())) && styles.disabled]} onPress={() => void save()}><Text style={styles.action}>{busy ? (en ? "Saving…" : "保存中…") : (en ? "Save" : "保存")}</Text></Pressable>
        </View>
        <View style={styles.fields}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: picker, disabled: frozen }} disabled={frozen} style={styles.destination} onPress={() => { Keyboard.dismiss(); setPicker(value => !value); }}>
            <Text numberOfLines={1} style={styles.destinationText}>{en ? "Save to: " : "保存先："}{destination}</Text>
            <Text style={styles.action}>⌄</Text>
          </Pressable>
          {picker ? <ScrollView style={styles.picker} keyboardShouldPersistTaps="handled">
            <Pressable accessibilityRole="button" style={styles.option} onPress={() => { setDraft(value => ({ ...value, projectId: null })); setPicker(false); }}><Text style={styles.optionText}>Private{!draft.projectId ? " ✓" : ""}</Text></Pressable>
            {writableProjects.map(project => <Pressable key={project.id} accessibilityRole="button" style={styles.option} onPress={() => { setDraft(value => ({ ...value, projectId: project.id })); setPicker(false); }}><Text numberOfLines={1} style={styles.optionText}>{project.name}{draft.projectId === project.id ? " ✓" : ""}</Text></Pressable>)}
            {!writableProjects.length ? <Text style={styles.helper}>{projectStatus === "loading" ? (en ? "Loading Projects…" : "Projectを読み込んでいます…") : (en ? "No writable Projects. Sign in to use shared Projects." : "保存可能なProjectがありません。共有にはログインとProjectへの参加が必要です。")}</Text> : null}
          </ScrollView> : null}
          {draft.projectId ? <Text style={styles.helper}>{en ? "Saving shares this memo with Project members." : "「保存」を押すとProjectメンバーに共有されます。"}</Text> : null}
          <TextInput accessibilityLabel={en ? "Title (optional)" : "タイトル（任意）"} placeholder={en ? "Title (optional)" : "タイトル（任意）"} placeholderTextColor="#6b7280" style={styles.title} value={draft.title} editable={!frozen} onChangeText={title => { if (!lock.current) setDraft(value => ({ ...value, title })); }} />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}{session.locked() ? (en ? " Retry saving the same memo to finish." : " 同じメモの保存を再試行してください。") : ""}</Text> : null}
          <MemoTextEditor value={draft.body} onChangeText={body => { if (!lock.current) setDraft(value => ({ ...value, body })); }} placeholder={en ? "Write a memo" : "メモを入力"} editable={!frozen} autoFocus fillAvailableSpace style={styles.body} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  heading: { flex: 1, minWidth: 0, textAlign: "center", fontSize: 17, fontWeight: "600", color: "#111827" },
  button: { minWidth: 72, minHeight: 44, padding: 12, alignItems: "center", justifyContent: "center" },
  action: { color: "#2563eb", fontSize: 15 },
  disabled: { opacity: 0.45 },
  fields: { flex: 1, paddingHorizontal: 16, paddingBottom: 8 },
  destination: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  destinationText: { flex: 1, minWidth: 0, fontSize: 14, color: "#374151" },
  picker: { maxHeight: 200, flexGrow: 0, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8 },
  option: { minHeight: 44, padding: 12, justifyContent: "center" },
  optionText: { fontSize: 15, color: "#111827" },
  helper: { fontSize: 12, lineHeight: 18, color: "#6b7280", paddingVertical: 4 },
  title: { minHeight: 44, paddingVertical: 8, fontSize: 17, color: "#111827", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb", marginBottom: 8 },
  body: { flex: 1 },
  error: { color: "#b91c1c", fontSize: 13, lineHeight: 20, paddingVertical: 8 },
});
