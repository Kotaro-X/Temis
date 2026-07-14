import { nanoid } from "nanoid/non-secure";

import {
  countChunksNeedingEmbeddingForMemo,
  getChunksNeedingEmbeddingForMemo,
  markEmbeddingChunksProcessing,
  markMemoEmbeddingFailed,
  markMemoEmbeddingPending,
  writeChunkEmbeddings,
} from "../db/chunkIndexRepo";
import { ensureDbReady, executeSql } from "../db/sqlite";
import { invalidateHybridSearchCache } from "./hybridSearch";
import { getEmbeddingProvider } from "./EmbeddingProvider";
import {
  canRunEmbeddingJob,
  EmbeddingJobStatus,
  markEmbeddingJobFailed as resolveFailedJob,
} from "./embeddingJobPolicy";

type EmbeddingJobRow = {
  id: string;
  memo_id: string;
  status: EmbeddingJobStatus;
  attempts: number;
  max_attempts: number;
  embedding_model_version: string;
  next_run_at: number;
  locked_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

type MemoIdRow = {
  id: string;
};

type CountRow = {
  count: number;
};

type RebuildProgressRow = {
  job_key: string;
  status: "pending" | "running" | "completed";
  embedding_model_version: string;
  cursor_memo_id: string | null;
  total_memos: number;
  processed_memos: number;
  enqueued_memos: number;
  force: number;
  created_at: number;
  updated_at: number;
};

export type EmbeddingJobRecord = {
  id: string;
  memoId: string;
  status: EmbeddingJobStatus;
  attempts: number;
  maxAttempts: number;
  embeddingModelVersion: string;
  nextRunAt: number;
  lockedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type EmbeddingJobRunResult = {
  jobId: string;
  memoId: string;
  status: EmbeddingJobStatus;
  chunkCount: number;
  error: string | null;
};

export type EmbeddingJobsRunSummary = {
  processedJobs: number;
  completedJobs: number;
  failedJobs: number;
};

export type MemoEmbeddingRebuildProgress = {
  jobKey: string;
  status: "pending" | "running" | "completed";
  embeddingModelVersion: string;
  cursorMemoId: string | null;
  totalMemos: number;
  processedMemos: number;
  enqueuedMemos: number;
  force: boolean;
  updatedAt: number;
};

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_JOB_LIMIT = 5;
const DEFAULT_REBUILD_JOB_KEY = "memo-embedding-rebuild-v1";
const STALE_PROCESSING_JOB_MS = 5 * 60 * 1_000;

const toJobRecord = (row: EmbeddingJobRow): EmbeddingJobRecord => ({
  id: row.id,
  memoId: row.memo_id,
  status: row.status,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  embeddingModelVersion: row.embedding_model_version,
  nextRunAt: row.next_run_at,
  lockedAt: row.locked_at,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toRebuildProgress = (
  row: RebuildProgressRow,
): MemoEmbeddingRebuildProgress => ({
  jobKey: row.job_key,
  status: row.status,
  embeddingModelVersion: row.embedding_model_version,
  cursorMemoId: row.cursor_memo_id,
  totalMemos: Number(row.total_memos) || 0,
  processedMemos: Number(row.processed_memos) || 0,
  enqueuedMemos: Number(row.enqueued_memos) || 0,
  force: row.force === 1,
  updatedAt: row.updated_at,
});

const getCurrentEmbeddingTarget = () => {
  const provider = getEmbeddingProvider();
  return {
    provider,
    embeddingModel: provider.getModel(),
    embeddingModelVersion: provider.getModelVersion(),
    embeddingDim: provider.getDim() > 0 ? provider.getDim() : null,
  };
};

export const enqueueMemoEmbeddingJob = async (
  memoId: string,
  options?: {
    embeddingModelVersion?: string;
    maxAttempts?: number;
    now?: number;
  },
): Promise<void> => {
  await ensureDbReady();
  const now = options?.now ?? Date.now();
  const embeddingModelVersion =
    options?.embeddingModelVersion ?? getEmbeddingProvider().getModelVersion();
  await executeSql(
    "INSERT INTO embedding_jobs (id, memo_id, status, attempts, max_attempts, embedding_model_version, next_run_at, locked_at, last_error, created_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(memo_id, embedding_model_version) DO UPDATE SET status = 'pending', attempts = 0, max_attempts = excluded.max_attempts, next_run_at = excluded.next_run_at, locked_at = NULL, last_error = NULL, updated_at = excluded.updated_at",
    [
      nanoid(),
      memoId,
      options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      embeddingModelVersion,
      now,
      now,
      now,
    ],
  );
};

export const retryMemoEmbeddingJob = async (
  memoId: string,
  options?: { embeddingModelVersion?: string },
): Promise<void> => {
  await ensureDbReady();
  const embeddingModelVersion =
    options?.embeddingModelVersion ?? getEmbeddingProvider().getModelVersion();
  await markMemoEmbeddingPending(memoId, embeddingModelVersion);
  await enqueueMemoEmbeddingJob(memoId, { embeddingModelVersion });
};

export const listRunnableEmbeddingJobs = async (
  limit = DEFAULT_JOB_LIMIT,
  now = Date.now(),
): Promise<EmbeddingJobRecord[]> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, memo_id, status, attempts, max_attempts, embedding_model_version, next_run_at, locked_at, last_error, created_at, updated_at FROM embedding_jobs WHERE status IN ('pending', 'failed') AND attempts < max_attempts AND next_run_at <= ? ORDER BY next_run_at ASC, created_at ASC LIMIT ?",
    [now, Math.max(1, limit)],
  );
  return (result.rows._array as EmbeddingJobRow[]).map(toJobRecord);
};

export const recoverStaleEmbeddingJobs = async (
  now = Date.now(),
): Promise<void> => {
  await ensureDbReady();
  const staleBefore = now - STALE_PROCESSING_JOB_MS;
  await executeSql(
    "UPDATE embedding_jobs SET status = 'pending', locked_at = NULL, updated_at = ? WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at < ?",
    [now, staleBefore],
  );
  await executeSql(
    "UPDATE chunk_index SET embedding_status = 'pending' WHERE embedding_status = 'processing' AND memo_id IN (SELECT memo_id FROM embedding_jobs WHERE status = 'pending' AND locked_at IS NULL AND updated_at = ?)",
    [now],
  );
};

const isMemoPresent = async (memoId: string): Promise<boolean> => {
  const result = await executeSql("SELECT id FROM memos WHERE id = ? LIMIT 1", [
    memoId,
  ]);
  return result.rows.length > 0;
};

const markJobProcessing = async (
  job: EmbeddingJobRecord,
  now: number,
): Promise<void> => {
  await executeSql(
    "UPDATE embedding_jobs SET status = 'processing', attempts = attempts + 1, locked_at = ?, last_error = NULL, updated_at = ? WHERE id = ?",
    [now, now, job.id],
  );
};

const markJobCompleted = async (
  jobId: string,
  now: number,
): Promise<void> => {
  await executeSql(
    "UPDATE embedding_jobs SET status = 'completed', locked_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
    [now, jobId],
  );
};

const markJobPending = async (
  jobId: string,
  now: number,
): Promise<void> => {
  await executeSql(
    "UPDATE embedding_jobs SET status = 'pending', locked_at = NULL, updated_at = ? WHERE id = ?",
    [now, jobId],
  );
};

const markJobFailed = async (
  job: EmbeddingJobRecord,
  message: string,
  now: number,
): Promise<void> => {
  const failed = resolveFailedJob(
    {
      status: job.status,
      attempts: job.attempts + 1,
      maxAttempts: job.maxAttempts,
      nextRunAt: job.nextRunAt,
      lastError: job.lastError,
    },
    message,
    now,
  );
  await executeSql(
    "UPDATE embedding_jobs SET status = ?, next_run_at = ?, locked_at = NULL, last_error = ?, updated_at = ? WHERE id = ?",
    [failed.status, failed.nextRunAt, failed.lastError, now, job.id],
  );
};

const deleteJob = async (jobId: string): Promise<void> => {
  await executeSql("DELETE FROM embedding_jobs WHERE id = ?", [jobId]);
};

export const runEmbeddingJob = async (
  job: EmbeddingJobRecord,
): Promise<EmbeddingJobRunResult> => {
  await ensureDbReady();
  const startedAt = Date.now();
  if (!canRunEmbeddingJob(job, startedAt)) {
    return {
      jobId: job.id,
      memoId: job.memoId,
      status: job.status,
      chunkCount: 0,
      error: null,
    };
  }

  if (!(await isMemoPresent(job.memoId))) {
    await executeSql("DELETE FROM chunk_index WHERE memo_id = ?", [job.memoId]);
    await deleteJob(job.id);
    invalidateHybridSearchCache();
    return {
      jobId: job.id,
      memoId: job.memoId,
      status: "completed",
      chunkCount: 0,
      error: null,
    };
  }

  await markJobProcessing(job, startedAt);
  const target = getCurrentEmbeddingTarget();

  try {
    const chunks = await getChunksNeedingEmbeddingForMemo(job.memoId, {
      embeddingModel: target.embeddingModel,
      embeddingModelVersion: target.embeddingModelVersion,
      embeddingDim: target.embeddingDim,
    });

    if (chunks.length === 0) {
      await markJobCompleted(job.id, Date.now());
      return {
        jobId: job.id,
        memoId: job.memoId,
        status: "completed",
        chunkCount: 0,
        error: null,
      };
    }

    await markEmbeddingChunksProcessing(chunks.map((chunk) => chunk.chunkId));
    const embeddings = await target.provider.embedBatch(
      chunks.map((chunk) => chunk.text),
    );
    if (embeddings.length !== chunks.length) {
      throw new Error("EmbeddingProvider returned invalid batch size.");
    }

    const embeddedAt = Date.now();
    const entries = embeddings.map((embedding, index) => {
      const embeddingDim =
        target.embeddingDim && target.embeddingDim > 0
          ? target.embeddingDim
          : embedding.length;
      if (embeddingDim > 0 && embedding.length !== embeddingDim) {
        throw new Error("EmbeddingProvider returned invalid vector dimension.");
      }
      return {
        chunkId: chunks[index].chunkId,
        embedding,
        embeddingModel: target.embeddingModel,
        embeddingModelVersion: target.embeddingModelVersion,
        embeddingDim,
        embeddedAt,
      };
    });

    await writeChunkEmbeddings(entries);
    const remaining = await countChunksNeedingEmbeddingForMemo(job.memoId, {
      embeddingModel: target.embeddingModel,
      embeddingModelVersion: target.embeddingModelVersion,
      embeddingDim: target.embeddingDim,
    });
    if (remaining === 0) {
      await markJobCompleted(job.id, Date.now());
    } else {
      await markJobPending(job.id, Date.now());
    }
    invalidateHybridSearchCache();
    return {
      jobId: job.id,
      memoId: job.memoId,
      status: remaining === 0 ? "completed" : "pending",
      chunkCount: entries.length,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markMemoEmbeddingFailed(job.memoId, message);
    await markJobFailed(job, message, Date.now());
    invalidateHybridSearchCache();
    return {
      jobId: job.id,
      memoId: job.memoId,
      status: "failed",
      chunkCount: 0,
      error: message,
    };
  }
};

export const runPendingEmbeddingJobs = async (options?: {
  limit?: number;
}): Promise<EmbeddingJobsRunSummary> => {
  await recoverStaleEmbeddingJobs();
  const jobs = await listRunnableEmbeddingJobs(options?.limit ?? DEFAULT_JOB_LIMIT);
  let completedJobs = 0;
  let failedJobs = 0;
  for (const job of jobs) {
    const result = await runEmbeddingJob(job);
    if (result.status === "completed") {
      completedJobs += 1;
    }
    if (result.status === "failed") {
      failedJobs += 1;
    }
  }
  return {
    processedJobs: jobs.length,
    completedJobs,
    failedJobs,
  };
};

const countAllMemos = async (): Promise<number> => {
  const result = await executeSql("SELECT COUNT(1) as count FROM memos");
  const row = result.rows.item(0) as CountRow;
  return Number(row.count) || 0;
};

const readRebuildProgress = async (
  jobKey: string,
): Promise<MemoEmbeddingRebuildProgress | null> => {
  const result = await executeSql(
    "SELECT job_key, status, embedding_model_version, cursor_memo_id, total_memos, processed_memos, enqueued_memos, force, created_at, updated_at FROM embedding_rebuild_progress WHERE job_key = ? LIMIT 1",
    [jobKey],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return toRebuildProgress(result.rows.item(0) as RebuildProgressRow);
};

const saveRebuildProgress = async (
  progress: MemoEmbeddingRebuildProgress,
): Promise<void> => {
  const now = Date.now();
  await executeSql(
    "INSERT INTO embedding_rebuild_progress (job_key, status, embedding_model_version, cursor_memo_id, total_memos, processed_memos, enqueued_memos, force, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_key) DO UPDATE SET status = excluded.status, embedding_model_version = excluded.embedding_model_version, cursor_memo_id = excluded.cursor_memo_id, total_memos = excluded.total_memos, processed_memos = excluded.processed_memos, enqueued_memos = excluded.enqueued_memos, force = excluded.force, updated_at = excluded.updated_at",
    [
      progress.jobKey,
      progress.status,
      progress.embeddingModelVersion,
      progress.cursorMemoId,
      progress.totalMemos,
      progress.processedMemos,
      progress.enqueuedMemos,
      progress.force ? 1 : 0,
      now,
      now,
    ],
  );
};

export const rebuildAllMemoEmbeddings = async (options?: {
  batchSize?: number;
  force?: boolean;
  jobKey?: string;
}): Promise<MemoEmbeddingRebuildProgress> => {
  await ensureDbReady();
  const batchSize = Math.max(1, options?.batchSize ?? 20);
  const jobKey = options?.jobKey ?? DEFAULT_REBUILD_JOB_KEY;
  const embeddingModelVersion = getEmbeddingProvider().getModelVersion();
  const existing = await readRebuildProgress(jobKey);
  const now = Date.now();
  const force = options?.force ?? existing?.force ?? false;
  const progress =
    existing && existing.status !== "completed"
      ? existing
      : {
          jobKey,
          status: "running" as const,
          embeddingModelVersion,
          cursorMemoId: null,
          totalMemos: await countAllMemos(),
          processedMemos: 0,
          enqueuedMemos: 0,
          force,
          updatedAt: now,
        };

  const params: Array<string | number> = [];
  let cursorSql = "";
  if (progress.cursorMemoId) {
    cursorSql = "WHERE id > ?";
    params.push(progress.cursorMemoId);
  }
  params.push(batchSize);
  const result = await executeSql(
    `SELECT id FROM memos ${cursorSql} ORDER BY id ASC LIMIT ?`,
    params,
  );
  const memos = result.rows._array as MemoIdRow[];

  if (memos.length === 0) {
    const completed = {
      ...progress,
      status: "completed" as const,
      updatedAt: now,
    };
    await saveRebuildProgress(completed);
    return completed;
  }

  let enqueued = 0;
  for (const memo of memos) {
    if (force) {
      await markMemoEmbeddingPending(memo.id, embeddingModelVersion);
    }
    await enqueueMemoEmbeddingJob(memo.id, { embeddingModelVersion });
    enqueued += 1;
  }

  const lastMemo = memos[memos.length - 1];
  const nextProgress = {
    ...progress,
    status: "running" as const,
    cursorMemoId: lastMemo.id,
    processedMemos: progress.processedMemos + memos.length,
    enqueuedMemos: progress.enqueuedMemos + enqueued,
    updatedAt: Date.now(),
  };
  await saveRebuildProgress(nextProgress);
  return nextProgress;
};
