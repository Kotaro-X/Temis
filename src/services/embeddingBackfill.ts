import { nanoid } from "nanoid/non-secure";

import { getEmbeddingProvider } from "./EmbeddingProvider";
import { buildIndexText, IndexableNote } from "./indexTextBuilder";
import { rebuildChunkIndexForDocument } from "../db/chunkIndexRepo";
import { ensureDbReady, executeSql } from "../db/sqlite";

type StaleChunkRow = {
  chunk_id: string;
  memo_id: string;
};

type MemoSourceRow = {
  body: string;
};

type NoteSourceRow = {
  id: string;
  type: "daily" | "free";
  title: string | null;
  body: string;
};

type ProgressRow = {
  job_key: string;
  batch_size: number;
  processed_chunks: number;
  reindexed_docs: number;
  skipped_docs: number;
  error_count: number;
  updated_at: number;
};

export type EmbeddingBackfillProgress = {
  jobKey: string;
  batchSize: number;
  processedChunks: number;
  reindexedDocs: number;
  skippedDocs: number;
  errorCount: number;
  remainingChunks: number;
  updatedAt: number;
};

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_JOB_KEY = "embedding-backfill-v1";

const buildStaleWhereSql = (embeddingDim: number | null) => {
  if (embeddingDim && embeddingDim > 0) {
    return "(embedding IS NULL OR trim(embedding) = '' OR embedding_model IS NULL OR embedding_model <> ? OR embedded_at IS NULL OR embedding_dim IS NULL OR embedding_dim <> ?)";
  }
  return "(embedding IS NULL OR trim(embedding) = '' OR embedding_model IS NULL OR embedding_model <> ? OR embedded_at IS NULL)";
};

const buildStaleParams = (embeddingModel: string, embeddingDim: number | null) => {
  if (embeddingDim && embeddingDim > 0) {
    return [embeddingModel, embeddingDim];
  }
  return [embeddingModel];
};

const toProgress = (
  row: ProgressRow,
  remainingChunks: number,
): EmbeddingBackfillProgress => ({
  jobKey: row.job_key,
  batchSize: row.batch_size,
  processedChunks: row.processed_chunks,
  reindexedDocs: row.reindexed_docs,
  skippedDocs: row.skipped_docs,
  errorCount: row.error_count,
  remainingChunks,
  updatedAt: row.updated_at,
});

const readProgress = async (
  jobKey: string,
): Promise<ProgressRow | null> => {
  const result = await executeSql(
    "SELECT job_key, batch_size, processed_chunks, reindexed_docs, skipped_docs, error_count, updated_at FROM embedding_backfill_progress WHERE job_key = ? LIMIT 1",
    [jobKey],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows.item(0) as ProgressRow;
};

const saveProgress = async (progress: ProgressRow): Promise<void> => {
  await executeSql(
    "INSERT INTO embedding_backfill_progress (job_key, batch_size, processed_chunks, reindexed_docs, skipped_docs, error_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_key) DO UPDATE SET batch_size = excluded.batch_size, processed_chunks = excluded.processed_chunks, reindexed_docs = excluded.reindexed_docs, skipped_docs = excluded.skipped_docs, error_count = excluded.error_count, updated_at = excluded.updated_at",
    [
      progress.job_key,
      progress.batch_size,
      progress.processed_chunks,
      progress.reindexed_docs,
      progress.skipped_docs,
      progress.error_count,
      progress.updated_at,
    ],
  );
};

const saveError = async (input: {
  jobKey: string;
  documentId: string;
  chunkId: string | null;
  message: string;
}): Promise<void> => {
  await executeSql(
    "INSERT INTO embedding_backfill_errors (id, job_key, document_id, chunk_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      nanoid(),
      input.jobKey,
      input.documentId,
      input.chunkId,
      input.message,
      Date.now(),
    ],
  );
};

const loadIndexTextByDocumentId = async (
  documentId: string,
): Promise<string | null> => {
  if (documentId.startsWith("note:")) {
    const noteId = documentId.replace(/^note:/, "");
    const result = await executeSql(
      "SELECT id, type, title, body FROM notes WHERE id = ? LIMIT 1",
      [noteId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows.item(0) as NoteSourceRow;
    const note: IndexableNote = {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
    };
    return buildIndexText(note);
  }

  const memoResult = await executeSql(
    "SELECT body FROM memos WHERE id = ? LIMIT 1",
    [documentId],
  );
  if (memoResult.rows.length === 0) {
    return null;
  }
  const memoRow = memoResult.rows.item(0) as MemoSourceRow;
  return memoRow.body ?? "";
};

const selectStaleChunks = async (params: {
  embeddingModel: string;
  embeddingDim: number | null;
  batchSize: number;
}): Promise<StaleChunkRow[]> => {
  const whereSql = buildStaleWhereSql(params.embeddingDim);
  const whereParams = buildStaleParams(params.embeddingModel, params.embeddingDim);
  const result = await executeSql(
    `SELECT chunk_id, memo_id FROM chunk_index WHERE ${whereSql} ORDER BY created_at ASC LIMIT ?`,
    [...whereParams, params.batchSize],
  );
  return result.rows._array as StaleChunkRow[];
};

const countStaleChunks = async (params: {
  embeddingModel: string;
  embeddingDim: number | null;
}): Promise<number> => {
  const whereSql = buildStaleWhereSql(params.embeddingDim);
  const whereParams = buildStaleParams(params.embeddingModel, params.embeddingDim);
  const result = await executeSql(
    `SELECT COUNT(1) as count FROM chunk_index WHERE ${whereSql}`,
    whereParams,
  );
  const row = result.rows.item(0) as { count: number };
  return Number(row.count) || 0;
};

export const getEmbeddingBackfillProgress = async (
  jobKey = DEFAULT_JOB_KEY,
): Promise<EmbeddingBackfillProgress | null> => {
  await ensureDbReady();
  const provider = getEmbeddingProvider();
  const remainingChunks = await countStaleChunks({
    embeddingModel: provider.getModel(),
    embeddingDim: provider.getDim() > 0 ? provider.getDim() : null,
  });
  const row = await readProgress(jobKey);
  if (!row) {
    return null;
  }
  return toProgress(row, remainingChunks);
};

export const backfillEmbeddings = async (options?: {
  batchSize?: number;
  jobKey?: string;
}): Promise<EmbeddingBackfillProgress> => {
  await ensureDbReady();
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE);
  const jobKey = options?.jobKey ?? DEFAULT_JOB_KEY;

  const provider = getEmbeddingProvider();
  const embeddingModel = provider.getModel();
  const embeddingDim = provider.getDim() > 0 ? provider.getDim() : null;

  const staleChunks = await selectStaleChunks({
    embeddingModel,
    embeddingDim,
    batchSize,
  });

  const existing = await readProgress(jobKey);
  const nextProgress: ProgressRow = existing ?? {
    job_key: jobKey,
    batch_size: batchSize,
    processed_chunks: 0,
    reindexed_docs: 0,
    skipped_docs: 0,
    error_count: 0,
    updated_at: Date.now(),
  };
  nextProgress.batch_size = batchSize;

  if (staleChunks.length === 0) {
    nextProgress.updated_at = Date.now();
    await saveProgress(nextProgress);
    const remainingChunks = await countStaleChunks({
      embeddingModel,
      embeddingDim,
    });
    console.log(
      `[Backfill][Embedding] no stale chunks job=${jobKey} remaining=${remainingChunks}`,
    );
    return toProgress(nextProgress, remainingChunks);
  }

  const chunkCount = staleChunks.length;
  const memoIds = Array.from(new Set(staleChunks.map((row) => row.memo_id)));
  const sampleChunkIdByDoc = new Map(
    staleChunks.map((row) => [row.memo_id, row.chunk_id]),
  );

  for (const documentId of memoIds) {
    try {
      const indexText = await loadIndexTextByDocumentId(documentId);
      if (indexText === null) {
        nextProgress.skipped_docs += 1;
        console.warn(
          `[Backfill][Embedding] skip missing source documentId=${documentId}`,
        );
        continue;
      }
      await rebuildChunkIndexForDocument(documentId, indexText);
      nextProgress.reindexed_docs += 1;
    } catch (error) {
      nextProgress.error_count += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Backfill][Embedding] error documentId=${documentId} message=${message}`,
      );
      await saveError({
        jobKey,
        documentId,
        chunkId: sampleChunkIdByDoc.get(documentId) ?? null,
        message,
      });
    }
  }

  nextProgress.processed_chunks += chunkCount;
  nextProgress.updated_at = Date.now();
  await saveProgress(nextProgress);

  const remainingChunks = await countStaleChunks({
    embeddingModel,
    embeddingDim,
  });
  console.log(
    `[Backfill][Embedding] job=${jobKey} processedChunks+=${chunkCount} docs=${memoIds.length} reindexedTotal=${nextProgress.reindexed_docs} errorsTotal=${nextProgress.error_count} remaining=${remainingChunks}`,
  );
  return toProgress(nextProgress, remainingChunks);
};
