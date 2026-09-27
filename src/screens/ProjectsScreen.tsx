import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useCollaboration } from "../context/CollaborationContext";
import ProjectCreateModal from "../components/project/ProjectCreateModal";
import {
  getProjectMember,
  inviteToProject,
  listMyPendingInvitations,
  listProjectMembers,
  listProjectSharedNotes,
  listProjectTasks,
  respondToProjectInvitation,
  searchProfiles,
  setProjectTaskEnabled,
  setProjectGuildVisibility,
} from "../services/collaboration/collaborationService";
import { listProjectJoinRequests, respondToProjectJoinRequest } from "../services/guild/guildService";
import type {
  Project,
  ProjectMember,
  ProjectSharedNote,
  ProjectTask,
  ProjectInvitation,
  UserProfile,
} from "../types/collaboration";
import type { ProjectJoinRequest } from "../types/guild";

type Props = {
  visible: boolean;
  contentPaddingTop: number;
  onOpenMenu: () => void;
  activeProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
};

const ProjectsScreen = ({
  visible,
  contentPaddingTop,
  onOpenMenu,
  activeProjectId,
  onSelectProject,
}: Props) => {
  const {
    profile,
    projects,
    projectStatus: status,
    projectError: error,
    refresh,
    saveUsername,
    projectAccess,
    overflowProjects,
    resolveOverflow,
  } = useCollaboration();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [notes, setNotes] = useState<ProjectSharedNote[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [myRole, setMyRole] = useState<ProjectMember["role"] | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteResults, setInviteResults] = useState<UserProfile[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<ProjectInvitation[]>([]);
  const [inviting, setInviting] = useState(false);
  const [joinRequests, setJoinRequests] = useState<ProjectJoinRequest[]>([]);
  const [keepProjectId, setKeepProjectId] = useState<string | null>(null);
  const [ownerResolution, setOwnerResolution] = useState<Record<string, string>>( {} );
  const [resolvingOverflow, setResolvingOverflow] = useState(false);

  useEffect(() => {
    if (projectAccess?.status !== "selection_required") {
      setKeepProjectId(null);
      setOwnerResolution({});
    }
  }, [projectAccess?.status]);

  const handleResolveOverflow = async () => {
    if (!keepProjectId || resolvingOverflow) return;
    const resolutions = overflowProjects
      .filter((item) => item.project.id !== keepProjectId)
      .map((item) => {
        if (item.role !== "owner") return { projectId: item.project.id, action: "leave" as const };
        const choice = ownerResolution[item.project.id];
        if (choice === "delete") return { projectId: item.project.id, action: "delete" as const };
        return { projectId: item.project.id, action: "transfer" as const, transferToUserId: choice };
      });
    const unresolvedOwner = overflowProjects.some((item) =>
      item.project.id !== keepProjectId && item.role === "owner" && !ownerResolution[item.project.id]);
    if (unresolvedOwner) {
      Alert.alert("移譲先を選択してください", "所有中のプロジェクトは、メンバーへ移譲するか削除する必要があります。");
      return;
    }
    Alert.alert(
      "無料枠をこの1件に整理しますか？",
      "退出するプロジェクトの共有メモ・共有タスクは削除せず、作成者を「匿名ユーザー」にして残します。本文とタイトル自体はそのまま残り、元アカウントとの紐付けと編集権限は失われます。この処理は元に戻せません。",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "整理する",
          style: "destructive",
          onPress: () => {
            setResolvingOverflow(true);
            void resolveOverflow(keepProjectId, resolutions)
              .then(() => Alert.alert("無料枠の整理が完了しました"))
              .catch((cause) => Alert.alert("整理を完了できません", cause instanceof Error ? cause.message : "もう一度お試しください。"))
              .finally(() => setResolvingOverflow(false));
          },
        },
      ],
    );
  };

  const loadProject = useCallback(
    async (project: Project) => {
      setSelected(project);
      onSelectProject(project.id);
      try {
        const [nextMembers, nextNotes, nextTasks, membership] =
          await Promise.all([
            listProjectMembers(project.id),
            listProjectSharedNotes(project.id),
            listProjectTasks(project.id),
            profile
              ? getProjectMember(project.id, profile.userId)
              : Promise.resolve(null),
          ]);
        setMembers(nextMembers);
        setNotes(nextNotes);
        setTasks(nextTasks);
        setMyRole(membership?.role ?? null);
        setJoinRequests(membership?.role === "owner" ? await listProjectJoinRequests(project.id) : []);
      } catch (cause) {
        Alert.alert(
          "プロジェクトを開けません",
          cause instanceof Error ? cause.message : "読み込みに失敗しました。",
        );
      }
    },
    [onSelectProject, profile],
  );

  useEffect(() => {
    if (visible) void refresh();
  }, [refresh, visible]);

  const refreshInvitations = useCallback(async () => {
    try {
      setPendingInvitations(await listMyPendingInvitations());
    } catch {
      setPendingInvitations([]);
    }
  }, []);

  useEffect(() => {
    if (visible) void refreshInvitations();
  }, [refreshInvitations, visible]);

  useEffect(() => {
    setUsernameDraft(profile?.username ?? "");
  }, [profile?.username]);

  useEffect(() => {
    if (activeProjectId || !selected) return;
    setSelected(null);
  }, [activeProjectId, selected]);

  const handleSaveUsername = async () => {
    try {
      await saveUsername(usernameDraft);
      Alert.alert("ユーザーIDを保存しました");
    } catch (cause) {
      Alert.alert(
        "ユーザーIDを変更できません",
        cause instanceof Error ? cause.message : "もう一度お試しください。",
      );
    }
  };

  const toggleTasks = async () => {
    if (!selected) return;
    try {
      await setProjectTaskEnabled(selected.id, !selected.taskEnabled);
      const next = { ...selected, taskEnabled: !selected.taskEnabled };
      setSelected(next);
      if (next.taskEnabled) setTasks(await listProjectTasks(next.id));
    } catch (cause) {
      Alert.alert(
        "変更できません",
        cause instanceof Error ? cause.message : "設定を変更できませんでした。",
      );
    }
  };

  const handleSearchInvitee = async () => {
    try {
      setInviteResults(await searchProfiles(inviteQuery));
    } catch (cause) {
      Alert.alert("検索できません", cause instanceof Error ? cause.message : "ユーザー検索に失敗しました。");
    }
  };

  const handleInvite = async (invitee: UserProfile) => {
    if (!selected || !myRole) return;
    try {
      setInviting(true);
      await inviteToProject(selected, myRole, invitee.userId);
      setInviteQuery("");
      setInviteResults([]);
      Alert.alert("招待を送りました", `@${invitee.username} にプロジェクト招待を送りました。`);
    } catch (cause) {
      Alert.alert("招待できません", cause instanceof Error ? cause.message : "プロジェクト招待に失敗しました。");
    } finally {
      setInviting(false);
    }
  };

  const handleProjectVisibility = async (isPublic: boolean) => {
    if (!selected) return;
    try {
      const updated = await setProjectGuildVisibility(selected.id, isPublic);
      setSelected(updated);
      await refresh();
    } catch (cause) { Alert.alert("公開設定を変更できません", cause instanceof Error ? cause.message : "もう一度お試しください。"); }
  };

  const handleJoinRequest = async (request: ProjectJoinRequest, accept: boolean) => {
    try {
      await respondToProjectJoinRequest(request.id, accept);
      setJoinRequests((current) => current.map((item) => item.id === request.id ? { ...item, status: accept ? "accepted" : "declined" } : item));
      if (selected) await loadProject(selected);
    } catch (cause) { Alert.alert("参加申請を処理できません", cause instanceof Error ? cause.message : "もう一度お試しください。"); }
  };

  const handleInvitationResponse = async (invitation: ProjectInvitation, accept: boolean) => {
    try {
      await respondToProjectInvitation(invitation.id, accept);
      await Promise.all([refresh(), refreshInvitations()]);
      Alert.alert(accept ? "プロジェクトに参加しました" : "招待を辞退しました");
    } catch (cause) {
      Alert.alert("招待に応答できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    }
  };

  if (!visible) return null;

  if (selected && activeProjectId === selected.id) {
    return (
      <View style={[styles.container, { paddingTop: contentPaddingTop }]}>
        <View style={styles.header}>
          <View style={styles.headerSide}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="プロジェクト一覧へ戻る"
              style={styles.menuButton}
              onPress={() => setSelected(null)}
            >
              <Ionicons name="chevron-back" size={22} color="#111827" />
            </Pressable>
          </View>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {selected.name}
          </Text>
          <View style={styles.headerSide} />
        </View>

        <ScrollView
          contentContainerStyle={styles.detailContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.projectOverview}>
            <View style={styles.projectIcon}>
              <Text style={styles.projectIconText}>{selected.icon ?? "■"}</Text>
            </View>
            <View style={styles.projectOverviewText}>
              <Text style={styles.projectName}>{selected.name}</Text>
              <Text style={styles.caption}>
                {selected.description || "説明はありません"}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>メンバー</Text>
          <View style={styles.surfaceRow}>
            <View>
              <Text style={styles.rowTitle}>{members.length} 人が参加中</Text>
              <Text style={styles.caption}>
                {members.map((member) => member.role).join(" · ") || "メンバー情報を読み込み中"}
              </Text>
            </View>
            <Ionicons name="people-outline" size={20} color="#6b7280" />
          </View>

          {myRole === "owner" || myRole === "member" ? (
            <>
              <Text style={styles.sectionTitle}>ユーザーを招待</Text>
              <View style={styles.inviteSurface}>
                <View style={styles.profileRow}>
                  <TextInput
                    style={styles.usernameInput}
                    value={inviteQuery}
                    onChangeText={setInviteQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="ユーザーIDで検索"
                  />
                  <Pressable style={styles.saveButton} onPress={() => void handleSearchInvitee()}>
                    <Text style={styles.saveButtonText}>検索</Text>
                  </Pressable>
                </View>
                {inviteResults.map((user) => (
                  <View key={user.userId} style={styles.inviteeRow}>
                    <View style={styles.rowBodyNoMargin}>
                      <Text style={styles.rowTitle}>{user.displayName || `@${user.username}`}</Text>
                      <Text style={styles.caption}>@{user.username}</Text>
                    </View>
                    <Pressable
                      disabled={inviting || user.userId === profile?.userId}
                      style={styles.inviteButton}
                      onPress={() => void handleInvite(user)}
                    >
                      <Text style={styles.inviteButtonText}>招待</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {myRole === "owner" ? (
            <>
              <Text style={styles.sectionTitle}>Commons公開</Text>
              <View style={styles.surfaceRow}>
                <View style={styles.visibilityCopy}><Text style={styles.rowTitle}>{selected.visibility === "public" ? "公開・承認制" : "非公開"}</Text><Text style={styles.caption}>公開しても、メモ・タスク・メンバー一覧はCommonsには公開されません。</Text></View>
                <Pressable style={[styles.inviteButton, styles.visibilityButton]} onPress={() => void handleProjectVisibility(selected.visibility !== "public")}><Text numberOfLines={1} style={styles.inviteButtonText}>{selected.visibility === "public" ? "非公開にする" : "公開する"}</Text></Pressable>
              </View>
              {joinRequests.filter((request) => request.status === "pending").length > 0 ? <>
                <Text style={styles.sectionTitle}>参加申請</Text>
                {joinRequests.filter((request) => request.status === "pending").map((request) => <View key={request.id} style={styles.invitationRow}><View style={styles.rowBodyNoMargin}><Text style={styles.rowTitle}>参加希望: {request.requestedRole}</Text><Text style={styles.caption}>{request.message || "メッセージなし"}</Text></View><Pressable style={styles.declineButton} onPress={() => void handleJoinRequest(request, false)}><Text style={styles.declineButtonText}>却下</Text></Pressable><Pressable style={styles.inviteButton} onPress={() => void handleJoinRequest(request, true)}><Text style={styles.inviteButtonText}>承認</Text></Pressable></View>)}
              </> : null}
            </>
          ) : null}

          <Text style={styles.sectionTitle}>メモ</Text>
          {notes.length === 0 ? (
            <View style={styles.emptySurface}>
              <Ionicons name="document-text-outline" size={21} color="#9ca3af" />
              <Text style={styles.emptyText}>
                このプロジェクトには共有メモがありません。
              </Text>
            </View>
          ) : (
            notes.map((note) => (
              <View key={note.id} style={styles.listRow}>
                <Ionicons name="document-text-outline" size={20} color="#6b7280" />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{note.title || "無題"}</Text>
                  <Text numberOfLines={2} style={styles.caption}>
                    {note.body}
                  </Text>
                </View>
              </View>
            ))
          )}

          <View style={styles.taskSectionHeader}>
            <Text style={styles.sectionTitle}>共有タスク</Text>
            {myRole === "owner" ? (
              <Pressable style={styles.textAction} onPress={() => void toggleTasks()}>
                <Text style={styles.textActionLabel}>
                  {selected.taskEnabled ? "OFFにする" : "ONにする"}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {!selected.taskEnabled ? (
            <View style={styles.emptySurface}>
              <Ionicons name="checkmark-circle-outline" size={21} color="#9ca3af" />
              <Text style={styles.emptyText}>共有タスクはOFFです。</Text>
            </View>
          ) : tasks.length === 0 ? (
            <View style={styles.emptySurface}>
              <Ionicons name="checkmark-circle-outline" size={21} color="#9ca3af" />
              <Text style={styles.emptyText}>共有タスクはまだありません。</Text>
            </View>
          ) : (
            tasks.map((task) => (
              <View key={task.id} style={styles.listRow}>
                <Ionicons name="ellipse-outline" size={20} color="#6b7280" />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{task.title}</Text>
                  <Text style={styles.caption}>{task.status}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: contentPaddingTop }]}>
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
        <Text style={styles.headerTitle}>プロジェクト</Text>
        <View style={styles.headerSideRight}>
          <Pressable
            style={styles.addButton}
            onPress={() => setCreating(true)}
            disabled={status !== "ready" || projectAccess?.status === "selection_required"}
          >
            <Ionicons name="add" size={18} color="#111827" />
            <Text style={styles.addButtonText}>作成</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={projects}
        keyExtractor={(project) => project.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={status === "loading"}
            onRefresh={() => void refresh()}
          />
        }
        ListHeaderComponent={
          <>
            {status === "loading" ? <ActivityIndicator style={styles.loading} /> : null}
            {status === "signed_out" ? (
              <View style={styles.emptySurface}>
                <Text style={styles.emptyText}>
                  GoogleまたはAppleでログインすると、つながりとプロジェクトを利用できます。
                </Text>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {projectAccess?.status === "selection_required" ? (
              <View style={styles.overflowSurface}>
                <Text style={styles.overflowTitle}>無料で利用する1件を選択</Text>
                <Text style={styles.caption}>
                  残さないプロジェクトからは退出します。本人作成の共有メモ・共有タスクは削除されず「匿名ユーザー」のコンテンツとして残ります。本文とタイトルに自分で書いた氏名などは自動で消去されません。
                </Text>
                {overflowProjects.map((item) => {
                  const selectedToKeep = keepProjectId === item.project.id;
                  const exits = keepProjectId != null && !selectedToKeep;
                  return (
                    <View key={item.project.id} style={styles.overflowProject}>
                      <Pressable style={styles.overflowKeepRow} onPress={() => setKeepProjectId(item.project.id)}>
                        <Ionicons name={selectedToKeep ? "radio-button-on" : "radio-button-off"} size={20} color="#111827" />
                        <View style={styles.rowBody}>
                          <Text style={styles.rowTitle}>{item.project.name}</Text>
                          <Text style={styles.caption}>
                            匿名化対象: 共有メモ {item.ownedNoteCount}件・共有タスク {item.ownedTaskCount}件
                          </Text>
                        </View>
                      </Pressable>
                      {exits && item.role === "owner" ? (
                        <View style={styles.ownerChoice}>
                          <Text style={styles.caption}>所有権の移譲先、またはプロジェクト削除を選択</Text>
                          {item.transferCandidates.map((candidate) => (
                            <Pressable key={candidate.userId} style={styles.choiceButton} onPress={() => setOwnerResolution((current) => ({ ...current, [item.project.id]: candidate.userId }))}>
                              <Text style={styles.choiceText}>{ownerResolution[item.project.id] === candidate.userId ? "✓ " : ""}{candidate.label}へ移譲</Text>
                            </Pressable>
                          ))}
                          <Pressable style={styles.deleteChoiceButton} onPress={() => setOwnerResolution((current) => ({ ...current, [item.project.id]: "delete" }))}>
                            <Text style={styles.deleteChoiceText}>{ownerResolution[item.project.id] === "delete" ? "✓ " : ""}プロジェクトを削除</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                <Pressable style={[styles.resolveButton, (!keepProjectId || resolvingOverflow) && styles.disabledButton]} disabled={!keepProjectId || resolvingOverflow} onPress={() => void handleResolveOverflow()}>
                  <Text style={styles.resolveButtonText}>{resolvingOverflow ? "整理中…" : "選択した1件に整理する"}</Text>
                </Pressable>
              </View>
            ) : null}
            {profile ? (
              <View style={styles.profileSurface}>
                <Text style={styles.profileLabel}>あなたの公開ユーザーID</Text>
                <View style={styles.profileRow}>
                  <TextInput
                    style={styles.usernameInput}
                    value={usernameDraft}
                    onChangeText={setUsernameDraft}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="公開ユーザーID"
                  />
                  <Pressable style={styles.saveButton} onPress={() => void handleSaveUsername()}>
                    <Text style={styles.saveButtonText}>保存</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {pendingInvitations.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>プロジェクトへの招待</Text>
                {pendingInvitations.map((invitation) => (
                  <View key={invitation.id} style={styles.invitationRow}>
                    <View style={styles.rowBodyNoMargin}>
                      <Text style={styles.rowTitle}>プロジェクトに招待されています</Text>
                      <Text style={styles.caption}>参加ロール: {invitation.role}</Text>
                    </View>
                    <Pressable style={styles.declineButton} onPress={() => void handleInvitationResponse(invitation, false)}>
                      <Text style={styles.declineButtonText}>辞退</Text>
                    </Pressable>
                    <Pressable style={styles.inviteButton} onPress={() => void handleInvitationResponse(invitation, true)}>
                      <Text style={styles.inviteButtonText}>参加</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}
            <Text style={styles.sectionTitle}>プロジェクトを選択</Text>
          </>
        }
        ListEmptyComponent={
          status === "ready" ? (
            <View style={styles.emptySurface}>
              <Ionicons name="folder-open-outline" size={21} color="#9ca3af" />
              <Text style={styles.emptyText}>参加中のプロジェクトはありません。右上の作成から始められます。</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name} のルームを開く`}
            style={styles.projectRow}
            onPress={() => void loadProject(item)}
          >
            <View style={styles.projectIcon}>
              <Text style={styles.projectIconText}>{item.icon ?? "■"}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text numberOfLines={1} style={styles.caption}>
                {item.description || "説明はありません"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </Pressable>
        )}
      />

      <ProjectCreateModal
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(project) => {
          setCreating(false);
          void loadProject(project);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  headerSide: { width: 120, flexDirection: "row", alignItems: "center" },
  headerSideRight: {
    width: 120,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  menuButton: { paddingHorizontal: 6, paddingVertical: 6 },
  addButton: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#ffffff",
  },
  addButtonText: { marginLeft: 4, fontSize: 12, fontWeight: "600", color: "#111827" },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  detailContent: { paddingHorizontal: 16, paddingBottom: 28 },
  loading: { marginVertical: 8 },
  overflowSurface: { borderWidth: 1, borderColor: "#f59e0b", backgroundColor: "#fffbeb", borderRadius: 12, padding: 14, marginBottom: 12 },
  overflowTitle: { color: "#92400e", fontSize: 16, fontWeight: "700" },
  overflowProject: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#f59e0b", paddingTop: 10 },
  overflowKeepRow: { flexDirection: "row", alignItems: "center" },
  ownerChoice: { marginLeft: 32, gap: 6 },
  choiceButton: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#ffffff" },
  choiceText: { color: "#374151", fontSize: 12, fontWeight: "600" },
  deleteChoiceButton: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#fca5a5", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#fff1f2" },
  deleteChoiceText: { color: "#b91c1c", fontSize: 12, fontWeight: "600" },
  resolveButton: { marginTop: 14, borderRadius: 9, paddingVertical: 11, alignItems: "center", backgroundColor: "#111827" },
  resolveButtonText: { color: "#ffffff", fontSize: 13, fontWeight: "700" },
  disabledButton: { opacity: 0.45 },
  projectOverview: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
  },
  projectOverviewText: { flex: 1, marginLeft: 12 },
  projectIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  projectIconText: { color: "#374151", fontSize: 14 },
  projectName: { color: "#111827", fontSize: 16, fontWeight: "700" },
  sectionTitle: { marginTop: 20, marginBottom: 8, color: "#111827", fontSize: 14, fontWeight: "600" },
  taskSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  projectRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 12,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  surfaceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
  },
  visibilityCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  visibilityButton: { flexShrink: 0 },
  rowBody: { flex: 1, marginLeft: 12 },
  rowBodyNoMargin: { flex: 1 },
  rowTitle: { color: "#111827", fontSize: 15, fontWeight: "600" },
  caption: { marginTop: 3, color: "#6b7280", fontSize: 13 },
  emptySurface: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 13,
  },
  emptyText: { flex: 1, color: "#6b7280", fontSize: 13 },
  profileSurface: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    marginBottom: 2,
  },
  inviteSurface: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, padding: 12 },
  inviteeRow: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e7eb", marginTop: 10, paddingTop: 10 },
  invitationRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, padding: 12, gap: 8 },
  inviteButton: { borderRadius: 8, backgroundColor: "#111827", paddingHorizontal: 10, paddingVertical: 8 },
  inviteButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  declineButton: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  declineButtonText: { color: "#4b5563", fontSize: 12, fontWeight: "600" },
  profileLabel: { marginBottom: 8, color: "#374151", fontSize: 13, fontWeight: "600" },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  usernameInput: {
    flex: 1,
    minHeight: 36,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: "#111827",
  },
  saveButton: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 },
  saveButtonText: { color: "#111827", fontSize: 12, fontWeight: "600" },
  textAction: { paddingHorizontal: 4, paddingVertical: 6, marginTop: 12 },
  textActionLabel: { color: "#2563eb", fontSize: 12, fontWeight: "600" },
  error: { marginTop: 4, color: "#b91c1c", fontSize: 13 },
  modalBackdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.35)" },
  modal: { borderRadius: 14, backgroundColor: "#ffffff", padding: 20 },
  modalTitle: { color: "#111827", fontSize: 18, fontWeight: "700" },
  input: { marginTop: 12, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 11 },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 18, marginTop: 18 },
  cancelText: { color: "#2563eb", fontWeight: "600" },
  createButton: { borderRadius: 8, backgroundColor: "#111827", paddingHorizontal: 14, paddingVertical: 9 },
  createButtonText: { color: "#ffffff", fontWeight: "700" },
});

export default ProjectsScreen;
