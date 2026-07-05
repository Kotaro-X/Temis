import { loadAllTodayStates } from "../../storage";
import { getMemoById } from "../db/memoRepo";
import { getNoteById } from "../db/noteRepo";
import { searchByToken } from "../db/tokenIndexRepo";
import { getResearchNoteById } from "./researchNoteService";

export type WikiReferenceSource = "task" | "note" | "tankyu";

export type WikiReferenceItem = {
  memoId: string;
  source: WikiReferenceSource;
  title: string;
  preview: string;
  date: string;
  updatedAt: number;
};

const pad2 = (num: number) => String(num).padStart(2, "0");

const toDateString = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;

const dateFromTimestamp = (timestamp: number) =>
  toDateString(new Date(timestamp));

const buildPreview = (body: string, maxLength = 90) => {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
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

const buildTitleFromPreview = (
  fallback: string,
  body: string,
  maxLength = 36,
) => {
  const preview = buildPreview(body, maxLength);
  return preview || fallback;
};

export const listWikiReferencesByToken = async (
  token: string,
  options?: {
    excludeMemoId?: string | null;
  },
): Promise<WikiReferenceItem[]> => {
  const [hits, taskIndex] = await Promise.all([
    searchByToken(token),
    buildTaskIndex(),
  ]);
  const excludeMemoId = options?.excludeMemoId ?? null;

  const items = await Promise.all(
    hits.map(async (hit): Promise<WikiReferenceItem | null> => {
      if (excludeMemoId && hit.memoId === excludeMemoId) {
        return null;
      }
      if (hit.memoId.startsWith("note:")) {
        const noteId = hit.memoId.slice("note:".length);
        const note = await getNoteById(noteId);
        if (!note) {
          return null;
        }
        const title =
          note.type === "free"
            ? note.title?.trim() || buildTitleFromPreview("無題", note.body)
            : "Daily";
        return {
          memoId: hit.memoId,
          source: "note",
          title,
          preview: buildPreview(note.body),
          date: note.date ?? dateFromTimestamp(note.updatedAt),
          updatedAt: note.updatedAt,
        };
      }

      if (hit.memoId.startsWith("tankyu:")) {
        const tankyuId = hit.memoId.slice("tankyu:".length);
        const note = await getResearchNoteById(tankyuId);
        if (!note) {
          return null;
        }
        return {
          memoId: hit.memoId,
          source: "tankyu",
          title: note.title.trim() || buildTitleFromPreview("探究", note.body),
          preview: buildPreview(note.body),
          date: dateFromTimestamp(note.updatedAt),
          updatedAt: note.updatedAt,
        };
      }

      const memo = await getMemoById(hit.memoId);
      if (!memo) {
        return null;
      }
      const info = taskIndex.get(memo.taskId);
      return {
        memoId: memo.id,
        source: "task",
        title: info?.title || "未設定",
        preview: buildPreview(memo.body),
        date: info?.date ?? dateFromTimestamp(memo.updatedAt),
        updatedAt: memo.updatedAt,
      };
    }),
  );

  return items
    .filter((item): item is WikiReferenceItem => item !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
};
