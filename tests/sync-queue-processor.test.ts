import test from "node:test";
import assert from "node:assert/strict";

import type { SyncEntityEnvelope, SyncQueueItem } from "../src/types/sync.ts";
import { processSyncQueue } from "../src/services/sync/syncQueueProcessor.ts";

const createTodoEnvelope = (
  overrides: Partial<SyncEntityEnvelope<"todo">> = {},
): SyncEntityEnvelope<"todo"> => ({
  schemaVersion: 3,
  entityType: "todo",
  entityId: "todo-1",
  record: {
    id: "todo-1",
    text: "todo",
    memo: "",
    tags: [],
    isDone: false,
    createdAt: 100,
    doneAt: null,
    reminderDate: null,
    reminderTime: null,
    repeat: "none",
    notificationId: null,
    notificationIds: [],
    seriesId: null,
    seriesAnchorDate: null,
    occurrenceDate: null,
    isDeleted: false,
  },
  updatedAt: 100,
  isDeleted: false,
  deletedAt: null,
  deviceId: "device-a",
  ...overrides,
});

const createQueueItem = (
  overrides: Partial<SyncQueueItem<{ envelope: SyncEntityEnvelope<"todo"> }>> = {},
): SyncQueueItem<{ envelope: SyncEntityEnvelope<"todo"> }> => ({
  id: "queue-1",
  entityType: "todo",
  entityId: "todo-1",
  operation: "upsert",
  payload: { envelope: createTodoEnvelope() },
  createdAt: 100,
  updatedAt: 100,
  attemptCount: 0,
  lastError: null,
  nextRetryAt: 0,
  ...overrides,
});

test("processSyncQueue pushes ready items and preserves unrelated entries", async () => {
  const pushedIds: string[] = [];
  const result = await processSyncQueue(
    "todo",
    [
      createQueueItem({
        id: "queue-ready",
        entityId: "todo-ready",
        payload: { envelope: createTodoEnvelope({ entityId: "todo-ready" }) },
      }),
      createQueueItem({
        id: "queue-waiting",
        entityId: "todo-waiting",
        nextRetryAt: 5_000,
        payload: { envelope: createTodoEnvelope({ entityId: "todo-waiting" }) },
      }),
      createQueueItem({
        id: "queue-task",
        entityType: "task",
        entityId: "task-1",
        payload: { envelope: createTodoEnvelope({ entityId: "task-1" }) },
      }) as SyncQueueItem,
      createQueueItem({
        id: "queue-invalid",
        entityId: "todo-invalid",
        payload: {} as { envelope: SyncEntityEnvelope<"todo"> },
      }),
    ],
    1_000,
    async (envelope) => {
      pushedIds.push(envelope.entityId);
    },
  );

  assert.deepEqual(pushedIds, ["todo-ready"]);
  assert.equal(result.pushedCount, 1);
  assert.equal(result.firstError, null);
  assert.deepEqual(
    result.queue.map((item) => item.id),
    ["queue-waiting", "queue-task"],
  );
});

test("processSyncQueue retries failed items with exponential backoff and keeps later pushes running", async () => {
  const result = await processSyncQueue(
    "todo",
    [
      createQueueItem({
        id: "queue-fail",
        entityId: "todo-fail",
        attemptCount: 2,
        payload: { envelope: createTodoEnvelope({ entityId: "todo-fail" }) },
      }),
      createQueueItem({
        id: "queue-success",
        entityId: "todo-success",
        payload: { envelope: createTodoEnvelope({ entityId: "todo-success" }) },
      }),
    ],
    10_000,
    async (envelope) => {
      if (envelope.entityId === "todo-fail") {
        throw new Error("push failed");
      }
    },
  );

  assert.equal(result.pushedCount, 1);
  assert.equal(result.firstError?.message, "Firestore write failed");
  assert.deepEqual(
    result.queue,
    [
      createQueueItem({
        id: "queue-fail",
        entityId: "todo-fail",
        attemptCount: 3,
        lastError: "SYNC-RDB-002",
        updatedAt: 10_000,
        nextRetryAt: 18_000,
        payload: { envelope: createTodoEnvelope({ entityId: "todo-fail" }) },
      }),
    ],
  );
});

test("processSyncQueue migrates supported legacy envelopes and drops corrupt ones", async () => {
  const pushedVersions: number[] = [];
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => warnings.push(String(message));

  try {
    const result = await processSyncQueue(
      "todo",
      [
        createQueueItem({
          id: "queue-legacy",
          payload: {
            envelope: { ...createTodoEnvelope(), schemaVersion: 2 },
          },
        }),
        createQueueItem({
          id: "queue-corrupt",
          payload: {
            envelope: {
              ...createTodoEnvelope(),
              record: {
                ...createTodoEnvelope().record,
                repeat: "invalid",
              },
            } as unknown as SyncEntityEnvelope<"todo">,
          },
        }),
      ],
      1_000,
      async (envelope) => {
        pushedVersions.push(envelope.schemaVersion);
      },
    );

    assert.deepEqual(pushedVersions, [3]);
    assert.equal(result.firstError, null);
    assert.deepEqual(result.queue, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /reason=corrupt/);
  } finally {
    console.warn = originalWarn;
  }
});
