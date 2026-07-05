import { nanoid } from "nanoid/non-secure";

import { loadSyncDeviceId } from "../../storage";
import { getEmbeddingProvider } from "../services/EmbeddingProvider";
import { invalidateHybridSearchCache } from "../services/hybridSearch";
import { buildIndexText, buildNoteDocumentId } from "../services/indexTextBuilder";
import { buildNoteSyncEnvelope } from "../services/sync/syncEntityModels";
import { persistAndEnqueueSyncEnvelope } from "../services/sync/syncEnvelopeStore";
import { extractTokens } from "../utils/wikiLink";
import {
  getChunkIndexCountByDocumentId,
  rebuildChunkIndexForDocument,
} from "./chunkIndexRepo";
import { ensureDbReady, executeSql } from "./sqlite";
import {
  getTokenIndexCountByDocumentId,
  rebuildTokenIndexForDocument,
} from "./tokenIndexRepo";

export type NoteType = "daily" | "free";

type NoteRow = {
  id: string;
  type: NoteType;
  date: string | null;
  title: string | null;
  body: string;
  updated_at: number;
};

type NoteLinkRow = {
  token: string;
};

export type NoteRecord = {
  id: string;
  type: NoteType;
  date: string | null;
  title: string | null;
  body: string;
  updatedAt: number;
};

export type FreeNoteSummary = {
  id: string;
  title: string | null;
  updatedAt: number;
};

export type NoteIndexBackfillProgress = {
  jobKey: string;
  total: number;
  processed: number;
  reindexed: number;
  skipped: number;
  updatedAt: number;
};

type BackfillProgressRow = {
  job_key: string;
  total: number;
  processed: number;
  reindexed: number;
  skipped: number;
  updated_at: number;
};

const toNoteRecord = (row: NoteRow): NoteRecord => ({
  id: row.id,
  type: row.type,
  date: row.date,
  title: row.title,
  body: row.body,
  updatedAt: row.updated_at,
});

const toBackfillProgress = (row: BackfillProgressRow): NoteIndexBackfillProgress => ({
  jobKey: row.job_key,
  total: row.total,
  processed: row.processed,
  reindexed: row.reindexed,
  skipped: row.skipped,
  updatedAt: row.updated_at,
});

const saveBackfillProgress = async (
  progress: NoteIndexBackfillProgress,
): Promise<void> => {
  await executeSql(
    "INSERT INTO index_backfill_progress (job_key, total, processed, reindexed, skipped, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(job_key) DO UPDATE SET total = excluded.total, processed = excluded.processed, reindexed = excluded.reindexed, skipped = excluded.skipped, updated_at = excluded.updated_at",
    [
      progress.jobKey,
      progress.total,
      progress.processed,
      progress.reindexed,
      progress.skipped,
      progress.updatedAt,
    ],
  );
};

const rebuildSearchIndexesForNote = async (note: NoteRecord): Promise<void> => {
  const indexText = buildIndexText(note);
  const noteId = note.id;
  const documentId = buildNoteDocumentId(noteId);
  const freeTextLength =
    note.type === "free" ? (note.body ?? "").trim().length : 0;

  console.log(
    `[Index][Note] start noteId=${noteId} freeTextLength=${freeTextLength} indexTextLength=${indexText.length}`,
  );

  await rebuildNoteLinks(noteId, indexText);
  const tokenStats = await rebuildTokenIndexForDocument(documentId, indexText);
  const chunkStats = await rebuildChunkIndexForDocument(documentId, indexText);
  invalidateHybridSearchCache();
  console.log(
    `[Index][Note] done noteId=${noteId} chunks=${chunkStats.chunkCount} embedding=${chunkStats.chunkCount > 0 ? "yes" : "no"} embeddingModel=${chunkStats.embeddingModel} embeddingDim=${chunkStats.embeddingDim} tokens=${tokenStats.tokenCount}`,
  );
};

export const getDailyNoteByDate = async (
  date: string,
): Promise<NoteRecord | null> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, type, date, title, body, updated_at FROM notes WHERE type = 'daily' AND date = ? LIMIT 1",
    [date],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return toNoteRecord(result.rows.item(0) as NoteRow);
};

export const upsertDailyNote = async (
  date: string,
  body: string,
  options?: { enqueueSync?: boolean },
): Promise<NoteRecord> => {
  await ensureDbReady();
  const now = Date.now();
  const shouldEnqueueSync = options?.enqueueSync !== false;
  const existing = await executeSql(
    "SELECT id FROM notes WHERE type = 'daily' AND date = ? LIMIT 1",
    [date],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows.item(0) as Pick<NoteRow, "id">;
    const updated: NoteRecord = {
      id: row.id,
      type: "daily",
      date,
      title: null,
      body,
      updatedAt: now,
    };
    await executeSql("BEGIN IMMEDIATE TRANSACTION");
    try {
      await executeSql(
        "UPDATE notes SET body = ?, updated_at = ? WHERE id = ?",
        [body, now, row.id],
      );
      await rebuildSearchIndexesForNote(updated);
      await executeSql("COMMIT");
    } catch (error) {
      await executeSql("ROLLBACK");
      throw error;
    }
    if (shouldEnqueueSync) {
      const deviceId = await loadSyncDeviceId();
      await persistAndEnqueueSyncEnvelope(
        buildNoteSyncEnvelope({
          note: updated,
          deviceId,
        }),
      );
    }
    return updated;
  }
  const id = nanoid();
  const created: NoteRecord = {
    id,
    type: "daily",
    date,
    title: null,
    body,
    updatedAt: now,
  };
  await executeSql("BEGIN IMMEDIATE TRANSACTION");
  try {
    await executeSql(
      "INSERT INTO notes (id, type, date, title, body, updated_at) VALUES (?, 'daily', ?, NULL, ?, ?)",
      [id, date, body, now],
    );
    await rebuildSearchIndexesForNote(created);
    await executeSql("COMMIT");
  } catch (error) {
    await executeSql("ROLLBACK");
    throw error;
  }
  if (shouldEnqueueSync) {
    const deviceId = await loadSyncDeviceId();
    await persistAndEnqueueSyncEnvelope(
      buildNoteSyncEnvelope({
        note: created,
        deviceId,
      }),
    );
  }
  return created;
};

export const listFreeNotes = async (): Promise<FreeNoteSummary[]> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, title, updated_at FROM notes WHERE type = 'free' ORDER BY updated_at DESC",
  );
  return (result.rows._array as Array<{
    id: string;
    title: string | null;
    updated_at: number;
  }>).map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
  }));
};

export const getFreeNoteById = async (
  noteId: string,
): Promise<NoteRecord | null> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, type, date, title, body, updated_at FROM notes WHERE type = 'free' AND id = ? LIMIT 1",
    [noteId],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return toNoteRecord(result.rows.item(0) as NoteRow);
};

export const getNoteById = async (
  noteId: string,
): Promise<NoteRecord | null> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, type, date, title, body, updated_at FROM notes WHERE id = ? LIMIT 1",
    [noteId],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return toNoteRecord(result.rows.item(0) as NoteRow);
};

export const listAllNotes = async (): Promise<NoteRecord[]> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, type, date, title, body, updated_at FROM notes ORDER BY updated_at DESC",
  );
  return (result.rows._array as NoteRow[]).map((row) => toNoteRecord(row));
};

export const upsertFreeNote = async (input: {
  id?: string | null;
  title?: string | null;
  body: string;
  enqueueSync?: boolean;
}): Promise<NoteRecord> => {
  await ensureDbReady();
  const now = Date.now();
  const title = input.title ?? null;
  const shouldEnqueueSync = input.enqueueSync !== false;
  if (input.id) {
    const updated: NoteRecord = {
      id: input.id,
      type: "free",
      date: null,
      title,
      body: input.body,
      updatedAt: now,
    };
    await executeSql("BEGIN IMMEDIATE TRANSACTION");
    try {
      await executeSql(
        "UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND type = 'free'",
        [title, input.body, now, input.id],
      );
      await rebuildSearchIndexesForNote(updated);
      await executeSql("COMMIT");
    } catch (error) {
      await executeSql("ROLLBACK");
      throw error;
    }
    if (shouldEnqueueSync) {
      const deviceId = await loadSyncDeviceId();
      await persistAndEnqueueSyncEnvelope(
        buildNoteSyncEnvelope({
          note: updated,
          deviceId,
        }),
      );
    }
    return updated;
  }
  const id = nanoid();
  const created: NoteRecord = {
    id,
    type: "free",
    date: null,
    title,
    body: input.body,
    updatedAt: now,
  };
  await executeSql("BEGIN IMMEDIATE TRANSACTION");
  try {
    await executeSql(
      "INSERT INTO notes (id, type, date, title, body, updated_at) VALUES (?, 'free', NULL, ?, ?, ?)",
      [id, title, input.body, now],
    );
    await rebuildSearchIndexesForNote(created);
    await executeSql("COMMIT");
  } catch (error) {
    await executeSql("ROLLBACK");
    throw error;
  }
  if (shouldEnqueueSync) {
    const deviceId = await loadSyncDeviceId();
    await persistAndEnqueueSyncEnvelope(
      buildNoteSyncEnvelope({
        note: created,
        deviceId,
      }),
    );
  }
  return created;
};

export const upsertNoteRecord = async (
  record: NoteRecord,
): Promise<NoteRecord> => {
  await ensureDbReady();
  await executeSql("BEGIN IMMEDIATE TRANSACTION");
  try {
    await executeSql(
      "INSERT INTO notes (id, type, date, title, body, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, date = excluded.date, title = excluded.title, body = excluded.body, updated_at = excluded.updated_at",
      [
        record.id,
        record.type,
        record.date,
        record.title,
        record.body,
        record.updatedAt,
      ],
    );
    await rebuildSearchIndexesForNote(record);
    await executeSql("COMMIT");
  } catch (error) {
    await executeSql("ROLLBACK");
    throw error;
  }
  return record;
};

export const deleteNoteById = async (
  noteId: string,
  options?: { enqueueSync?: boolean },
): Promise<void> => {
  await ensureDbReady();
  const existing = await getNoteById(noteId);
  const documentId = buildNoteDocumentId(noteId);
  await executeSql("BEGIN IMMEDIATE TRANSACTION");
  try {
    await executeSql("DELETE FROM note_links WHERE note_id = ?", [noteId]);
    await executeSql("DELETE FROM token_index WHERE memo_id = ?", [documentId]);
    await executeSql("DELETE FROM chunk_index WHERE memo_id = ?", [documentId]);
    await executeSql("DELETE FROM notes WHERE id = ?", [noteId]);
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
    buildNoteSyncEnvelope({
      note: existing,
      deletedAt: Date.now(),
      deviceId,
    }),
  );
};

export const rebuildNoteLinks = async (
  noteId: string,
  text: string,
): Promise<void> => {
  await ensureDbReady();
  const tokens = extractTokens(text);
  await executeSql("DELETE FROM note_links WHERE note_id = ?", [noteId]);
  if (tokens.length === 0) {
    return;
  }
  for (const token of tokens) {
    await executeSql(
      "INSERT INTO note_links (id, note_id, token) VALUES (?, ?, ?)",
      [nanoid(), noteId, token],
    );
  }
};

export const getTokensByNoteId = async (noteId: string): Promise<string[]> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT token FROM note_links WHERE note_id = ? ORDER BY token",
    [noteId],
  );
  return (result.rows._array as NoteLinkRow[]).map((row) => row.token);
};

export const getNoteIndexBackfillProgress = async (
  jobKey: string,
): Promise<NoteIndexBackfillProgress | null> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT job_key, total, processed, reindexed, skipped, updated_at FROM index_backfill_progress WHERE job_key = ? LIMIT 1",
    [jobKey],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return toBackfillProgress(result.rows.item(0) as BackfillProgressRow);
};

export const backfillNoteIndexes = async (options?: {
  batchSize?: number;
  jobKey?: string;
  force?: boolean;
}): Promise<NoteIndexBackfillProgress> => {
  await ensureDbReady();
  const batchSize = Math.max(1, options?.batchSize ?? 20);
  const jobKey = options?.jobKey ?? "note-index-backfill-v1";
  const force = options?.force ?? false;
  const notes = await listAllNotes();
  const provider = getEmbeddingProvider();
  const providerModel = provider.getModel();
  const providerDim = provider.getDim();

  let processed = 0;
  let reindexed = 0;
  let skipped = 0;

  for (let offset = 0; offset < notes.length; offset += batchSize) {
    const batch = notes.slice(offset, offset + batchSize);
    for (const note of batch) {
      const indexText = buildIndexText(note);
      const documentId = buildNoteDocumentId(note.id);
      const tokenCount = await getTokenIndexCountByDocumentId(documentId);
      const chunkCount = await getChunkIndexCountByDocumentId(documentId, {
        embeddingModel: providerModel,
        embeddingDim: providerDim > 0 ? providerDim : undefined,
      });
      const needsReindex =
        force ||
        indexText.length === 0 ||
        tokenCount === 0 ||
        chunkCount === 0;
      if (needsReindex) {
        await rebuildSearchIndexesForNote(note);
        reindexed += 1;
      } else {
        skipped += 1;
      }
      processed += 1;
    }

    const progress: NoteIndexBackfillProgress = {
      jobKey,
      total: notes.length,
      processed,
      reindexed,
      skipped,
      updatedAt: Date.now(),
    };
    await saveBackfillProgress(progress);
    console.log(
      `[Backfill][Note] progress job=${jobKey} ${processed}/${notes.length} reindexed=${reindexed} skipped=${skipped}`,
    );
  }

  const completed: NoteIndexBackfillProgress = {
    jobKey,
    total: notes.length,
    processed,
    reindexed,
    skipped,
    updatedAt: Date.now(),
  };
  await saveBackfillProgress(completed);
  return completed;
};
