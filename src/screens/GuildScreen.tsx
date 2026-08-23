import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import GuildPostComposerModal from "../components/guild/GuildPostComposerModal";
import { useCollaboration } from "../context/CollaborationContext";
import { useSubscription } from "../context/SubscriptionContext";
import {
  createProjectJoinRequest,
  getGuildPost,
  listGuildPosts,
  reportGuildPost,
  setGuildPostStatus,
} from "../services/guild/guildService";
import { getProjectMember, inviteToProject, sendConnectionRequest } from "../services/collaboration/collaborationService";
import { extractGuildTags, type GuildFeedKind, type GuildFeedPost } from "../types/guild";
import { normalizeParens } from "../utils/wikiLink";

type Props = {
  visible: boolean;
  contentPaddingTop: number;
  onOpenMenu: () => void;
};

const FEEDS: { key: GuildFeedKind; label: string }[] = [
  { key: "recommended", label: "おすすめ" },
  { key: "recent", label: "新着" },
  { key: "connected", label: "つながり・参加中" },
];

const formatDate = (value: number | null) => value ? new Date(value).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }) : "";

const GuildScreen = ({ visible, contentPaddingTop, onOpenMenu }: Props) => {
  const { profile, projects } = useCollaboration();
  const { isCloudSyncEntitled } = useSubscription();
  const [feed, setFeed] = useState<GuildFeedKind>("recommended");
  const [search, setSearch] = useState("");
  const [posts, setPosts] = useState<GuildFeedPost[]>([]);
  const [cursor, setCursor] = useState<{ publishedAt: number; id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<GuildFeedPost | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reporting, setReporting] = useState(false);
  const tags = useMemo(() => extractGuildTags(search), [search]);

  const loadFirst = useCallback(async (refresh = false) => {
    if (!profile) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const page = await listGuildPosts({ feed, tags });
      setPosts(page.posts);
      setCursor(page.cursor);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "投稿を読み込めませんでした。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [feed, profile, tags]);

  useEffect(() => {
    if (!visible || !profile) return;
    void loadFirst();
  }, [loadFirst, profile, visible]);

  const loadMore = async () => {
    if (!cursor || loadingMore || loading || !profile) return;
    setLoadingMore(true);
    try {
      const page = await listGuildPosts({ feed, tags, cursor });
      setPosts((current) => {
        const ids = new Set(current.map((post) => post.id));
        return [...current, ...page.posts.filter((post) => !ids.has(post.id))];
      });
      setCursor(page.cursor);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "追加の投稿を読み込めませんでした。");
    } finally {
      setLoadingMore(false);
    }
  };

  const openDetail = async (post: GuildFeedPost) => {
    setSelectedPost(post);
    setDetailLoading(true);
    try { setSelectedPost(await getGuildPost(post.id)); } catch { setSelectedPost(null); }
    finally { setDetailLoading(false); }
  };

  const handleConnect = async () => {
    if (!selectedPost) return;
    try {
      await sendConnectionRequest(selectedPost.authorUserId);
      Alert.alert("申請を送信しました", "相手が承認するとつながりになります。");
    } catch (cause) { Alert.alert("申請できません", cause instanceof Error ? cause.message : "もう一度お試しください。"); }
  };

  const handleJoin = async () => {
    if (!selectedPost?.projectId) return;
    if (!isCloudSyncEntitled) { Alert.alert("Temis Plus限定", "プロジェクト参加申請にはTemis Plusが必要です。"); return; }
    try { await createProjectJoinRequest({ projectId: selectedPost.projectId }); Alert.alert("参加申請を送信しました", "オーナーの承認をお待ちください。"); }
    catch (cause) { Alert.alert("申請できません", cause instanceof Error ? cause.message : "もう一度お試しください。"); }
  };

  const handleScout = async () => {
    if (!selectedPost) return;
    if (!isCloudSyncEntitled) { Alert.alert("Temis Plus限定", "スカウト送信にはTemis Plusが必要です。"); return; }
    const candidates = await Promise.all(projects.map(async (project) => ({ project, member: profile ? await getProjectMember(project.id, profile.userId) : null })));
    const eligible = candidates.filter(({ member, project }) => member && (member.role === "owner" || (member.role === "member" && project.invitationPolicy === "members")));
    if (!eligible.length) { Alert.alert("スカウトできません", "招待権限を持つプロジェクトがありません。"); return; }
    Alert.alert("プロジェクトへスカウト", "招待先を選択してください。", [
      ...eligible.map(({ project, member }) => ({
        text: project.name,
        onPress: () => {
          void inviteToProject(project, member!.role, selectedPost.authorUserId)
            .then(() => Alert.alert("スカウトを送信しました"))
            .catch((cause) => Alert.alert("送信できません", cause instanceof Error ? cause.message : "もう一度お試しください。"));
        },
      })),
      { text: "キャンセル", style: "cancel" as const },
    ]);
  };

  const handleReport = async () => {
    if (!selectedPost || reporting) return;
    setReporting(true);
    try { await reportGuildPost(selectedPost.id, "ユーザーからの通報"); Alert.alert("通報を受け付けました", "運営が確認します。"); }
    catch (cause) { Alert.alert("通報できません", cause instanceof Error ? cause.message : "もう一度お試しください。"); }
    finally { setReporting(false); }
  };

  const visiblePosts = useMemo(() => {
    const term = normalizeParens(search).normalize("NFKC").trim().toLocaleLowerCase();
    if (!term) return posts;
    return posts.filter((post) => normalizeParens(`${post.authorDisplayName} ${post.body} ${post.tags.map((tag) => `#${tag}`).join(" ")}`).normalize("NFKC").toLocaleLowerCase().includes(term));
  }, [posts, search]);

  if (!visible) return null;
  if (!profile) return <View style={[styles.screen, { paddingTop: contentPaddingTop }]}><Text style={styles.signIn}>ギルドを利用するにはGoogleでログインしてください。</Text></View>;

  return (
    <View style={[styles.screen, { paddingTop: contentPaddingTop }]}> 
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="メニューを開く"
            style={styles.menuButton}
            onPress={onOpenMenu}
          >
            <Ionicons name="menu" size={20} color="#111827" />
          </Pressable>
        </View>
        <Text style={styles.headerTitle}>ギルド</Text>
        <View style={styles.headerSideRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="投稿を作成"
            style={styles.newButton}
            onPress={() => setComposerOpen(true)}
          >
            <Ionicons name="add" size={18} color="#111827" />
            <Text style={styles.newButtonText}>投稿</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.feedTabs}>{FEEDS.map((item) => <Pressable key={item.key} style={[styles.feedTab, feed === item.key && styles.feedTabActive]} onPress={() => setFeed(item.key)}><Text style={[styles.feedTabText, feed === item.key && styles.feedTabTextActive]}>{item.label}</Text></Pressable>)}</View>
      <TextInput value={search} onChangeText={setSearch} style={styles.search} placeholder="投稿・#タグ・((Wikiリンク)) を検索" />
      {loading ? <View style={styles.center}><ActivityIndicator color="#2563eb" /></View> : loadError && !posts.length ? <View style={styles.center}><Text style={styles.error}>{loadError}</Text><Pressable onPress={() => void loadFirst()}><Text style={styles.retry}>再試行</Text></Pressable></View> : <FlatList data={visiblePosts} keyExtractor={(item) => item.id} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadFirst(true)} />} onEndReached={() => void loadMore()} onEndReachedThreshold={0.6} contentContainerStyle={visiblePosts.length ? styles.list : styles.emptyList} renderItem={({ item }) => <Pressable style={styles.card} onPress={() => void openDetail(item)}><View style={styles.cardMeta}><Text style={styles.author}>{item.authorDisplayName}</Text><Text style={styles.date}>{formatDate(item.publishedAt)}</Text></View><Text style={styles.body} numberOfLines={5}>{item.body}</Text><View style={styles.tagRow}>{item.tags.map((tag) => <Text key={tag} style={styles.tag}>#{tag}</Text>)}</View>{item.projectId ? <Text style={styles.projectLabel}>関連プロジェクト</Text> : null}</Pressable>} ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{tags.length ? "タグに合う投稿がまだありません" : "公開投稿はまだありません"}</Text><Pressable onPress={() => setComposerOpen(true)}><Text style={styles.retry}>最初の投稿を作成</Text></Pressable></View>} ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color="#2563eb" /> : loadError && posts.length ? <Pressable style={styles.footer} onPress={() => void loadMore()}><Text style={styles.retry}>追加読み込みを再試行</Text></Pressable> : null} />}
      <GuildPostComposerModal visible={composerOpen} onClose={() => setComposerOpen(false)} onPublished={(post) => setPosts((current) => [((({ source: _source, ...safe }) => safe)(post)), ...current])} />
      <Modal visible={selectedPost !== null} animationType="slide" onRequestClose={() => setSelectedPost(null)}>
        <SafeAreaView style={styles.detail}>
          <View style={styles.detailHeader}>
            <Pressable onPress={() => setSelectedPost(null)}><Text style={styles.retry}>閉じる</Text></Pressable>
            <Text style={styles.title}>投稿詳細</Text>
            <View style={{ width: 40 }} />
          </View>
          {detailLoading ? <ActivityIndicator color="#2563eb" /> : selectedPost ? <>
            <Text style={styles.author}>{selectedPost.authorDisplayName}</Text>
            <Text style={styles.detailBody}>{selectedPost.body}</Text>
            <View style={styles.tagRow}>{selectedPost.tags.map((tag) => <Text key={tag} style={styles.tag}>#{tag}</Text>)}</View>
            {selectedPost.authorUserId !== profile.userId ? <View style={styles.actions}>
              <Pressable style={styles.action} onPress={() => void handleConnect()}><Text style={styles.actionText}>つながり申請</Text></Pressable>
              {selectedPost.projectId ? <Pressable style={styles.action} onPress={() => void handleJoin()}><Text style={styles.actionText}>参加を申請</Text></Pressable> : null}
              <Pressable style={styles.action} onPress={() => void handleScout()}><Text style={styles.actionText}>プロジェクトへスカウト</Text></Pressable>
            </View> : <Pressable style={styles.action} onPress={() => void setGuildPostStatus(selectedPost.id, "unpublished").then(() => setSelectedPost(null))}><Text style={styles.actionText}>非公開にする</Text></Pressable>}
            <Pressable style={styles.report} onPress={() => void handleReport()} disabled={reporting}><Text style={styles.reportText}>通報</Text></Pressable>
          </> : <Text style={styles.empty}>この投稿は表示できません。</Text>}
        </SafeAreaView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, paddingHorizontal: 16 },
  headerSide: { width: 120, flexDirection: "row", alignItems: "center" },
  headerSideRight: { width: 120, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  headerTitle: { flex: 1, color: "#111827", fontSize: 18, fontWeight: "600", textAlign: "center" },
  menuButton: { paddingHorizontal: 6, paddingVertical: 6 },
  newButton: { minHeight: 32, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#fff" },
  newButtonText: { marginLeft: 4, color: "#111827", fontSize: 12, fontWeight: "600" },
  title: { color: "#111827", fontSize: 19, fontWeight: "800" },
  feedTabs: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 9 }, feedTab: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: "#e5e7eb" }, feedTabActive: { backgroundColor: "#dbeafe" }, feedTabText: { color: "#4b5563", fontSize: 12 }, feedTabTextActive: { color: "#1d4ed8", fontWeight: "800" }, search: { marginHorizontal: 16, marginBottom: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, paddingHorizontal: 11, paddingVertical: 9 }, list: { padding: 16, gap: 10 }, emptyList: { flexGrow: 1, justifyContent: "center", padding: 24 }, card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14, gap: 8 }, cardMeta: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, author: { fontSize: 14, color: "#111827", fontWeight: "800" }, date: { fontSize: 12, color: "#6b7280" }, body: { color: "#1f2937", lineHeight: 21, fontSize: 14 }, tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, tag: { color: "#2563eb", fontSize: 12 }, projectLabel: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, color: "#166534", backgroundColor: "#dcfce7", fontSize: 11, fontWeight: "700" }, center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }, signIn: { margin: 24, color: "#4b5563", textAlign: "center" }, empty: { color: "#6b7280", textAlign: "center" }, error: { color: "#b91c1c", textAlign: "center" }, retry: { color: "#2563eb", fontWeight: "700", padding: 8 }, footer: { alignSelf: "center", marginVertical: 14 }, detail: { flex: 1, backgroundColor: "#fff", padding: 20, gap: 16 }, detailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, detailBody: { color: "#111827", fontSize: 16, lineHeight: 25 }, actions: { gap: 9 }, action: { borderRadius: 9, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#bfdbfe" }, actionText: { color: "#1d4ed8", fontWeight: "700", textAlign: "center" }, report: { alignSelf: "flex-start", paddingVertical: 10 }, reportText: { color: "#b91c1c", fontWeight: "700" },
});

export default GuildScreen;
