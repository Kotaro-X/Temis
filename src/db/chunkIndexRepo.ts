import { nanoid } from "nanoid/non-secure";

import { getEmbeddingProvider } from "../services/EmbeddingProvider";
import { chunkMemoBody } from "../utils/memoChunk";
import { cosineSimilarity, stableTopK } from "../utils/similarity";
import { ensureDbReady, executeSql } from "./sqlite";

export type EmbeddingStatus = "pending" | "processing" | "completed" | "failed";

type ChunkIndexRow = {
  chunk_id: string;
  memo_id: string;
  text: string;
  created_at: number;
  tags: string | null;
  embedding: string;
  embedding_model: string | null;
  embedding_dim: number | null;
  embedded_at: number | null;
  embedding_status: EmbeddingStatus | null;
  embedding_model_version: string | null;
  embedding_error: string | null;
  embedding_attempts: number | null;
};

export type ChunkIndexRecord = {
  chunkId: string;
  memoId: string;
  text: string;
  createdAt: number;
  tags: string[];
  embedding: number[];
  embeddingModel: string | null;
  embeddingDim: number | null;
  embeddedAt: number | null;
  embeddingStatus: EmbeddingStatus;
  embeddingModelVersion: string | null;
  embeddingError: string | null;
  embeddingAttempts: number;
};

export type ChunkSimilarityHit = ChunkIndexRecord & {
  similarity: number;
};

export type ChunkIndexRebuildStats = {
  chunkCount: number;
  indexedTextLength: number;
  embeddingModel: string;
  embeddingDim: number;
  embeddedAt: number | null;
};

export type ChunkIndexTextStats = {
  chunkCount: number;
  indexedTextLength: number;
};

export type MemoEmbeddingStatus =
  | "unbuilt"
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type PendingEmbeddingChunk = {
  chunkId: string;
  memoId: string;
  text: string;
  attempts: number;
};

const parseJsonArray = <T>(value: string | null, fallback: T[]): T[] => {
  if (!value) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return fallback;
    }
    return parsed as T[];
  } catch {
    return fallback;
  }
};

const toChunkRecord = (row: ChunkIndexRow): ChunkIndexRecord => ({
  chunkId: row.chunk_id,
  memoId: row.memo_id,
  text: row.text,
  createdAt: row.created_at,
  tags: parseJsonArray<string>(row.tags, []).filter(
    (tag): tag is string => typeof tag === "string",
  ),
  embedding: parseJsonArray<number>(row.embedding, []).filter(
    (value): value is number => typeof value === "number",
  ),
  embeddingModel: row.embedding_model,
  embeddingDim: row.embedding_dim,
  embeddedAt: row.embedded_at,
  embeddingStatus: row.embedding_status ?? "completed",
  embeddingModelVersion: row.embedding_model_version,
  embeddingError: row.embedding_error,
  embeddingAttempts: Number(row.embedding_attempts) || 0,
});

export const replaceChunkIndexTextForDocument = async (
  documentId: string,
  text: string,
  options?: { embeddingModelVersion?: string },
): Promise<ChunkIndexTextStats> => {
  await ensureDbReady();
  const chunks = chunkMemoBody(text);
  const now = Date.now();
  await executeSql("DELETE FROM chunk_index WHERE memo_id = ?", [documentId]);
  for (const chunk of chunks) {
    await executeSql(
      "INSERT INTO chunk_index (chunk_id, memo_id, text, created_at, tags, embedding, embedding_model, embedding_dim, embedded_at, embedding_status, embedding_model_version, embedding_error, embedding_attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        nanoid(),
        documentId,
        chunk.text,
        now,
        chunk.tags.length > 0 ? JSON.stringify(chunk.tags) : null,
        "[]",
        null,
        null,
        null,
        "pending",
        options?.embeddingModelVersion ?? null,
        null,
        0,
      ],
    );
  }
  return {
    chunkCount: chunks.length,
    indexedTextLength: text.length,
  };
};

export const replaceChunkIndexTextForMemo = async (
  memoId: string,
  body: string,
  options?: { embeddingModelVersion?: string },
): Promise<void> => {
  await replaceChunkIndexTextForDocument(memoId, body, options);
};

const buildEmbeddingStaleWhereSql = (embeddingDim: number | null): string => {
  if (embeddingDim && embeddingDim > 0) {
    return "(embedding_status <> 'completed' OR embedding_model_version IS NULL OR embedding_model_version <> ? OR embedded_at IS NULL OR embedding_model IS NULL OR embedding_model <> ? OR embedding_dim IS NULL OR embedding_dim <> ?)";
  }
  return "(embedding_status <> 'completed' OR embedding_model_version IS NULL OR embedding_model_version <> ? OR embedded_at IS NULL OR embedding_model IS NULL OR embedding_model <> ?)";
};

const buildEmbeddingStaleParams = (
  embeddingModelVersion: string,
  embeddingModel: string,
  embeddingDim: number | null,
): Array<string | number> => {
  if (embeddingDim && embeddingDim > 0) {
    return [embeddingModelVersion, embeddingModel, embeddingDim];
  }
  return [embeddingModelVersion, embeddingModel];
};

export const getChunksNeedingEmbeddingForMemo = async (
  memoId: string,
  options: {
    embeddingModel: string;
    embeddingModelVersion: string;
    embeddingDim: number | null;
  },
): Promise<PendingEmbeddingChunk[]> => {
  await ensureDbReady();
  const whereSql = buildEmbeddingStaleWhereSql(options.embeddingDim);
  const whereParams = buildEmbeddingStaleParams(
    options.embeddingModelVersion,
    options.embeddingModel,
    options.embeddingDim,
  );
  const result = await executeSql(
    `SELECT chunk_id, memo_id, text, embedding_attempts FROM chunk_index WHERE memo_id = ? AND ${whereSql} ORDER BY created_at ASC`,
    [memoId, ...whereParams],
  );
  return (result.rows._array as Array<{
    chunk_id: string;
    memo_id: string;
    text: string;
    embedding_attempts: number | null;
  }>).map((row) => ({
    chunkId: row.chunk_id,
    memoId: row.memo_id,
    text: row.text,
    attempts: Number(row.embedding_attempts) || 0,
  }));
};

export const markEmbeddingChunksProcessing = async (
  chunkIds: string[],
): Promise<void> => {
  await ensureDbReady();
  for (const chunkId of chunkIds) {
    await executeSql(
      "UPDATE chunk_index SET embedding_status = 'processing', embedding_error = NULL, embedding_attempts = embedding_attempts + 1 WHERE chunk_id = ?",
      [chunkId],
    );
  }
};

export const writeChunkEmbeddings = async (
  entries: Array<{
    chunkId: string;
    embedding: number[];
    embeddingModel: string;
    embeddingModelVersion: string;
    embeddingDim: number;
    embeddedAt: number;
  }>,
): Promise<void> => {
  await ensureDbReady();
  for (const entry of entries) {
    await executeSql(
      "UPDATE chunk_index SET embedding = ?, embedding_model = ?, embedding_dim = ?, embedded_at = ?, embedding_status = 'completed', embedding_model_version = ?, embedding_error = NULL WHERE chunk_id = ?",
      [
        JSON.stringify(entry.embedding),
        entry.embeddingModel,
        entry.embeddingDim,
        entry.embeddedAt,
        entry.embeddingModelVersion,
        entry.chunkId,
      ],
    );
  }
};

export const markMemoEmbeddingFailed = async (
  memoId: string,
  message: string,
): Promise<void> => {
  await ensureDbReady();
  await executeSql(
    "UPDATE chunk_index SET embedding_status = 'failed', embedding_error = ? WHERE memo_id = ? AND embedding_status <> 'completed'",
    [message, memoId],
  );
};

export const markMemoEmbeddingPending = async (
  memoId: string,
  embeddingModelVersion: string,
): Promise<void> => {
  await ensureDbReady();
  await executeSql(
    "UPDATE chunk_index SET embedding_status = 'pending', embedding_model_version = ?, embedding_error = NULL WHERE memo_id = ?",
    [embeddingModelVersion, memoId],
  );
};

export const countChunksNeedingEmbeddingForMemo = async (
  memoId: string,
  options: {
    embeddingModel: string;
    embeddingModelVersion: string;
    embeddingDim: number | null;
  },
): Promise<number> => {
  await ensureDbReady();
  const whereSql = buildEmbeddingStaleWhereSql(options.embeddingDim);
  const whereParams = buildEmbeddingStaleParams(
    options.embeddingModelVersion,
    options.embeddingModel,
    options.embeddingDim,
  );
  const result = await executeSql(
    `SELECT COUNT(1) as count FROM chunk_index WHERE memo_id = ? AND ${whereSql}`,
    [memoId, ...whereParams],
  );
  const row = result.rows.item(0) as { count: number };
  return Number(row.count) || 0;
};

export const getMemoEmbeddingStatus = async (
  memoId: string,
): Promise<MemoEmbeddingStatus> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT embedding_status, COUNT(1) as count FROM chunk_index WHERE memo_id = ? GROUP BY embedding_status",
    [memoId],
  );
  const rows = result.rows._array as Array<{
    embedding_status: EmbeddingStatus | null;
    count: number;
  }>;
  if (rows.length === 0) {
    return "unbuilt";
  }
  const statuses = new Set(rows.map((row) => row.embedding_status ?? "completed"));
  if (statuses.has("failed")) {
    return "failed";
  }
  if (statuses.has("processing")) {
    return "processing";
  }
  if (statuses.has("pending")) {
    return "pending";
  }
  return "completed";
};

export const rebuildChunkIndexForDocument = async (
  documentId: string,
  text: string,
): Promise<ChunkIndexRebuildStats> => {
  await ensureDbReady();
  await replaceChunkIndexTextForDocument(documentId, text, {
    embeddingModelVersion: getEmbeddingProvider().getModelVersion(),
  });
  const provider = getEmbeddingProvider();
  const model = provider.getModel();
  const modelVersion = provider.getModelVersion();
  const chunks = await getChunksByMemoId(documentId);
  if (chunks.length === 0) {
    return {
      chunkCount: 0,
      indexedTextLength: text.length,
      embeddingModel: model,
      embeddingDim: provider.getDim(),
      embeddedAt: null,
    };
  }

  const embeddings = await provider.embedBatch(chunks.map((chunk) => chunk.text));
  const dim = provider.getDim();
  if (embeddings.length !== chunks.length) {
    throw new Error("EmbeddingProvider returned invalid batch size.");
  }

  const now = Date.now();
  let resolvedDim = dim;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const embedding = embeddings[index];
    const embeddingDim = dim > 0 ? dim : embedding.length;
    resolvedDim = embeddingDim;
    if (embeddingDim > 0 && embedding.length !== embeddingDim) {
      throw new Error("EmbeddingProvider returned invalid vector dimension.");
    }
    await executeSql(
      "UPDATE chunk_index SET embedding = ?, embedding_model = ?, embedding_dim = ?, embedded_at = ?, embedding_status = 'completed', embedding_model_version = ?, embedding_error = NULL WHERE chunk_id = ?",
      [
        JSON.stringify(embedding),
        model,
        embeddingDim,
        now,
        modelVersion,
        chunk.chunkId,
      ],
    );
  }
  return {
    chunkCount: chunks.length,
    indexedTextLength: text.length,
    embeddingModel: model,
    embeddingDim: resolvedDim,
    embeddedAt: now,
  };
};

export const rebuildChunkIndexForMemo = async (
  memoId: string,
  body: string,
): Promise<void> => {
  await rebuildChunkIndexForDocument(memoId, body);
};

export const getChunksByMemoId = async (
  memoId: string,
): Promise<ChunkIndexRecord[]> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT chunk_id, memo_id, text, created_at, tags, embedding, embedding_model, embedding_dim, embedded_at, embedding_status, embedding_model_version, embedding_error, embedding_attempts FROM chunk_index WHERE memo_id = ? ORDER BY created_at ASC",
    [memoId],
  );
  return (result.rows._array as ChunkIndexRow[]).map((row) =>
    toChunkRecord(row),
  );
};

export const getChunksByMemoIds = async (
  memoIds: string[],
): Promise<ChunkIndexRecord[]> => {
  await ensureDbReady();
  if (memoIds.length === 0) {
    return [];
  }
  const placeholders = memoIds.map(() => "?").join(", ");
  const result = await executeSql(
    `SELECT chunk_id, memo_id, text, created_at, tags, embedding, embedding_model, embedding_dim, embedded_at, embedding_status, embedding_model_version, embedding_error, embedding_attempts FROM chunk_index WHERE memo_id IN (${placeholders}) ORDER BY created_at DESC`,
    memoIds,
  );
  return (result.rows._array as ChunkIndexRow[]).map((row) =>
    toChunkRecord(row),
  );
};

export const searchTopChunksByEmbedding = async (
  queryEmbedding: number[],
  topK = 8,
  options: { embeddingModel: string; embeddingDim?: number },
): Promise<ChunkSimilarityHit[]> => {
  await ensureDbReady();
  if (queryEmbedding.length === 0 || topK <= 0) {
    return [];
  }
  const normalizedTopK = Math.min(10, Math.max(5, Math.floor(topK)));
  const embeddingDim = options.embeddingDim ?? queryEmbedding.length;
  const result = await executeSql(
    "SELECT chunk_id, memo_id, text, created_at, tags, embedding, embedding_model, embedding_dim, embedded_at, embedding_status, embedding_model_version, embedding_error, embedding_attempts FROM chunk_index WHERE embedding_model = ? AND embedding_dim = ? AND embedding_status = 'completed'",
    [options.embeddingModel, embeddingDim],
  );
  const scored = (result.rows._array as ChunkIndexRow[]).flatMap((row) => {
    const chunk = toChunkRecord(row);
    const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (similarity === null || similarity <= 0) {
      return [];
    }
    return [
      {
        ...chunk,
        similarity: Number(similarity.toFixed(6)),
      },
    ];
  });
  return stableTopK(
    scored,
    normalizedTopK,
    (left, right) =>
      right.similarity - left.similarity ||
      left.chunkId.localeCompare(right.chunkId),
  );
};

export const getChunkIndexCountByDocumentId = async (
  documentId: string,
  options?: { embeddingModel?: string; embeddingDim?: number },
): Promise<number> => {
  await ensureDbReady();
  if (
    options?.embeddingModel &&
    typeof options.embeddingDim === "number"
  ) {
    const result = await executeSql(
      "SELECT COUNT(1) as count FROM chunk_index WHERE memo_id = ? AND embedding_model = ? AND embedding_dim = ?",
      [documentId, options.embeddingModel, options.embeddingDim],
    );
    const row = result.rows.item(0) as { count: number };
    return Number(row.count) || 0;
  }
  if (options?.embeddingModel) {
    const result = await executeSql(
      "SELECT COUNT(1) as count FROM chunk_index WHERE memo_id = ? AND embedding_model = ?",
      [documentId, options.embeddingModel],
    );
    const row = result.rows.item(0) as { count: number };
    return Number(row.count) || 0;
  }
  const result = await executeSql(
    "SELECT COUNT(1) as count FROM chunk_index WHERE memo_id = ?",
    [documentId],
  );
  const row = result.rows.item(0) as { count: number };
  return Number(row.count) || 0;
};
