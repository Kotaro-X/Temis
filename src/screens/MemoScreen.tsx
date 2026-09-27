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
import { loadTodos } from "../repositories/todoRepository";
import TodoComposerHost from "../components/todos/TodoComposerHost";
import { useTodoWorkspace } from "../context/TodoWorkspaceContext";
import {
  ALL_TAG_FILTER, NO_TAG_FILTER, buildTodoMemoItems, filterMemoTab,
  filterMemoTags, filterMemoQuery, hasMemoTags, type MemoItem,
} from "../utils/memoListItems";
import {
  buildNoteDocumentId,
  buildTankyuDocumentId,
} from "../services/indexTextBuilder";
import BracketToolbar from "../components/BracketToolbar";
import AIAnswerEvidencePanel from "../components/ai/AIAnswerEvidencePanel";
import TemisAIDock from "../components/ai/TemisAIDock";
import MemoListCard from "../components/memo/MemoListCard";
import { AppLanguage, t } from "../i18n";
import { useAI } from "../hooks/useAI";
import { formatTemisAIUsageLabel, useTemisAIUsage } from "../context/TemisAIUsageContext";
import type { MemoWorkspaceTabKey } from "../types/appNavigation";
import type { AIEvidence } from "../types";

export type MemoNavigation = {
  push: (screen: "MemoDetail", params: { id: string }) => void;
};

type MemoTab = MemoWorkspaceTabKey;

type Section = {
  title: string;
  data: MemoItem[];
};

type Props = {
  visible: boolean;
  onBack: () => void;
  onOpenMenu: () => void;
  navigation: MemoNavigation;
  tab: MemoTab;
  onChangeTab: (tab: MemoTab) => void;
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

type MemoEvidenceCardProps = {
  result: LabeledEvidence;
  memoItemByMemoId: Map<string, MemoItem>;
  onOpenMemoId: (memoId: string) => void;
  highlighted: boolean;
  showTokens?: boolean;
  keyPrefix: string;
  formatLabel?: (value: string) => string;
};

const TAB_LABELS: Record<MemoTab, string> = {
  all: "All",
  task: "Task",
  note: "Note",
};

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
  const [taskIndex, memos, notes, tankyuNotes, todos] = await Promise.all([
    buildTaskIndex(),
    listAllMemos(),
    listAllNotes(),
    listResearchNotes(),
    loadTodos(),
  ]);
  const items: MemoItem[] = buildTodoMemoItems(todos);
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
      scope: note.scope,
      projectId: note.projectId,
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

const MemoEvidenceCard = ({
  result,
  memoItemByMemoId,
  onOpenMemoId,
  highlighted,
  showTokens = false,
  keyPrefix,
  formatLabel,
}: MemoEvidenceCardProps) => {
  const memo = memoItemByMemoId.get(result.memoId);
  return (
    <Pressable
      key={`${keyPrefix}:${result.chunkId}:${result.evidenceId}`}
      style={[styles.qaResultItem, highlighted ? styles.qaCitedItem : null]}
      onPress={() => onOpenMemoId(result.memoId)}
    >
          <Text style={styles.qaEvidenceId}>[{result.evidenceId}]</Text>
          <Text style={styles.qaResultSnippet}>{result.snippetText}</Text>
          {result.linkPath?.length ? (
            <Text style={styles.qaResultMeta}>{result.linkPath.join(" → ")}経由</Text>
          ) : null}
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
};

const MemoScreen = ({
  visible,
  onBack,
  onOpenMenu,
  navigation,
  tab,
  onChangeTab,
  refreshToken = 0,
  language,
}: Props) => {
  const tr = (key: string) => t(language, key);
  const { closeTodoCreate, openTodoEditById, todoComposerSource } = useTodoWorkspace();
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
    if (source === "todo") return "ToDo";
    if (source === "task") {
      return language === "en" ? "Task" : "タスク";
    }
    if (source === "note") {
      return memoDefaultTitle;
    }
    return tankyuLabel;
  };
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
  const aiUsage = useTemisAIUsage();
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
  }, { begin: aiUsage.begin, refresh: aiUsage.refresh });

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

  useEffect(() => {
    if (visible) return loadItems();
  }, [loadItems, refreshToken, visible, tab]);

  useEffect(() => {
    if (!visible && todoComposerSource === "memo") closeTodoCreate();
  }, [closeTodoCreate, todoComposerSource, visible]);

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

  const tabbedItems = useMemo(() => filterMemoTab(items, tab), [items, tab]);

  const tagFilterOptions = useMemo(() => {
    const options = [ALL_TAG_FILTER, ...tagLibrary];
    const hasNoTag = items.some((item) => {
      if (!hasMemoTags(item)) {
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

  const tagFilteredItems = useMemo(() =>
    tab === "note" ? tabbedItems : filterMemoTags(tabbedItems, tagFilter, activeTagSet),
  [tab, tabbedItems, tagFilter, activeTagSet]);

  const filteredItems = useMemo(() => filterMemoQuery(tagFilteredItems, query),
    [tagFilteredItems, query]);

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
      qaResults.map((item) => ({ ...item, evidenceId: item.key })),
    [qaResults],
  );

  const citedEvidence = useMemo(() => {
    const citedSet = new Set(qaCitedEvidenceIds);
    return labeledEvidence.filter((item) => citedSet.has(item.evidenceId));
  }, [labeledEvidence, qaCitedEvidenceIds]);

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
    if (item.source === "todo") return;
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

  if (!visible) {
    return null;
  }

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
              onPress={() => onChangeTab(key)}
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
                <MemoListCard
                  title={normalizeUiText(item.memoTitle)}
                  meta={[
                    `${normalizeUiText(sourceLabel(item.source))} · ${normalizeUiText(
                      item.taskTitle || "メモ",
                    )}${item.scope === "project" ? " · プロジェクト" : ""}`,
                    ...(item.source === "todo" && item.tags?.length ? [item.tags.join(" · ")] : []),
                  ]}
                  onPress={() => {
                      if (item.source === "todo") {
                        Keyboard.dismiss();
                        if (!item.todoId) return;
                        void openTodoEditById(item.todoId, "memo").then((opened) => {
                          if (!opened) Alert.alert(tr("todo.editTitle"), "ToDoが削除されたか、見つかりません。");
                        });
                      } else openMemoDetail(item.memoId);
                    }}
                  onDelete={item.source !== "todo" ? () => handleDeleteMemo(item) : undefined}
                  deleting={isDeleting}
                />
              );
            }}
            ListEmptyComponent={
              <Text style={styles.helperText}>{tr("memo.none")}</Text>
            }
          />
        )}
      </View>
      <TemisAIDock
        expanded={qaOpen}
        expandedTop={headerBottomY > 0 ? headerBottomY : undefined}
        query={qaQuery}
        placeholder={tr("memo.aiInputPlaceholder")}
        searchLabel={qaSearchLoading
          ? tr("memo.aiSearching")
          : qaAnswerLoading
            ? tr("memo.aiGenerating")
            : tr("memo.aiSearch")}
        searchDisabled={qaSearchLoading || qaAnswerLoading}
        onChangeQuery={setQaQuery}
        onSearch={handleSearchEvidence}
        onToggle={() => setQaOpen((prev) => !prev)}
        badge={<Pressable disabled={aiUsage.status !== "error"} onPress={() => void aiUsage.refresh()} accessibilityRole="button"><Text style={styles.aiUsageBadge}>{formatTemisAIUsageLabel(aiUsage.usage, aiUsage.status)}{aiUsage.status === "error" ? "・再試行" : ""}</Text></Pressable>}
        inputProps={{
          selection: qaSelectionOverride ?? undefined,
          onSelectionChange: handleQaSelectionChange,
          inputAccessoryViewID: Platform.OS === "ios" ? qaAccessoryId : undefined,
          onFocus: () => {
            setQaInputFocused(true);
            setQaOpen(true);
          },
          onBlur: () => setQaInputFocused(false),
        }}
      >
        {qaSearchLoading ? (
              <Text style={styles.qaHelperText}>{tr("memo.aiSearchingEvidence")}</Text>
            ) : qaAnswerLoading ? (
              <Text style={styles.qaHelperText}>{tr("memo.aiGeneratingAnswer")}</Text>
            ) : qaAnswerError ? (
              <Text accessibilityRole="alert" style={styles.qaHelperText}>{qaAnswerError}</Text>
            ) : qaSearched && qaResults.length === 0 ? (
              <Text style={styles.qaHelperText}>{tr("memo.aiNoRelated")}</Text>
            ) : (
              <ScrollView
                style={[styles.qaResultList, styles.qaResultListExpanded]}
                contentContainerStyle={styles.qaResultListContent}
                showsVerticalScrollIndicator
                nestedScrollEnabled
              >
                <AIAnswerEvidencePanel
                  answerText={qaAnswerText}
                  errorText={qaAnswerError}
                  answerTitle={tr("memo.aiAnswer")}
                  citedTitle={tr("memo.aiCitedEvidence")}
                  allTitle={tr("memo.aiAllEvidence")}
                  showAllLabel={tr("memo.aiShowAllEvidence")}
                  hideAllLabel={tr("memo.aiHideAllEvidence")}
                  citedEvidence={citedEvidence}
                  allEvidence={labeledEvidence}
                  showAll={qaShowAllEvidence}
                  onToggleAll={() => setQaShowAllEvidence((prev) => !prev)}
                  getEvidenceKey={(result) => result.evidenceId}
                  renderEvidence={(result, options) => (
                    <MemoEvidenceCard
                      result={result}
                      memoItemByMemoId={memoItemByMemoId}
                      onOpenMemoId={openMemoDetail}
                      highlighted={options.cited}
                      showTokens={options.allSection}
                      keyPrefix={options.allSection ? "all" : "cited"}
                      formatLabel={normalizeUiText}
                    />
                  )}
                />
              </ScrollView>
            )}
      </TemisAIDock>
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
      <TodoComposerHost source="memo" tr={tr} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  aiUsageBadge: {
    color: "#6b7280",
    fontSize: 11,
    fontWeight: "600",
  },
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
