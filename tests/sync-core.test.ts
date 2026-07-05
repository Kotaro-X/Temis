import test from "node:test";
import assert from "node:assert/strict";

import type { SyncEntityEnvelope } from "../src/types/sync.ts";
import {
  compareSyncEnvelopes,
  findReconciliationPushes,
  mergeSyncEnvelopes,
  upsertSyncEnvelope,
} from "../src/services/sync/syncCore.ts";

const createTodoEnvelope = (
  overrides: Partial<SyncEntityEnvelope<"todo">> = {},
): SyncEntityEnvelope<"todo"> => ({
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
  deletedAt: null,
  deviceId: "device-a",
  ...overrides,
});

test("sync envelope ordering prefers updatedAt, then deletedAt, then deviceId", () => {
  assert.equal(
    compareSyncEnvelopes(
      createTodoEnvelope({ updatedAt: 200 }),
      createTodoEnvelope({ updatedAt: 100 }),
    ) > 0,
    true,
  );
  assert.equal(
    compareSyncEnvelopes(
      createTodoEnvelope({ updatedAt: 100, deletedAt: 50 }),
      createTodoEnvelope({ updatedAt: 100, deletedAt: null }),
    ) > 0,
    true,
  );
  assert.equal(
    compareSyncEnvelopes(
      createTodoEnvelope({ updatedAt: 100, deletedAt: null, deviceId: "device-b" }),
      createTodoEnvelope({ updatedAt: 100, deletedAt: null, deviceId: "device-a" }),
    ) > 0,
    true,
  );
});

test("mergeSyncEnvelopes keeps the newest version per entity and sorts by id", () => {
  const merged = mergeSyncEnvelopes(
    [
      createTodoEnvelope({ entityId: "todo-2", updatedAt: 100 }),
      createTodoEnvelope({ entityId: "todo-1", updatedAt: 300 }),
    ],
    [
      createTodoEnvelope({ entityId: "todo-2", updatedAt: 200 }),
      createTodoEnvelope({ entityId: "todo-3", updatedAt: 150 }),
    ],
  );

  assert.deepEqual(
    merged.map((entry) => [entry.entityId, entry.updatedAt]),
    [
      ["todo-1", 300],
      ["todo-2", 200],
      ["todo-3", 150],
    ],
  );
});

test("upsertSyncEnvelope ignores stale writes and replaces newer ones", () => {
  const current = [
    createTodoEnvelope({ entityId: "todo-2", updatedAt: 200 }),
    createTodoEnvelope({ entityId: "todo-3", updatedAt: 300 }),
  ];

  const ignored = upsertSyncEnvelope(
    current,
    createTodoEnvelope({ entityId: "todo-2", updatedAt: 150 }),
  );
  assert.equal(ignored, current);

  const next = upsertSyncEnvelope(
    current,
    createTodoEnvelope({ entityId: "todo-1", updatedAt: 400 }),
  );
  assert.deepEqual(
    next.map((entry) => [entry.entityId, entry.updatedAt]),
    [
      ["todo-1", 400],
      ["todo-2", 200],
      ["todo-3", 300],
    ],
  );
});

test("findReconciliationPushes selects local records that are missing or newer remotely", () => {
  const local = [
    createTodoEnvelope({ entityId: "todo-1", updatedAt: 300 }),
    createTodoEnvelope({ entityId: "todo-2", updatedAt: 100 }),
    createTodoEnvelope({ entityId: "todo-3", updatedAt: 200 }),
  ];
  const remote = [
    createTodoEnvelope({ entityId: "todo-1", updatedAt: 200 }),
    createTodoEnvelope({ entityId: "todo-2", updatedAt: 400 }),
  ];

  const pushes = findReconciliationPushes(local, remote);

  assert.deepEqual(
    pushes.map((entry) => entry.entityId),
    ["todo-1", "todo-3"],
  );
});
