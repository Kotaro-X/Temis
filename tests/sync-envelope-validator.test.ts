import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION,
  assertValidSyncEnvelopeForWrite,
  validateSyncEnvelope,
} from "../src/services/sync/syncEnvelopeValidator.ts";
import {
  inspectPulledSyncEnvelopes,
  rewriteMigratedSyncEnvelopes,
} from "../src/services/sync/syncEnvelopePullProcessor.ts";
import { mergeSyncEnvelopes } from "../src/services/sync/syncCore.ts";
import type { SyncEntityEnvelope } from "../src/types/sync.ts";

const createTodoEnvelope = (): SyncEntityEnvelope<"todo"> => ({
  schemaVersion: CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION,
  entityType: "todo",
  entityId: "todo-remote",
  record: {
    id: "todo-remote",
    text: "remote todo",
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
  deviceId: "device-remote",
});

test("sync envelope validator accepts the current schema", () => {
  const result = validateSyncEnvelope("todo", createTodoEnvelope());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.migrated, false);
    assert.equal(result.envelope.schemaVersion, 3);
  }
});

test("write validation refuses legacy and corrupt envelopes before persistence", () => {
  const legacyEnvelope = {
    ...createTodoEnvelope(),
    schemaVersion: 2,
  } as SyncEntityEnvelope<"todo">;
  const corruptEnvelope = {
    ...createTodoEnvelope(),
    record: { ...createTodoEnvelope().record, repeat: "invalid" },
  } as unknown as SyncEntityEnvelope<"todo">;

  assert.throws(
    () => assertValidSyncEnvelopeForWrite(legacyEnvelope),
    /refusing to write legacy/,
  );
  assert.throws(
    () => assertValidSyncEnvelopeForWrite(corruptEnvelope),
    /refusing to write invalid/,
  );
});

test("sync envelope validator migrates supported legacy formats to v3", () => {
  const legacyEnvelope = createTodoEnvelope() as Record<string, unknown>;
  delete legacyEnvelope.schemaVersion;

  const v0Result = validateSyncEnvelope("todo", legacyEnvelope);
  const v2Result = validateSyncEnvelope("todo", {
    ...createTodoEnvelope(),
    schemaVersion: 2,
  });

  assert.equal(v0Result.ok, true);
  assert.equal(v2Result.ok, true);
  if (v0Result.ok && v2Result.ok) {
    assert.equal(v0Result.migrated, true);
    assert.equal(v2Result.migrated, true);
    assert.equal(
      v0Result.envelope.schemaVersion,
      CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION,
    );
    assert.equal(v2Result.envelope.schemaVersion, 3);
  }
});

test("future and corrupt remote documents are logged, skipped, and cannot alter local records", async () => {
  const localEnvelope = {
    ...createTodoEnvelope(),
    entityId: "todo-local",
    record: { ...createTodoEnvelope().record, id: "todo-local", text: "local todo" },
  };
  const legacyEnvelope = createTodoEnvelope() as Record<string, unknown>;
  delete legacyEnvelope.schemaVersion;
  const futureEnvelope = { ...createTodoEnvelope(), schemaVersion: 4 };
  const corruptEnvelope = { ...createTodoEnvelope(), updatedAt: "not-a-timestamp" };
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => warnings.push(String(message));

  try {
    const inspected = inspectPulledSyncEnvelopes("todo", [
      { id: "normal", data: createTodoEnvelope() },
      { id: "legacy", data: legacyEnvelope },
      { id: "future", data: futureEnvelope },
      { id: "corrupt", data: corruptEnvelope },
    ]);
    const rewritten: Array<{ documentId: string; schemaVersion: number }> = [];
    await rewriteMigratedSyncEnvelopes("todo", inspected.migrations, async (
      documentId,
      envelope,
    ) => {
      rewritten.push({ documentId, schemaVersion: envelope.schemaVersion });
    });
    const acceptedRemoteRecords = inspected.envelopes;
    const merged = mergeSyncEnvelopes([localEnvelope], acceptedRemoteRecords);

    assert.deepEqual(
      merged.map((envelope) => envelope.entityId),
      ["todo-local", "todo-remote"],
    );
    assert.equal(acceptedRemoteRecords.length, 2);
    assert.deepEqual(rewritten, [{ documentId: "legacy", schemaVersion: 3 }]);
    assert.equal(
      acceptedRemoteRecords.find((envelope) => envelope.entityId === "todo-remote")
        ?.schemaVersion,
      CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION,
    );
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /reason=future_version/);
    assert.match(warnings[1], /reason=corrupt/);
  } finally {
    console.warn = originalWarn;
  }
});
