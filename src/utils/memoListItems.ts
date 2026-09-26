import type { SimpleTodoItem } from "../types/todo.ts";
import type { MemoWorkspaceTabKey } from "../types/appNavigation.ts";
import { normalizeParens } from "./linkTokenize.ts";
import { normalizeSearchToken } from "./wikiLink.ts";

export type MemoItem = {
  key: string;
  memoId: string;
  date: string;
  memoTitle: string;
  memoText: string;
  taskTitle: string;
  updatedAt: number;
  source: "task" | "note" | "tankyu" | "todo";
  taskId?: string;
  todoId?: string;
  noteId?: string;
  noteType?: "daily" | "free";
  noteTitle?: string | null;
  tankyuId?: string;
  tags?: string[];
  scope?: "personal" | "project";
  projectId?: string | null;
};

export const ALL_TAG_FILTER = "すべて";
export const NO_TAG_FILTER = "タグ未設定";

export function buildTodoMemoItems(todos: readonly SimpleTodoItem[]): MemoItem[] {
  return todos.filter((todo) => !todo.isDeleted && todo.memo.trim()).map((todo) => {
    const created = new Date(todo.createdAt);
    const createdDate = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
    const title = todo.memo.replace(/\s+/g, " ").trim();
    return {
      key: `todo:${todo.id}`,
      memoId: `todo:${todo.id}`,
      todoId: todo.id,
      date: todo.occurrenceDate || todo.reminderDate || createdDate,
      memoTitle: title.length > 60 ? `${title.slice(0, 60)}...` : title,
      memoText: todo.memo,
      taskTitle: todo.text.trim() || "未設定",
      // Todos have no updatedAt field. Keep the existing storage/sync schema.
      updatedAt: todo.createdAt,
      source: "todo",
      tags: [...todo.tags],
    };
  });
}

export const filterMemoTab = (items: MemoItem[], tab: MemoWorkspaceTabKey) =>
  tab === "all" ? items : items.filter((item) => item.source === tab);

export const hasMemoTags = (item: MemoItem) =>
  item.source === "task" || item.source === "tankyu" || item.source === "todo";

export function filterMemoTags(items: MemoItem[], tag: string, activeTags: ReadonlySet<string>) {
  if (tag === ALL_TAG_FILTER) return items;
  return items.filter((item) => {
    if (!hasMemoTags(item)) return false;
    const valid = (item.tags ?? []).filter((value) => activeTags.has(value));
    return tag === NO_TAG_FILTER ? valid.length === 0 : valid.includes(tag);
  });
}

export function filterMemoQuery(items: MemoItem[], query: string) {
  const rawInput = normalizeParens(query).trim();
  if (!rawInput) return items;
  const normalized = normalizeSearchToken(rawInput).toLowerCase();
  const raw = rawInput.toLowerCase();
  const keys = normalized === raw ? [raw] : [normalized, raw];
  return items.filter((item) => {
    const title = normalizeParens(item.memoTitle).toLowerCase();
    const body = normalizeParens(item.memoText).toLowerCase();
    return keys.some((key) => key && (title.includes(key) || body.includes(key)));
  });
}
