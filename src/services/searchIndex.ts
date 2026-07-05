import { loadAllTodayStates } from "../../storage";
import { getMemoByTaskId, listAllMemos } from "../db/memoRepo";
import { getDailyNoteByDate, getFreeNoteById, listAllNotes } from "../db/noteRepo";
import {
  getResearchNoteById,
  listResearchNotes,
} from "../services/researchNoteService";
import { buildTankyuDocumentId } from "./indexTextBuilder";
import { SearchItem, SearchItemKind } from "../types/SearchItem";
import { normalizeParens, normalizeSearchToken } from "../utils/wikiLink";

const pad2 = (num: number) => String(num).padStart(2, "0");

const toDateString = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;

const dateFromTimestamp = (timestamp: number) =>
  toDateString(new Date(timestamp));

export type SearchMemo = {
  key: string;
  taskId: string;
  date: string;
  memoText: string;
  taskTitle: string;
  source: "task" | "note" | "tankyu";
  noteId?: string;
  noteType?: "daily" | "free";
  noteTitle?: string | null;
  tankyuId?: string;
};

const normalize = (value: string) =>
  normalizeSearchToken(value).toLowerCase();

const normalizeMemoText = (value: string) =>
  normalizeParens(value).toLowerCase();

const matchesMemo = (text: string, keyword: string) => {
  if (!text) {
    return false;
  }
  const normalized = normalizeMemoText(text);
  return normalized.includes(keyword) || normalized.includes(`((${keyword}))`);
};

const buildTaskIndex = async () => {
  const states = await loadAllTodayStates();
  const taskIndex = new Map<string, { title: string; date: string }>();
  for (const state of states) {
    for (const slot of Object.values(state.slots)) {
      for (const task of slot.tasks) {
        if (!task.id) {
          continue;
        }
        const title = task.taskName || "未設定";
        const existing = taskIndex.get(task.id);
        if (!existing || state.date > existing.date) {
          taskIndex.set(task.id, { title, date: state.date });
        }
      }
    }
  }
  return taskIndex;
};

const findTaskInfoById = async (taskId: string) => {
  const states = await loadAllTodayStates();
  let latest: { title: string; date: string } | null = null;
  for (const state of states) {
    for (const slot of Object.values(state.slots)) {
      for (const task of slot.tasks) {
        if (task.id !== taskId) {
          continue;
        }
        const title = task.taskName || "未設定";
        if (!latest || state.date > latest.date) {
          latest = { title, date: state.date };
        }
      }
    }
  }
  return latest;
};

export const searchTaskMemos = async (query: string): Promise<SearchMemo[]> => {
  const keyword = normalize(query);
  if (!keyword) {
    return [];
  }
  const [taskIndex, memos] = await Promise.all([
    buildTaskIndex(),
    listAllMemos(),
  ]);
  const results: SearchMemo[] = [];
  for (const memo of memos) {
    if (!matchesMemo(memo.body, keyword)) {
      continue;
    }
    const info = taskIndex.get(memo.taskId);
    results.push({
      key: memo.id,
      taskId: memo.taskId,
      date: info?.date ?? dateFromTimestamp(memo.updatedAt),
      memoText: memo.body,
      taskTitle: info?.title ?? "未設定",
      source: "task",
    });
  }
  return results.sort((a, b) => b.date.localeCompare(a.date));
};

export const searchNoteMemos = async (query: string): Promise<SearchMemo[]> => {
  const keyword = normalize(query);
  if (!keyword) {
    return [];
  }
  const notes = await listAllNotes();
  const results: SearchMemo[] = [];
  for (const note of notes) {
    if (
      !matchesMemo(note.body, keyword) &&
      !(note.title && matchesMemo(note.title, keyword))
    ) {
      continue;
    }
    const title =
      note.type === "free"
        ? note.title?.trim() || "無題"
        : "Daily";
    results.push({
      key: `note:${note.id}`,
      taskId: "",
      date: note.date ?? dateFromTimestamp(note.updatedAt),
      memoText: note.body,
      taskTitle: title,
      source: "note",
      noteId: note.id,
      noteType: note.type,
      noteTitle: note.title ?? null,
    });
  }
  return results.sort((a, b) => b.date.localeCompare(a.date));
};

export const searchAllMemos = async (query: string): Promise<SearchMemo[]> => {
  const [taskResults, noteResults, tankyuResults] = await Promise.all([
    searchTaskMemos(query),
    searchNoteMemos(query),
    searchTankyuMemos(query),
  ]);
  return [...taskResults, ...noteResults, ...tankyuResults];
};

export const searchTankyuMemos = async (query: string): Promise<SearchMemo[]> => {
  const keyword = normalize(query);
  if (!keyword) {
    return [];
  }
  const notes = await listResearchNotes();
  const results: SearchMemo[] = [];
  for (const note of notes) {
    if (
      !matchesMemo(note.body, keyword) &&
      !(note.title && matchesMemo(note.title, keyword))
    ) {
      continue;
    }
    results.push({
      key: buildTankyuDocumentId(note.id),
      taskId: "",
      date: dateFromTimestamp(note.updatedAt),
      memoText: note.body,
      taskTitle: note.title?.trim() || "探究",
      source: "tankyu",
      tankyuId: note.id,
    });
  }
  return results.sort((a, b) => b.date.localeCompare(a.date));
};

export const getSearchItemById = async (
  kind: SearchItemKind,
  itemId: string,
): Promise<SearchItem | null> => {
  if (kind === "task") {
    const [info, memo] = await Promise.all([
      findTaskInfoById(itemId),
      getMemoByTaskId(itemId),
    ]);
    if (!info && !memo) {
      return null;
    }
    const date = info?.date ?? (memo ? dateFromTimestamp(memo.updatedAt) : "");
    return {
      id: itemId,
      kind: "task",
      date,
      title: info?.title ?? "未設定",
      body: memo?.body ?? "",
    };
  }

  const freeNote = await getFreeNoteById(itemId);
  if (freeNote) {
    return {
      id: freeNote.id,
      kind: "note",
      date: freeNote.date ?? dateFromTimestamp(freeNote.updatedAt),
      title: freeNote.title?.trim() || "無題",
      body: freeNote.body,
    };
  }

  const dailyNote = await getDailyNoteByDate(itemId);
  if (dailyNote) {
    return {
      id: dailyNote.id,
      kind: "note",
      date: dailyNote.date ?? dateFromTimestamp(dailyNote.updatedAt),
      title: "Daily",
      body: dailyNote.body,
    };
  }

  if (kind === "tankyu") {
    const tankyu = await getResearchNoteById(itemId);
    if (!tankyu) {
      return null;
    }
    return {
      id: tankyu.id,
      kind: "tankyu",
      date: dateFromTimestamp(tankyu.updatedAt),
      title: tankyu.title?.trim() || "探究",
      body: tankyu.body,
    };
  }

  return null;
};
