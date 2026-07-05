import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { loadAllTodayStates } from "../../storage";
import WikiReferenceOverlay, {
  WikiReferenceFilter,
} from "../components/WikiReferenceOverlay";
import MemoTextEditor from "../components/inputs/MemoTextEditor";
import TokenChips from "../components/TokenChips";
import {
  deleteMemo,
  loadMemoById,
  updateMemo,
} from "../repositories/memoRepository";
import {
  deleteNoteById,
  getNoteById,
  upsertDailyNote,
  upsertFreeNote,
} from "../db/noteRepo";
import {
  deleteResearchNoteById,
  getResearchNoteById,
  upsertResearchNote,
} from "../services/researchNoteService";
import {
  listWikiReferencesByToken,
  WikiReferenceItem,
} from "../services/wikiReferenceService";
import { extractTokens } from "../utils/wikiLink";
import { AppLanguage, t } from "../i18n";

const pad2 = (num: number) => String(num).padStart(2, "0");

const toDateString = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;

const dateFromTimestamp = (timestamp: number) =>
  toDateString(new Date(timestamp));

const findTaskInfoById = async (taskId: string) => {
  const states = await loadAllTodayStates();
  let latest: { title: string; date: string } | null = null;
  for (const state of states) {
    for (const slot of Object.values(state.slots)) {
      for (const task of slot.tasks) {
        if (task.id !== taskId) {
          continue;
        }
        const title = task.taskName || "";
        if (!latest || state.date > latest.date) {
          latest = { title, date: state.date };
        }
      }
    }
  }
  return latest;
};

type MemoDetailData =
  | {
      kind: "task";
      memoId: string;
      taskId: string;
      title: string;
      date: string;
      body: string;
    }
  | {
      kind: "note";
      memoId: string;
      noteId: string;
      noteType: "daily" | "free";
      title: string;
      date: string;
      body: string;
    }
  | {
      kind: "tankyu";
      memoId: string;
      tankyuId: string;
      title: string;
      date: string;
      body: string;
    };

type Props = {
  memoId: string;
  onBack: () => void;
  language: AppLanguage;
};

type DraftSnapshot = {
  memoId: string;
  kind: "task" | "note" | "tankyu";
  taskId?: string;
  noteId?: string;
  noteType?: "daily" | "free";
  tankyuId?: string;
  date?: string;
  title: string;
  body: string;
};

type HistoryEntry = {
  memoId: string;
  referenceToken: string | null;
  referenceFilter: WikiReferenceFilter;
};

const MemoDetailScreen = ({
  memoId,
  onBack,
  language,
}: Props) => {
  const tr = (key: string) => t(language, key);
  const [activeMemoId, setActiveMemoId] = useState(memoId);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<MemoDetailData | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [referenceVisible, setReferenceVisible] = useState(false);
  const [referenceToken, setReferenceToken] = useState<string | null>(null);
  const [referenceFilter, setReferenceFilter] =
    useState<WikiReferenceFilter>("all");
  const [referenceItems, setReferenceItems] = useState<WikiReferenceItem[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [historyStack, setHistoryStack] = useState<HistoryEntry[]>([]);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<DraftSnapshot | null>(null);
  const latestSnapshotRef = useRef<DraftSnapshot | null>(null);
  const pendingSaveRef = useRef<DraftSnapshot | null>(null);
  const savingRef = useRef(false);
  const savingPromiseRef = useRef<Promise<void> | null>(null);
  const userEditedRef = useRef(false);
  const deletedRef = useRef(false);
  const displayTitle =
    detail?.kind === "tankyu" ||
    (detail?.kind === "note" && detail.noteType === "free")
      ? titleDraft.trim() || tr("common.untitled")
      : detail?.title ?? "";
  const tokens = useMemo(() => extractTokens(bodyDraft), [bodyDraft]);

  useEffect(() => {
    setActiveMemoId(memoId);
    setHistoryStack([]);
    setReferenceVisible(false);
    setReferenceToken(null);
    setReferenceFilter("all");
    setReferenceItems([]);
    setReferenceLoading(false);
  }, [memoId]);

  const buildSnapshot = (
    source: MemoDetailData,
    body: string,
    title: string,
  ): DraftSnapshot => {
    if (source.kind === "task") {
      return {
        memoId: source.memoId,
        kind: "task",
        taskId: source.taskId,
        title: "",
        body,
      };
    }
    if (source.kind === "tankyu") {
      return {
        memoId: source.memoId,
        kind: "tankyu",
        tankyuId: source.tankyuId,
        title,
        body,
      };
    }
    return {
      memoId: source.memoId,
      kind: "note",
      noteId: source.noteId,
      noteType: source.noteType,
      date: source.noteType === "daily" ? source.date : undefined,
      title: source.noteType === "free" ? title : "",
      body,
    };
  };

  const hasChanges = (snapshot: DraftSnapshot, lastSaved: DraftSnapshot | null) => {
    if (!lastSaved) {
      return true;
    }
    if (snapshot.memoId !== lastSaved.memoId) {
      return true;
    }
    if (snapshot.noteType !== lastSaved.noteType) {
      return true;
    }
    if (snapshot.title !== lastSaved.title) {
      return true;
    }
    return snapshot.body !== lastSaved.body;
  };

  const saveDraft = async (snapshot: DraftSnapshot) => {
    if (deletedRef.current) {
      return;
    }
    if (savingRef.current) {
      pendingSaveRef.current = snapshot;
      return savingPromiseRef.current ?? Promise.resolve();
    }
    savingRef.current = true;
    const savePromise = (async () => {
      if (snapshot.kind === "task" && snapshot.taskId) {
        await updateMemo(snapshot.taskId, snapshot.body, {
          indexMode: "async",
        });
      } else if (snapshot.noteType === "daily") {
        if (snapshot.date) {
          await upsertDailyNote(snapshot.date, snapshot.body);
        }
      } else if (snapshot.noteId) {
        await upsertFreeNote({
          id: snapshot.noteId,
          title: snapshot.title.trim() || null,
          body: snapshot.body,
        });
      } else if (snapshot.kind === "tankyu" && snapshot.tankyuId) {
        await upsertResearchNote({
          id: snapshot.tankyuId,
          title: snapshot.title,
          body: snapshot.body,
          weeklyPrompt: null,
        });
      }
    })();
    savingPromiseRef.current = savePromise;
    try {
      await savePromise;
      if (!deletedRef.current) {
        lastSavedRef.current = snapshot;
      }
    } finally {
      savingRef.current = false;
      savingPromiseRef.current = null;
      const pending = pendingSaveRef.current;
      if (!deletedRef.current && pending && hasChanges(pending, lastSavedRef.current)) {
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
    if (snapshot && hasChanges(snapshot, lastSavedRef.current)) {
      await saveDraft(snapshot);
    }
  };

  const handleTitleChange = (text: string) => {
    userEditedRef.current = true;
    setTitleDraft(text);
  };

  const handleBodyChange = (text: string) => {
    userEditedRef.current = true;
    setBodyDraft(text);
  };

  const handlePressToken = (token: string) => {
    setReferenceToken(token);
    setReferenceFilter("all");
    setReferenceVisible(true);
  };

  const handleCloseReferences = () => {
    setReferenceVisible(false);
  };

  const handleSelectReference = async (nextMemoId: string) => {
    if (nextMemoId === activeMemoId) {
      setReferenceVisible(false);
      return;
    }
    await flushDraft();
    setHistoryStack((prev) => [
      ...prev,
      {
        memoId: activeMemoId,
        referenceToken,
        referenceFilter,
      },
    ]);
    setReferenceVisible(false);
    setReferenceToken(null);
    setReferenceItems([]);
    setActiveMemoId(nextMemoId);
  };

  const handleBack = async () => {
    if (historyStack.length === 0) {
      onBack();
      return;
    }
    await flushDraft();
    const previous = historyStack[historyStack.length - 1];
    setHistoryStack((prev) => prev.slice(0, -1));
    setReferenceToken(previous.referenceToken);
    setReferenceFilter(previous.referenceFilter);
    setReferenceVisible(true);
    setActiveMemoId(previous.memoId);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      userEditedRef.current = false;
      deletedRef.current = false;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      try {
        if (activeMemoId.startsWith("note:")) {
          const noteId = activeMemoId.slice("note:".length);
          const note = await getNoteById(noteId);
          if (!active) {
            return;
          }
          if (!note) {
            setDetail(null);
            return;
          }
          const date = note.date ?? dateFromTimestamp(note.updatedAt);
          const title =
            note.type === "free"
              ? note.title?.trim() || tr("common.untitled")
              : "Daily";
          const loaded: MemoDetailData = {
            kind: "note",
            memoId,
            noteId: note.id,
            noteType: note.type,
            title,
            date,
            body: note.body,
          };
          const snapshot = buildSnapshot(
            loaded,
            note.body,
            note.title ?? "",
          );
          setDetail(loaded);
          setTitleDraft(note.title ?? "");
          setBodyDraft(note.body);
          lastSavedRef.current = snapshot;
          latestSnapshotRef.current = snapshot;
          return;
        }
        if (activeMemoId.startsWith("tankyu:")) {
          const tankyuId = activeMemoId.slice("tankyu:".length);
          const note = await getResearchNoteById(tankyuId);
          if (!active) {
            return;
          }
          if (!note) {
            setDetail(null);
            return;
          }
          const loaded: MemoDetailData = {
            kind: "tankyu",
            memoId,
            tankyuId: note.id,
            title: note.title?.trim() || tr("research.title"),
            date: dateFromTimestamp(note.updatedAt),
            body: note.body,
          };
          const snapshot = buildSnapshot(loaded, note.body, note.title ?? "");
          setDetail(loaded);
          setTitleDraft(note.title ?? "");
          setBodyDraft(note.body);
          lastSavedRef.current = snapshot;
          latestSnapshotRef.current = snapshot;
          return;
        }
        const memo = await loadMemoById(activeMemoId);
        if (!active) {
          return;
        }
        if (!memo) {
          setDetail(null);
          return;
        }
        const info = await findTaskInfoById(memo.taskId);
        if (!active) {
          return;
        }
        const date = info?.date ?? dateFromTimestamp(memo.updatedAt);
        const loaded: MemoDetailData = {
          kind: "task",
          memoId,
          taskId: memo.taskId,
          title: info?.title?.trim() || tr("common.untitled"),
          date,
          body: memo.body,
        };
        const snapshot = buildSnapshot(loaded, memo.body, "");
        setDetail(loaded);
        setTitleDraft("");
        setBodyDraft(memo.body);
        lastSavedRef.current = snapshot;
        latestSnapshotRef.current = snapshot;
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [activeMemoId]);

  useEffect(() => {
    if (!referenceVisible || !referenceToken) {
      setReferenceLoading(false);
      setReferenceItems([]);
      return;
    }
    let active = true;
    setReferenceLoading(true);
    listWikiReferencesByToken(referenceToken, {
      excludeMemoId: activeMemoId,
    })
      .then((items) => {
        if (active) {
          setReferenceItems(items);
        }
      })
      .catch(() => {
        if (active) {
          setReferenceItems([]);
        }
      })
      .finally(() => {
        if (active) {
          setReferenceLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [referenceVisible, referenceToken, activeMemoId]);

  useEffect(() => {
    if (!detail) {
      latestSnapshotRef.current = null;
      return;
    }
    latestSnapshotRef.current = buildSnapshot(detail, bodyDraft, titleDraft);
  }, [detail, bodyDraft, titleDraft]);

  useEffect(() => {
    if (!detail || loading) {
      return;
    }
    if (!userEditedRef.current) {
      return;
    }
    const snapshot = latestSnapshotRef.current;
    if (!snapshot || !hasChanges(snapshot, lastSavedRef.current)) {
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
  }, [detail, bodyDraft, titleDraft, loading]);

  useEffect(() => () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    const snapshot = latestSnapshotRef.current;
    if (snapshot && hasChanges(snapshot, lastSavedRef.current)) {
      void saveDraft(snapshot);
    }
  }, []);

  const handleDeleteConfirmed = async () => {
    if (!detail || deleting) {
      return;
    }
    setDeleting(true);
    deletedRef.current = true;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
    try {
      const inFlight = savingPromiseRef.current;
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          // ignore autosave errors when deleting
        }
      }
      if (detail.kind === "task") {
        await deleteMemo(detail.memoId);
      } else if (detail.kind === "note") {
        await deleteNoteById(detail.noteId);
      } else {
        await deleteResearchNoteById(detail.tankyuId);
      }
      if (historyStack.length > 0) {
        const previous = historyStack[historyStack.length - 1];
        setHistoryStack((prev) => prev.slice(0, -1));
        setReferenceToken(previous.referenceToken);
        setReferenceFilter(previous.referenceFilter);
        setReferenceVisible(true);
        setActiveMemoId(previous.memoId);
      } else {
        onBack();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[MemoDetail] delete failed ${message}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleDelete = () => {
    if (!detail || deleting) {
      return;
    }
    Alert.alert(tr("memo.confirmDeleteTitle"), tr("memo.confirmDeleteBody"), [
      { text: tr("common.cancel"), style: "cancel" },
      { text: tr("common.delete"), style: "destructive", onPress: () => void handleDeleteConfirmed() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => void handleBack()}>
            <Ionicons name="chevron-back" size={18} color="#2563eb" />
            <Text style={styles.backText}>{tr("common.back")}</Text>
          </Pressable>
          <Text style={styles.title}>
            {detail?.kind === "note"
              ? "Note"
              : detail?.kind === "tankyu"
                ? tr("research.title")
                : tr("memo.detailTitle")}
          </Text>
          <Pressable
            style={[
              styles.deleteButton,
              (deleting || loading || !detail) && styles.deleteButtonDisabled,
            ]}
            onPress={handleDelete}
            disabled={deleting || loading || !detail}
          >
            <Text style={styles.deleteButtonText}>
              {deleting ? tr("memo.deleting") : tr("common.delete")}
            </Text>
          </Pressable>
        </View>
        <View style={styles.container}>
          {loading ? (
            <Text style={styles.helperText}>{tr("common.loading")}</Text>
          ) : !detail ? (
            <Text style={styles.helperText}>{tr("memo.notFound")}</Text>
          ) : (
            <>
              <Text style={styles.memoTitle}>{displayTitle}</Text>
              <Text style={styles.memoMeta}>{detail.date}</Text>
              {(detail.kind === "tankyu" ||
                (detail.kind === "note" && detail.noteType === "free")) ? (
                <View style={styles.titleInputRow}>
                  <Text style={styles.label}>
                    {language === "en" ? "Title" : "タイトル"}
                  </Text>
                  <TextInput
                    style={styles.titleInput}
                    value={titleDraft}
                    onChangeText={handleTitleChange}
                    placeholder={language === "en" ? "Title (optional)" : "タイトル（任意）"}
                  />
                </View>
              ) : null}
              <MemoTextEditor
                value={bodyDraft}
                onChangeText={handleBodyChange}
                placeholder={language === "en" ? "Body" : "本文"}
                style={styles.editor}
                inputStyle={styles.bodyInput}
                linkStyle={styles.memoLink}
                enableHighlight={false}
              />
              <View style={styles.tokenSection}>
                <Text style={styles.label}>
                  {language === "en" ? "Wiki links" : "Wikiリンク"}
                </Text>
                <TokenChips
                  tokens={tokens}
                  onPressToken={handlePressToken}
                  emptyLabel={language === "en" ? "No linked terms" : undefined}
                />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
      <WikiReferenceOverlay
        visible={referenceVisible}
        token={referenceToken}
        items={referenceItems}
        loading={referenceLoading}
        filter={referenceFilter}
        language={language}
        onClose={handleCloseReferences}
        onChangeFilter={setReferenceFilter}
        onSelectItem={(nextMemoId) => void handleSelectReference(nextMemoId)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#ffffff",
    position: "relative",
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    width: 72,
    minHeight: 44,
    paddingVertical: 8,
  },
  backText: {
    color: "#2563eb",
    fontSize: 12,
    marginLeft: 2,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  deleteButton: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#6b7280",
    alignItems: "center",
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  container: {
    flex: 1,
    padding: 16,
  },
  helperText: {
    fontSize: 12,
    color: "#6b7280",
  },
  memoTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
  },
  memoMeta: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 12,
  },
  titleInputRow: {
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 6,
  },
  titleInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
  },
  bodyInput: {
    minHeight: 160,
  },
  memoLink: {
    backgroundColor: "#fef3c7",
    color: "#1f2937",
    fontWeight: "600",
  },
  editor: {
    flex: 1,
  },
  tokenSection: {
    marginTop: 12,
  },
});

export default MemoDetailScreen;
