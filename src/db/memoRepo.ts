import { nanoid } from "nanoid/non-secure";

import { loadSyncDeviceId } from "../../storage";
import { extractTokens, normalizeSearchToken } from "../utils/wikiLink";
import { ensureDbReady, executeSql } from "./sqlite";
import { replaceChunkIndexTextForMemo } from "./chunkIndexRepo";
import { invalidateHybridSearchCache } from "../services/hybridSearch";
import { buildTaskMemoSyncEnvelope } from "../services/sync/syncEntityModels";
import { persistAndEnqueueSyncEnvelope } from "../services/sync/syncEnvelopeStore";
import {
  enqueueMemoEmbeddingJob,
  runPendingEmbeddingJobs,
} from "../services/embeddingJobs";
import { getEmbeddingModelVersion } from "../services/EmbeddingProvider";
import {
  rebuildTokenIndexForMemo,
  searchByToken as searchTokenIndexByToken,
  TokenIndexHit,
} from "./tokenIndexRepo";

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

type MemoSearchRow = {
  memo_id: string;
  task_id: string;
  body: string;
  updated_at: number;
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

export const getMemoById = async (
  memoId: string,
): Promise<MemoRecord | null> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, task_id, body, created_at, updated_at FROM memos WHERE id = ? LIMIT 1",
    [memoId],
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

type MemoIndexMode = "sync" | "async";

type UpsertMemoOptions = {
  indexMode?: MemoIndexMode;
  enqueueSync?: boolean;
};

const rebuildMemoIndexes = async (
  memoId: string,
  body: string,
): Promise<void> => {
  await rebuildMemoLinks(memoId, body);
  await rebuildTokenIndexForMemo(memoId, body);
  await replaceChunkIndexTextForMemo(memoId, body, {
    embeddingModelVersion: getEmbeddingModelVersion(),
  });
  invalidateHybridSearchCache();
};

const runMemoEmbeddingJobAsync = (memoId: string): void => {
  void runPendingEmbeddingJobs({ limit: 1 }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Embedding][Memo] async job failed memoId=${memoId} ${message}`);
  });
};

export const upsertMemoForTask = async (
  taskId: string,
  body: string,
  options?: UpsertMemoOptions,
): Promise<MemoRecord> => {
  await ensureDbReady();
  const now = Date.now();
  const shouldEnqueueSync = options?.enqueueSync !== false;
  let memo: MemoRecord;
  await executeSql("BEGIN IMMEDIATE TRANSACTION");
  try {
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
      await rebuildMemoIndexes(row.id, body);
      await enqueueMemoEmbeddingJob(row.id);
      memo = {
        id: row.id,
        taskId,
        body,
        createdAt: row.created_at,
        updatedAt: now,
      };
    } else {
      const memoId = nanoid();
      await executeSql(
        "INSERT INTO memos (id, task_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [memoId, taskId, body, now, now],
      );
      await rebuildMemoIndexes(memoId, body);
      await enqueueMemoEmbeddingJob(memoId);
      memo = {
        id: memoId,
        taskId,
        body,
        createdAt: now,
        updatedAt: now,
      };
    }
    await executeSql("COMMIT");
  } catch (error) {
    await executeSql("ROLLBACK");
    throw error;
  }

  runMemoEmbeddingJobAsync(memo.id);
  if (shouldEnqueueSync) {
    const deviceId = await loadSyncDeviceId();
    await persistAndEnqueueSyncEnvelope(
      buildTaskMemoSyncEnvelope({
        memo,
        deviceId,
      }),
    );
  }
  return memo;
};

export const upsertMemoRecord = async (
  record: MemoRecord,
  options?: { indexMode?: MemoIndexMode },
): Promise<MemoRecord> => {
  await ensureDbReady();
  await executeSql("BEGIN IMMEDIATE TRANSACTION");
  try {
    const result = await executeSql(
      "SELECT id FROM memos WHERE id = ? LIMIT 1",
      [record.id],
    );
    if (result.rows.length > 0) {
      await executeSql(
        "UPDATE memos SET task_id = ?, body = ?, created_at = ?, updated_at = ? WHERE id = ?",
        [record.taskId, record.body, record.createdAt, record.updatedAt, record.id],
      );
    } else {
      await executeSql(
        "INSERT INTO memos (id, task_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [record.id, record.taskId, record.body, record.createdAt, record.updatedAt],
      );
    }
    await rebuildMemoIndexes(record.id, record.body);
    await enqueueMemoEmbeddingJob(record.id);
    await executeSql("COMMIT");
  } catch (error) {
    await executeSql("ROLLBACK");
    throw error;
  }
  runMemoEmbeddingJobAsync(record.id);
  return record;
};

export const deleteMemoById = async (
  memoId: string,
  options?: { enqueueSync?: boolean },
): Promise<void> => {
  await ensureDbReady();
  const existing = await getMemoById(memoId);
  await executeSql("BEGIN IMMEDIATE TRANSACTION");
  try {
    await executeSql("DELETE FROM memo_links WHERE memo_id = ?", [memoId]);
    await executeSql("DELETE FROM token_index WHERE memo_id = ?", [memoId]);
    await executeSql("DELETE FROM chunk_index WHERE memo_id = ?", [memoId]);
    await executeSql("DELETE FROM embedding_jobs WHERE memo_id = ?", [memoId]);
    await executeSql("DELETE FROM memos WHERE id = ?", [memoId]);
    await executeSql("COMMIT");
  } catch (error) {
    await executeSql("ROLLBACK");
    throw error;
  }
  invalidateHybridSearchCache();
  if (options?.enqueueSync === false || !existing) {
    return;
  }
  const deviceId = await loadSyncDeviceId();
  await persistAndEnqueueSyncEnvelope(
    buildTaskMemoSyncEnvelope({
      memo: existing,
      deletedAt: Date.now(),
      deviceId,
    }),
  );
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

export const searchByToken = async (token: string): Promise<TokenIndexHit[]> =>
  searchTokenIndexByToken(token);

export const findMemosByToken = async (
  token: string,
): Promise<MemoSearchHit[]> => {
  await ensureDbReady();
  const tokenHits = await searchByToken(token);
  if (tokenHits.length === 0) {
    return [];
  }
  const memoIds = tokenHits.map((hit) => hit.memoId);
  const placeholders = memoIds.map(() => "?").join(", ");
  const result = await executeSql(
    `SELECT id as memo_id, task_id as task_id, body as body, updated_at as updated_at FROM memos WHERE id IN (${placeholders}) ORDER BY updated_at DESC`,
    memoIds,
  );
  const snippetByMemoId = new Map(
    tokenHits.map((hit) => [hit.memoId, hit.snippet]),
  );
  return (result.rows._array as MemoSearchRow[]).map((row) => ({
    memoId: row.memo_id,
    taskId: row.task_id,
    taskTitle: taskTitleById.get(row.task_id) || "未設定",
    updatedAt: row.updated_at,
    preview: snippetByMemoId.get(row.memo_id) || buildPreview(row.body),
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
    "SELECT m.id as memo_id, m.task_id as task_id, m.body as body, m.updated_at as updated_at, ti.token as token, ti.snippet as snippet FROM token_index ti JOIN memos m ON m.id = ti.memo_id WHERE ti.token LIKE ? ESCAPE '\\' ORDER BY m.updated_at DESC",
    [likeQuery],
  );
  const rows = result.rows._array as Array<
    MemoSearchRow & { token: string; snippet: string | null }
  >;
  const filtered = rows.filter((row) => row.token.includes(normalized));
  const hitByMemoId = new Map<string, MemoSearchHit>();
  for (const row of filtered) {
    if (!hitByMemoId.has(row.memo_id)) {
      hitByMemoId.set(row.memo_id, {
        memoId: row.memo_id,
        taskId: row.task_id,
        taskTitle: taskTitleById.get(row.task_id) || "未設定",
        updatedAt: row.updated_at,
        preview: row.snippet || buildPreview(row.body),
      });
    }
  }
  return Array.from(hitByMemoId.values());
};
