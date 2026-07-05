import { nanoid } from "nanoid/non-secure";

import { getEmbeddingProvider } from "../services/EmbeddingProvider";
import { chunkMemoBody } from "../utils/memoChunk";
import { cosineSimilarity, stableTopK } from "../utils/similarity";
import { ensureDbReady, executeSql } from "./sqlite";

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
});

export const rebuildChunkIndexForDocument = async (
  documentId: string,
  text: string,
): Promise<ChunkIndexRebuildStats> => {
  await ensureDbReady();
  const chunks = chunkMemoBody(text);
  await executeSql("DELETE FROM chunk_index WHERE memo_id = ?", [documentId]);
  const provider = getEmbeddingProvider();
  const model = provider.getModel();
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
      "INSERT INTO chunk_index (chunk_id, memo_id, text, created_at, tags, embedding, embedding_model, embedding_dim, embedded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        nanoid(),
        documentId,
        chunk.text,
        now,
        chunk.tags.length > 0 ? JSON.stringify(chunk.tags) : null,
        JSON.stringify(embedding),
        model,
        embeddingDim,
        now,
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
    "SELECT chunk_id, memo_id, text, created_at, tags, embedding, embedding_model, embedding_dim, embedded_at FROM chunk_index WHERE memo_id = ? ORDER BY created_at ASC",
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
    `SELECT chunk_id, memo_id, text, created_at, tags, embedding, embedding_model, embedding_dim, embedded_at FROM chunk_index WHERE memo_id IN (${placeholders}) ORDER BY created_at DESC`,
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
    "SELECT chunk_id, memo_id, text, created_at, tags, embedding, embedding_model, embedding_dim, embedded_at FROM chunk_index WHERE embedding_model = ? AND embedding_dim = ?",
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
