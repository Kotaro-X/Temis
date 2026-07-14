import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  SYNC_ERROR_TYPES,
  classifySyncError,
  createAnonymousUserId,
  createSanitizedSyncError,
  createSyncDiagnosticReporter,
  createUserFacingSyncError,
  sanitizeSyncDiagnosticEvent,
  shouldSendSyncDiagnosticsToCrashlytics,
  toCrashlyticsAttributes,
  type SyncDiagnosticEvent,
  type SyncErrorType,
  type SyncPhase,
} from "../src/services/sync/syncDiagnostics.ts";
import { createSyncDiagnosticObserver } from "../src/services/sync/syncDiagnosticObserver.ts";

const anonymousUserId = "a".repeat(64);

const baseEvent = (overrides: Record<string, unknown> = {}) => ({
  anonymousUserId,
  syncId: "sync_test_123",
  entity: "memo",
  phase: "sync_start",
  successCount: 0,
  failedCount: 0,
  retryCount: 0,
  durationMs: 12,
  appVersion: "1.2.2",
  osVersion: "ios-26.0",
  schemaVersion: 3,
  migrationVersion: "007_create_notes_tables",
  ...overrides,
});

test("anonymous user ids are stable SHA-256 values and never expose the source id", async () => {
  const digest = async (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const internalId = "firebase-uid-sensitive";

  const first = await createAnonymousUserId(internalId, "stable-salt", digest);
  const second = await createAnonymousUserId(internalId, "stable-salt", digest);
  const other = await createAnonymousUserId("another-user", "stable-salt", digest);

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.equal(first.length, 64);
  assert.equal(first.includes(internalId), false);
});

test("diagnostic sanitization is allowlist-only and removes every prohibited content field", () => {
  const prohibited = {
    memoBody: "secret memo body",
    memoTitle: "secret title",
    userName: "Sensitive Name",
    email: "person@example.com",
    location: "35.0,139.0",
    attachment: "private attachment bytes",
    aiInput: "private AI prompt",
    searchQuery: "private search query",
    userId: "firebase-uid-sensitive",
    stack: "Error: private stack detail",
  };
  const event = sanitizeSyncDiagnosticEvent({
    ...baseEvent(),
    ...prohibited,
    appVersion: "person@example.com",
    osVersion: "private search query",
    migrationVersion: "secret memo body",
  });

  assert.ok(event);
  const serialized = JSON.stringify(event);
  for (const value of Object.values(prohibited)) {
    assert.equal(serialized.includes(value), false);
  }
  assert.equal(event.appVersion, "unknown");
  assert.equal(event.osVersion, "unknown");
  assert.equal(event.migrationVersion, "unknown");
  assert.deepEqual(Object.keys(event).sort(), [
    "anonymousUserId",
    "appVersion",
    "durationMs",
    "entity",
    "failedCount",
    "migrationVersion",
    "osVersion",
    "phase",
    "retryCount",
    "schemaVersion",
    "successCount",
    "syncId",
  ]);
});

test("Crashlytics custom keys contain only the approved anonymous diagnostic fields", () => {
  const event = sanitizeSyncDiagnosticEvent(
    baseEvent({
      phase: "write_local_db",
      errorType: "LocalDB",
      errorCode: "SYNC-LDB-001",
      sanitizedReason: "sqlite_write_failed",
    }),
  );
  assert.ok(event);
  const attributes = toCrashlyticsAttributes(event);

  assert.deepEqual(Object.keys(attributes).sort(), [
    "anonymousUserId",
    "appVersion",
    "durationMs",
    "entity",
    "errorCode",
    "errorType",
    "failedCount",
    "migrationVersion",
    "osVersion",
    "phase",
    "retryCount",
    "schemaVersion",
    "successCount",
    "syncId",
  ]);
  const serialized = JSON.stringify(attributes);
  for (const prohibited of [
    "firebase-uid",
    "secret memo body",
    "secret title",
    "person@example.com",
    "private search query",
    "private AI prompt",
    "private stack detail",
  ]) {
    assert.equal(serialized.includes(prohibited), false);
  }
});

test("sanitized reasons retain safe diagnostic granularity without raw exceptions", () => {
  const firestore = classifySyncError(
    new Error("memo body person@example.com private stack"),
    "fetch_remote_changes",
  );
  const schema = classifySyncError(
    new Error("refusing to write legacy secret title"),
    "validate_remote_records",
  );
  const sqlite = classifySyncError(
    new Error("SQLite row contains private AI prompt"),
    "write_local_db",
  );

  assert.equal(firestore.sanitizedReason, "firestore_read_failed");
  assert.equal(schema.sanitizedReason, "schema_version_mismatch");
  assert.equal(sqlite.sanitizedReason, "sqlite_write_failed");

  const safeError = createSanitizedSyncError(sqlite);
  assert.equal(safeError.name, "SanitizedSyncError");
  assert.equal(safeError.message, "SYNC-LDB-001: sqlite_write_failed");
  const safeErrorOutput = `${safeError.message}\n${safeError.stack ?? ""}`;
  for (const prohibited of [
    "SQLite row contains",
    "private AI prompt",
    "person@example.com",
    "secret title",
    "memo body",
  ]) {
    assert.equal(safeErrorOutput.includes(prohibited), false);
  }
});

test("Crashlytics collection stays disabled for debug and enabled for release candidates", () => {
  const firebaseConfig = JSON.parse(
    readFileSync(
      decodeURIComponent(new URL("../firebase.json", import.meta.url).pathname),
      "utf8",
    ),
  ) as {
    "react-native": {
      crashlytics_auto_collection_enabled: boolean;
      crashlytics_debug_enabled: boolean;
    };
  };

  assert.equal(
    firebaseConfig["react-native"].crashlytics_debug_enabled,
    false,
  );
  assert.equal(
    firebaseConfig["react-native"].crashlytics_auto_collection_enabled,
    true,
  );
  assert.equal(shouldSendSyncDiagnosticsToCrashlytics(true), false);
  assert.equal(shouldSendSyncDiagnosticsToCrashlytics(false), true);
});

test("all required error types map to stable codes without returning raw messages", () => {
  const cases: Array<{
    expected: SyncErrorType;
    error: unknown;
    phase: SyncPhase;
  }> = [
    { expected: "Network", error: { code: "unavailable" }, phase: "fetch_remote_changes" },
    { expected: "Auth", error: { code: "unauthenticated" }, phase: "fetch_remote_changes" },
    { expected: "Permission", error: { code: "permission-denied" }, phase: "upload_local_changes" },
    { expected: "Validation", error: new Error("raw record data"), phase: "validate_remote_records" },
    { expected: "LocalDB", error: new Error("secret sqlite detail"), phase: "write_local_db" },
    { expected: "RemoteDB", error: new Error("secret firestore detail"), phase: "fetch_remote_changes" },
    { expected: "Conflict", error: new Error("secret conflict detail"), phase: "resolve_conflicts" },
    { expected: "RateLimit", error: { code: "resource-exhausted" }, phase: "upload_local_changes" },
    { expected: "Unknown", error: new Error("secret unknown detail"), phase: "sync_failed" },
  ];

  assert.deepEqual(
    cases.map(({ error, phase }) => classifySyncError(error, phase).errorType),
    SYNC_ERROR_TYPES,
  );
  for (const { error, phase } of cases) {
    const serialized = JSON.stringify(classifySyncError(error, phase));
    assert.equal(serialized.includes("secret"), false);
    assert.equal(serialized.includes("raw record data"), false);
  }
});

test("user-facing sync errors show only a safe message and the matching error code", () => {
  const classified = classifySyncError(
    new Error("memo title and stack trace must stay private"),
    "write_local_db",
  );
  const message = createUserFacingSyncError(classified);

  assert.match(message, /同期に失敗しました/);
  assert.match(message, /エラーコード: SYNC-LDB-001/);
  assert.equal(message.includes("memo title"), false);
  assert.equal(message.includes("stack trace"), false);
});

test("successful observation records sync_start through sync_complete with counts and versions", async () => {
  const events: SyncDiagnosticEvent[] = [];
  let clock = 1_000;
  const reporter = createSyncDiagnosticReporter({
    sink: (event) => {
      events.push(event);
    },
  });
  const observer = createSyncDiagnosticObserver({
    context: {
      anonymousUserId,
      syncId: "sync_success_123",
      appVersion: "1.2.2",
      osVersion: "ios-26.0",
      schemaVersion: 3,
      migrationVersion: "007_create_notes_tables",
    },
    entity: "memo",
    reporter,
    now: () => clock,
  });

  await observer.start();
  clock += 5;
  await observer.phase("load_local_changes");
  clock += 5;
  await observer.phase("fetch_remote_changes");
  clock += 5;
  await observer.phase("validate_remote_records");
  await observer.phase("resolve_conflicts");
  await observer.phase("write_local_db");
  await observer.phase("upload_local_changes", { retryCount: 1 });
  await observer.phase("mark_synced");
  clock += 10;
  await observer.complete({ successCount: 7, failedCount: 0 });

  assert.equal(events[0].phase, "sync_start");
  assert.equal(events.at(-1)?.phase, "sync_complete");
  assert.equal(events.at(-1)?.entity, "memo");
  assert.equal(events.at(-1)?.successCount, 7);
  assert.equal(events.at(-1)?.durationMs, 25);
  assert.equal(events.at(-1)?.appVersion, "1.2.2");
  assert.equal(events.at(-1)?.osVersion, "ios-26.0");
});

test("failed observation records the actual phase and sync_failed while telemetry failure stays non-fatal", async () => {
  const events: SyncDiagnosticEvent[] = [];
  const reporter = createSyncDiagnosticReporter({
    sink: async (event) => {
      events.push(event);
      throw new Error("Crashlytics unavailable");
    },
  });
  const observer = createSyncDiagnosticObserver({
    context: {
      anonymousUserId,
      syncId: "sync_failure_123",
      appVersion: "1.2.2",
      osVersion: "android-36",
      schemaVersion: 3,
      migrationVersion: "007_create_notes_tables",
    },
    entity: "todo",
    reporter,
    now: () => 2_000,
  });

  await observer.start();
  await observer.phase("write_local_db", { retryCount: 2 });
  const failure = await observer.fail(new Error("private SQLite exception"));

  assert.equal(failure.classification.errorType, "LocalDB");
  assert.equal(failure.classification.errorCode, "SYNC-LDB-001");
  assert.deepEqual(
    events.slice(-2).map((event) => event.phase),
    ["write_local_db", "sync_failed"],
  );
  assert.equal(events.at(-1)?.retryCount, 2);
  assert.equal(JSON.stringify(events).includes("private SQLite exception"), false);
});
