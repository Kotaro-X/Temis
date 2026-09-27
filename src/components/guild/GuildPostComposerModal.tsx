import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { upsertFreeNote } from "../../db/noteRepo";
import { useCollaboration } from "../../context/CollaborationContext";
import { updateGuildSourceMemo } from "../../services/guild/guildOwnedPostService";
import { createGuildPost } from "../../services/guild/guildService";
import { extractGuildTags, validateGuildPostInput, type GuildPost, type GuildPostType } from "../../types/guild";

export type GuildPostSource = { scope: "personal" | "project"; memoId: string; projectId?: string | null };

type Props = {
  visible: boolean;
  source?: GuildPostSource | null;
  initialTitle?: string;
  initialBody?: string;
  onClose: () => void;
  onPublished: (post: GuildPost) => void;
};

const TYPE_LABEL: Record<GuildPostType, string> = {
  personal: "個人の探究",
  project_activity: "プロジェクト活動",
  project_recruiting: "メンバー募集",
};

const GuildPostComposerModal = ({ visible, source = null, initialTitle = "", initialBody = "", onClose, onPublished }: Props) => {
  const { profile, projects, projectStatus } = useCollaboration();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [type, setType] = useState<GuildPostType>(source?.scope === "project" ? "project_activity" : "personal");
  const [projectId, setProjectId] = useState<string | null>(source?.projectId ?? null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(initialTitle);
    setBody(initialBody);
    setType(source?.scope === "project" ? "project_activity" : "personal");
    setProjectId(source?.projectId ?? null);
  }, [initialBody, initialTitle, source?.projectId, source?.scope, visible]);

  const projectChoices = useMemo(() => projects.filter((project) => !project.deletedAt), [projects]);
  const selectProject = () => {
    Alert.alert("関連プロジェクト", "投稿に関連付けるプロジェクトを選択してください。", [
      ...projectChoices.map((project) => ({ text: project.name, onPress: () => setProjectId(project.id) })),
      { text: "関連付けない", onPress: () => setProjectId(null) },
      { text: "キャンセル", style: "cancel" as const },
    ]);
  };

  const handlePublish = async () => {
    if ((projectId || type !== "personal" || source?.scope === "project") && projectStatus !== "ready") {
      Alert.alert("投稿できません", "プロジェクトの利用状態を確認してから再試行してください。");
      return;
    }
    if (!profile || submitting) {
      if (!profile) Alert.alert("ログインが必要です", "Commonsへ投稿するにはアカウントにログインしてください。");
      return;
    }
    setSubmitting(true);
    try {
      const draftSource = source
        ? { scope: source.scope, memoId: source.memoId }
        : { scope: "personal" as const, memoId: "pending-local-note" };
      const validationError = validateGuildPostInput({
        title: title.trim() || null,
        body,
        type,
        projectId,
        source: draftSource,
      });
      if (validationError) throw new Error(validationError);

      if (source) {
        await updateGuildSourceMemo({
          source: draftSource,
          title: title.trim() || null,
          body,
          profile,
        });
      }
      const createdSource = source ? null : await upsertFreeNote({ title: title.trim() || null, body });
      const resolvedSource = source ?? {
        scope: "personal" as const,
        memoId: `note:${createdSource!.id}`,
      };
      const post = await createGuildPost({
        title: title.trim() || null,
        body,
        type,
        projectId,
        source: { scope: resolvedSource.scope, memoId: resolvedSource.memoId },
      }, {
        authorUserId: profile.userId,
        authorDisplayName: profile.displayName,
        authorPhotoUrl: profile.photoUrl ?? null,
      });
      onPublished(post);
      onClose();
    } catch (cause) {
      Alert.alert("投稿できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable style={styles.headerButton} onPress={onClose} disabled={submitting}><Text style={styles.cancel}>キャンセル</Text></Pressable>
          <Text style={styles.title}>Commonsに投稿</Text>
          <Pressable style={[styles.publishButton, submitting && styles.disabled]} onPress={() => void handlePublish()} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.publishText}>公開</Text>}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.caption}>公開後にCommons側で編集すると、元メモにも同じ変更が反映されます。</Text>
          <Text style={styles.label}>タイトル</Text>
          <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="タイトル（任意）" />
          <TextInput value={body} onChangeText={setBody} style={styles.body} multiline autoFocus placeholder="探究やプロジェクトの活動を共有する" textAlignVertical="top" />
          <Text style={styles.syntaxHint}>#タグ と ((Wikiリンク)) は本文に直接入力してください。どちらも検索対象になります。</Text>
          <Text style={styles.label}>投稿種別</Text>
          <View style={styles.typeRow}>
            {(Object.keys(TYPE_LABEL) as GuildPostType[]).map((item) => (
              <Pressable key={item} style={[styles.typeChip, type === item && styles.typeChipActive]} onPress={() => setType(item)}>
                <Text style={[styles.typeText, type === item && styles.typeTextActive]}>{TYPE_LABEL[item]}</Text>
              </Pressable>
            ))}
          </View>
          {extractGuildTags(body).length > 0 ? (
            <Text style={styles.detectedTags}>タグ: {extractGuildTags(body).map((tag) => `#${tag}`).join(" ")}</Text>
          ) : null}
          <Text style={styles.label}>関連プロジェクト{type === "personal" ? "（任意）" : ""}</Text>
          <Pressable style={styles.projectPicker} onPress={selectProject}>
            <Text style={styles.projectPickerText}>{projectChoices.find((project) => project.id === projectId)?.name ?? "プロジェクトを選択"}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" }, header: { minHeight: 58, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerButton: { width: 72, paddingVertical: 10 }, cancel: { color: "#2563eb", fontWeight: "600" }, title: { fontSize: 16, fontWeight: "700", color: "#111827" }, publishButton: { minWidth: 52, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center", backgroundColor: "#2563eb" }, disabled: { opacity: 0.6 }, publishText: { color: "#fff", fontWeight: "700" },
  content: { padding: 16, gap: 10 }, caption: { color: "#6b7280", fontSize: 12, lineHeight: 18 }, input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: "#111827" }, body: { minHeight: 190, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, padding: 12, fontSize: 15, color: "#111827" }, syntaxHint: { color: "#6b7280", fontSize: 12, lineHeight: 18 }, detectedTags: { color: "#2563eb", fontSize: 12, fontWeight: "600" }, label: { marginTop: 6, color: "#374151", fontSize: 12, fontWeight: "700" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, typeChip: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }, typeChipActive: { borderColor: "#2563eb", backgroundColor: "#dbeafe" }, typeText: { color: "#4b5563", fontSize: 12 }, typeTextActive: { color: "#1d4ed8", fontWeight: "700" },
  projectPicker: { minHeight: 42, justifyContent: "center", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, paddingHorizontal: 11 }, projectPickerText: { color: "#374151", fontSize: 14 },
});

export default GuildPostComposerModal;
