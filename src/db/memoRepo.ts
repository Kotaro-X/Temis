import { nanoid } from "nanoid/non-secure";

import { extractTokens, normalizeSearchToken } from "../utils/wikiLink";
import { ensureDbReady, executeSql } from "./sqlite";

type MemoRow = {
  id: string;
  task_id: string;
  body: string;
  created_at: number;
  updated_at: number;
};

type MemoLinkRow = {
  token: string;
};

export type MemoRecord = {
  id: string;
  taskId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

export type MemoSearchHit = {
  memoId: string;
  taskId: string;
  taskTitle: string;
  updatedAt: number;
  preview: string;
};

let taskTitleById = new Map<string, string>();

export const setTaskIndex = (
  entries: Array<{ taskId: string; taskTitle: string }>,
) => {
  taskTitleById = new Map(
    entries.map((entry) => [entry.taskId, entry.taskTitle || "未設定"]),
  );
};

const toMemoRecord = (row: MemoRow): MemoRecord => ({
  id: row.id,
  taskId: row.task_id,
  body: row.body,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const buildPreview = (body: string, maxLength = 120) => {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

export const getMemoByTaskId = async (
  taskId: string,
): Promise<MemoRecord | null> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, task_id, body, created_at, updated_at FROM memos WHERE task_id = ? LIMIT 1",
    [taskId],
  );
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows.item(0) as MemoRow;
  return toMemoRecord(row);
};

export const listAllMemos = async (): Promise<MemoRecord[]> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, task_id, body, created_at, updated_at FROM memos ORDER BY updated_at DESC",
  );
  return (result.rows._array as MemoRow[]).map((row) => toMemoRecord(row));
};

export const upsertMemoForTask = async (
  taskId: string,
  body: string,
): Promise<MemoRecord> => {
  await ensureDbReady();
  const now = Date.now();
  const existing = await executeSql(
    "SELECT id, created_at FROM memos WHERE task_id = ? LIMIT 1",
    [taskId],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows.item(0) as Pick<MemoRow, "id" | "created_at">;
    await executeSql(
      "UPDATE memos SET body = ?, updated_at = ? WHERE id = ?",
      [body, now, row.id],
    );
    await rebuildMemoLinks(row.id, body);
    return {
      id: row.id,
      taskId,
      body,
      createdAt: row.created_at,
      updatedAt: now,
    };
  }
  const memoId = nanoid();
  await executeSql(
    "INSERT INTO memos (id, task_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [memoId, taskId, body, now, now],
  );
  await rebuildMemoLinks(memoId, body);
  return {
    id: memoId,
    taskId,
    body,
    createdAt: now,
    updatedAt: now,
  };
};

export const rebuildMemoLinks = async (
  memoId: string,
  body: string,
): Promise<void> => {
  await ensureDbReady();
  const tokens = extractTokens(body);
  await executeSql("DELETE FROM memo_links WHERE memo_id = ?", [memoId]);
  if (tokens.length === 0) {
    return;
  }
  for (const token of tokens) {
    await executeSql(
      "INSERT INTO memo_links (id, memo_id, token) VALUES (?, ?, ?)",
      [nanoid(), memoId, token],
    );
  }
};

export const getTokensByMemoId = async (memoId: string): Promise<string[]> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT token FROM memo_links WHERE memo_id = ? ORDER BY token",
    [memoId],
  );
  return (result.rows._array as MemoLinkRow[]).map((row) => row.token);
};

export const findMemosByToken = async (
  token: string,
): Promise<MemoSearchHit[]> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT m.id as memo_id, m.task_id as task_id, m.body as body, m.updated_at as updated_at FROM memo_links ml JOIN memos m ON m.id = ml.memo_id WHERE ml.token = ? ORDER BY m.updated_at DESC",
    [token],
  );
  return (result.rows._array as Array<{
    memo_id: string;
    task_id: string;
    body: string;
    updated_at: number;
  }>).map((row) => ({
    memoId: row.memo_id,
    taskId: row.task_id,
    taskTitle: taskTitleById.get(row.task_id) || "未設定",
    updatedAt: row.updated_at,
    preview: buildPreview(row.body),
  }));
};

export const searchMemosByTaskTitle = async (
  query: string,
): Promise<MemoSearchHit[]> => {
  await ensureDbReady();
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const matchingTaskIds = Array.from(taskTitleById.entries())
    .filter(([, title]) => title.includes(trimmed))
    .map(([taskId]) => taskId);
  if (matchingTaskIds.length === 0) {
    return [];
  }
  const placeholders = matchingTaskIds.map(() => "?").join(", ");
  const result = await executeSql(
    `SELECT id as memo_id, task_id as task_id, body as body, updated_at as updated_at FROM memos WHERE task_id IN (${placeholders}) ORDER BY updated_at DESC`,
    matchingTaskIds,
  );
  return (result.rows._array as Array<{
    memo_id: string;
    task_id: string;
    body: string;
    updated_at: number;
  }>).map((row) => ({
    memoId: row.memo_id,
    taskId: row.task_id,
    taskTitle: taskTitleById.get(row.task_id) || "未設定",
    updatedAt: row.updated_at,
    preview: buildPreview(row.body),
  }));
};

export const searchMemosByToken = async (
  query: string,
): Promise<MemoSearchHit[]> => {
  await ensureDbReady();
  const normalized = normalizeSearchToken(query);
  if (!normalized) {
    return [];
  }
  const likeQuery = `%${escapeLike(normalized)}%`;
  const result = await executeSql(
    "SELECT m.id as memo_id, m.task_id as task_id, m.body as body, m.updated_at as updated_at, ml.token as token FROM memo_links ml JOIN memos m ON m.id = ml.memo_id WHERE ml.token LIKE ? ESCAPE '\\' ORDER BY m.updated_at DESC",
    [likeQuery],
  );
  const rows = result.rows._array as Array<{
    memo_id: string;
    task_id: string;
    body: string;
    updated_at: number;
    token: string;
  }>;
  const filtered = rows.filter((row) => row.token.includes(normalized));
  const hitByMemoId = new Map<string, MemoSearchHit>();
  for (const row of filtered) {
    if (!hitByMemoId.has(row.memo_id)) {
      hitByMemoId.set(row.memo_id, {
        memoId: row.memo_id,
        taskId: row.task_id,
        taskTitle: taskTitleById.get(row.task_id) || "未設定",
        updatedAt: row.updated_at,
        preview: buildPreview(row.body),
      });
    }
  }
  return Array.from(hitByMemoId.values());
};
