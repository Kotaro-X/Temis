import test from "node:test";
import assert from "node:assert/strict";

import {
  SYNC_PAGE_SIZE,
  completeSyncEntityMetadata,
  createEmptySyncEntityMetadata,
  createIncrementalPullRequest,
  failSyncEntityMetadata,
  runIncrementalPull,
  type IncrementalPullRequest,
} from "../src/services/sync/syncCore.ts";
import type { SyncEntityMetadata } from "../src/types/sync.ts";

const completedMetadata = (
  overrides: Partial<SyncEntityMetadata> = {},
): SyncEntityMetadata => ({
  ...createEmptySyncEntityMetadata(),
  lastPulledAt: 1_000,
  initialSyncCompleted: true,
  status: "succeeded",
  ...overrides,
});

test("initial pull is full, while later pulls use updatedAt > lastPulledAt", () => {
  assert.deepEqual(createIncrementalPullRequest(createEmptySyncEntityMetadata()), {
    updatedAfter: null,
    after: null,
    pageSize: 500,
  });
  assert.deepEqual(createIncrementalPullRequest(completedMetadata()), {
    updatedAfter: 1_000,
    after: null,
    pageSize: 500,
  });
});

test("incremental pull paginates at 500 and advances cursor only after page apply", async () => {
  const requests: IncrementalPullRequest[] = [];
  const events: string[] = [];
  let call = 0;
  const result = await runIncrementalPull<number>({
    metadata: createEmptySyncEntityMetadata(),
    pullPage: async (request) => {
      requests.push(request);
      call += 1;
      if (call === 1) {
        return {
          records: Array.from({ length: SYNC_PAGE_SIZE }, (_, index) => index),
          nextCursor: { updatedAt: 500, entityId: "record-0500" },
          hasMore: true,
        };
      }
      return {
        records: [500],
        nextCursor: { updatedAt: 501, entityId: "record-0501" },
        hasMore: false,
      };
    },
    applyPage: async (records) => {
      events.push(`apply:${records.length}`);
    },
    saveProgress: async (metadata) => {
      events.push(`cursor:${metadata.lastPulledId ?? "complete"}`);
    },
  });

  assert.equal(requests[0].pageSize, 500);
  assert.deepEqual(requests[1].after, {
    updatedAt: 500,
    entityId: "record-0500",
  });
  assert.deepEqual(events, [
    "apply:500",
    "cursor:record-0500",
    "apply:1",
    "cursor:complete",
  ]);
  assert.equal(result.pulled, 501);
  assert.equal(result.pages, 2);
});

test("a failed page is replayed without cursor-only advancement", async () => {
  const savedMetadata: SyncEntityMetadata[] = [];
  let pullCount = 0;
  await assert.rejects(
    runIncrementalPull<number>({
      metadata: createEmptySyncEntityMetadata(),
      pullPage: async () => {
        pullCount += 1;
        return pullCount === 1
          ? {
              records: [1],
              nextCursor: { updatedAt: 100, entityId: "record-1" },
              hasMore: true,
            }
          : {
              records: [2],
              nextCursor: { updatedAt: 100, entityId: "record-2" },
              hasMore: false,
            };
      },
      applyPage: async (records) => {
        if (records[0] === 2) {
          throw new Error("local apply failed");
        }
      },
      saveProgress: async (metadata) => {
        savedMetadata.push(metadata);
      },
    }),
    /local apply failed/,
  );

  assert.equal(savedMetadata[0]?.lastPulledAt, 100);
  assert.equal(savedMetadata[0]?.lastPulledId, "record-1");
  assert.deepEqual(createIncrementalPullRequest(savedMetadata[0]), {
    updatedAfter: null,
    after: { updatedAt: 100, entityId: "record-1" },
    pageSize: 500,
  });
});

test("no remote changes causes no local apply or cursor write", async () => {
  let applies = 0;
  let cursorWrites = 0;
  const result = await runIncrementalPull({
    metadata: completedMetadata(),
    pullPage: async (request) => {
      assert.equal(request.updatedAfter, 1_000);
      return { records: [], nextCursor: null, hasMore: false };
    },
    applyPage: async () => {
      applies += 1;
    },
    saveProgress: async () => {
      cursorWrites += 1;
    },
  });

  assert.equal(result.pulled, 0);
  assert.equal(applies, 0);
  assert.equal(cursorWrites, 0);
});

test("initial sync becomes available only after success and remains retryable on failure", () => {
  const syncing: SyncEntityMetadata = {
    ...createEmptySyncEntityMetadata(),
    status: "syncing",
  };
  const failed = failSyncEntityMetadata(syncing, new Error("network"));
  assert.equal(failed.initialSyncCompleted, false);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "network");

  const completed = completeSyncEntityMetadata(failed);
  assert.equal(completed.initialSyncCompleted, true);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.lastPulledAt, 0);
  assert.equal(completed.error, null);
});
