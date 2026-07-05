import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  InputAccessoryView,
  Keyboard,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TextInputSelectionChangeEventData,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { loadAllTodayStates, loadTagLibrary } from "../../storage";
import { deleteMemoById, listAllMemos } from "../db/memoRepo";
import { deleteNoteById, listAllNotes, upsertFreeNote } from "../db/noteRepo";
import {
  deleteResearchNoteById,
  listResearchNotes,
} from "../services/researchNoteService";
import {
  normalizeKey,
  normalizeParens,
  tokenizeLinks,
} from "../utils/linkTokenize";
import { normalizeSearchToken } from "../utils/wikiLink";
import {
  buildNoteDocumentId,
  buildTankyuDocumentId,
} from "../services/indexTextBuilder";
import BracketToolbar from "../components/BracketToolbar";
import { AppLanguage, t } from "../i18n";
import { useAI } from "../hooks/useAI";
import type { AIEvidence } from "../types";

export type MemoNavigation = {
  push: (screen: "MemoDetail", params: { id: string }) => void;
};

type MemoTab = "all" | "task" | "note";

type MemoItem = {
  key: string;
  memoId: string;
  date: string;
  memoTitle: string;
  memoText: string;
  taskTitle: string;
  updatedAt: number;
  source: "task" | "note" | "tankyu";
  taskId?: string;
  noteId?: string;
  noteType?: "daily" | "free";
  noteTitle?: string | null;
  tankyuId?: string;
  tags?: string[];
};

type Section = {
  title: string;
  data: MemoItem[];
};

type Props = {
  onBack: () => void;
  onOpenMenu: () => void;
  navigation: MemoNavigation;
  initialTab?: MemoTab;
  refreshToken?: number;
  language: AppLanguage;
};

type LabeledEvidence = AIEvidence & {
  evidenceId: string;
};

type Selection = {
  start: number;
  end: number;
};

type AnswerPanelProps = {
  answerText: string;
  errorText: string | null;
  title: string;
};

type CitationListProps = {
  title: string;
  evidence: LabeledEvidence[];
  memoItemByMemoId: Map<string, MemoItem>;
  onOpenMemoId: (memoId: string) => void;
  highlightedEvidenceIds?: Set<string>;
  showTokens?: boolean;
  keyPrefix: string;
  formatLabel?: (value: string) => string;
};

const TAB_LABELS: Record<MemoTab, string> = {
  all: "All",
  task: "Task",
  note: "Note",
};
const ALL_TAG_FILTER = "すべて";
const NO_TAG_FILTER = "タグ未設定";

const pad2 = (num: number) => String(num).padStart(2, "0");

const toDateString = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;

const dateFromTimestamp = (timestamp: number) =>
  toDateString(new Date(timestamp));

const buildMemoTitle = (text: string, maxLength = 60) => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "メモ";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
};

const buildTaskIndex = async () => {
  const states = await loadAllTodayStates();
  const taskIndex = new Map<string, { title: string; date: string; tags: string[] }>();
  for (const state of states) {
    for (const slot of Object.values(state.slots)) {
      for (const task of slot.tasks) {
        if (!task.id) {
          continue;
        }
        const title = task.taskName || "未設定";
        const existing = taskIndex.get(task.id);
        if (!existing || state.date > existing.date) {
          taskIndex.set(task.id, { title, date: state.date, tags: task.tags ?? [] });
        }
      }
    }
  }
  return taskIndex;
};

const buildMemoItems = async (): Promise<MemoItem[]> => {
  const [taskIndex, memos, notes, tankyuNotes] = await Promise.all([
    buildTaskIndex(),
    listAllMemos(),
    listAllNotes(),
    listResearchNotes(),
  ]);
  const items: MemoItem[] = [];
  for (const memo of memos) {
    const info = taskIndex.get(memo.taskId);
    const updatedAt = memo.updatedAt ?? memo.createdAt;
    const date = info?.date ?? dateFromTimestamp(updatedAt);
    items.push({
      key: `task:${memo.id}`,
      memoId: memo.id,
      updatedAt,
      date,
      memoTitle: buildMemoTitle(memo.body),
      memoText: memo.body,
      taskTitle: info?.title ?? "未設定",
      source: "task",
      taskId: memo.taskId,
      tags: info?.tags ?? [],
    });
  }
  for (const note of notes) {
    const updatedAt = note.updatedAt;
    const date = note.date ?? dateFromTimestamp(updatedAt);
    const memoTitle =
      note.type === "free"
        ? note.title?.trim() || "無題"
        : "Daily";
    items.push({
      key: `note:${note.id}`,
      memoId: buildNoteDocumentId(note.id),
      updatedAt,
      date,
      memoTitle,
      memoText: note.body,
      taskTitle: "メモ",
      source: "note",
      noteId: note.id,
      noteType: note.type,
      noteTitle: note.title ?? null,
    });
  }
  for (const note of tankyuNotes) {
    const updatedAt = note.updatedAt;
    items.push({
      key: `tankyu:${note.id}`,
      memoId: buildTankyuDocumentId(note.id),
      updatedAt,
      date: dateFromTimestamp(updatedAt),
      memoTitle: note.title?.trim() || buildMemoTitle(note.body),
      memoText: note.body,
      taskTitle: "探究",
      source: "tankyu",
      tankyuId: note.id,
      tags: note.tags ?? [],
    });
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
};

const extractLinkQuery = (input: string) => {
  const normalized = normalizeParens(input);
  const start = normalized.lastIndexOf("((");
  if (start === -1) {
    return { isActive: false, query: "" };
  }
  const after = normalized.slice(start + 2);
  if (after.includes("))")) {
    return { isActive: false, query: "" };
  }
  return { isActive: true, query: after };
};

const AnswerPanel = ({ answerText, errorText, title }: AnswerPanelProps) => {
  if (!answerText && !errorText) {
    return null;
  }
  return (
    <View
      style={[
        styles.qaAnswerPanel,
        errorText ? styles.qaAnswerPanelError : null,
      ]}
    >
      <Text style={styles.qaAnswerLabel}>{title}</Text>
      <ScrollView
        style={styles.qaAnswerScroll}
        contentContainerStyle={styles.qaAnswerScrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        <Text
          style={[
            styles.qaAnswerText,
            errorText ? styles.qaAnswerErrorText : null,
          ]}
        >
          {errorText || answerText}
        </Text>
      </ScrollView>
    </View>
  );
};

const CitationList = ({
  title,
  evidence,
  memoItemByMemoId,
  onOpenMemoId,
  highlightedEvidenceIds,
  showTokens = false,
  keyPrefix,
  formatLabel,
}: CitationListProps) => (
  <View style={styles.qaCitedSection}>
    <Text style={styles.qaCitedTitle}>{title}</Text>
    {evidence.map((result) => {
      const memo = memoItemByMemoId.get(result.memoId);
      const isHighlighted = !!highlightedEvidenceIds?.has(result.evidenceId);
      return (
        <Pressable
          key={`${keyPrefix}:${result.chunkId}:${result.evidenceId}`}
          style={[
            styles.qaResultItem,
            isHighlighted ? styles.qaCitedItem : null,
          ]}
          onPress={() => onOpenMemoId(result.memoId)}
        >
          <Text style={styles.qaEvidenceId}>[{result.evidenceId}]</Text>
          <Text style={styles.qaResultSnippet}>{result.snippetText}</Text>
          <Text style={styles.qaResultMeta}>
            {(memo?.date ?? "-") +
              " · " +
              (formatLabel
                ? formatLabel(memo?.taskTitle ?? "メモ")
                : memo?.taskTitle ?? "メモ") +
              " · " +
              (memo?.source === "task"
                ? "Task"
                : memo?.source === "note"
                  ? "Note"
                  : memo?.source === "tankyu"
                    ? "Tankyu"
                    : "-")}
          </Text>
          {showTokens && (result.tokensHit?.length ?? 0) > 0 ? (
            <Text style={styles.qaResultTokens}>
              {result.tokensHit?.map((token) => `((` + token + `))`).join(" ")}
            </Text>
          ) : null}
        </Pressable>
      );
    })}
  </View>
);

const MemoScreen = ({
  onBack,
  onOpenMenu,
  navigation,
  initialTab,
  refreshToken = 0,
  language,
}: Props) => {
  const tr = (key: string) => t(language, key);
  const allTagLabel = tr("common.all");
  const noTagLabel = tr("common.noTag");
  const untitledLabel = tr("common.untitled");
  const memoDefaultTitle = tr("memo.defaultTitle");
  const tankyuLabel = tr("research.title");
  const normalizeUiText = (value: string) => {
    if (value === "メモ") {
      return memoDefaultTitle;
    }
    if (value === "未設定" || value === "無題") {
      return untitledLabel;
    }
    if (value === "タグ未設定") {
      return noTagLabel;
    }
    if (value === "探究") {
      return tankyuLabel;
    }
    return value;
  };
  const sourceLabel = (source: MemoItem["source"]) => {
    if (source === "task") {
      return language === "en" ? "Task" : "タスク";
    }
    if (source === "note") {
      return memoDefaultTitle;
    }
    return tankyuLabel;
  };
  const [tab, setTab] = useState<MemoTab>(initialTab ?? "all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MemoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const [deletingMemoKeys, setDeletingMemoKeys] = useState<string[]>([]);
  const [tagLibrary, setTagLibrary] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState(ALL_TAG_FILTER);
  const [headerBottomY, setHeaderBottomY] = useState(0);
  const [qaInputFocused, setQaInputFocused] = useState(false);
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [qaSelection, setQaSelection] = useState<Selection | null>(null);
  const [qaSelectionOverride, setQaSelectionOverride] = useState<Selection | null>(null);
  const [searchSelection, setSearchSelection] = useState<Selection | null>(null);
  const [searchSelectionOverride, setSearchSelectionOverride] = useState<Selection | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const listRef = useRef<SectionList<MemoItem>>(null);
  const qaAccessoryId = useMemo(
    () => `qa-toolbar-${Math.random().toString(36).slice(2, 10)}`,
    [],
  );
  const searchAccessoryId = useMemo(
    () => `search-toolbar-${Math.random().toString(36).slice(2, 10)}`,
    [],
  );
  const {
    query: qaQuery,
    setQuery: setQaQuery,
    searched: qaSearched,
    searchLoading: qaSearchLoading,
    answerLoading: qaAnswerLoading,
    answerText: qaAnswerText,
    error: qaAnswerError,
    allEvidence: qaResults,
    citedEvidenceKeys: qaCitedEvidenceIds,
    showAllEvidence: qaShowAllEvidence,
    setShowAllEvidence: setQaShowAllEvidence,
    run: runQaSearch,
  } = useAI({
    searchError: tr("memo.qaErrorSearch"),
    searchTimeoutError: tr("memo.qaErrorSearchTimeout"),
    answerError: tr("memo.qaErrorAnswer"),
    answerTimeoutError: tr("memo.qaErrorAnswerTimeout"),
  });

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
    }
  }, [initialTab]);

  const loadItems = useCallback(() => {
    let active = true;
    setLoading(true);
    buildMemoItems()
      .then((loaded) => {
        if (active) {
          setItems(loaded);
        }
      })
      .catch(() => {
        if (active) {
          setItems([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => loadItems(), [loadItems, refreshToken]);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      const windowHeight = Dimensions.get("window").height;
      const keyboardTop = event.endCoordinates.screenY;
      const heightOffset = event.endCoordinates.height;
      const nextOffset =
        Platform.OS === "ios"
          ? Math.max(0, windowHeight - keyboardTop)
          : Math.max(0, heightOffset);
      setKeyboardVisible(true);
      setKeyboardOffset(nextOffset);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      setKeyboardOffset(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    const end = qaQuery.length;
    setQaSelection((prev) => {
      if (!prev) {
        return prev;
      }
      const nextStart = Math.min(prev.start, end);
      const nextEnd = Math.min(prev.end, end);
      if (nextStart === prev.start && nextEnd === prev.end) {
        return prev;
      }
      return { start: nextStart, end: nextEnd };
    });
    setQaSelectionOverride((prev) => {
      if (!prev) {
        return prev;
      }
      const nextStart = Math.min(prev.start, end);
      const nextEnd = Math.min(prev.end, end);
      if (nextStart === prev.start && nextEnd === prev.end) {
        return prev;
      }
      return { start: nextStart, end: nextEnd };
    });
  }, [qaQuery]);

  useEffect(() => {
    const end = query.length;
    setSearchSelection((prev) => {
      if (!prev) {
        return prev;
      }
      const nextStart = Math.min(prev.start, end);
      const nextEnd = Math.min(prev.end, end);
      if (nextStart === prev.start && nextEnd === prev.end) {
        return prev;
      }
      return { start: nextStart, end: nextEnd };
    });
    setSearchSelectionOverride((prev) => {
      if (!prev) {
        return prev;
      }
      const nextStart = Math.min(prev.start, end);
      const nextEnd = Math.min(prev.end, end);
      if (nextStart === prev.start && nextEnd === prev.end) {
        return prev;
      }
      return { start: nextStart, end: nextEnd };
    });
  }, [query]);

  const handleQaSelectionChange = (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    const next = event.nativeEvent.selection;
    setQaSelection(next);
    setQaSelectionOverride((prev) => {
      if (!prev) {
        return prev;
      }
      return prev.start !== next.start || prev.end !== next.end ? null : prev;
    });
  };

  const applyQaSelection = (next: Selection) => {
    setQaSelection(next);
    setQaSelectionOverride(next);
  };

  const handleSearchSelectionChange = (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    const next = event.nativeEvent.selection;
    setSearchSelection(next);
    setSearchSelectionOverride((prev) => {
      if (!prev) {
        return prev;
      }
      return prev.start !== next.start || prev.end !== next.end ? null : prev;
    });
  };

  const applySearchSelection = (next: Selection) => {
    setSearchSelection(next);
    setSearchSelectionOverride(next);
  };

  useEffect(() => {
    let active = true;
    loadTagLibrary()
      .then((tags) => {
        if (active) {
          setTagLibrary(tags);
        }
      })
      .catch(() => {
        if (active) {
          setTagLibrary([]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (tab === "note" && tagFilter !== ALL_TAG_FILTER) {
      setTagFilter(ALL_TAG_FILTER);
    }
  }, [tab, tagFilter]);

  const activeTagSet = useMemo(() => new Set(tagLibrary), [tagLibrary]);

  const linkIndex = useMemo(() => {
    const index = new Map<string, { label: string; count: number }>();
    for (const item of items) {
      const parts = tokenizeLinks(item.memoText);
      for (const part of parts) {
        if (part.type !== "link") {
          continue;
        }
        const token = part.value.trim();
        if (!token) {
          continue;
        }
        const key = normalizeKey(token);
        if (!key) {
          continue;
        }
        const existing = index.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          index.set(key, { label: token, count: 1 });
        }
      }
    }
    return index;
  }, [items]);

  const activeLinkQuery = useMemo(() => extractLinkQuery(query), [query]);

  const suggestions = useMemo(() => {
    if (!activeLinkQuery.isActive) {
      return [];
    }
    const entries = Array.from(linkIndex.entries()).map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
    }));
    if (entries.length === 0) {
      return [];
    }
    const needle = normalizeKey(activeLinkQuery.query);
    if (!needle) {
      return entries
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }
    const prefixMatches: typeof entries = [];
    const containsMatches: typeof entries = [];
    for (const entry of entries) {
      if (entry.key.startsWith(needle)) {
        prefixMatches.push(entry);
      } else if (entry.key.includes(needle)) {
        containsMatches.push(entry);
      }
    }
    prefixMatches.sort((a, b) => b.count - a.count);
    containsMatches.sort((a, b) => b.count - a.count);
    return [...prefixMatches, ...containsMatches].slice(0, 10);
  }, [activeLinkQuery, linkIndex]);

  const tabbedItems = useMemo(() => {
    if (tab === "task") {
      return items.filter((item) => item.source === "task");
    }
    if (tab === "note") {
      return items.filter((item) => item.source === "note");
    }
    return items;
  }, [items, tab]);

  const tagFilterOptions = useMemo(() => {
    const options = [ALL_TAG_FILTER, ...tagLibrary];
    const hasNoTag = items.some((item) => {
      if (item.source !== "task" && item.source !== "tankyu") {
        return false;
      }
      const validTags = (item.tags ?? []).filter((tag) =>
        activeTagSet.has(tag),
      );
      return validTags.length === 0;
    });
    if (hasNoTag && !options.includes(NO_TAG_FILTER)) {
      options.push(NO_TAG_FILTER);
    }
    return options;
  }, [tagLibrary, items, activeTagSet]);

  useEffect(() => {
    if (!tagFilterOptions.includes(tagFilter)) {
      setTagFilter(ALL_TAG_FILTER);
    }
  }, [tagFilterOptions, tagFilter]);

  const tagFilteredItems = useMemo(() => {
    if (tab === "note" || tagFilter === ALL_TAG_FILTER) {
      return tabbedItems;
    }
    return tabbedItems.filter((item) => {
      if (item.source !== "task" && item.source !== "tankyu") {
        return false;
      }
      const validTags = (item.tags ?? []).filter((tag) =>
        activeTagSet.has(tag),
      );
      if (tagFilter === NO_TAG_FILTER) {
        return validTags.length === 0;
      }
      return validTags.includes(tagFilter);
    });
  }, [tab, tabbedItems, tagFilter, activeTagSet]);

  const filteredItems = useMemo(() => {
    const rawInput = normalizeParens(query).trim();
    if (!rawInput) {
      return tagFilteredItems;
    }
    const normalizedQuery = normalizeSearchToken(rawInput).toLowerCase();
    const rawQuery = rawInput.toLowerCase();
    const keys =
      normalizedQuery === rawQuery
        ? [rawQuery]
        : [normalizedQuery, rawQuery];
    return tagFilteredItems.filter((item) => {
      const title = normalizeParens(item.memoTitle).toLowerCase();
      const body = normalizeParens(item.memoText).toLowerCase();
      return keys.some((key) => key && (title.includes(key) || body.includes(key)));
    });
  }, [tagFilteredItems, query]);

  const sections = useMemo<Section[]>(() => {
    const grouped = new Map<string, MemoItem[]>();
    for (const item of filteredItems) {
      if (!grouped.has(item.date)) {
        grouped.set(item.date, []);
      }
      grouped.get(item.date)?.push(item);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([title, data]) => ({ title, data }));
  }, [filteredItems]);

  useEffect(() => {
    if (sections.length === 0) {
      return;
    }
    requestAnimationFrame(() => {
      listRef.current?.scrollToLocation?.({
        sectionIndex: 0,
        itemIndex: 0,
        viewOffset: 0,
        animated: false,
      });
    });
  }, [tab, tagFilter, sections.length]);

  const memoItemByMemoId = useMemo(() => {
    const index = new Map<string, MemoItem>();
    for (const item of items) {
      index.set(item.memoId, item);
    }
    return index;
  }, [items]);

  const labeledEvidence = useMemo<LabeledEvidence[]>(
    () =>
      qaResults
        .slice()
        .sort(
          (left, right) =>
            (right.tokensHit?.length ?? 0) - (left.tokensHit?.length ?? 0) ||
            (right.score ?? 0) - (left.score ?? 0) ||
            left.chunkId.localeCompare(right.chunkId),
        )
        .map((item, index) => ({
          ...item,
          evidenceId: `E${index + 1}`,
        })),
    [qaResults],
  );

  const citedEvidence = useMemo(() => {
    const citedSet = new Set(qaCitedEvidenceIds);
    return labeledEvidence.filter((item) => citedSet.has(item.evidenceId));
  }, [labeledEvidence, qaCitedEvidenceIds]);

  const citedEvidenceIdSet = useMemo(
    () => new Set(qaCitedEvidenceIds),
    [qaCitedEvidenceIds],
  );

  const handleSearchEvidence = async () => {
    await runQaSearch();
  };

  const openMemoDetail = (memoId: string) => {
    navigation.push("MemoDetail", { id: memoId });
  };

  const handleAddNote = async () => {
    if (creatingNote) {
      return;
    }
    setCreatingNote(true);
    try {
      const created = await upsertFreeNote({ title: null, body: "" });
      const memoTitle = created.title?.trim() || untitledLabel;
      const date = created.date ?? dateFromTimestamp(created.updatedAt);
      const memoId = buildNoteDocumentId(created.id);
      const newItem: MemoItem = {
        key: `note:${created.id}`,
        memoId,
        updatedAt: created.updatedAt,
        date,
        memoTitle,
        memoText: created.body,
        taskTitle: memoDefaultTitle,
        source: "note",
        noteId: created.id,
        noteType: created.type,
        noteTitle: created.title ?? null,
      };
      setItems((prev) => [newItem, ...prev.filter((item) => item.memoId !== memoId)]);
      openMemoDetail(memoId);
    } finally {
      setCreatingNote(false);
    }
  };

  const confirmDeleteMemo = async (item: MemoItem) => {
    setDeletingMemoKeys((prev) =>
      prev.includes(item.key) ? prev : [...prev, item.key],
    );
    try {
      if (item.source === "task") {
        await deleteMemoById(item.memoId);
      } else if (item.source === "tankyu" && item.tankyuId) {
        await deleteResearchNoteById(item.tankyuId);
      } else if (item.noteId) {
        await deleteNoteById(item.noteId);
      }
      setItems((prev) => prev.filter((entry) => entry.key !== item.key));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Memo] delete failed ${message}`);
    } finally {
      setDeletingMemoKeys((prev) => prev.filter((key) => key !== item.key));
    }
  };

  const handleDeleteMemo = (item: MemoItem) => {
    if (deletingMemoKeys.includes(item.key)) {
      return;
    }
    Alert.alert(tr("memo.confirmDeleteTitle"), tr("memo.confirmDeleteBody"), [
      { text: tr("common.cancel"), style: "cancel" },
      { text: tr("common.delete"), style: "destructive", onPress: () => void confirmDeleteMemo(item) },
    ]);
  };

  const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const next = Math.round(y + height);
    setHeaderBottomY((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header} onLayout={handleHeaderLayout}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.menuButton} onPress={onOpenMenu}>
            <Ionicons name="menu" size={20} color="#111827" />
          </Pressable>
        </View>
        <Text style={styles.headerTitle}>Memo</Text>
        <View style={styles.headerRight}>
          <Pressable
            style={styles.addButton}
            onPress={handleAddNote}
            disabled={creatingNote}
          >
            <Ionicons name="add" size={18} color="#111827" />
            <Text style={styles.addButtonText}>
              {creatingNote ? tr("memo.adding") : tr("memo.add")}
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.segmentRow}>
        {(Object.keys(TAB_LABELS) as MemoTab[]).map((key) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              style={[
                styles.segmentButton,
                active && styles.segmentButtonActive,
              ]}
              onPress={() => setTab(key)}
            >
              <Text
                style={[
                  styles.segmentText,
                  active && styles.segmentTextActive,
                ]}
              >
                {TAB_LABELS[key]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder={tr("memo.searchPlaceholder")}
          value={query}
          onChangeText={setQuery}
          selection={searchSelectionOverride ?? undefined}
          onSelectionChange={handleSearchSelectionChange}
          inputAccessoryViewID={
            Platform.OS === "ios" ? searchAccessoryId : undefined
          }
          onFocus={() => setSearchInputFocused(true)}
          onBlur={() => setSearchInputFocused(false)}
        />
        {activeLinkQuery.isActive && suggestions.length > 0 ? (
          <View style={styles.suggestionPanel}>
            <ScrollView>
              {suggestions.map((item) => (
                <Pressable
                  key={item.key}
                  style={styles.suggestionRow}
                  onPress={() => setQuery(`((` + item.label + `))`)}
                >
                  <Text style={styles.suggestionText}>
                    {`((` + item.label + `))`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
      {tab === "task" || tab === "all" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {tagFilterOptions.map((tag) => (
            <Pressable
              key={tag}
              style={[
                styles.filterChip,
                tagFilter === tag && styles.filterChipActive,
              ]}
              onPress={() => setTagFilter(tag)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  tagFilter === tag && styles.filterChipTextActive,
                ]}
              >
                {tag === ALL_TAG_FILTER ? allTagLabel : tag === NO_TAG_FILTER ? noTagLabel : tag}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View
        style={[
          styles.content,
          (tab === "task" || tab === "all") && styles.contentTight,
        ]}
      >
        {loading ? (
          <Text style={styles.helperText}>{tr("common.loading")}</Text>
        ) : (
          <SectionList
            ref={listRef}
            key={`${tab}-${tagFilter}`}
            sections={sections}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.listBody}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionTitle}>{section.title}</Text>
            )}
            renderItem={({ item }) => {
              const isDeleting = deletingMemoKeys.includes(item.key);
              return (
                <View style={styles.item}>
                  <Pressable
                    style={styles.itemContent}
                    onPress={() => openMemoDetail(item.memoId)}
                    disabled={isDeleting}
                  >
                    <Text style={styles.itemTitle}>{normalizeUiText(item.memoTitle)}</Text>
                    <Text style={styles.itemMeta}>
                      {`${normalizeUiText(sourceLabel(item.source))} · ${normalizeUiText(
                        item.taskTitle || "メモ",
                      )}`}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.itemDeleteButton,
                      isDeleting && styles.itemDeleteButtonDisabled,
                    ]}
                    onPress={() => handleDeleteMemo(item)}
                    disabled={isDeleting}
                  >
                    <Ionicons name="trash-outline" size={16} color="#111827" />
                  </Pressable>
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.helperText}>{tr("memo.none")}</Text>
            }
          />
        )}
      </View>
      <View
        style={[
          styles.aiDock,
          qaOpen ? styles.aiDockExpanded : null,
          qaOpen && headerBottomY > 0 ? { top: headerBottomY } : null,
        ]}
      >
        <Pressable
          style={styles.aiDockHeader}
          onPress={() => setQaOpen((prev) => !prev)}
        >
          <View style={styles.aiDockTitleRow}>
            <Ionicons name="sparkles" size={16} color="#111827" />
            <View style={styles.aiDockTitleGroup}>
              <Text style={styles.aiDockTitle}>{tr("memo.aiTitle")}</Text>
              <Text style={styles.aiDockSubtitle}>{tr("memo.aiSubtitle")}</Text>
            </View>
          </View>
          <Ionicons
            name={qaOpen ? "chevron-down" : "chevron-up"}
            size={16}
            color="#111827"
          />
        </Pressable>
        <View style={styles.aiDockInputRow}>
          <TextInput
            style={styles.aiInput}
            placeholder={tr("memo.aiInputPlaceholder")}
            placeholderTextColor="#9ca3af"
            value={qaQuery}
            onChangeText={setQaQuery}
            selection={qaSelectionOverride ?? undefined}
            onSelectionChange={handleQaSelectionChange}
            inputAccessoryViewID={
              Platform.OS === "ios" ? qaAccessoryId : undefined
            }
            onFocus={() => {
              setQaInputFocused(true);
              setQaOpen(true);
            }}
            onBlur={() => setQaInputFocused(false)}
            onSubmitEditing={handleSearchEvidence}
            returnKeyType="search"
          />
          <Pressable
            style={styles.aiSearchButton}
            onPress={handleSearchEvidence}
            disabled={qaSearchLoading || qaAnswerLoading}
          >
            <Text style={styles.aiSearchButtonText}>
              {qaSearchLoading
                ? tr("memo.aiSearching")
                : qaAnswerLoading
                  ? tr("memo.aiGenerating")
                  : tr("memo.aiSearch")}
            </Text>
          </Pressable>
        </View>
        {qaOpen ? (
          <View style={[styles.aiDockBody, styles.aiDockBodyExpanded]}>
            {qaSearchLoading ? (
              <Text style={styles.qaHelperText}>{tr("memo.aiSearchingEvidence")}</Text>
            ) : qaAnswerLoading ? (
              <Text style={styles.qaHelperText}>{tr("memo.aiGeneratingAnswer")}</Text>
            ) : qaSearched && qaResults.length === 0 ? (
              <Text style={styles.qaHelperText}>{tr("memo.aiNoRelated")}</Text>
            ) : (
              <ScrollView
                style={[styles.qaResultList, styles.qaResultListExpanded]}
                contentContainerStyle={styles.qaResultListContent}
                showsVerticalScrollIndicator
                nestedScrollEnabled
              >
                <AnswerPanel
                  answerText={qaAnswerText}
                  errorText={qaAnswerError}
                  title={tr("memo.aiAnswer")}
                />
                {citedEvidence.length > 0 ? (
                  <CitationList
                    title={tr("memo.aiCitedEvidence")}
                    evidence={citedEvidence}
                    memoItemByMemoId={memoItemByMemoId}
                    onOpenMemoId={openMemoDetail}
                    highlightedEvidenceIds={citedEvidenceIdSet}
                    keyPrefix="cited"
                    formatLabel={normalizeUiText}
                  />
                ) : null}
                {labeledEvidence.length > 0 ? (
                  <Pressable
                    style={styles.qaAllToggle}
                    onPress={() => setQaShowAllEvidence((prev) => !prev)}
                  >
                    <Text style={styles.qaAllToggleText}>
                      {qaShowAllEvidence
                        ? tr("memo.aiHideAllEvidence")
                        : `${tr("memo.aiShowAllEvidence")} (${labeledEvidence.length})`}
                    </Text>
                  </Pressable>
                ) : null}
                {qaShowAllEvidence ? (
                  <CitationList
                    title={tr("memo.aiAllEvidence")}
                    evidence={labeledEvidence}
                    memoItemByMemoId={memoItemByMemoId}
                    onOpenMemoId={openMemoDetail}
                    highlightedEvidenceIds={citedEvidenceIdSet}
                    showTokens
                    keyPrefix="all"
                    formatLabel={normalizeUiText}
                  />
                ) : null}
              </ScrollView>
            )}
          </View>
        ) : null}
      </View>
      {Platform.OS === "ios" ? (
        <>
          <InputAccessoryView nativeID={qaAccessoryId} backgroundColor="#fff">
            <BracketToolbar
              value={qaQuery}
              selection={qaSelection}
              onChangeText={setQaQuery}
              onSelectionChange={applyQaSelection}
            />
          </InputAccessoryView>
          <InputAccessoryView nativeID={searchAccessoryId} backgroundColor="#fff">
            <BracketToolbar
              value={query}
              selection={searchSelection}
              onChangeText={setQuery}
              onSelectionChange={applySearchSelection}
            />
          </InputAccessoryView>
        </>
      ) : qaInputFocused && keyboardVisible ? (
        <View
          style={[
            styles.qaBracketToolbar,
            { bottom: Math.max(0, keyboardOffset) },
          ]}
        >
          <BracketToolbar
            value={qaQuery}
            selection={qaSelection}
            onChangeText={setQaQuery}
            onSelectionChange={applyQaSelection}
          />
        </View>
      ) : searchInputFocused && keyboardVisible ? (
        <View
          style={[
            styles.qaBracketToolbar,
            { bottom: Math.max(0, keyboardOffset) },
          ]}
        >
          <BracketToolbar
            value={query}
            selection={searchSelection}
            onChangeText={setQuery}
            onSelectionChange={applySearchSelection}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  content: {
    flex: 1,
  },
  contentTight: {
    marginTop: -500,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  headerLeft: {
    width: 120,
    flexDirection: "row",
    alignItems: "center",
  },
  headerRight: {
    width: 120,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 32,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  addButtonText: {
    marginLeft: 4,
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  menuButton: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  backButton: {
    marginLeft: 6,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  linkText: {
    color: "#2563eb",
    fontSize: 12,
    marginLeft: 2,
  },
  segmentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 4,
    backgroundColor: "#f9fafb",
  },
  segmentButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: 8,
  },
  segmentButtonActive: {
    backgroundColor: "#111827",
  },
  segmentText: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "600",
  },
  segmentTextActive: {
    color: "#ffffff",
  },
  searchRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 10,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 0,
    alignItems: "center",
  },
  filterChip: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 8,
    backgroundColor: "#ffffff",
    alignSelf: "flex-start",
  },
  filterChipActive: {
    borderColor: "#111827",
    backgroundColor: "#111827",
  },
  filterChipText: {
    fontSize: 10,
    lineHeight: 14,
    color: "#6b7280",
    fontWeight: "600",
  },
  filterChipTextActive: {
    color: "#ffffff",
  },
  suggestionPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    maxHeight: 200,
  },
  aiDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  aiDockExpanded: {
    bottom: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 12,
  },
  aiDockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  aiDockTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  aiDockTitleGroup: {
    marginLeft: 8,
  },
  aiDockTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  aiDockSubtitle: {
    fontSize: 11,
    color: "#6b7280",
  },
  aiDockInputRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  aiInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#111827",
  },
  aiSearchButton: {
    marginLeft: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#111827",
  },
  aiSearchButtonText: {
    fontSize: 12,
    color: "#ffffff",
    fontWeight: "700",
  },
  aiDockBody: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 10,
  },
  aiDockBodyExpanded: {
    flex: 1,
    minHeight: 0,
  },
  qaSection: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  qaHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
  },
  qaTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  qaBody: {
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    padding: 10,
    flexShrink: 1, // prevent long answers from expanding the whole screen
  },
  qaInputRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  qaInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  qaSearchButton: {
    marginLeft: 8,
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  qaSearchButtonText: {
    fontSize: 12,
    color: "#ffffff",
    fontWeight: "600",
  },
  qaHelperText: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
  },
  qaResultList: {
    marginTop: 8,
    maxHeight: 280, // scroll area for AI answer + cited evidence
  },
  qaResultListExpanded: {
    maxHeight: undefined,
    flex: 1,
    minHeight: 0,
  },
  qaResultListContent: {
    flexGrow: 1,
  },
  qaAnswerPanel: {
    borderWidth: 1,
    borderColor: "#111827",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 10,
    marginBottom: 8,
  },
  qaAnswerPanelError: {
    borderColor: "#111827",
    backgroundColor: "#ffffff",
  },
  qaAnswerLabel: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
    backgroundColor: "#111827",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 6,
  },
  qaAnswerText: {
    fontSize: 13,
    color: "#111827",
    lineHeight: 19,
  },
  qaAnswerScroll: {
    maxHeight: 220,
  },
  qaAnswerScrollContent: {
    paddingBottom: 2,
  },
  qaAnswerErrorText: {
    color: "#b91c1c",
  },
  qaCitedSection: {
    marginBottom: 8,
  },
  qaCitedTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 6,
  },
  qaAllToggle: {
    marginBottom: 8,
  },
  qaAllToggleText: {
    fontSize: 12,
    color: "#2563eb",
  },
  qaResultItem: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#f9fafb",
    marginBottom: 8,
  },
  qaCitedItem: {
    borderColor: "#93c5fd",
    backgroundColor: "#eff6ff",
  },
  qaEvidenceId: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1d4ed8",
    marginBottom: 3,
  },
  qaResultSnippet: {
    fontSize: 13,
    color: "#111827",
    marginBottom: 4,
  },
  qaResultMeta: {
    fontSize: 11,
    color: "#6b7280",
  },
  qaResultTokens: {
    marginTop: 4,
    fontSize: 11,
    color: "#2563eb",
  },
  suggestionRow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  suggestionText: {
    fontSize: 12,
    color: "#111827",
  },
  helperText: {
    paddingHorizontal: 16,
    fontSize: 12,
    color: "#6b7280",
  },
  listBody: {
    paddingHorizontal: 16,
    paddingBottom: 210,
  },
  qaBracketToolbar: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 30,
    elevation: 30,
  },
  sectionTitle: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 0,
    marginBottom: 6,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#f9fafb",
    marginBottom: 10,
  },
  itemContent: {
    flex: 1,
    paddingRight: 8,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  itemMeta: {
    fontSize: 11,
    color: "#6b7280",
  },
  itemDeleteButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e5e7eb",
  },
  itemDeleteButtonDisabled: {
    opacity: 0.6,
  },
});

export default MemoScreen;
