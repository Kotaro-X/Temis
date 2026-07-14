import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canRunEmbeddingJob,
  markEmbeddingJobFailed,
  resolveRetryDelayMs,
  shouldCompleteEmbeddingJob,
} from "../src/services/embeddingJobPolicy.ts";
import { runMigrations } from "../src/db/migrations.ts";

test("embedding job is resumable after restart when pending and due", () => {
  assert.equal(
    canRunEmbeddingJob(
      {
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        nextRunAt: 100,
        lastError: null,
      },
      101,
    ),
    true,
  );
});

test("embedding failure records retryable failed state with backoff", () => {
  const failed = markEmbeddingJobFailed(
    {
      status: "processing",
      attempts: 1,
      maxAttempts: 5,
      nextRunAt: 0,
      lastError: null,
    },
    "provider unavailable",
    1_000,
  );

  assert.equal(failed.status, "failed");
  assert.equal(failed.lastError, "provider unavailable");
  assert.equal(failed.nextRunAt, 1_000 + resolveRetryDelayMs(1));
  assert.equal(canRunEmbeddingJob(failed, failed.nextRunAt - 1), false);
  assert.equal(canRunEmbeddingJob(failed, failed.nextRunAt), true);
});

test("embedding job stops automatic retries after max attempts", () => {
  assert.equal(
    canRunEmbeddingJob(
      {
        status: "failed",
        attempts: 5,
        maxAttempts: 5,
        nextRunAt: 100,
        lastError: "still failing",
      },
      1_000,
    ),
    false,
  );
});

test("embedding completion is idempotent when no stale chunks remain", () => {
  assert.equal(shouldCompleteEmbeddingJob(0), true);
  assert.equal(shouldCompleteEmbeddingJob(2), false);
});

test("migrations create embedding outbox and status columns", async () => {
  const statements: string[] = [];
  await runMigrations(async (sql) => {
    statements.push(sql);
    if (sql.startsWith("PRAGMA table_info")) {
      return { rows: { _array: [] } };
    }
    return { rows: { _array: [] } };
  });

  assert.equal(
    statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS embedding_jobs")),
    true,
  );
  assert.equal(
    statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS embedding_rebuild_progress")),
    true,
  );
  assert.equal(
    statements.some((sql) => sql.includes("embedding_status")),
    true,
  );
  assert.equal(
    statements.some((sql) => sql.includes("embedding_model_version")),
    true,
  );
});

test("memo persistence wraps memo and chunk index writes in one transaction", async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = await readFile(
    resolve(testDir, "../src/db/memoRepo.ts"),
    "utf8",
  );
  const beginIndex = source.indexOf('await executeSql("BEGIN IMMEDIATE TRANSACTION")');
  const memoWriteIndex = source.indexOf("UPDATE memos SET body", beginIndex);
  const chunkWriteIndex = source.indexOf("rebuildMemoIndexes", memoWriteIndex);
  const jobWriteIndex = source.indexOf("enqueueMemoEmbeddingJob", chunkWriteIndex);
  const commitIndex = source.indexOf('await executeSql("COMMIT")', jobWriteIndex);
  const rollbackIndex = source.indexOf('await executeSql("ROLLBACK")', beginIndex);

  assert.notEqual(beginIndex, -1);
  assert.notEqual(memoWriteIndex, -1);
  assert.notEqual(chunkWriteIndex, -1);
  assert.notEqual(jobWriteIndex, -1);
  assert.notEqual(commitIndex, -1);
  assert.notEqual(rollbackIndex, -1);
  assert.equal(beginIndex < memoWriteIndex, true);
  assert.equal(memoWriteIndex < chunkWriteIndex, true);
  assert.equal(chunkWriteIndex < jobWriteIndex, true);
  assert.equal(jobWriteIndex < commitIndex, true);
  assert.equal(rollbackIndex > beginIndex, true);
});

test("embedding runner recovers stale processing jobs for app restart", async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = await readFile(
    resolve(testDir, "../src/services/embeddingJobs.ts"),
    "utf8",
  );

  assert.equal(source.includes("recoverStaleEmbeddingJobs"), true);
  assert.equal(source.includes("status = 'processing'"), true);
  assert.equal(source.includes("status = 'pending'"), true);
  assert.equal(source.includes("await recoverStaleEmbeddingJobs()"), true);
});
