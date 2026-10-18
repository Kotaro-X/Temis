import { z } from "zod";

import type { SyncEntityEnvelope, SyncEntityType } from "../../types";

/** The only format written by this app. */
export const CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION = 3;
/**
 * v0 (schemaVersion absent) through v2 are accepted and migrated to v3 until
 * this date. After that date they are isolated as unsupported legacy data.
 * The migration code and this deadline should be removed together.
 */
export const OLDEST_SUPPORTED_SYNC_ENVELOPE_SCHEMA_VERSION = 0;
export const LEGACY_SYNC_ENVELOPE_SUPPORT_END = "2027-07-11";

type SyncableEntityType = SyncEntityType;

const finiteNumber = z.number().finite();
const nullableFiniteNumber = finiteNumber.nullable();
const nullableString = z.string().nullable();
const tags = z.array(z.string());

const todoRecordSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  memo: z.string(),
  tags,
  isDone: z.boolean(),
  createdAt: finiteNumber,
  doneAt: nullableFiniteNumber,
  reminderDate: nullableString,
  reminderTime: nullableString,
  repeat: z.enum(["none", "daily", "weekly", "monthly", "yearly"]),
  notificationId: nullableString,
  notificationIds: z.array(z.string()),
  seriesId: nullableString,
  seriesAnchorDate: nullableString,
  occurrenceDate: nullableString,
  isDeleted: z.boolean(),
});

const reminderSchema = z.object({ enabled: z.boolean(), mode: z.enum(['start', 'custom']), offsetMinutes: finiteNumber.min(0).max(60), at: nullableFiniteNumber });
const occurrenceSchema = z.object({ date: z.string(), slot: z.enum(['morning','forenoon','afternoon','night']), plannedStartAt: nullableFiniteNumber, plannedEndAt: nullableFiniteNumber, estimateMinutes: finiteNumber.min(0), executionStatus: z.enum(['TODO','IN_PROGRESS','PAUSED','DONE']).optional(), elapsedMinutes: finiteNumber.min(0).optional(), startAt: nullableFiniteNumber.optional(), title: z.string().optional(), memo: z.string().optional(), tags: tags.optional(), completed: z.boolean().optional(), deleted: z.boolean().optional() });
const taskStateSchema = z.object({
  plannedStartAt: nullableFiniteNumber.optional(), plannedEndAt: nullableFiniteNumber.optional(),
  repeat: z.enum(['none','daily','weekly','monthly','yearly']).optional(), repeatAnchorDate: nullableString.optional(),
  occurrenceOverrides: z.record(z.string(), occurrenceSchema).optional(), reminder: reminderSchema.optional(), migratedTodoId: z.string().optional(),
  id: z.string().min(1),
  taskName: z.string(),
  tags,
  estimateMinutes: finiteNumber,
  elapsedMinutes: finiteNumber,
  status: z.enum(["TODO", "IN_PROGRESS", "PAUSED", "DONE"]),
  isArchived: z.boolean(),
  startAt: nullableFiniteNumber,
}).refine(task => {
  const start = task.plannedStartAt ?? null, end = task.plannedEndAt ?? null;
  return start == null && end == null || start != null && end != null && end - start >= 300000;
}, { message: 'planned start/end must be paired and at least five minutes apart' });

const taskLogSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  slot: z.enum(["morning", "forenoon", "afternoon", "night"]),
  taskId: z.string().min(1),
  taskName: z.string(),
  tags,
  estimateMinutes: finiteNumber,
  actualMinutes: finiteNumber,
  result: z.enum(["completed", "failed"]),
  endedAt: finiteNumber,
});

const taskRecordSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("state"),
    date: z.string().min(1),
    slotKey: z.enum(["morning", "forenoon", "afternoon", "night"]),
    task: taskStateSchema,
  }),
  z.object({ kind: z.literal("log"), log: taskLogSchema }),
]);

const taskMemoSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  body: z.string(),
  createdAt: finiteNumber,
  updatedAt: finiteNumber,
});

const noteSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["daily", "free"]),
  date: nullableString,
  title: nullableString,
  body: z.string(),
  scope: z.enum(["personal", "project"]),
  projectId: nullableString,
  updatedAt: finiteNumber,
});

const researchNoteSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  tags,
  createdAt: finiteNumber,
  updatedAt: finiteNumber,
  weekId: z.string(),
  weeklyPromptId: z.string(),
});

const memoRecordSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("taskMemo"), data: taskMemoSchema }),
  z.object({ kind: z.literal("note"), data: noteSchema }),
  z.object({ kind: z.literal("research"), data: researchNoteSchema }),
]);

const tagRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  order: finiteNumber,
  createdAt: finiteNumber,
  updatedAt: finiteNumber,
  archivedAt: nullableFiniteNumber,
  deletedAt: nullableFiniteNumber,
  deviceId: nullableString,
});

const recordSchemaByEntity = {
  tag: tagRecordSchema,
  todo: todoRecordSchema,
  task: taskRecordSchema,
  memo: memoRecordSchema,
} as const;

const schemaVersionProbe = z
  .object({ schemaVersion: z.number().int().nonnegative().optional() })
  .passthrough();

const envelopeSchemaFor = <TType extends SyncableEntityType>(entityType: TType) =>
  z
    .object({
      schemaVersion: z.literal(CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION),
      entityType: z.literal(entityType),
      entityId: z.string().min(1),
      record: recordSchemaByEntity[entityType],
      updatedAt: finiteNumber,
      isDeleted: z.boolean(),
      deletedAt: nullableFiniteNumber,
      deviceId: nullableString,
    })
    .passthrough();

export type SyncEnvelopeValidationFailure = {
  ok: false;
  reason: "corrupt" | "unsupported_legacy" | "future_version";
  detail: string;
};

export type SyncEnvelopeValidationSuccess<TType extends SyncableEntityType> = {
  ok: true;
  envelope: SyncEntityEnvelope<TType>;
  migrated: boolean;
};

export type SyncEnvelopeValidationResult<TType extends SyncableEntityType> =
  | SyncEnvelopeValidationSuccess<TType>
  | SyncEnvelopeValidationFailure;

const formatIssues = (issues: readonly { path: PropertyKey[]; message: string }[]) =>
  issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
    .join("; ");

/**
 * Validates a Firestore/local payload before it can participate in merging.
 * v0 is the pre-versioning format (schemaVersion absent or explicitly 0).
 * v0–v2 are migrated in memory to v3. Versions newer than this app are never
 * parsed, and legacy migrations expire on the published support-end date.
 */
export const validateSyncEnvelope = <TType extends SyncableEntityType>(
  expectedEntityType: TType,
  input: unknown,
): SyncEnvelopeValidationResult<TType> => {
  const versionProbe = schemaVersionProbe.safeParse(input);
  if (!versionProbe.success) {
    return {
      ok: false,
      reason: "corrupt",
      detail: formatIssues(versionProbe.error.issues),
    };
  }

  const version =
    versionProbe.data.schemaVersion ?? OLDEST_SUPPORTED_SYNC_ENVELOPE_SCHEMA_VERSION;
  if (version > CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "future_version",
      detail: `schemaVersion ${version} is newer than supported version ${CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION}`,
    };
  }
  const legacySupportExpired =
    Date.now() >= new Date(`${LEGACY_SYNC_ENVELOPE_SUPPORT_END}T00:00:00.000Z`).getTime();
  if (
    version < OLDEST_SUPPORTED_SYNC_ENVELOPE_SCHEMA_VERSION ||
    (version < CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION && legacySupportExpired)
  ) {
    return {
      ok: false,
      reason: "unsupported_legacy",
      detail: `schemaVersion ${version} is outside the supported legacy range (v${OLDEST_SUPPORTED_SYNC_ENVELOPE_SCHEMA_VERSION}–v${CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION - 1}; support ends ${LEGACY_SYNC_ENVELOPE_SUPPORT_END})`,
    };
  }

  const rawInput = input as Record<string, unknown>;
  const isDeletedMissing = typeof rawInput.isDeleted !== "boolean";
  const rawRecord = rawInput.record as Record<string, unknown> | undefined;
  const rawNote = rawRecord?.data as Record<string, unknown> | undefined;
  const isLegacyNoteWithoutScope =
    expectedEntityType === "memo" &&
    rawRecord?.kind === "note" &&
    rawNote != null &&
    (rawNote.scope === undefined || rawNote.projectId === undefined);
  const normalizedRecord = isLegacyNoteWithoutScope
    ? {
        ...rawRecord,
        data: { ...rawNote, scope: "personal", projectId: null },
      }
    : rawInput.record;
  const normalized = {
    ...rawInput,
    schemaVersion: CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION,
    record: normalizedRecord,
    isDeleted:
      typeof rawInput.isDeleted === "boolean"
        ? rawInput.isDeleted
        : typeof rawInput.deletedAt === "number",
  };
  const parsed = envelopeSchemaFor(expectedEntityType).safeParse(normalized);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "corrupt",
      detail: formatIssues(parsed.error.issues),
    };
  }

  return {
    ok: true,
    envelope: parsed.data as SyncEntityEnvelope<TType>,
    migrated:
      version !== CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION || isDeletedMissing || isLegacyNoteWithoutScope,
  };
};

export const assertValidSyncEnvelopeForWrite = <
  TType extends SyncableEntityType,
>(
  envelope: SyncEntityEnvelope<TType>,
): SyncEntityEnvelope<TType> => {
  const result = validateSyncEnvelope(envelope.entityType, envelope);
  if (!result.ok) {
    throw new Error(
      `[sync] refusing to write invalid ${envelope.entityType} envelope (${result.reason}): ${result.detail}`,
    );
  }
  if (result.migrated) {
    throw new Error(
      `[sync] refusing to write legacy ${envelope.entityType} envelope; migrate it before enqueueing`,
    );
  }
  return result.envelope;
};

export const logSkippedSyncEnvelope = (
  entityType: SyncableEntityType,
  _documentId: string,
  failure: SyncEnvelopeValidationFailure,
) => {
  // Do not log the record itself: it can contain memo text and other user data.
  console.warn(
    `[sync] skipped ${entityType} record reason=${failure.reason}`,
  );
};
