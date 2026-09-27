import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import CommonsRequestsButton from "../components/guild/CommonsRequestsButton";
import GuildPostComposerModal from "../components/guild/GuildPostComposerModal";
import AIAnswerEvidencePanel from "../components/ai/AIAnswerEvidencePanel";
import TemisAIDock from "../components/ai/TemisAIDock";
import MemoTextEditor from "../components/inputs/MemoTextEditor";
import TokenChips from "../components/TokenChips";
import { useCollaboration } from "../context/CollaborationContext";
import { formatTemisAIUsageLabel, useTemisAIUsage } from "../context/TemisAIUsageContext";
import { useAppUI } from "../context/AppUIContext";
import {
  createProjectJoinRequest,
  getOwnedGuildPost,
  getGuildPost,
  listGuildPosts,
  listMyGuildPosts,
  reportGuildPost,
  setGuildPostStatus,
} from "../services/guild/guildService";
import {
  searchGuildPostsWithAI,
  type GuildAISearchResult,
  type GuildAIEvidencePost,
} from "../services/guild/guildAISearch";
import {
  republishOwnedGuildPost,
  resolveGuildSourceMemoId,
  updateOwnedGuildPostAndSource,
} from "../services/guild/guildOwnedPostService";
import { getConnectionWithUser, getProjectMember, inviteToProject, sendConnectionRequest } from "../services/collaboration/collaborationService";
import { getConnectionStatus, type ConnectionStatus } from "../types/collaboration";
import { extractGuildTags, type GuildFeedKind, type GuildFeedPost, type GuildPost, type OwnedGuildFeedCursor } from "../types/guild";
import { extractTokens, normalizeParens } from "../utils/wikiLink";
import { createAIRequestId } from "../services/freemium/temisFreemiumService";

type Props = {
  visible: boolean;
  contentPaddingTop: number;
  onOpenMenu: () => void;
};

type GuildView = GuildFeedKind | "mine";
type GuildDisplayPost = GuildFeedPost | GuildPost;
type ConnectionActionState = ConnectionStatus | "loading" | "error";

const FEEDS: { key: GuildView; label: string }[] = [
  { key: "recommended", label: "おすすめ" },
  { key: "recent", label: "新着" },
  { key: "connected", label: "つながり・参加中" },
  { key: "mine", label: "自分の投稿" },
];

const formatDate = (value: number | null) => value ? new Date(value).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }) : "";

const GuildScreenContent = ({ visible, contentPaddingTop, onOpenMenu }: Props) => {
  const { profile, inviteableProjects, status, error, refreshProfile: refresh, projectStatus, projectError, refreshProjects } = useCollaboration();
  const { openMemoDetail } = useAppUI();
  const aiUsage = useTemisAIUsage();
  const [feed, setFeed] = useState<GuildView>("recommended");
  const [search, setSearch] = useState("");
  const [aiQuery, setAIQuery] = useState("");
  const [aiOpen, setAIOpen] = useState(false);
  const [headerBottomY, setHeaderBottomY] = useState(0);
  const [aiSearching, setAISearching] = useState(false);
  const [aiResult, setAIResult] = useState<GuildAISearchResult | null>(null);
  const [aiError, setAIError] = useState<string | null>(null);
  const [showAllAIEvidence, setShowAllAIEvidence] = useState(false);
  const aiRequestRef = useRef(0);
  useEffect(() => {
    aiRequestRef.current += 1;
    setAIResult(null);
    setAIError(null);
    setAISearching(false);
    setShowAllAIEvidence(false);
    setAIOpen(false);
    return () => { aiRequestRef.current += 1; };
  }, [profile?.userId]);
  const [posts, setPosts] = useState<GuildDisplayPost[]>([]);
  const [cursor, setCursor] = useState<{ publishedAt: number; id: string } | OwnedGuildFeedCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<GuildDisplayPost | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionActionState>("loading");
  const tags = useMemo(() => extractGuildTags(search), [search]);
  const detailTokens = useMemo(
    () => extractTokens(selectedPost?.body ?? ""),
    [selectedPost?.body],
  );

  const loadFirst = useCallback(async (refresh = false) => {
    if (!profile) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    if (feed !== "mine") {
      // Public posts must not remain visible when a server refresh cannot
      // confirm that they are still published.
      setPosts([]);
      setCursor(null);
    }
    try {
      const page = feed === "mine"
        ? await listMyGuildPosts()
        : await listGuildPosts({ feed, tags });
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

  useEffect(() => {
    const authorUserId = selectedPost?.authorUserId;
    if (!authorUserId || !profile || authorUserId === profile.userId) {
      setConnectionState("none");
      return;
    }
    let active = true;
    setConnectionState("loading");
    void getConnectionWithUser(authorUserId)
      .then((connection) => {
        if (active) setConnectionState(getConnectionStatus(connection, profile.userId));
      })
      .catch(() => {
        if (active) setConnectionState("error");
      });
    return () => { active = false; };
  }, [profile, selectedPost?.authorUserId]);

  const loadMore = async () => {
    if (!cursor || loadingMore || loading || !profile) return;
    setLoadingMore(true);
    try {
      const page = feed === "mine"
        ? await listMyGuildPosts(cursor as OwnedGuildFeedCursor)
        : await listGuildPosts({ feed, tags, cursor: cursor as { publishedAt: number; id: string } });
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

  const openDetail = async (post: GuildDisplayPost) => {
    const isOwnedPost = post.authorUserId === profile?.userId;
    setSelectedPost(post);
    setDetailLoading(true);
    try {
      const detail = isOwnedPost
        ? await getOwnedGuildPost(post.id)
        : await getGuildPost(post.id);
      if (!detail) throw new Error("この投稿は現在表示できません。");
      setSelectedPost(detail);
      setTitleDraft(detail.title ?? detail.body.split("\n").find(Boolean) ?? "");
      setBodyDraft(detail.body);
      setEditing(false);
    } catch (cause) {
      if (!isOwnedPost) {
        setPosts((current) => current.filter((item) => item.id !== post.id));
      }
      setSelectedPost(null);
      Alert.alert(
        "投稿を開けません",
        isOwnedPost && cause instanceof Error
          ? cause.message
          : "この投稿は現在表示できません。",
      );
    }
    finally { setDetailLoading(false); }
  };

  const updateSelectedPost = (next: GuildPost) => {
    setSelectedPost(next);
    setPosts((current) => current.map((post) => post.id === next.id ? next : post));
  };

  const handleSaveOwnedPost = async () => {
    if (!selectedPost || !("source" in selectedPost) || !profile || saving) return;
    setSaving(true);
    try {
      const updated = await updateOwnedGuildPostAndSource({
        postId: selectedPost.id,
        profile,
        input: { title: titleDraft.trim() || null, body: bodyDraft, type: selectedPost.type, projectId: selectedPost.projectId },
      });
      updateSelectedPost(updated);
      setEditing(false);
    } catch (cause) {
      Alert.alert("更新できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    } finally { setSaving(false); }
  };

  const handleVisibility = async () => {
    if (!selectedPost || !("source" in selectedPost) || !profile || saving) return;
    if (selectedPost.status === "unpublished") {
      Alert.alert("再公開しますか？", "Commons側のタイトルと本文で元メモを上書きしてから再公開します。", [
        { text: "キャンセル", style: "cancel" },
        { text: "再公開する", onPress: () => {
          setSaving(true);
          void republishOwnedGuildPost({ postId: selectedPost.id, profile })
            .then(updateSelectedPost)
            .catch((cause) => Alert.alert("再公開できません", cause instanceof Error ? cause.message : "もう一度お試しください。"))
            .finally(() => setSaving(false));
        } },
      ]);
      return;
    }
    setSaving(true);
    try {
      await setGuildPostStatus(selectedPost.id, "unpublished");
      updateSelectedPost({ ...selectedPost, status: "unpublished", publishedAt: null, updatedAt: Date.now() });
    } catch (cause) {
      Alert.alert("非公開にできません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    } finally { setSaving(false); }
  };

  const handleOpenSourceMemo = async () => {
    if (!selectedPost || !("source" in selectedPost)) return;
    try {
      const sourceId = await resolveGuildSourceMemoId(selectedPost.source.memoId);
      openMemoDetail(sourceId);
      setSelectedPost(null);
    } catch (cause) {
      Alert.alert("元メモを開けません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    }
  };

  const handleConnect = async () => {
    if (!selectedPost || !profile || connecting) return;
    setConnecting(true);
    try {
      await sendConnectionRequest(selectedPost.authorUserId);
      const connection = await getConnectionWithUser(selectedPost.authorUserId);
      const nextState = getConnectionStatus(connection, profile.userId);
      setConnectionState(nextState);
      if (nextState === "connected") Alert.alert("つながりました");
      else Alert.alert("申請を送信しました", "相手が承認するとつながりになります。");
    } catch (cause) {
      Alert.alert("申請できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    } finally {
      setConnecting(false);
    }
  };

  const handleJoin = async () => {
    if (!selectedPost?.projectId || projectStatus !== "ready") return;
    try { await createProjectJoinRequest({ projectId: selectedPost.projectId }); Alert.alert("参加申請を送信しました", "オーナーの承認をお待ちください。"); }
    catch (cause) { Alert.alert("申請できません", cause instanceof Error ? cause.message : "もう一度お試しください。"); }
  };

  const handleScout = async () => {
    if (!selectedPost) return;
    if (!profile || !inviteableProjects.length || projectStatus !== "ready") return;
    Alert.alert("プロジェクトへスカウト", "招待先を選択してください。", [
      ...inviteableProjects.map((project) => ({
        text: project.name,
        onPress: () => {
          void getProjectMember(project.id, profile.userId)
            .then((member) => {
              if (!member) throw new Error("招待権限を確認できません。");
              return inviteToProject(project, member.role, selectedPost.authorUserId);
            })
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

  const handleAISearch = async () => {
    const question = aiQuery.trim();
    if (!question || aiSearching) return;
    const requestId = ++aiRequestRef.current;
    setAISearching(true);
    setAIError(null);
    setAIResult(null);
    setShowAllAIEvidence(false);
    try {
      const result = await searchGuildPostsWithAI(question, createAIRequestId("commons"));
      if (requestId === aiRequestRef.current) setAIResult(result);
    } catch (cause) {
      if (requestId !== aiRequestRef.current) return;
      setAIError(
        cause instanceof Error
          ? cause.message
          : "Temis AIの検索を実行できませんでした。しばらくしてからもう一度お試しください。",
      );
    } finally {
      await aiUsage.refresh().catch(() => undefined);
      if (requestId === aiRequestRef.current) setAISearching(false);
    }
  };

  const openAIEvidence = async (evidence: GuildAIEvidencePost) => {
    setDetailLoading(true);
    try {
      const detail = await getGuildPost(evidence.id);
      if (!detail) throw new Error("この投稿は現在表示できません。");
      setSelectedPost(detail);
      setTitleDraft(detail.title ?? detail.body.split("\n").find(Boolean) ?? "");
      setBodyDraft(detail.body);
      setEditing(false);
    } catch (cause) {
      Alert.alert(
        "投稿を開けません",
        cause instanceof Error ? cause.message : "もう一度お試しください。",
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const citedAIEvidence = useMemo(() => {
    if (!aiResult) return [];
    const cited = new Set(aiResult.citedPostIds);
    return aiResult.evidencePosts.filter((post) => cited.has(post.id));
  }, [aiResult]);
  const visiblePosts = useMemo(() => {
    const term = normalizeParens(search).normalize("NFKC").trim().toLocaleLowerCase();
    if (!term) return posts;
    return posts.filter((post) => normalizeParens(`${post.authorDisplayName} ${post.title ?? ""} ${post.body} ${post.tags.map((tag) => `#${tag}`).join(" ")}`).normalize("NFKC").toLocaleLowerCase().includes(term));
  }, [posts, search]);

  if (!visible) return null;
  if (status === "loading" && !profile) {
    return <View style={[styles.screen, styles.center, { paddingTop: contentPaddingTop }]}><ActivityIndicator color="#2563eb" /></View>;
  }
  if (status === "signed_out") {
    return <View style={[styles.screen, { paddingTop: contentPaddingTop }]}><Text style={styles.signIn}>Commonsを利用するにはアカウントにログインしてください。</Text></View>;
  }
  if (!profile) {
    return <View style={[styles.screen, styles.center, { paddingTop: contentPaddingTop }]}><Text style={styles.error}>{error ?? "プロフィールを読み込めませんでした。"}</Text><Pressable onPress={() => void refresh()}><Text style={styles.retry}>再試行</Text></Pressable></View>;
  }

  return (
    <View style={[styles.screen, { paddingTop: contentPaddingTop }]}> 
      <View style={styles.header} onLayout={(event) => {
        const layout = event.nativeEvent.layout;
        setHeaderBottomY(layout.y + layout.height);
      }}>
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
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.headerTitle}>Commons</Text>
        <View style={styles.headerSideRight}>
          <CommonsRequestsButton key={profile.userId} />
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
      <ScrollView horizontal style={styles.feedTabsViewport} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.feedTabs}>{FEEDS.map((item) => <Pressable key={item.key} style={[styles.feedTab, feed === item.key && styles.feedTabActive]} onPress={() => setFeed(item.key)}><Text style={[styles.feedTabText, feed === item.key && styles.feedTabTextActive]}>{item.label}</Text></Pressable>)}</ScrollView>
      <TextInput value={search} onChangeText={setSearch} style={styles.search} placeholder="投稿・#タグ・((Wikiリンク)) を検索" />
      {loading ? <View style={styles.center}><ActivityIndicator color="#2563eb" /></View> : loadError && !posts.length ? <View style={styles.center}><Text style={styles.error}>{loadError}</Text><Pressable onPress={() => void loadFirst()}><Text style={styles.retry}>再試行</Text></Pressable></View> : <FlatList style={styles.feedList} data={visiblePosts} keyExtractor={(item) => item.id} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadFirst(true)} />} onEndReached={() => void loadMore()} onEndReachedThreshold={0.6} contentContainerStyle={visiblePosts.length ? styles.list : styles.emptyList} renderItem={({ item }) => <Pressable style={styles.card} onPress={() => void openDetail(item)}><View style={styles.cardMeta}><Text style={styles.author}>{item.authorDisplayName}</Text><Text style={styles.date}>{formatDate(item.publishedAt ?? item.updatedAt)}</Text></View>{feed === "mine" ? <Text style={[styles.statusBadge, item.status === "published" ? styles.statusPublished : styles.statusUnpublished]}>{item.status === "published" ? "公開中" : "非公開"}</Text> : null}<Text style={styles.cardTitle} numberOfLines={2}>{item.title?.trim() || item.body.split("\n").find(Boolean) || "無題"}</Text><Text style={styles.body} numberOfLines={5}>{item.body}</Text><View style={styles.tagRow}>{item.tags.map((tag) => <Text key={tag} style={styles.tag}>#{tag}</Text>)}</View>{item.projectId ? <Text style={styles.projectLabel}>関連プロジェクト</Text> : null}</Pressable>} ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{feed === "mine" ? "自分の投稿はまだありません" : tags.length ? "タグに合う投稿がまだありません" : "公開投稿はまだありません"}</Text><Pressable onPress={() => setComposerOpen(true)}><Text style={styles.retry}>最初の投稿を作成</Text></Pressable></View>} ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color="#2563eb" /> : loadError && posts.length ? <Pressable style={styles.footer} onPress={() => void loadMore()}><Text style={styles.retry}>追加読み込みを再試行</Text></Pressable> : null} />}
      <TemisAIDock
        expanded={aiOpen}
        expandedTop={headerBottomY > 0 ? headerBottomY : undefined}
        query={aiQuery}
        placeholder="Commonsの投稿に質問"
        searchLabel={aiSearching ? "検索中" : "検索"}
        searchDisabled={aiSearching}
        onChangeQuery={setAIQuery}
        onSearch={() => void handleAISearch()}
        onToggle={() => setAIOpen((current) => !current)}
        badge={<Pressable disabled={aiUsage.status !== "error"} onPress={() => void aiUsage.refresh()} accessibilityRole="button"><Text style={styles.plusBadge}>{formatTemisAIUsageLabel(aiUsage.usage, aiUsage.status)}{aiUsage.status === "error" ? "・再試行" : ""}</Text></Pressable>}
        inputProps={{ onFocus: () => setAIOpen(true) }}
      >
        {aiSearching ? <Text style={styles.aiHelperText}>根拠を検索中...</Text> : null}
        {aiError ? <Text style={styles.aiError}>{aiError}</Text> : null}
        {aiResult ? <ScrollView style={styles.aiResultScroll} nestedScrollEnabled showsVerticalScrollIndicator>
            <AIAnswerEvidencePanel
              answerTitle="Temis AI"
              answerText={aiResult.answerText}
              citedTitle="参照した根拠"
              allTitle="全根拠"
              showAllLabel="全根拠を表示"
              hideAllLabel="全根拠を閉じる"
              citedEvidence={citedAIEvidence}
              allEvidence={aiResult.evidencePosts}
              showAll={showAllAIEvidence}
              onToggleAll={() => setShowAllAIEvidence((current) => !current)}
              getEvidenceKey={(post) => post.id}
              renderEvidence={(post, options) => <Pressable
                style={[styles.aiEvidenceCard, options.cited ? styles.aiEvidenceCardCited : null]}
                onPress={() => void openAIEvidence(post)}
              >
                <Text style={styles.aiEvidenceTitle} numberOfLines={2}>{post.title?.trim() || post.body.split("\n").find(Boolean) || "無題"}</Text>
                <Text style={styles.aiEvidenceBody} numberOfLines={3}>{post.snippetText ?? post.body}</Text>
                {post.linkPath?.length ? <Text style={styles.aiEvidenceMeta}>{post.linkPath.join(" → ")}経由</Text> : null}
                <Text style={styles.aiEvidenceMeta}>{post.authorDisplayName}・{formatDate(post.publishedAt)}</Text>
              </Pressable>}
            />
          </ScrollView> : null}
      </TemisAIDock>
      <GuildPostComposerModal visible={composerOpen} onClose={() => setComposerOpen(false)} onPublished={(post) => setPosts((current) => [post, ...current])} />
      <Modal visible={selectedPost !== null} animationType="slide" onRequestClose={() => setSelectedPost(null)}>
        <SafeAreaView style={styles.detail}>
          <KeyboardAvoidingView style={styles.detailKeyboard} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.detailHeader}>
            <Pressable style={styles.detailBack} onPress={() => setSelectedPost(null)}><Text style={styles.detailBackText}>‹ 戻る</Text></Pressable>
            <Text style={styles.title}>Note</Text>
            <View style={styles.detailHeaderAction}>{selectedPost?.authorUserId === profile.userId ? <Pressable disabled={saving} onPress={() => editing ? void handleSaveOwnedPost() : setEditing(true)}><Text style={styles.headerActionText}>{editing ? "保存" : "編集"}</Text></Pressable> : null}</View>
          </View>
          {detailLoading ? <ActivityIndicator color="#2563eb" /> : selectedPost ? <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
            <Text style={styles.detailTitle}>{selectedPost.title?.trim() || selectedPost.body.split("\n").find(Boolean) || "無題"}</Text>
            <Text style={styles.date}>{formatDate(selectedPost.publishedAt ?? selectedPost.updatedAt)}</Text>
            <Text style={[styles.scopeBadge, selectedPost.status === "published" ? styles.statusPublished : styles.statusUnpublished]}>Commons・{selectedPost.status === "published" ? "公開" : "非公開"}</Text>
            <Text style={styles.author}>投稿者: {selectedPost.authorDisplayName}</Text>
            {editing ? <>
              <Text style={styles.fieldLabel}>タイトル</Text>
              <TextInput style={styles.detailInput} value={titleDraft} onChangeText={setTitleDraft} />
              <Text style={styles.fieldLabel}>本文</Text>
              <MemoTextEditor
                value={bodyDraft}
                onChangeText={setBodyDraft}
                inputStyle={[styles.detailInput, styles.detailBodyInput]}
              />
            </> : <View style={styles.detailBodySurface}><Text style={styles.detailBody}>{selectedPost.body}</Text></View>}
            <View style={styles.tagRow}>{selectedPost.tags.map((tag) => <Text key={tag} style={styles.tag}>#{tag}</Text>)}</View>
            <View style={styles.wikiSection}>
              <Text style={styles.wikiSectionTitle}>Wikiリンク</Text>
              <TokenChips tokens={detailTokens} />
            </View>
            {selectedPost.authorUserId !== profile.userId ? <View style={styles.actions}>
              {connectionState !== "blocked" ? <Pressable
                style={styles.action}
                onPress={() => void handleConnect()}
                disabled={connecting || !["none", "incoming_pending"].includes(connectionState)}
              ><Text style={styles.actionText}>{connecting
                  ? "送信中..."
                  : connectionState === "loading"
                    ? "つながりを確認中..."
                    : connectionState === "error"
                      ? "つながりを確認できません"
                      : connectionState === "outgoing_pending"
                        ? "申請済み"
                        : connectionState === "connected"
                          ? "つながり済み"
                          : connectionState === "incoming_pending"
                            ? "つながる"
                            : "つながり申請"}</Text></Pressable> : null}
              {selectedPost.projectId && projectStatus !== "ready" ? <View><Text style={styles.error}>{projectError ?? "プロジェクトの利用状態を確認中です。"}</Text>{projectStatus === "error" ? <Pressable onPress={() => void refreshProjects()}><Text style={styles.retry}>再試行</Text></Pressable> : null}</View> : null}
              {selectedPost.projectId ? <Pressable disabled={projectStatus !== "ready"} style={styles.action} onPress={() => void handleJoin()}><Text style={styles.actionText}>参加を申請</Text></Pressable> : null}
              {inviteableProjects.length ? <Pressable style={styles.action} onPress={() => void handleScout()}><Text style={styles.actionText}>プロジェクトへスカウト</Text></Pressable> : null}
              <Pressable style={styles.report} onPress={() => void handleReport()} disabled={reporting}><Text style={styles.reportText}>通報</Text></Pressable>
            </View> : <View style={styles.actions}>
              <Pressable style={styles.action} onPress={() => void handleOpenSourceMemo()}><Text style={styles.actionText}>元メモを見る</Text></Pressable>
              <Pressable style={styles.action} onPress={() => void handleVisibility()} disabled={saving}><Text style={styles.actionText}>{selectedPost.status === "published" ? "非公開にする" : "再公開する"}</Text></Pressable>
            </View>}
          </ScrollView> : <Text style={styles.empty}>この投稿は表示できません。</Text>}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  header: { position: "relative", flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, paddingHorizontal: 16 },
  headerSide: { width: 44, flexDirection: "row", alignItems: "center" },
  headerSideRight: { width: 112, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  headerTitle: { position: "absolute", left: 0, right: 0, color: "#111827", fontSize: 18, fontWeight: "600", textAlign: "center" },
  menuButton: { paddingHorizontal: 6, paddingVertical: 6 },
  newButton: { minHeight: 32, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#fff" },
  newButtonText: { marginLeft: 4, color: "#111827", fontSize: 12, fontWeight: "600" },
  title: { flex: 1, textAlign: "center", color: "#111827", fontSize: 18, fontWeight: "600" }, detailHeaderAction: { width: 64, alignItems: "flex-end" }, headerActionText: { color: "#2563eb", fontWeight: "800", padding: 8 },
  feedTabsViewport: { flexGrow: 0, flexShrink: 0, marginBottom: 9 },
  plusBadge: { color: "#1d4ed8", backgroundColor: "#dbeafe", borderRadius: 999, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: "800" },
  aiError: { color: "#b91c1c", fontSize: 12, lineHeight: 17 },
  aiHelperText: { color: "#6b7280", fontSize: 12 },
  aiResultScroll: { flex: 1, minHeight: 0 },
  aiEvidenceCard: { borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 9, backgroundColor: "#eff6ff", padding: 10, gap: 4 },
  aiEvidenceCardCited: { borderColor: "#60a5fa", backgroundColor: "#dbeafe" },
  aiEvidenceTitle: { color: "#1d4ed8", fontWeight: "800" },
  aiEvidenceBody: { color: "#1f2937", fontSize: 12, lineHeight: 17 },
  aiEvidenceMeta: { color: "#6b7280", fontSize: 11 },
  feedList: { flex: 1 },
  feedTabs: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 8 }, feedTab: { flexShrink: 0, minHeight: 34, justifyContent: "center", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: "#e5e7eb" }, feedTabActive: { backgroundColor: "#dbeafe" }, feedTabText: { color: "#4b5563", fontSize: 12 }, feedTabTextActive: { color: "#1d4ed8", fontWeight: "800" }, search: { flexShrink: 0, marginHorizontal: 16, marginBottom: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, paddingHorizontal: 11, paddingVertical: 9 }, list: { padding: 16, paddingBottom: 132, gap: 10 }, emptyList: { flexGrow: 1, justifyContent: "center", padding: 24, paddingBottom: 132 }, card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14, gap: 8 }, cardMeta: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, cardTitle: { color: "#111827", fontSize: 16, fontWeight: "800" }, author: { fontSize: 14, color: "#111827", fontWeight: "800" }, date: { fontSize: 12, color: "#6b7280" }, statusBadge: { alignSelf: "flex-start", overflow: "hidden", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: "800" }, statusPublished: { color: "#166534", backgroundColor: "#dcfce7" }, statusUnpublished: { color: "#92400e", backgroundColor: "#fef3c7" }, body: { color: "#1f2937", lineHeight: 21, fontSize: 14 }, tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, tag: { color: "#2563eb", fontSize: 12 }, projectLabel: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, color: "#166534", backgroundColor: "#dcfce7", fontSize: 11, fontWeight: "700" }, center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }, signIn: { margin: 24, color: "#4b5563", textAlign: "center" }, empty: { color: "#6b7280", textAlign: "center" }, error: { color: "#b91c1c", textAlign: "center" }, retry: { color: "#2563eb", fontWeight: "700", padding: 8 }, footer: { alignSelf: "center", marginVertical: 14 }, detail: { flex: 1, backgroundColor: "#fff" }, detailKeyboard: { flex: 1 }, detailScroll: { flex: 1 }, detailBack: { width: 64, minHeight: 44, justifyContent: "center" }, detailBackText: { color: "#2563eb", fontSize: 12 }, detailHeader: { flexShrink: 0, minHeight: 44, paddingHorizontal: 16, marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, detailContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 36, gap: 12 }, detailTitle: { color: "#111827", fontSize: 16, fontWeight: "700" }, scopeBadge: { alignSelf: "flex-start", overflow: "hidden", borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, fontWeight: "700" }, fieldLabel: { color: "#6b7280", fontSize: 12, fontWeight: "700" }, detailInput: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: "#111827", fontSize: 16 }, detailBodyInput: { minHeight: 160, fontSize: 14, lineHeight: 20 }, detailBodySurface: { minHeight: 160, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10 }, detailBody: { color: "#111827", fontSize: 14, lineHeight: 20 }, wikiSection: { marginTop: 8, gap: 8 }, wikiSectionTitle: { color: "#6b7280", fontSize: 13, fontWeight: "700" }, actions: { gap: 9 }, action: { borderRadius: 9, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#bfdbfe" }, actionText: { color: "#1d4ed8", fontWeight: "700", textAlign: "center" }, report: { alignSelf: "flex-start", paddingVertical: 10 }, reportText: { color: "#b91c1c", fontWeight: "700" },
});

const GuildScreen = (props: Props) => {
  const { profile } = useCollaboration();
  // Feed, private post drafts and detail state belong to one account only.
  return <GuildScreenContent key={profile?.userId ?? "signed-out"} {...props} />;
};

export default GuildScreen;
