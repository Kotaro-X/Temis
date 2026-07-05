import test from "node:test";
import assert from "node:assert/strict";

import type { SyncEntityEnvelope, SyncQueueItem } from "../src/types/sync.ts";
import type { TagRecord } from "../src/types/index.ts";
import {
  pruneExpiredDeletedEnvelopes,
  pruneExpiredDeletedTagRecords,
  pruneExpiredDeletedTodos,
  pruneSyncQueueItems,
} from "../src/services/sync/syncRetention.ts";

const NOW = 1_000_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
    createdAt: NOW - 100,
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
  updatedAt: NOW - 100,
  deletedAt: null,
  deviceId: "device-a",
  ...overrides,
});

test("pruneExpiredDeletedEnvelopes keeps active records and only removes expired tombstones", () => {
  const result = pruneExpiredDeletedEnvelopes(
    [
      createTodoEnvelope({ entityId: "active", deletedAt: null }),
      createTodoEnvelope({
        entityId: "recent-delete",
        deletedAt: NOW - RETENTION_MS + 1000,
      }),
      createTodoEnvelope({
        entityId: "expired-delete",
        deletedAt: NOW - RETENTION_MS - 1000,
      }),
    ],
    NOW,
  );

  assert.deepEqual(
    result.keptRecords.map((record) => record.entityId),
    ["active", "recent-delete"],
  );
  assert.deepEqual(result.expiredEntityIds, ["expired-delete"]);
});

test("pruneExpiredDeletedTodos removes only expired deleted todos", () => {
  const result = pruneExpiredDeletedTodos(
    [
      {
        id: "active",
        text: "active",
        memo: "",
        tags: [],
        isDone: false,
        createdAt: NOW - 100,
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
      {
        id: "recent",
        text: "recent",
        memo: "",
        tags: [],
        isDone: false,
        createdAt: NOW - 100,
        doneAt: NOW - RETENTION_MS + 1000,
        reminderDate: null,
        reminderTime: null,
        repeat: "none",
        notificationId: null,
        notificationIds: [],
        seriesId: null,
        seriesAnchorDate: null,
        occurrenceDate: null,
        isDeleted: true,
      },
      {
        id: "expired",
        text: "expired",
        memo: "",
        tags: [],
        isDone: false,
        createdAt: NOW - RETENTION_MS - 1000,
        doneAt: NOW - RETENTION_MS - 1000,
        reminderDate: null,
        reminderTime: null,
        repeat: "none",
        notificationId: null,
        notificationIds: [],
        seriesId: null,
        seriesAnchorDate: null,
        occurrenceDate: null,
        isDeleted: true,
      },
    ],
    NOW,
  );

  assert.deepEqual(result.keptTodos.map((todo) => todo.id), ["active", "recent"]);
  assert.deepEqual(result.removedTodoIds, ["expired"]);
});

test("pruneExpiredDeletedTagRecords removes only tags past the retention window", () => {
  const records: TagRecord[] = [
    {
      id: "active",
      name: "active",
      order: 0,
      createdAt: NOW - 100,
      updatedAt: NOW - 100,
      archivedAt: null,
      deletedAt: null,
      deviceId: null,
    },
    {
      id: "expired",
      name: "expired",
      order: 1,
      createdAt: NOW - 100,
      updatedAt: NOW - 100,
      archivedAt: null,
      deletedAt: NOW - RETENTION_MS - 1000,
      deviceId: null,
    },
  ];

  const result = pruneExpiredDeletedTagRecords(records, NOW);

  assert.deepEqual(result.keptRecords.map((record) => record.id), ["active"]);
  assert.deepEqual(result.expiredEntityIds, ["expired"]);
});

test("pruneSyncQueueItems drops matching entity ids and preserves unrelated queue items", () => {
  const queue: SyncQueueItem[] = [
    {
      id: "1",
      entityType: "todo",
      entityId: "todo-1",
      operation: "upsert",
      payload: {},
      createdAt: NOW,
      updatedAt: NOW,
      attemptCount: 0,
      lastError: null,
      nextRetryAt: 0,
    },
    {
      id: "2",
      entityType: "task",
      entityId: "task-1",
      operation: "upsert",
      payload: {},
      createdAt: NOW,
      updatedAt: NOW,
      attemptCount: 0,
      lastError: null,
      nextRetryAt: 0,
    },
  ];

  const nextQueue = pruneSyncQueueItems(queue, "todo", new Set(["todo-1"]));

  assert.deepEqual(nextQueue.map((item) => item.id), ["2"]);
});
