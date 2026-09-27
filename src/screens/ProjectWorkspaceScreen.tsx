import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import TokenChips from "../components/TokenChips";
import AIAnswerEvidencePanel from "../components/ai/AIAnswerEvidencePanel";
import TemisAIDock from "../components/ai/TemisAIDock";
import SwipeableRow from "../components/common/SwipeableRow";
import MemoEditorFields from "../components/memo/MemoEditorFields";
import MemoListCard from "../components/memo/MemoListCard";
import { getFreeNoteById, setNoteScope, upsertFreeNote, upsertNoteRecord } from "../db/noteRepo";
import { useCollaboration } from "../context/CollaborationContext";
import { useAppUI } from "../context/AppUIContext";
import { useAppSettings } from "../context/AppSettingsContext";
import { formatTemisAIUsageLabel, useTemisAIUsage } from "../context/TemisAIUsageContext";
import { useAI } from "../hooks/useAI";
import {
  createProjectTask,
  deleteProjectTask,
  listProjectCreatorProfiles,
  listProjectSharedNotes,
  listProjectTasks,
  removeProjectSharedNote,
  updateProjectTask,
  upsertProjectSharedNote,
} from "../services/collaboration/collaborationService";
import { syncProjectTaskMemo } from "../services/collaboration/projectTaskMemoService";
import type {
  ProjectSharedNote,
  ProjectTask,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from "../types/collaboration";
import { SLOT_KEYS, SLOT_LABELS, type AIEvidence, type SlotKey } from "../types";
import { getSlotForTime } from "../hooks/tasks/taskUtils";
import { getProjectTaskPrivateDate, getProjectTaskPrivateSlot, toLocalDateString } from "../utils/projectTaskPlacement";
import { extractTokens } from "../utils/wikiLink";
import {
  projectNoteIdFromEvidence,
  searchProjectMemoAIContext,
  type ProjectMemoSearchScope,
} from "../services/collaboration/projectMemoAIRetrieval";

type ProjectWorkspaceTab = "tasks" | "todo" | "memos";
type ComposerKind = ProjectWorkspaceTab | null;

const TAB_CONFIG: Record<
  ProjectWorkspaceTab,
  { title: string; empty: string; icon: keyof typeof Ionicons.glyphMap; taskKind?: "task" | "todo" }
> = {
  tasks: { title: "タスク", empty: "共有タスクはまだありません。", icon: "checkmark-circle-outline", taskKind: "task" },
  todo: { title: "ToDo", empty: "プロジェクトの ToDo はまだありません。", icon: "list-outline", taskKind: "todo" },
  memos: { title: "Memo", empty: "共有メモはまだありません。", icon: "document-text-outline" },
};

type ProjectMemoEvidence = AIEvidence & { evidenceId: string };

const STATUS_LABEL: Record<ProjectTaskStatus, string> = {
  todo: "未着手",
  in_progress: "進行中",
  paused: "一時停止",
  completed: "完了",
};
const TASK_PALETTE: Record<ProjectTaskStatus, { bar: string; badgeBackground: string; badgeText: string }> = {
  todo: { bar: "#9ca3af", badgeBackground: "#f3f4f6", badgeText: "#374151" },
  in_progress: { bar: "#2563eb", badgeBackground: "#dbeafe", badgeText: "#1e40af" },
  paused: { bar: "#f59e0b", badgeBackground: "#fef3c7", badgeText: "#92400e" },
  completed: { bar: "#16a34a", badgeBackground: "#dcfce7", badgeText: "#166534" },
};

const parseDueAt = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) throw new Error("期限は YYYY-MM-DD 形式で入力してください。");
  const timestamp = new Date(`${trimmed}T00:00:00`).getTime();
  if (Number.isNaN(timestamp)) throw new Error("期限の日付を確認してください。");
  return timestamp;
};

const taskUpdate = (
  task: ProjectTask,
  changes: Partial<Parameters<typeof updateProjectTask>[1]>,
): Parameters<typeof updateProjectTask>[1] => ({
  title: task.title,
  description: task.description ?? null,
  status: task.status,
  tags: task.tags ?? [],
  estimateMinutes: task.estimateMinutes ?? 25,
  isArchived: task.isArchived ?? false,
  priority: task.priority ?? null,
  dueAt: task.dueAt ?? null,
  privateDate: task.privateDate ?? null,
  privateSlotKey: task.privateSlotKey ?? null,
  assigneeUserId: task.assigneeUserId ?? null,
  relatedMemoId: task.relatedMemoId ?? null,
  ...changes,
});

const ProjectTaskRow = ({
  task,
  selecting,
  selected,
  onOpen,
  onToggleSelected,
  onStatus,
  onArchive,
  onRestore,
  onDelete,
  canDelete,
  creatorLabel,
  isSwipeOpen,
  onOpenSwipe,
  onCloseSwipe,
}: {
  task: ProjectTask;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelected: () => void;
  onStatus: (status: ProjectTaskStatus) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  canDelete: boolean;
  creatorLabel: string;
  isSwipeOpen: boolean;
  onOpenSwipe: () => void;
  onCloseSwipe: () => void;
}) => {
  const tagLabel = task.tags?.length ? task.tags.join(" · ") : "タグなし";
  const palette = TASK_PALETTE[task.status];
  const completed = task.status === "completed" && !task.isArchived;

  return (
    <SwipeableRow
      styles={styles}
      actions={task.isArchived
        ? canDelete ? [{ label: "消去", onPress: onDelete, style: styles.swipeDeleteButton }] : []
        : [
            { label: "アーカイブ", onPress: onArchive, style: styles.swipeArchiveButton },
            ...(canDelete ? [{ label: "消去", onPress: onDelete, style: styles.swipeDeleteButton }] : []),
          ]}
      enabled={!selecting}
      isOpen={isSwipeOpen}
      onOpen={onOpenSwipe}
      onClose={onCloseSwipe}
      maxSwipe={task.isArchived ? canDelete ? 86 : 0 : canDelete ? 172 : 86}
      revealOnLeft
      swipeActivationDistance={6}
      swipeOpenThreshold={0.2}
      swipeVelocityThreshold={0.22}
      swipeHorizontalDominanceRatio={0.6}
      swipeMaxVerticalDrift={40}
    >
    <View style={[styles.projectTaskItem, task.isArchived && styles.archivedTaskRow]}>
      {completed ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${task.title}を編集`} style={styles.projectCompletedTaskRow} onPress={onOpen}>
          <View style={[styles.projectTaskStatusBar, { backgroundColor: palette.bar }]} />
          <View style={styles.projectCompletedTaskBody}>
            <Text style={styles.projectCompletedTaskTitle}>{task.title || "無題のタスク"}</Text>
            <Text style={styles.projectCompletedTaskMeta}>作成者: {creatorLabel}</Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.projectActiveTaskRow}>
          <View style={[styles.projectTaskStatusBar, { backgroundColor: palette.bar }]} />
          <View style={styles.projectTaskHeaderBody}>
            {selecting ? <Pressable style={styles.projectTaskCheckbox} onPress={onToggleSelected}><Text style={styles.projectTaskCheckboxText}>{selected ? "[x]" : "[ ]"}</Text></Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={selecting ? `${task.title}を選択` : `${task.title}を編集`} style={styles.projectTaskHeaderPressable} onPress={selecting ? onToggleSelected : onOpen}>
              <View style={styles.projectTaskHeaderContent}>
                <Text style={styles.projectTaskHeaderTitle}>{task.title || "無題のタスク"}</Text>
                <Text numberOfLines={1} style={styles.projectTaskHeaderMeta}>{tagLabel}</Text>
                <Text numberOfLines={1} style={styles.projectTaskCreator}>作成者: {creatorLabel}</Text>
                {task.description ? <Text numberOfLines={1} style={styles.projectTaskDescription}>{task.description}</Text> : null}
              </View>
            </Pressable>
            <View style={[styles.projectTaskStatusBadge, { backgroundColor: palette.badgeBackground }]}><Text style={[styles.projectTaskStatusBadgeText, { color: palette.badgeText }]}>{STATUS_LABEL[task.status]}</Text></View>
            <View style={styles.projectTaskActions}>
              {task.isArchived ? <Pressable style={styles.secondaryAction} onPress={onRestore}><Text style={styles.secondaryActionText}>復元</Text></Pressable> : task.status === "in_progress" ? <><Pressable style={styles.inlineAction} onPress={() => onStatus("paused")}><Text style={styles.inlineActionText}>中断</Text></Pressable><Pressable style={styles.inlineAction} onPress={() => onStatus("completed")}><Text style={styles.inlineActionText}>完了</Text></Pressable></> : <Pressable style={styles.projectStartButton} onPress={() => onStatus("in_progress")}><Text style={styles.projectStartButtonText}>開始</Text></Pressable>}
            </View>
          </View>
        </View>
      )}
    </View>
    </SwipeableRow>
  );
};

const ProjectWorkspaceScreen = ({
  active,
  tab,
  contentPaddingTop,
}: {
  active: boolean;
  tab: ProjectWorkspaceTab;
  contentPaddingTop: number;
}) => {
  const { profile, projects, overflowProjects } = useCollaboration();
  const { addTag, tagOptions, timeBoxSchedule } = useAppSettings();
  const { activeProjectId, openMenu, openProjects, openMemoDetail } = useAppUI();
  const [notes, setNotes] = useState<ProjectSharedNote[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerKind>(null);
  const [editingNote, setEditingNote] = useState<ProjectSharedNote | null>(null);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<ProjectTaskStatus>("todo");
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [estimateDraft, setEstimateDraft] = useState("25");
  const [priorityDraft, setPriorityDraft] = useState<ProjectTaskPriority | null>(null);
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [privateDateDraft, setPrivateDateDraft] = useState("");
  const [privateSlotKeyDraft, setPrivateSlotKeyDraft] = useState<SlotKey>("morning");
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [newTagDraft, setNewTagDraft] = useState("");
  const [addingTagSaving, setAddingTagSaving] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [openSwipeTaskId, setOpenSwipeTaskId] = useState<string | null>(null);
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [memoQuery, setMemoQuery] = useState("");
  const [memoAIExpanded, setMemoAIExpanded] = useState(false);
  const [memoAIScope, setMemoAIScope] = useState<ProjectMemoSearchScope>("project");
  const [memoHeaderBottomY, setMemoHeaderBottomY] = useState(0);
  const aiUsage = useTemisAIUsage();

  const project = useMemo(
    () => projects.find((item) => item.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const myRole = useMemo(
    () => overflowProjects.find((item) => item.project.id === activeProjectId)?.role ?? null,
    [activeProjectId, overflowProjects],
  );
  const config = TAB_CONFIG[tab];
  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const memoTokens = useMemo(() => extractTokens(bodyDraft), [bodyDraft]);
  const activeTasks = useMemo(() => tasks.filter((task) => !task.isArchived && task.status !== "completed"), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => !task.isArchived && task.status === "completed"), [tasks]);
  const archivedTasks = useMemo(() => tasks.filter((task) => task.isArchived), [tasks]);
  const canCreateMemo = myRole === "owner" || myRole === "member";
  const canEditNote = useCallback((note: ProjectSharedNote | null | undefined) => {
    if (!note) return canCreateMemo;
    const anonymous = note.anonymizedReason === "project_exit" || note.ownerUserId == null;
    return anonymous ? myRole === "owner" : note.ownerUserId === profile?.userId;
  }, [canCreateMemo, myRole, profile?.userId]);
  const retrieveProjectMemoEvidence = useCallback(
    async (question: string) => project
      ? searchProjectMemoAIContext(question, project.id, notes, memoAIScope)
      : [],
    [memoAIScope, notes, project],
  );
  const {
    query: memoAIQuery,
    setQuery: setMemoAIQuery,
    searched: memoAISearched,
    searchLoading: memoAISearchLoading,
    answerLoading: memoAIAnswerLoading,
    answerText: memoAIAnswerText,
    error: memoAIError,
    allEvidence: memoAIEvidence,
    citedEvidenceKeys: memoAICitedEvidenceKeys,
    showAllEvidence: memoAIShowAllEvidence,
    setShowAllEvidence: setMemoAIShowAllEvidence,
    run: runMemoAISearch,
    reset: resetMemoAI,
  } = useAI({
    searchError: "関連するメモを検索できませんでした。",
    searchTimeoutError: "メモの検索がタイムアウトしました。",
    answerError: "回答を生成できませんでした。",
    answerTimeoutError: "回答の生成がタイムアウトしました。",
  }, { begin: aiUsage.begin, refresh: aiUsage.refresh }, { retrieveEvidence: retrieveProjectMemoEvidence });
  const labeledMemoEvidence = useMemo<ProjectMemoEvidence[]>(
    () => memoAIEvidence.map((item) => ({ ...item, evidenceId: item.key })),
    [memoAIEvidence],
  );
  const citedMemoEvidence = useMemo(() => {
    const keys = new Set(memoAICitedEvidenceKeys);
    return labeledMemoEvidence.filter((item) => keys.has(item.evidenceId));
  }, [labeledMemoEvidence, memoAICitedEvidenceKeys]);

  const loadCreatorNames = useCallback(async (userIds: (string | null | undefined)[]) => {
    const profiles = await listProjectCreatorProfiles(userIds);
    setCreatorNames((current) => ({
      ...current,
      ...Object.fromEntries(profiles.map((item) => [item.userId, item.displayName?.trim() || `@${item.username}`])),
    }));
  }, []);

  const creatorLabelFor = useCallback((
    userId: string | null,
    snapshot?: string | null,
    anonymizedReason?: ProjectSharedNote["anonymizedReason"],
  ) => {
    if (anonymizedReason === "project_exit" || userId == null) return "匿名ユーザー";
    if (userId === profile?.userId) return "あなた";
    return creatorNames[userId] || snapshot?.trim() || `ユーザー ${userId.slice(0, 8)}`;
  }, [creatorNames, profile?.userId]);
  const filteredNotes = useMemo(() => {
    const keyword = memoQuery.trim().toLocaleLowerCase();
    if (!keyword) return notes;
    return notes.filter((note) => [note.title ?? "", note.body, creatorLabelFor(
      note.ownerUserId,
      note.creatorDisplayName,
      note.anonymizedReason,
    )].some((value) => value.toLocaleLowerCase().includes(keyword)));
  }, [creatorLabelFor, memoQuery, notes]);

  const refresh = useCallback(async () => {
    if (!project) {
      setNotes([]);
      setTasks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (tab === "memos") {
        const nextNotes = await listProjectSharedNotes(project.id);
        setNotes(nextNotes);
        await loadCreatorNames(nextNotes.map((note) => note.ownerUserId));
      } else {
        const nextTasks = await listProjectTasks(project.id, config.taskKind);
        const tasksWithBackfilledMemos = profile
          ? await Promise.all(nextTasks.map(async (task) => {
            if (task.ownerUserId !== profile.userId || task.relatedMemoId || !task.description?.trim()) {
              return task;
            }
            const relatedMemoId = await syncProjectTaskMemo({ task, profile });
            return updateProjectTask(task.id, { relatedMemoId });
          }))
          : nextTasks;
        setTasks(tasksWithBackfilledMemos);
        await loadCreatorNames(tasksWithBackfilledMemos.map((task) => task.creatorUserId));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "プロジェクトの内容を読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }, [config.taskKind, loadCreatorNames, profile, project, tab]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  useEffect(() => {
    setMemoQuery("");
    setMemoAIQuery("");
    setMemoAIScope("project");
    setMemoAIExpanded(false);
    resetMemoAI();
  }, [activeProjectId, resetMemoAI, setMemoAIQuery]);

  useEffect(() => {
    setSelectedTaskIds((current) => current.filter((taskId) => tasks.some((task) => task.id === taskId && !task.isArchived)));
  }, [tasks]);

  const closeComposer = () => {
    if (saving) return;
    setComposer(null);
    setEditingNote(null);
    setEditingTask(null);
    setTitleDraft("");
    setBodyDraft("");
    setStatusDraft("todo");
    setTagDraft([]);
    setEstimateDraft("25");
    setPriorityDraft(null);
    setDueDateDraft("");
    setPrivateDateDraft("");
    setPrivateSlotKeyDraft("morning");
    setShowTagPicker(false);
    setAddingTag(false);
    setNewTagDraft("");
  };

  const openComposer = (kind: Exclude<ComposerKind, null>, item?: ProjectSharedNote | ProjectTask) => {
    if (!project) {
      openProjects();
      return;
    }
    if (kind !== "memos" && !project.taskEnabled) {
      Alert.alert("共有タスクはOFFです", "Projects のルームで共有タスクをONにしてから追加してください。");
      return;
    }
    if (kind === "memos") {
      const note = item as ProjectSharedNote | undefined;
      setEditingNote(note ?? null);
      setTitleDraft(note?.title ?? "");
      setBodyDraft(note?.body ?? "");
    } else {
      const task = item as ProjectTask | undefined;
      setEditingTask(task ?? null);
      setTitleDraft(task?.title ?? "");
      setBodyDraft(task?.description ?? "");
      setStatusDraft(task?.status ?? "todo");
      setTagDraft(task?.tags ?? []);
      setEstimateDraft(String(task?.estimateMinutes ?? 25));
      setPriorityDraft(task?.priority ?? null);
      setDueDateDraft(task?.dueAt ? new Date(task.dueAt).toISOString().slice(0, 10) : "");
      setPrivateDateDraft(task ? getProjectTaskPrivateDate(task) : toLocalDateString(Date.now()));
      setPrivateSlotKeyDraft(task ? getProjectTaskPrivateSlot(task, timeBoxSchedule) : getSlotForTime(timeBoxSchedule, new Date()));
    }
    setComposer(kind);
  };

  const saveComposer = async () => {
    if (!project || !composer || (composer !== "memos" && !titleDraft.trim())) return;
    try {
      setSaving(true);
      if (composer === "memos") {
        if (!profile) throw new Error("アカウントにログインしてからメモを作成してください。");
        if (!canEditNote(editingNote)) throw new Error("この共有メモを編集する権限がありません。");
        const editingAnonymous = editingNote?.anonymizedReason === "project_exit" || editingNote?.ownerUserId == null;
        if (editingNote && editingAnonymous) {
          await upsertProjectSharedNote({
            ...editingNote,
            title: titleDraft.trim(),
            body: bodyDraft,
            updatedAt: Date.now(),
          });
          closeComposer();
          await refresh();
          return;
        }
        const sourceNoteId = editingNote?.sourceNoteId ?? null;
        const localSource = sourceNoteId ? await getFreeNoteById(sourceNoteId) : null;
        const note = sourceNoteId && !localSource
          ? await upsertNoteRecord({
              id: sourceNoteId,
              type: "free",
              date: null,
              title: titleDraft.trim() || null,
              body: bodyDraft,
              scope: "project",
              projectId: project.id,
              updatedAt: Date.now(),
            })
          : await upsertFreeNote({ id: sourceNoteId, title: titleDraft.trim() || null, body: bodyDraft });
        if (!editingNote) await setNoteScope(note.id, { scope: "project", projectId: project.id });
        await upsertProjectSharedNote({ id: note.id, ownerUserId: profile.userId, creatorDisplayName: profile.displayName?.trim() || `@${profile.username}`, creatorAnonymizedAt: null, anonymizedReason: null, projectId: project.id, sourceNoteId: note.id, title: note.title, body: note.body, updatedAt: note.updatedAt });
      } else {
        if (!profile) throw new Error("アカウントにログインしてからタスクを保存してください。");
        const estimateMinutes = Math.max(0, Number.parseInt(estimateDraft, 10) || 0);
        const update = {
          title: titleDraft.trim(), description: bodyDraft.trim() || null, status: statusDraft,
          tags: tagDraft, estimateMinutes, isArchived: editingTask?.isArchived ?? false,
          priority: priorityDraft, dueAt: parseDueAt(dueDateDraft),
          privateDate: parseDueAt(privateDateDraft) ? privateDateDraft : null,
          privateSlotKey: privateSlotKeyDraft,
          assigneeUserId: editingTask?.assigneeUserId ?? null, relatedMemoId: editingTask?.relatedMemoId ?? null,
        };
        if (editingTask) {
          const savedTask = await updateProjectTask(editingTask.id, update);
          if (savedTask.anonymizedReason !== "project_exit") {
            const relatedMemoId = await syncProjectTaskMemo({ task: savedTask, profile });
            if (relatedMemoId !== savedTask.relatedMemoId) {
              await updateProjectTask(savedTask.id, { relatedMemoId });
            }
          }
        } else {
          const savedTask = await createProjectTask({ projectId: project.id, kind: TAB_CONFIG[composer].taskKind, ...update });
          const relatedMemoId = await syncProjectTaskMemo({ task: savedTask, profile });
          if (relatedMemoId !== savedTask.relatedMemoId) {
            await updateProjectTask(savedTask.id, { relatedMemoId });
          }
        }
      }
      closeComposer();
      await refresh();
    } catch (cause) {
      Alert.alert("保存できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  const handleProjectMemoBack = () => {
    if (saving) return;
    if (!canEditNote(editingNote)) {
      closeComposer();
      return;
    }
    void saveComposer();
  };

  const changeMemoAIScope = (scope: ProjectMemoSearchScope) => {
    if (scope === memoAIScope) return;
    setMemoAIScope(scope);
    resetMemoAI();
  };

  const handleMemoHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const next = Math.round(y + height);
    setMemoHeaderBottomY((current) => Math.abs(current - next) > 1 ? next : current);
  }, []);

  const updateTask = async (task: ProjectTask, update: Parameters<typeof updateProjectTask>[1]) => {
    try {
      await updateProjectTask(task.id, update);
      await refresh();
    } catch (cause) {
      Alert.alert("更新できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    }
  };

  const confirmDeleteTask = (task: ProjectTask) => {
    if (task.anonymizedReason === "project_exit" && myRole !== "owner") {
      Alert.alert("消去できません", "匿名タスクを消去できるのはプロジェクト所有者だけです。");
      return;
    }
    Alert.alert("タスクを消去しますか？", "この操作は元に戻せません。", [
      { text: "キャンセル", style: "cancel" },
      { text: "消去", style: "destructive", onPress: () => void (async () => {
        try {
          await deleteProjectTask(task.id);
          setSelectedTaskIds((current) => current.filter((id) => id !== task.id));
          await refresh();
        } catch (cause) {
          Alert.alert("消去できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
        }
      })() },
    ]);
  };

  const confirmDeleteNote = (note: ProjectSharedNote) => {
    Alert.alert("共有メモを消去しますか？", "プロジェクト上の共有メモを消去します。この操作は元に戻せません。", [
      { text: "キャンセル", style: "cancel" },
      { text: "消去", style: "destructive", onPress: () => void (async () => {
        try {
          await removeProjectSharedNote(note.id);
          closeComposer();
          await refresh();
        } catch (cause) {
          Alert.alert("消去できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
        }
      })() },
    ]);
  };

  const confirmDeleteSelected = () => {
    if (selectedTaskIds.length === 0) return;
    Alert.alert("選択したタスクを消去しますか？", `${selectedTaskIds.length}件を完全に消去します。`, [
      { text: "キャンセル", style: "cancel" },
      { text: "消去", style: "destructive", onPress: () => void (async () => {
        try {
          await Promise.all(selectedTaskIds.map((taskId) => deleteProjectTask(taskId)));
          setSelectionMode(false);
          setSelectedTaskIds([]);
          await refresh();
        } catch (cause) {
          Alert.alert("消去できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
        }
      })() },
    ]);
  };

  const toggleSelection = (task: ProjectTask) => {
    if (task.anonymizedReason === "project_exit" && myRole !== "owner") return;
    const taskId = task.id;
    setSelectedTaskIds((current) => current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]);
  };

  const toggleDraftTag = (tag: string) => {
    setTagDraft((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  };

  const openTagPicker = () => {
    // Keep the candidate list outside the task editor ScrollView while the
    // task-name keyboard is active; this avoids the iOS relayout freeze.
    Keyboard.dismiss();
    setShowTagPicker(true);
  };

  const closeTagPicker = () => {
    if (addingTagSaving) return;
    setShowTagPicker(false);
    setAddingTag(false);
    setNewTagDraft("");
  };

  const createAndSelectTag = async () => {
    const name = newTagDraft.trim();
    if (!name || addingTagSaving) return;
    const existing = tagOptions.find((tag) => tag === name);
    try {
      setAddingTagSaving(true);
      if (!existing) await addTag(name);
      setTagDraft((current) => current.includes(existing ?? name) ? current : [...current, existing ?? name]);
      setNewTagDraft("");
      setAddingTag(false);
    } catch (cause) {
      Alert.alert("タグを追加できません", cause instanceof Error ? cause.message : "もう一度お試しください。");
    } finally {
      setAddingTagSaving(false);
    }
  };

  const clearDefaultEstimate = () => {
    if (estimateDraft === "25" && (editingTask?.estimateMinutes ?? 25) === 25) {
      setEstimateDraft("");
    }
  };

  if (!active) return null;

  const items = tab === "memos" ? filteredNotes : tasks;
  const composerTitle = composer === "memos"
    ? editingNote ? "メモを編集" : "メモを追加"
    : editingTask ? `${composer === "todo" ? "ToDo" : "タスク"}を編集` : `${composer === "todo" ? "ToDo" : "タスク"}を追加`;
  const renderTaskRow = (task: ProjectTask, selecting = false, selected = false) => (
    <ProjectTaskRow
      key={task.id}
      task={task}
      selecting={selecting}
      selected={selected}
      canDelete={task.anonymizedReason !== "project_exit" || myRole === "owner"}
      creatorLabel={creatorLabelFor(task.creatorUserId, task.creatorDisplayName, task.anonymizedReason)}
      isSwipeOpen={openSwipeTaskId === task.id}
      onOpenSwipe={() => setOpenSwipeTaskId(task.id)}
      onCloseSwipe={() => setOpenSwipeTaskId(null)}
      onOpen={() => openComposer(tab, task)}
      onToggleSelected={() => toggleSelection(task)}
      onStatus={(status) => void updateTask(task, taskUpdate(task, { status }))}
      onArchive={() => void updateTask(task, taskUpdate(task, { isArchived: true }))}
      onRestore={() => void updateTask(task, taskUpdate(task, { isArchived: false }))}
      onDelete={() => confirmDeleteTask(task)}
    />
  );
  const tagPickerPanel = (
    <View style={styles.tagPickerPanel}>
      <View style={styles.tagPickerHeader}>
        <Text style={styles.tagPickerTitle}>タグ</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="タグ選択をキャンセル" style={styles.tagPickerCloseButton} onPress={closeTagPicker}>
          <Text style={styles.tagPickerCloseText}>キャンセル</Text>
        </Pressable>
      </View>
      <FlatList
        data={tagOptions}
        keyExtractor={(tag) => tag}
        style={styles.tagPickerList}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: tag }) => {
          const selected = tagDraft.includes(tag);
          return <Pressable accessibilityRole="button" accessibilityState={{ selected }} style={styles.tagPickerItem} onPress={() => { toggleDraftTag(tag); closeTagPicker(); }}><Text style={[styles.tagPickerItemText, selected && styles.tagPickerItemTextSelected]}>{tag}</Text></Pressable>;
        }}
      />
      <View style={styles.tagAddFooter}>{addingTag ? <><TextInput style={styles.newTagInput} value={newTagDraft} onChangeText={setNewTagDraft} placeholder="新しいタグ名" autoFocus returnKeyType="done" onSubmitEditing={() => void createAndSelectTag()} /><View style={styles.newTagActionRow}><Pressable style={styles.newTagCancelButton} onPress={() => { setAddingTag(false); setNewTagDraft(""); }}><Text style={styles.newTagCancelText}>キャンセル</Text></Pressable><Pressable disabled={!newTagDraft.trim() || addingTagSaving} style={[styles.newTagSaveButton, (!newTagDraft.trim() || addingTagSaving) && styles.saveActionDisabled]} onPress={() => void createAndSelectTag()}><Text style={styles.newTagSaveText}>{addingTagSaving ? "追加中" : "追加"}</Text></Pressable></View></> : <Pressable accessibilityRole="button" accessibilityLabel="新しいタグを追加" style={styles.addTagButton} onPress={() => setAddingTag(true)}><Ionicons name="add" size={18} color="#2563eb" /><Text style={styles.addTagButtonText}>タグの追加</Text></Pressable>}</View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: contentPaddingTop }]}>
      <View style={styles.header} onLayout={tab === "memos" ? handleMemoHeaderLayout : undefined}>
        <View style={styles.headerSide}><Pressable accessibilityRole="button" accessibilityLabel="メニューを開く" style={styles.menuButton} onPress={openMenu}><Ionicons name="menu" size={20} color="#111827" /></Pressable></View>
        <Text numberOfLines={1} style={styles.headerTitle}>{config.title}</Text>
        <View style={styles.headerSideRight}>
          {tab !== "memos" && selectionMode ? <Pressable style={styles.headerTextAction} onPress={() => { setSelectionMode(false); setSelectedTaskIds([]); }}><Text style={styles.headerTextActionLabel}>選択終了</Text></Pressable> : null}
          {tab !== "tasks" ? <Pressable accessibilityRole="button" accessibilityLabel={`${config.title}を追加`} style={[styles.addButton, (!project || (tab === "memos" && !canCreateMemo)) && styles.addButtonDisabled]} disabled={!project || (tab === "memos" && !canCreateMemo)} onPress={() => openComposer(tab)}><Ionicons name="add" size={18} color="#111827" /><Text style={styles.addButtonText}>追加</Text></Pressable> : null}
        </View>
      </View>

      {tab === "memos" && project ? (
        <View style={styles.memoSearchRow}>
          <TextInput
            style={styles.memoSearchInput}
            placeholder="メモを検索"
            value={memoQuery}
            onChangeText={setMemoQuery}
          />
        </View>
      ) : null}

      <ScrollView contentContainerStyle={[styles.content, tab === "memos" && styles.memoContent]} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />} keyboardShouldPersistTaps="handled">
        {!project ? (
          <View style={styles.emptySurface}><Ionicons name="folder-open-outline" size={22} color="#9ca3af" /><View style={styles.emptyBody}><Text style={styles.emptyTitle}>プロジェクトを選択してください</Text><Text style={styles.caption}>Projects から参加中のプロジェクトを開けます。</Text><Pressable style={styles.openProjectsButton} onPress={openProjects}><Text style={styles.openProjectsLabel}>Projects を開く</Text></Pressable></View></View>
        ) : (
          <>
            {tab !== "memos" ? <Pressable style={styles.projectBar} onPress={openProjects}><View style={styles.projectIcon}><Text style={styles.projectIconText}>{project.icon ?? "■"}</Text></View><View style={styles.projectInfo}><Text style={styles.projectName}>{project.name}</Text><Text numberOfLines={1} style={styles.caption}>{project.description || "説明はありません"}</Text></View><Ionicons name="chevron-forward" size={18} color="#9ca3af" /></Pressable> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {loading ? <ActivityIndicator style={styles.loading} /> : null}
            {tab !== "tasks" && items.length === 0 && !loading ? <View style={styles.emptySurface}><Ionicons name={config.icon} size={22} color="#9ca3af" /><Text style={styles.emptyTitle}>{tab === "memos" && memoQuery.trim() ? "一致する共有メモがありません。" : config.empty}</Text></View> : null}
            {tab === "memos" ? filteredNotes.map((note) => <MemoListCard
              key={note.id}
              title={note.title?.trim() || "無題"}
              meta={[
                `作成者: ${creatorLabelFor(note.ownerUserId, note.creatorDisplayName, note.anonymizedReason)}`,
                new Date(note.updatedAt).toLocaleDateString("ja-JP"),
              ]}
              onPress={() => openComposer("memos", note)}
              onDelete={canEditNote(note) ? () => confirmDeleteNote(note) : undefined}
            />) : tab === "tasks" ? <>
              <View style={styles.projectTaskBox}>
                <View style={styles.projectTaskBoxHeader}>
                  <Pressable style={styles.projectTaskBoxToggle} onPress={() => setActiveExpanded((current) => !current)}><Ionicons name={activeExpanded ? "chevron-down" : "chevron-forward"} size={18} color="#374151" /><Text style={styles.projectTaskBoxTitle}>タスク</Text><Text style={styles.projectTaskBoxCount}>（{activeTasks.length}）</Text></Pressable>
                  <View style={styles.projectTaskBoxActions}>
                    {!selectionMode ? <Pressable style={styles.headerTextAction} onPress={() => { setSelectionMode(true); setSelectedTaskIds([]); }}><Text style={styles.headerTextActionLabel}>選択</Text></Pressable> : null}
                    <Pressable accessibilityRole="button" accessibilityLabel="タスクを追加" style={styles.projectTaskAddButton} onPress={() => openComposer("tasks")}><Ionicons name="add" size={27} color="#374151" /></Pressable>
                  </View>
                </View>
                {selectionMode ? <View style={styles.selectionBar}><Text style={styles.selectionText}>{selectedTaskIds.length}件を選択中</Text><Pressable disabled={selectedTaskIds.length === 0} style={[styles.deleteSelectedButton, selectedTaskIds.length === 0 && styles.disabledAction]} onPress={confirmDeleteSelected}><Text style={styles.deleteActionText}>選択を消去</Text></Pressable></View> : null}
                {activeExpanded ? activeTasks.map((task) => renderTaskRow(task, selectionMode, selectedTaskIdSet.has(task.id))) : null}
                <View style={styles.projectCompletedSection}>
                  <Pressable style={styles.projectCompletedToggle} onPress={() => setCompletedExpanded((current) => !current)}><Text style={styles.projectCompletedToggleText}>完了（{completedTasks.length}）</Text><Ionicons name={completedExpanded ? "chevron-down" : "chevron-forward"} size={18} color="#6b7280" /></Pressable>
                  {completedExpanded ? completedTasks.length ? completedTasks.map((task) => renderTaskRow(task)) : <Text style={styles.projectCompletedEmpty}>完了タスクはありません</Text> : null}
                </View>
              </View>
              <Pressable style={styles.collapsibleHeader} onPress={() => setArchivedExpanded((current) => !current)}><Text style={styles.sectionTitle}>アーカイブ（{archivedTasks.length}）</Text><Ionicons name={archivedExpanded ? "chevron-up" : "chevron-down"} size={18} color="#6b7280" /></Pressable>
              {archivedExpanded ? archivedTasks.map((task) => renderTaskRow(task)) : null}
            </> : <>
              <View style={styles.taskListHeader}><Text style={styles.sectionTitle}>ToDo（{activeTasks.length}）</Text><Pressable style={styles.headerTextAction} onPress={() => { setSelectionMode(true); setSelectedTaskIds([]); }}><Text style={styles.headerTextActionLabel}>選択</Text></Pressable></View>
              {selectionMode ? <View style={styles.selectionBar}><Text style={styles.selectionText}>{selectedTaskIds.length}件を選択中</Text><Pressable disabled={selectedTaskIds.length === 0} style={[styles.deleteSelectedButton, selectedTaskIds.length === 0 && styles.disabledAction]} onPress={confirmDeleteSelected}><Text style={styles.deleteActionText}>選択を消去</Text></Pressable></View> : null}
              {activeTasks.map((task) => renderTaskRow(task, selectionMode, selectedTaskIdSet.has(task.id)))}
              <Pressable style={styles.collapsibleHeader} onPress={() => setCompletedExpanded((current) => !current)}><Text style={styles.sectionTitle}>完了（{completedTasks.length}）</Text><Ionicons name={completedExpanded ? "chevron-up" : "chevron-down"} size={18} color="#6b7280" /></Pressable>
              {completedExpanded ? completedTasks.map((task) => renderTaskRow(task)) : null}
              <Pressable style={styles.collapsibleHeader} onPress={() => setArchivedExpanded((current) => !current)}><Text style={styles.sectionTitle}>アーカイブ（{archivedTasks.length}）</Text><Ionicons name={archivedExpanded ? "chevron-up" : "chevron-down"} size={18} color="#6b7280" /></Pressable>
              {archivedExpanded ? archivedTasks.map((task) => renderTaskRow(task)) : null}
            </>}
          </>
        )}
      </ScrollView>

      {tab === "memos" && project ? (
        <TemisAIDock
          expanded={memoAIExpanded}
          expandedTop={memoHeaderBottomY > 0 ? memoHeaderBottomY : undefined}
          query={memoAIQuery}
          placeholder="Projectのメモについて質問"
          searchLabel={memoAISearchLoading ? "検索中" : memoAIAnswerLoading ? "回答中" : "検索"}
          searchDisabled={memoAISearchLoading || memoAIAnswerLoading}
          onChangeQuery={setMemoAIQuery}
          onSearch={() => { if (memoAIQuery.trim()) void runMemoAISearch(); }}
          onToggle={() => setMemoAIExpanded((current) => !current)}
          badge={<Pressable disabled={aiUsage.status !== "error"} onPress={() => void aiUsage.refresh()}><Text style={styles.aiUsageBadge}>{formatTemisAIUsageLabel(aiUsage.usage, aiUsage.status)}{aiUsage.status === "error" ? "・再試行" : ""}</Text></Pressable>}
          controls={<View style={styles.aiScopeRow}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: memoAIScope === "project" }} style={[styles.aiScopeButton, memoAIScope === "project" && styles.aiScopeButtonActive]} onPress={() => changeMemoAIScope("project")}><Text style={[styles.aiScopeText, memoAIScope === "project" && styles.aiScopeTextActive]}>Projectのみ</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: memoAIScope === "project_and_private" }} style={[styles.aiScopeButton, memoAIScope === "project_and_private" && styles.aiScopeButtonActive]} onPress={() => changeMemoAIScope("project_and_private")}><Text style={[styles.aiScopeText, memoAIScope === "project_and_private" && styles.aiScopeTextActive]}>Project＋Private</Text></Pressable>
          </View>}
        >
          {memoAISearchLoading ? <Text style={styles.aiHelper}>関連するメモを検索しています…</Text>
            : memoAIAnswerLoading ? <Text style={styles.aiHelper}>回答を生成しています…</Text>
              : memoAIError ? <Text accessibilityRole="alert" style={styles.aiHelper}>{memoAIError}</Text>
                : memoAISearched && labeledMemoEvidence.length === 0 ? <Text style={styles.aiHelper}>関連するメモが見つかりませんでした。</Text>
                  : <ScrollView style={styles.aiResults} contentContainerStyle={styles.aiResultsContent} nestedScrollEnabled showsVerticalScrollIndicator>
                    <AIAnswerEvidencePanel
                      answerText={memoAIAnswerText}
                      errorText={memoAIError}
                      answerTitle="回答"
                      citedTitle="引用したメモ"
                      allTitle="関連するメモ"
                      showAllLabel="すべて表示"
                      hideAllLabel="閉じる"
                      citedEvidence={citedMemoEvidence}
                      allEvidence={labeledMemoEvidence}
                      showAll={memoAIShowAllEvidence}
                      onToggleAll={() => setMemoAIShowAllEvidence((current) => !current)}
                      getEvidenceKey={(result) => result.evidenceId}
                      renderEvidence={(result, options) => {
                        const projectNoteId = projectNoteIdFromEvidence(result.memoId);
                        const note = projectNoteId ? notes.find((item) => item.id === projectNoteId) : null;
                        return <Pressable
                          style={[styles.aiEvidenceCard, options.cited && styles.aiEvidenceCardCited]}
                          onPress={() => note ? openComposer("memos", note) : openMemoDetail(result.memoId)}
                        >
                          <Text style={styles.aiEvidenceId}>[{result.evidenceId}]</Text>
                          <Text style={styles.aiEvidenceSnippet}>{result.snippetText}</Text>
                          <Text style={styles.aiEvidenceMeta}>{note ? `${note.title?.trim() || "無題"} · Project` : "Private"}</Text>
                          {options.allSection && result.tokensHit?.length ? <Text style={styles.aiEvidenceTokens}>{result.tokensHit.map((token) => `((${token}))`).join(" ")}</Text> : null}
                        </Pressable>;
                      }}
                    />
                  </ScrollView>}
        </TemisAIDock>
      ) : null}

      <Modal visible={composer !== null} animationType="slide" onRequestClose={composer === "memos" ? handleProjectMemoBack : closeComposer}>
        <View style={styles.composerModalRoot}>
          {composer === "memos" ? (
            <KeyboardAvoidingView style={[styles.composer, { paddingTop: contentPaddingTop }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
              <View style={styles.memoEditorHeader}>
                <Pressable style={styles.memoEditorBackButton} onPress={handleProjectMemoBack}>
                  <Ionicons name="chevron-back" size={18} color="#2563eb" />
                  <Text style={styles.memoEditorBackText}>{saving ? "保存中" : "戻る"}</Text>
                </Pressable>
                <Text style={styles.memoEditorHeaderTitle}>Note</Text>
                {editingNote && canEditNote(editingNote) ? (
                  <Pressable style={styles.memoEditorDeleteButton} onPress={() => confirmDeleteNote(editingNote)}>
                    <Text style={styles.memoEditorDeleteText}>消去</Text>
                  </Pressable>
                ) : <View style={styles.memoEditorHeaderSpacer} />}
              </View>
              <ScrollView contentContainerStyle={styles.projectMemoEditorContent} keyboardShouldPersistTaps="handled">
                <Text style={styles.projectMemoDisplayTitle}>{titleDraft.trim() || "無題"}</Text>
                <Text style={styles.projectMemoMeta}>{project?.name ?? "Project"} · 作成者: {editingNote ? creatorLabelFor(editingNote.ownerUserId, editingNote.creatorDisplayName, editingNote.anonymizedReason) : "あなた"}</Text>
                {!canEditNote(editingNote) ? <Text style={styles.projectMemoReadOnly}>このメモは読み取り専用です。</Text> : null}
                <MemoEditorFields
                  title={titleDraft}
                  body={bodyDraft}
                  editable={canEditNote(editingNote)}
                  language="ja"
                  tokens={memoTokens}
                  onChangeTitle={setTitleDraft}
                  onChangeBody={setBodyDraft}
                />
              </ScrollView>
            </KeyboardAvoidingView>
          ) : <View style={[styles.composer, { paddingTop: contentPaddingTop }]}>
          <View style={styles.editorHeader}>
            <View style={styles.editorHeaderLeft}>
              {editingTask ? <Pressable style={styles.editorDeleteAction} onPress={() => confirmDeleteTask(editingTask)}><Text style={styles.editorDeleteText}>消去</Text></Pressable> : null}
              <View style={styles.scopePill}><Text numberOfLines={1} style={styles.scopePillText}>{project?.name ?? "Project"}</Text><Ionicons name="chevron-down" size={17} color="#4b5563" /></View>
            </View>
            <Text numberOfLines={1} style={styles.editorTitle}>{composerTitle}</Text>
            <View style={styles.editorHeaderRight}><Pressable style={styles.editorCancelAction} onPress={closeComposer}><Text style={styles.editorCancelText}>キャンセル</Text></Pressable><Pressable disabled={saving || !titleDraft.trim()} style={[styles.editorDoneAction, (!titleDraft.trim() || saving) && styles.saveActionDisabled]} onPress={() => void saveComposer()}><Text style={styles.editorDoneText}>{saving ? "保存中" : "完了"}</Text></Pressable></View>
          </View>
          <ScrollView contentContainerStyle={styles.composerContent} keyboardShouldPersistTaps="handled">
            <View style={styles.taskEditorCard}>
              <View style={styles.taskEditorTopRow}>
                <Text numberOfLines={1} style={styles.taskEditorName}>{titleDraft || "未設定"}</Text>
                <View style={styles.taskEditorControls}>
                  <Text style={[styles.editorStatusBadge, statusDraft === "completed" && styles.editorStatusBadgeCompleted]}>{STATUS_LABEL[statusDraft]}</Text>
                  {statusDraft === "in_progress" ? <><Pressable style={styles.editorPauseAction} onPress={() => setStatusDraft("paused")}><Text style={styles.editorPauseText}>中断</Text></Pressable><Pressable style={styles.editorStartAction} onPress={() => setStatusDraft("completed")}><Text style={styles.editorStartText}>完了</Text></Pressable></> : <Pressable disabled={statusDraft === "completed"} style={[styles.editorStartAction, statusDraft === "completed" && styles.editorStartActionDisabled]} onPress={() => setStatusDraft("in_progress")}><Text style={styles.editorStartText}>開始</Text></Pressable>}
                </View>
              </View>
              <TextInput style={styles.taskNameInput} value={titleDraft} onChangeText={setTitleDraft} placeholder={composer === "todo" ? "ToDoを入力" : "タスク名"} autoFocus />
              <View style={styles.taskEditorFieldRow}>
                <Text style={styles.taskEditorFieldLabel}>タグ</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="タグを選択"
                  accessibilityState={{ expanded: showTagPicker }}
                  hitSlop={8}
                  style={({ pressed }) => [styles.taskEditorTagButton, pressed && styles.taskEditorTagButtonPressed]}
                  onPress={openTagPicker}
                >
                  <Text numberOfLines={1} style={styles.taskEditorFieldText}>{tagDraft.length ? tagDraft.join("、") : "タグを選択"}</Text>
                  <Ionicons name="chevron-down" size={18} color="#6b7280" />
                </Pressable>
              </View>
              <View style={styles.taskEditorFieldRow}><Text style={styles.taskEditorFieldLabel}>予測 (分)</Text><TextInput style={styles.taskEditorEstimateInput} keyboardType="number-pad" value={estimateDraft} onFocus={clearDefaultEstimate} onChangeText={setEstimateDraft} placeholder="25" /></View>
              <View style={styles.taskEditorFieldRow}><Text style={styles.taskEditorFieldLabel}>Private日付</Text><TextInput style={styles.taskEditorEstimateInput} value={privateDateDraft} onChangeText={setPrivateDateDraft} placeholder="YYYY-MM-DD" /></View>
              <View style={styles.taskEditorFieldRow}><Text style={styles.taskEditorFieldLabel}>Private時間帯</Text><View style={styles.privateSlotRow}>{SLOT_KEYS.map((slotKey) => <Pressable key={slotKey} style={[styles.privateSlotButton, privateSlotKeyDraft === slotKey && styles.privateSlotButtonActive]} onPress={() => setPrivateSlotKeyDraft(slotKey)}><Text style={[styles.privateSlotButtonText, privateSlotKeyDraft === slotKey && styles.privateSlotButtonTextActive]}>{SLOT_LABELS[slotKey]}</Text></Pressable>)}</View></View>
              <View style={styles.memoDivider} />
              <Text style={styles.memoSectionTitle}>Memo</Text>
              <TextInput style={styles.memoInput} value={bodyDraft} onChangeText={setBodyDraft} placeholder="メモを入力" multiline textAlignVertical="top" />
              <View style={styles.wikiSection}><Text style={styles.wikiSectionTitle}>Wikiリンク</Text><TokenChips tokens={memoTokens} /></View>
            </View>
          </ScrollView>
          </View>}
        {composer !== "memos" && showTagPicker ? <View style={styles.tagPickerOverlay} accessibilityViewIsModal>
          <Pressable accessibilityRole="button" accessibilityLabel="タグ選択を閉じる" style={styles.tagPickerBackdrop} onPress={closeTagPicker} />
          {addingTag ? <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>{tagPickerPanel}</KeyboardAvoidingView> : tagPickerPanel}
        </View> : null}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" }, composerModalRoot: { flex: 1, backgroundColor: "#ffffff" }, composer: { flex: 1, backgroundColor: "#ffffff" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, paddingHorizontal: 16 }, headerSide: { width: 120, flexDirection: "row", alignItems: "center" }, headerSideRight: { width: 120, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }, headerTitle: { flex: 1, color: "#111827", fontSize: 18, fontWeight: "600", textAlign: "center" }, menuButton: { paddingHorizontal: 6, paddingVertical: 6 },
  addButton: { minHeight: 32, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }, addButtonDisabled: { opacity: 0.45 }, addButtonText: { marginLeft: 4, color: "#111827", fontSize: 12, fontWeight: "600" }, headerTextAction: { paddingHorizontal: 4, paddingVertical: 6 }, headerTextActionLabel: { color: "#2563eb", fontSize: 12, fontWeight: "600" },
  content: { paddingHorizontal: 16, paddingBottom: 32 }, memoContent: { paddingBottom: 220 }, memoSearchRow: { paddingHorizontal: 16, marginBottom: 8 }, memoSearchInput: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 10, color: "#111827" }, projectBar: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, padding: 12, marginBottom: 20 }, projectIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: "#f3f4f6" }, projectIconText: { color: "#374151", fontSize: 14 }, projectInfo: { flex: 1, marginLeft: 12 }, projectName: { color: "#111827", fontSize: 15, fontWeight: "700" },
  aiUsageBadge: { color: "#6b7280", fontSize: 11, fontWeight: "600" }, aiScopeRow: { flexDirection: "row", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 9, padding: 3, backgroundColor: "#f9fafb" }, aiScopeButton: { flex: 1, alignItems: "center", borderRadius: 7, paddingVertical: 6 }, aiScopeButtonActive: { backgroundColor: "#111827" }, aiScopeText: { color: "#6b7280", fontSize: 11, fontWeight: "700" }, aiScopeTextActive: { color: "#ffffff" }, aiHelper: { color: "#6b7280", fontSize: 12 }, aiResults: { flex: 1, minHeight: 0 }, aiResultsContent: { flexGrow: 1 }, aiEvidenceCard: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, padding: 10, backgroundColor: "#f9fafb", marginBottom: 8 }, aiEvidenceCardCited: { borderColor: "#93c5fd", backgroundColor: "#eff6ff" }, aiEvidenceId: { fontSize: 11, fontWeight: "700", color: "#1d4ed8", marginBottom: 3 }, aiEvidenceSnippet: { fontSize: 13, color: "#111827", marginBottom: 4 }, aiEvidenceMeta: { fontSize: 11, color: "#6b7280" }, aiEvidenceTokens: { marginTop: 4, fontSize: 11, color: "#2563eb" },
  itemRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb", paddingVertical: 14 }, itemBody: { flex: 1, marginLeft: 10 }, itemTitle: { color: "#111827", fontSize: 15, fontWeight: "600" }, completedTaskTitle: { color: "#6b7280", textDecorationLine: "line-through" }, caption: { marginTop: 3, color: "#6b7280", fontSize: 13 }, taskMeta: { marginTop: 5, color: "#6b7280", fontSize: 11 }, creatorText: { marginTop: 5, color: "#6b7280", fontSize: 11 },
  emptySurface: { flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, padding: 14, gap: 10 }, emptyBody: { flex: 1 }, emptyTitle: { flex: 1, color: "#4b5563", fontSize: 13, lineHeight: 19 }, openProjectsButton: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, marginTop: 10, paddingHorizontal: 10, paddingVertical: 7 }, openProjectsLabel: { color: "#111827", fontSize: 12, fontWeight: "600" }, loading: { marginVertical: 12 }, error: { marginBottom: 10, color: "#b91c1c", fontSize: 13 },
  taskListHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2, marginBottom: 4 }, sectionTitle: { color: "#374151", fontSize: 13, fontWeight: "700" }, taskRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb", paddingVertical: 12 }, archivedTaskRow: { opacity: 0.65 }, taskMainPressable: { flex: 1, flexDirection: "row", alignItems: "center", paddingRight: 6 }, taskTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 }, statusBadge: { borderRadius: 999, backgroundColor: "#f3f4f6", color: "#4b5563", fontSize: 10, fontWeight: "700", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 2 }, statusBadgeCompleted: { backgroundColor: "#dcfce7", color: "#166534" }, taskActions: { flexDirection: "row", alignItems: "center", gap: 6 }, primaryAction: { borderRadius: 7, backgroundColor: "#111827", paddingHorizontal: 8, paddingVertical: 6 }, primaryActionText: { color: "#ffffff", fontSize: 11, fontWeight: "700" }, secondaryAction: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6 }, secondaryActionText: { color: "#374151", fontSize: 11, fontWeight: "700" }, overflowAction: { padding: 6 }, deleteAction: { borderRadius: 7, backgroundColor: "#fee2e2", paddingHorizontal: 8, paddingVertical: 6 }, deleteActionText: { color: "#b91c1c", fontSize: 11, fontWeight: "700" },
  projectTaskBox: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, backgroundColor: "#ffffff", padding: 12, marginBottom: 2 }, projectTaskBoxHeader: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, projectTaskBoxToggle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6 }, projectTaskBoxTitle: { color: "#111827", fontSize: 18, fontWeight: "700" }, projectTaskBoxCount: { color: "#6b7280", fontSize: 15, fontWeight: "500" }, projectTaskBoxActions: { flexDirection: "row", alignItems: "center", gap: 6 }, projectTaskAddButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, backgroundColor: "#ffffff" }, projectTaskItem: { marginTop: 10 }, projectActiveTaskRow: { flexDirection: "row", alignItems: "stretch", overflow: "hidden", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, backgroundColor: "#ffffff" }, projectTaskStatusBar: { width: 8, marginVertical: 10, borderRadius: 8 }, projectTaskHeaderBody: { flex: 1, flexDirection: "row", alignItems: "center", padding: 10, gap: 8 }, projectTaskCheckbox: { paddingVertical: 7 }, projectTaskCheckboxText: { color: "#374151", fontSize: 12, fontWeight: "700" }, projectTaskHeaderPressable: { flex: 1, minWidth: 0 }, projectTaskHeaderContent: { borderRadius: 8, backgroundColor: "#f8fafc", paddingHorizontal: 10, paddingVertical: 8 }, projectTaskHeaderTitle: { color: "#111827", fontSize: 15, fontWeight: "600" }, projectTaskHeaderMeta: { marginTop: 3, color: "#6b7280", fontSize: 11 }, projectTaskCreator: { marginTop: 4, color: "#6b7280", fontSize: 10 }, projectTaskDescription: { marginTop: 4, color: "#4b5563", fontSize: 11 }, projectTaskStatusBadge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4, alignSelf: "flex-start" }, projectTaskStatusBadgeText: { fontSize: 10, fontWeight: "700" }, projectTaskActions: { alignItems: "center", gap: 6 }, inlineAction: { paddingHorizontal: 6, paddingVertical: 3 }, inlineActionText: { color: "#2563eb", fontSize: 10, fontWeight: "700" }, projectStartButton: { borderRadius: 8, backgroundColor: "#111827", paddingHorizontal: 10, paddingVertical: 7 }, projectStartButtonText: { color: "#ffffff", fontSize: 11, fontWeight: "700" }, projectCompletedSection: { marginTop: 16, borderTopWidth: 1, borderColor: "#e5e7eb", paddingTop: 10 }, projectCompletedToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }, projectCompletedToggleText: { color: "#6b7280", fontSize: 13, fontWeight: "700" }, projectCompletedEmpty: { paddingVertical: 20, color: "#9ca3af", fontSize: 13, textAlign: "center" }, projectCompletedTaskRow: { flexDirection: "row", alignItems: "center", overflow: "hidden", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb", paddingVertical: 9 }, projectCompletedTaskBody: { flex: 1, marginLeft: 10 }, projectCompletedTaskTitle: { color: "#6b7280", fontSize: 14, textDecorationLine: "line-through" }, projectCompletedTaskMeta: { marginTop: 3, color: "#9ca3af", fontSize: 10 },
  swipeRowContainer: { position: "relative", overflow: "hidden", borderRadius: 6 }, swipeActions: { position: "absolute", top: 0, bottom: 0, flexDirection: "row", alignItems: "stretch" }, swipeActionButton: { flex: 1, justifyContent: "center", alignItems: "center" }, swipeActionText: { color: "#ffffff", fontSize: 12, fontWeight: "600" }, swipeArchiveButton: { backgroundColor: "#4b5563" }, swipeDeleteButton: { backgroundColor: "#dc2626" }, swipeContent: { backgroundColor: "#ffffff" },
  collapsibleHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderColor: "#e5e7eb", marginTop: 16, paddingTop: 14, paddingBottom: 6 }, selectionBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#eff6ff", borderRadius: 8, padding: 10, marginBottom: 6 }, selectionText: { color: "#1d4ed8", fontSize: 12, fontWeight: "600" }, deleteSelectedButton: { borderRadius: 7, backgroundColor: "#fee2e2", paddingHorizontal: 9, paddingVertical: 6 }, disabledAction: { opacity: 0.45 },
  composerContent: { padding: 16, paddingBottom: 40 }, titleInput: { borderBottomWidth: 1, borderBottomColor: "#e5e7eb", color: "#111827", fontSize: 20, fontWeight: "600", paddingVertical: 12 }, bodyInput: { minHeight: 150, color: "#374151", fontSize: 16, lineHeight: 24, paddingTop: 16 }, cancelText: { color: "#2563eb", fontSize: 12, fontWeight: "600" }, saveAction: { borderRadius: 8, backgroundColor: "#111827", paddingHorizontal: 11, paddingVertical: 8 }, saveActionDisabled: { opacity: 0.45 }, saveActionText: { color: "#ffffff", fontSize: 12, fontWeight: "700" }, deleteHeaderAction: { borderRadius: 7, backgroundColor: "#fee2e2", paddingHorizontal: 8, paddingVertical: 6 }, formLabel: { marginTop: 18, marginBottom: 8, color: "#374151", fontSize: 13, fontWeight: "600" }, statusRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, statusButton: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 }, statusButtonActive: { borderColor: "#111827", backgroundColor: "#111827" }, statusButtonText: { color: "#4b5563", fontSize: 12, fontWeight: "600" }, statusButtonTextActive: { color: "#ffffff" }, compactInput: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, color: "#111827", fontSize: 15, paddingHorizontal: 11, paddingVertical: 10 }, tagPickerButton: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 10 }, tagPickerButtonText: { flex: 1, color: "#374151", fontSize: 14 },
  tagPickerOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.4)" }, tagPickerBackdrop: { ...StyleSheet.absoluteFillObject }, tagPickerPanel: { maxHeight: "70%", borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: "#ffffff", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 }, tagPickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }, tagPickerTitle: { color: "#111827", fontSize: 16, fontWeight: "600" }, tagPickerCloseButton: { paddingHorizontal: 8, paddingVertical: 6 }, tagPickerCloseText: { color: "#2563eb", fontSize: 14 }, tagPickerList: { flexGrow: 0 }, tagPickerItem: { paddingHorizontal: 8, paddingVertical: 14, borderBottomWidth: 1, borderColor: "#f3f4f6" }, tagPickerItemText: { color: "#111827", fontSize: 14 }, tagPickerItemTextSelected: { color: "#2563eb", fontWeight: "600" }, tagAddFooter: { borderTopWidth: 1, borderColor: "#f3f4f6", paddingTop: 12, paddingHorizontal: 8 }, addTagButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 9, backgroundColor: "#eff6ff", paddingVertical: 11 }, addTagButtonText: { color: "#2563eb", fontSize: 14, fontWeight: "700" }, newTagInput: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, color: "#111827", fontSize: 15, paddingHorizontal: 11, paddingVertical: 10 }, newTagActionRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 }, newTagCancelButton: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8 }, newTagCancelText: { color: "#4b5563", fontSize: 12, fontWeight: "600" }, newTagSaveButton: { borderRadius: 8, backgroundColor: "#111827", paddingHorizontal: 12, paddingVertical: 8 }, newTagSaveText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 }, editorHeaderLeft: { width: 116, flexDirection: "row", alignItems: "center", gap: 8 }, editorHeaderRight: { width: 150, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }, editorTitle: { flex: 1, color: "#000000", fontSize: 20, fontWeight: "700", textAlign: "center" }, editorDeleteAction: { paddingVertical: 8 }, editorDeleteText: { color: "#ef4444", fontSize: 16, fontWeight: "600" }, scopePill: { maxWidth: 88, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 12, backgroundColor: "#f1f3f6", paddingHorizontal: 10, paddingVertical: 9 }, scopePillText: { maxWidth: 56, color: "#4b5563", fontSize: 14, fontWeight: "600" }, editorCancelAction: { borderRadius: 9, backgroundColor: "#e6e9ee", paddingHorizontal: 12, paddingVertical: 10 }, editorCancelText: { color: "#374151", fontSize: 14, fontWeight: "600" }, editorDoneAction: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, backgroundColor: "#ffffff", paddingHorizontal: 12, paddingVertical: 10 }, editorDoneText: { color: "#111827", fontSize: 14, fontWeight: "600" },
  memoEditorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 }, memoEditorBackButton: { width: 72, minHeight: 44, flexDirection: "row", alignItems: "center", paddingVertical: 8 }, memoEditorBackText: { color: "#2563eb", fontSize: 12, marginLeft: 2 }, memoEditorHeaderTitle: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "600", color: "#111827" }, memoEditorHeaderSpacer: { width: 64 }, memoEditorDeleteButton: { minWidth: 64, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: "#6b7280", alignItems: "center" }, memoEditorDeleteText: { color: "#ffffff", fontSize: 12, fontWeight: "600" }, projectMemoEditorContent: { flexGrow: 1, padding: 16 }, projectMemoDisplayTitle: { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 4 }, projectMemoMeta: { fontSize: 12, color: "#6b7280", marginBottom: 12 }, projectMemoReadOnly: { alignSelf: "flex-start", marginBottom: 12, borderRadius: 8, backgroundColor: "#f3f4f6", color: "#4b5563", fontSize: 12, paddingHorizontal: 10, paddingVertical: 7 },
  taskEditorCard: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, backgroundColor: "#ffffff", padding: 14 }, taskEditorTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }, taskEditorName: { flex: 1, color: "#111827", fontSize: 17, fontWeight: "700", paddingTop: 3, paddingRight: 8 }, taskEditorControls: { flexDirection: "row", alignItems: "center", gap: 8 }, editorStatusBadge: { borderRadius: 999, backgroundColor: "#f3f4f6", color: "#4b5563", fontSize: 11, fontWeight: "700", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 }, editorStatusBadgeCompleted: { backgroundColor: "#dcfce7", color: "#166534" }, editorStartAction: { borderRadius: 9, backgroundColor: "#111827", paddingHorizontal: 12, paddingVertical: 9 }, editorStartActionDisabled: { backgroundColor: "#9ca3af" }, editorStartText: { color: "#ffffff", fontSize: 13, fontWeight: "700" }, editorPauseAction: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, backgroundColor: "#ffffff", paddingHorizontal: 10, paddingVertical: 8 }, editorPauseText: { color: "#374151", fontSize: 12, fontWeight: "700" }, taskNameInput: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, color: "#111827", fontSize: 16, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 12 }, taskEditorFieldRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 }, taskEditorFieldLabel: { width: 82, color: "#4b5563", fontSize: 14, fontWeight: "500" }, taskEditorFieldControl: { flex: 1, minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, paddingHorizontal: 12 }, taskEditorTagButton: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "#9ca3af", borderRadius: 9, backgroundColor: "#ffffff", paddingHorizontal: 12 }, taskEditorTagButtonPressed: { backgroundColor: "#f3f4f6", opacity: 0.82 }, taskEditorFieldText: { flex: 1, color: "#111827", fontSize: 15 }, taskEditorEstimateInput: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, color: "#111827", fontSize: 16, paddingHorizontal: 12 }, memoDivider: { height: 1, backgroundColor: "#e5e7eb", marginTop: 6, marginBottom: 14 }, memoSectionTitle: { color: "#111827", fontSize: 16, fontWeight: "700", marginBottom: 10 }, memoInput: { minHeight: 180, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, color: "#111827", fontSize: 15, lineHeight: 22, paddingHorizontal: 12, paddingTop: 12 }, wikiSection: { marginTop: 18 }, wikiSectionTitle: { color: "#6b7280", fontSize: 13, marginBottom: 8 },
  privateSlotRow: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 }, privateSlotButton: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 8 }, privateSlotButtonActive: { backgroundColor: "#111827", borderColor: "#111827" }, privateSlotButtonText: { color: "#4b5563", fontSize: 12, fontWeight: "600" }, privateSlotButtonTextActive: { color: "#ffffff" },
});

export default ProjectWorkspaceScreen;
