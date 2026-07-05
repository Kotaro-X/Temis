import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Clipboard,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import MemoTextEditor from "../components/inputs/MemoTextEditor";
import WikiText from "../components/WikiText";
import { AppLanguage, t } from "../i18n";
import {
  deleteResearchNoteById,
  listResearchNotes,
  upsertResearchNote,
} from "../services/researchNoteService";
import {
  getCurrentWeeklyPrompt,
  listPublishedWeeklyPromptsForLanguage,
} from "../services/weeklyPromptService";
import { WeeklyPrompt } from "../types/weeklyPrompt";
import { ResearchNote } from "../types/research";

const CHAT_URL = "https://ig.me/j/AbYeWHV2gCB--JLL/";

type Props = {
  onBack: () => void;
  onOpenMenu: () => void;
  language: AppLanguage;
  refreshToken?: number;
};

type ResearchDraftSnapshot = {
  id: string | null;
  title: string;
  body: string;
};

const formatDateTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const pad2 = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const buildTitle = (note: ResearchNote, fallback: string) => {
  const title = note.title.trim();
  if (title.length > 0) {
    return title;
  }
  const trimmed = note.body.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed.length > 64 ? `${trimmed.slice(0, 64)}...` : trimmed;
};

const ResearchScreen = ({
  onBack,
  onOpenMenu,
  language,
  refreshToken = 0,
}: Props) => {
  const tr = (key: string) => t(language, key);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [weeklyPrompts, setWeeklyPrompts] = useState<WeeklyPrompt[]>([]);
  const [currentPrompt, setCurrentPrompt] = useState<WeeklyPrompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWeekPromptId, setSelectedWeekPromptId] = useState<string | null>(
    null,
  );

  const [detailNote, setDetailNote] = useState<ResearchNote | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [editorDeleting, setEditorDeleting] = useState(false);
  const [editorUpdatedAt, setEditorUpdatedAt] = useState<number | null>(null);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSnapshotRef = useRef<ResearchDraftSnapshot | null>(null);
  const lastSavedRef = useRef<ResearchDraftSnapshot | null>(null);
  const pendingSaveRef = useRef<ResearchDraftSnapshot | null>(null);
  const savingRef = useRef(false);
  const savingPromiseRef = useRef<Promise<void> | null>(null);
  const userEditedRef = useRef(false);

  const promptById = useMemo(
    () => new Map(weeklyPrompts.map((prompt) => [prompt.id, prompt])),
    [weeklyPrompts],
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const [loadedNotes, loadedPrompts, loadedCurrentPrompt] = await Promise.all([
        listResearchNotes(),
        listPublishedWeeklyPromptsForLanguage(language),
        getCurrentWeeklyPrompt(new Date(), language),
      ]);
      setNotes(loadedNotes);
      setWeeklyPrompts(loadedPrompts);
      setCurrentPrompt(loadedCurrentPrompt);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [language, refreshToken]);

  const hasSnapshotChanges = (
    snapshot: ResearchDraftSnapshot,
    lastSaved: ResearchDraftSnapshot | null,
  ) => {
    if (!lastSaved) {
      return true;
    }
    if (snapshot.id !== lastSaved.id) {
      return true;
    }
    if (snapshot.title !== lastSaved.title) {
      return true;
    }
    return snapshot.body !== lastSaved.body;
  };

  const saveDraft = async (snapshot: ResearchDraftSnapshot) => {
    if (savingRef.current) {
      pendingSaveRef.current = snapshot;
      return savingPromiseRef.current ?? Promise.resolve();
    }
    savingRef.current = true;
    const promise = (async () => {
      const hasAnyContent =
        snapshot.body.trim().length > 0 || snapshot.title.trim().length > 0;
      if (!hasAnyContent) {
        return;
      }
      const saved = await upsertResearchNote({
        id: snapshot.id ?? undefined,
        title: snapshot.title,
        body: snapshot.body,
        weeklyPrompt: snapshot.id ? null : currentPrompt,
      });
      const savedSnapshot: ResearchDraftSnapshot = {
        id: saved.id,
        title: saved.title,
        body: saved.body,
      };
      setEditingNoteId(saved.id);
      setEditorUpdatedAt(saved.updatedAt);
      latestSnapshotRef.current = savedSnapshot;
      lastSavedRef.current = savedSnapshot;
      await loadData();
    })();
    savingPromiseRef.current = promise;

    try {
      await promise;
    } finally {
      savingRef.current = false;
      savingPromiseRef.current = null;
      const pending = pendingSaveRef.current;
      if (pending && hasSnapshotChanges(pending, lastSavedRef.current)) {
        pendingSaveRef.current = null;
        void saveDraft(pending);
      } else {
        pendingSaveRef.current = null;
      }
    }
  };

  const flushDraft = async () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const snapshot = latestSnapshotRef.current;
    if (snapshot && hasSnapshotChanges(snapshot, lastSavedRef.current)) {
      await saveDraft(snapshot);
    }
  };

  const openCreateEditor = () => {
    userEditedRef.current = false;
    setEditingNoteId(null);
    setEditorUpdatedAt(null);
    setTitleDraft("");
    setBodyDraft("");
    latestSnapshotRef.current = { id: null, title: "", body: "" };
    lastSavedRef.current = { id: null, title: "", body: "" };
    setEditorOpen(true);
  };

  const openEditEditor = (note: ResearchNote) => {
    userEditedRef.current = false;
    setEditingNoteId(note.id);
    setEditorUpdatedAt(note.updatedAt);
    setTitleDraft(note.title);
    setBodyDraft(note.body);
    const snapshot: ResearchDraftSnapshot = {
      id: note.id,
      title: note.title,
      body: note.body,
    };
    latestSnapshotRef.current = snapshot;
    lastSavedRef.current = snapshot;
    setDetailNote(null);
    setEditorOpen(true);
  };

  const closeEditor = async () => {
    await flushDraft();
    setEditorOpen(false);
    setEditingNoteId(null);
    setEditorDeleting(false);
    setEditorUpdatedAt(null);
    setTitleDraft("");
    setBodyDraft("");
    latestSnapshotRef.current = null;
    lastSavedRef.current = null;
    pendingSaveRef.current = null;
    userEditedRef.current = false;
  };

  const handleTitleChange = (text: string) => {
    userEditedRef.current = true;
    setTitleDraft(text);
  };

  const handleBodyChange = (text: string) => {
    userEditedRef.current = true;
    setBodyDraft(text);
  };

  useEffect(() => {
    if (!editorOpen) {
      return;
    }
    latestSnapshotRef.current = {
      id: editingNoteId,
      title: titleDraft,
      body: bodyDraft,
    };
  }, [editorOpen, editingNoteId, titleDraft, bodyDraft]);

  useEffect(() => {
    if (!editorOpen || !userEditedRef.current) {
      return;
    }
    const snapshot = latestSnapshotRef.current;
    if (!snapshot || !hasSnapshotChanges(snapshot, lastSavedRef.current)) {
      return;
    }
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      void saveDraft(snapshot);
    }, 800);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [editorOpen, titleDraft, bodyDraft]);

  const handleDeleteFromEditor = () => {
    if (!editingNoteId || editorDeleting) {
      return;
    }
    Alert.alert(tr("research.deleteConfirmTitle"), tr("research.deleteConfirmBody"), [
      { text: tr("common.cancel"), style: "cancel" },
      {
        text: tr("common.delete"),
        style: "destructive",
        onPress: async () => {
          setEditorDeleting(true);
          try {
            await deleteResearchNoteById(editingNoteId);
            await loadData();
            await closeEditor();
          } finally {
            setEditorDeleting(false);
          }
        },
      },
    ]);
  };

  const handleDelete = (note: ResearchNote) => {
    Alert.alert(tr("research.deleteConfirmTitle"), tr("research.deleteConfirmBody"), [
      { text: tr("common.cancel"), style: "cancel" },
      {
        text: tr("common.delete"),
        style: "destructive",
        onPress: async () => {
          await deleteResearchNoteById(note.id);
          if (detailNote?.id === note.id) {
            setDetailNote(null);
          }
          await loadData();
        },
      },
    ]);
  };

  const usedWeeklyPrompts = useMemo(() => {
    const seen = new Set<string>();
    const results: WeeklyPrompt[] = [];
    for (const note of notes) {
      if (!note.weeklyPromptId || seen.has(note.weeklyPromptId)) {
        continue;
      }
      const prompt = promptById.get(note.weeklyPromptId);
      if (!prompt) {
        continue;
      }
      seen.add(note.weeklyPromptId);
      results.push(prompt);
    }
    return results.sort((a, b) =>
      a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0,
    );
  }, [notes, promptById]);

  const filteredNotes = useMemo(() => {
    if (!selectedWeekPromptId) {
      return notes;
    }
    return notes.filter((note) => note.weeklyPromptId === selectedWeekPromptId);
  }, [notes, selectedWeekPromptId]);

  const getPromptForNote = (note: ResearchNote) =>
    promptById.get(note.weeklyPromptId) ?? currentPrompt;

  const handleShare = async (note: ResearchNote) => {
    const prompt = getPromptForNote(note)?.prompt ?? "";
    const text = `${tr("research.shareQuestionLabel")}:\n${prompt}\n\n${tr(
      "research.shareBodyLabel",
    )}:\n${note.body}\n\n${tr("research.shareTag")}`;
    await Share.share({ message: text });
  };

  const handlePressToken = (token: string) => {
    Clipboard.setString(token);
    Alert.alert(tr("research.linkTokenCopiedTitle"), `((${token}))`);
  };

  const renderItem = ({ item }: { item: ResearchNote }) => {
    const notePrompt = promptById.get(item.weeklyPromptId);
    return (
      <Pressable style={styles.card} onPress={() => setDetailNote(item)}>
        <Text style={styles.cardTitle}>{buildTitle(item, tr("common.untitled"))}</Text>
        <WikiText body={item.body} style={styles.cardBody} onPressToken={handlePressToken} />
        <View style={styles.cardFooter}>
          <Text style={styles.metaText}>{formatDateTime(item.updatedAt)}</Text>
          <Text style={styles.metaText}>{notePrompt?.title ?? item.weekId}</Text>
        </View>
        {item.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {item.tags.map((tag) => (
              <View key={`${item.id}-${tag}`} style={styles.tagChip}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.fixedHeader}>
        <View style={styles.headerTopRow}>
          <Pressable style={[styles.menuButton, styles.headerEdgeLeft]} onPress={onOpenMenu}>
            <Ionicons name="menu" size={20} color="#111827" />
          </Pressable>
          <Text style={styles.headerTitle}>{tr("research.title")}</Text>
          <Pressable
            style={[styles.inlineButton, styles.headerEdgeRight]}
            onPress={onBack}
          >
            <Text style={styles.inlineButtonText}>{tr("common.back")}</Text>
          </Pressable>
        </View>
        <View style={styles.weeklySection}>
          <Text style={styles.weekLabel}>{tr("research.thisWeek")}</Text>
          <Text style={styles.promptText} numberOfLines={4} ellipsizeMode="tail">
            {currentPrompt?.prompt ?? tr("research.promptNotFound")}
          </Text>
          <View style={styles.promptActions}>
            <Pressable
              style={styles.promptActionButton}
              onPress={() => Linking.openURL(CHAT_URL)}
            >
              <Text style={styles.promptActionText}>{tr("research.openChat")}</Text>
            </Pressable>
            <Pressable
              style={styles.promptActionButton}
              onPress={() => {
                const text = currentPrompt?.prompt ?? "";
                Clipboard.setString(text);
              }}
            >
              <Text style={styles.promptActionText}>{tr("research.copy")}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.listContainer}>
        <View style={styles.filterRow}>
          <Pressable
            style={[
              styles.filterChip,
              selectedWeekPromptId === null && styles.filterChipActive,
            ]}
            onPress={() => setSelectedWeekPromptId(null)}
          >
            <Text
              style={[
                styles.filterChipText,
                selectedWeekPromptId === null && styles.filterChipTextActive,
              ]}
            >
              {tr("research.allWeeks")}
            </Text>
          </Pressable>
          {usedWeeklyPrompts.map((prompt) => {
            const active = selectedWeekPromptId === prompt.id;
            return (
              <Pressable
                key={prompt.id}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setSelectedWeekPromptId(prompt.id)}
              >
                <Text
                  style={[styles.filterChipText, active && styles.filterChipTextActive]}
                  numberOfLines={1}
                >
                  {prompt.title}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <FlatList
          data={filteredNotes}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {loading ? tr("common.loading") : tr("research.none")}
            </Text>
          }
        />
      </View>

      <Pressable style={styles.fab} onPress={openCreateEditor}>
        <Text style={styles.fabText}>{tr("research.new")}</Text>
      </Pressable>

      <Modal
        visible={editorOpen}
        animationType="slide"
        onRequestClose={() => {
          void closeEditor();
        }}
      >
        <SafeAreaView style={styles.modalContainer}>
          <KeyboardAvoidingView
            style={styles.editorKeyboardAvoid}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={styles.editorHeader}>
              <Pressable
                style={styles.editorBackButton}
                onPress={() => {
                  void closeEditor();
                }}
              >
                <Ionicons name="chevron-back" size={18} color="#111827" />
                <Text style={styles.editorBackText}>{tr("common.back")}</Text>
              </Pressable>
              <Text style={styles.editorTitle}>
                {editingNoteId ? tr("research.editTitle") : tr("research.newTitle")}
              </Text>
              <Pressable
                style={[
                  styles.editorDeleteButton,
                  (!editingNoteId || editorDeleting) && styles.editorDeleteButtonDisabled,
                ]}
                onPress={handleDeleteFromEditor}
                disabled={!editingNoteId || editorDeleting}
              >
                <Text style={styles.editorDeleteButtonText}>
                  {editorDeleting ? tr("memo.deleting") : tr("common.delete")}
                </Text>
              </Pressable>
            </View>
            <View style={styles.editorContainer}>
              <Text style={styles.editorDisplayTitle}>
                {titleDraft.trim() || tr("common.untitled")}
              </Text>
              <Text style={styles.editorMeta}>
                {editorUpdatedAt ? formatDateTime(editorUpdatedAt) : "-"}
              </Text>
              <View style={styles.titleInputRow}>
                <Text style={styles.titleLabel}>
                  {language === "en" ? "Title" : "タイトル"}
                </Text>
                <TextInput
                  style={styles.titleInput}
                  value={titleDraft}
                  onChangeText={handleTitleChange}
                  placeholder={tr("research.titlePlaceholder")}
                />
              </View>
              <MemoTextEditor
                value={bodyDraft}
                onChangeText={handleBodyChange}
                placeholder={tr("research.bodyPlaceholder")}
                enableHighlight={false}
                style={styles.editor}
                inputStyle={styles.editorInput}
                linkStyle={styles.memoLink}
              />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={detailNote !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailNote(null)}
      >
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={() => setDetailNote(null)} />
          {detailNote ? (
            <View style={styles.detailCard}>
              <Text style={styles.detailTitle}>
                {buildTitle(detailNote, tr("common.untitled"))}
              </Text>
              <WikiText
                body={detailNote.body}
                style={styles.detailBody}
                onPressToken={handlePressToken}
              />
              <View style={styles.detailActions}>
                <Pressable
                  style={styles.detailActionButton}
                  onPress={() => handleShare(detailNote)}
                >
                  <Text style={styles.detailActionText}>{tr("research.share")}</Text>
                </Pressable>
                <Pressable
                  style={styles.detailActionButton}
                  onPress={() => openEditEditor(detailNote)}
                >
                  <Text style={styles.detailActionText}>{tr("research.edit")}</Text>
                </Pressable>
                <Pressable
                  style={[styles.detailActionButton, styles.detailDeleteButton]}
                  onPress={() => handleDelete(detailNote)}
                >
                  <Text style={[styles.detailActionText, styles.detailDeleteText]}>
                    {tr("research.delete")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  fixedHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  weeklySection: {
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerTopRow: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    minHeight: 40,
  },
  headerEdgeLeft: {
    position: "absolute",
    left: 0,
  },
  headerEdgeRight: {
    position: "absolute",
    right: 0,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  inlineButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  menuButton: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  inlineButtonText: {
    color: "#111827",
    fontWeight: "600",
    fontSize: 14,
  },
  weekLabel: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 4,
    fontWeight: "600",
  },
  promptText: {
    fontSize: 14,
    color: "#0f172a",
    lineHeight: 20,
  },
  promptActions: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  promptActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
  },
  promptActionText: {
    color: "#111827",
    fontWeight: "600",
    fontSize: 13,
  },
  listContainer: {
    flex: 1,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#ffffff",
  },
  filterChipActive: {
    borderColor: "#0f172a",
    backgroundColor: "#0f172a",
  },
  filterChipText: {
    fontSize: 12,
    color: "#334155",
    maxWidth: 180,
  },
  filterChipTextActive: {
    color: "#ffffff",
    fontWeight: "600",
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 96,
  },
  emptyText: {
    marginTop: 24,
    textAlign: "center",
    color: "#64748b",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 6,
  },
  cardBody: {
    color: "#334155",
    lineHeight: 20,
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  metaText: {
    fontSize: 12,
    color: "#64748b",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "#eef2ff",
  },
  tagText: {
    color: "#3730a3",
    fontSize: 11,
    fontWeight: "600",
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  fabText: {
    color: "#111827",
    fontWeight: "700",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  editorKeyboardAvoid: {
    flex: 1,
  },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  editorBackButton: {
    flexDirection: "row",
    alignItems: "center",
    width: 72,
    minHeight: 44,
    paddingVertical: 8,
  },
  editorBackText: {
    color: "#111827",
    fontSize: 12,
    marginLeft: 2,
  },
  editorTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  editorDeleteButton: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#6b7280",
    alignItems: "center",
  },
  editorDeleteButtonDisabled: {
    opacity: 0.6,
  },
  editorDeleteButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  editorContainer: {
    flex: 1,
    padding: 16,
  },
  editorDisplayTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
  },
  editorMeta: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 12,
  },
  titleInputRow: {
    marginBottom: 12,
  },
  titleLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 6,
  },
  titleInput: {
    borderWidth: 1.2,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
  },
  editor: {
    flex: 1,
  },
  editorInput: {
    minHeight: 160,
  },
  memoLink: {
    backgroundColor: "#fef3c7",
    color: "#1f2937",
    fontWeight: "600",
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.45)",
  },
  detailCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 8,
  },
  detailBody: {
    color: "#334155",
    lineHeight: 20,
  },
  detailActions: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  detailActionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  detailActionText: {
    fontWeight: "600",
    color: "#0f172a",
  },
  detailDeleteButton: {
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  detailDeleteText: {
    color: "#b91c1c",
  },
});

export default ResearchScreen;
