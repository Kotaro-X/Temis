import test from "node:test";
import assert from "node:assert/strict";
import { runSyncEntityJobs } from "../src/services/sync/syncEntityJobs.ts";
import { withLocalEntityMutation, withSyncStoreMutation } from "../src/services/sync/localMutationLock.ts";
import { reconcileProcessedQueue } from "../src/services/sync/reconcileProcessedQueue.ts";
import type { SyncQueueItem } from "../src/types/sync.ts";

test("each entity refreshes before the next begins, including partial failures", async () => {
  const order: string[] = [];
  const result = await runSyncEntityJobs([
    ["tag", async () => { order.push("tag"); return { pushed: 1, pulled: 2 }; }],
    ["todo", async () => { order.push("todo"); throw new Error("offline"); }],
    ["task", async () => { order.push("task"); return { pushed: 0, pulled: 3 }; }],
    ["memo", async () => { order.push("memo"); return { pushed: 0, pulled: 4 }; }],
  ], async (entity) => { order.push(`refresh:${entity}`); });
  assert.deepEqual(order, ["tag", "refresh:tag", "todo", "refresh:todo", "task", "refresh:task", "memo", "refresh:memo"]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.summaries.length, 3);
});

test("refresh failure does not skip later entities or trigger retries", async () => {
  let runs = 0;
  const result = await runSyncEntityJobs([
    ["tag", async () => { runs++; return { pushed: 0, pulled: 0 }; }],
    ["todo", async () => { runs++; return { pushed: 0, pulled: 0 }; }],
  ], () => { throw new Error("read failed"); });
  assert.equal(runs, 2);
  assert.equal(result.errors.length, 2);
});

test("local edits and remote apply cannot interleave, and failure releases the lock", async () => {
  const order: string[] = [];
  let release!: () => void;
  const first = withLocalEntityMutation("todo", async () => {
    order.push("edit");
    await new Promise<void>((resolve) => { release = resolve; });
    order.push("saved");
  });
  const second = withLocalEntityMutation("todo", async () => { order.push("merge-latest"); });
  await Promise.resolve();
  assert.deepEqual(order, ["edit"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["edit", "saved", "merge-latest"]);
  await assert.rejects(withSyncStoreMutation(async () => { throw new Error("disk"); }));
  assert.equal(await withSyncStoreMutation(async () => 42), 42);
});

const queueItem = (id: string, text: string): SyncQueueItem => ({
  id, entityType: "todo", entityId: id, operation: "upsert", payload: { text },
  createdAt: 1, updatedAt: 1, attemptCount: 0, lastError: null, nextRetryAt: 0,
});

test("upload acknowledgement preserves concurrent edits, even at the same timestamp", () => {
  const old = queueItem("one", "before");
  const edited = queueItem("one", "after");
  const added = queueItem("two", "new");
  assert.deepEqual(reconcileProcessedQueue([old], [], [edited, added]), [edited, added]);
  assert.deepEqual(reconcileProcessedQueue([old], [], [old, added]), [added]);
});

test("retry metadata applies only to the exact queued revision that failed", () => {
  const old = queueItem("one", "before");
  const retry = { ...old, attemptCount: 1, nextRetryAt: 1000 };
  const edited = queueItem("one", "after");
  assert.deepEqual(reconcileProcessedQueue([old], [retry], [old]), [retry]);
  assert.deepEqual(reconcileProcessedQueue([old], [retry], [edited]), [edited]);
});
