import type { SyncEntityType } from "../../types";

export const SYNC_PHASES = [
  "sync_start",
  "load_local_changes",
  "fetch_remote_changes",
  "validate_remote_records",
  "resolve_conflicts",
  "write_local_db",
  "upload_local_changes",
  "mark_synced",
  "sync_complete",
  "sync_failed",
] as const;

export type SyncPhase = (typeof SYNC_PHASES)[number];

export const SYNC_ERROR_TYPES = [
  "Network",
  "Auth",
  "Permission",
  "Validation",
  "LocalDB",
  "RemoteDB",
  "Conflict",
  "RateLimit",
  "Unknown",
] as const;

export type SyncErrorType = (typeof SYNC_ERROR_TYPES)[number];

export const SYNC_ERROR_CODES = [
  "SYNC-NET-001",
  "SYNC-AUTH-001",
  "SYNC-PERM-001",
  "SYNC-VAL-001",
  "SYNC-VAL-002",
  "SYNC-VAL-003",
  "SYNC-LDB-001",
  "SYNC-RDB-001",
  "SYNC-RDB-002",
  "SYNC-CON-001",
  "SYNC-RATE-001",
  "SYNC-UNK-001",
] as const;

export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

const SANITIZED_REASONS = [
  "Network unavailable",
  "Authentication required",
  "Permission denied",
  "Remote schema version unsupported",
  "Remote record format invalid",
  "Remote record validation failed",
  "Local database operation failed",
  "Firestore read failed",
  "Firestore write failed",
  "Conflict resolution failed",
  "Rate limit exceeded",
  "Unexpected sync failure",
] as const;

export type SanitizedSyncReason = (typeof SANITIZED_REASONS)[number];

export type SyncErrorClassification = {
  errorType: SyncErrorType;
  errorCode: SyncErrorCode;
  sanitizedReason: SanitizedSyncReason;
};

export type SyncDiagnosticEvent = {
  anonymousUserId: string;
  syncId: string;
  entity: SyncEntityType;
  phase: SyncPhase;
  successCount: number;
  failedCount: number;
  retryCount: number;
  durationMs: number;
  appVersion: string;
  osVersion: string;
  schemaVersion: number;
  migrationVersion: string;
  errorType?: SyncErrorType;
  errorCode?: SyncErrorCode;
  sanitizedReason?: SanitizedSyncReason;
};

export type SyncDiagnosticEventInput = Partial<SyncDiagnosticEvent> &
  Pick<
    SyncDiagnosticEvent,
    "anonymousUserId" | "syncId" | "entity" | "phase"
  >;

const ERROR_TYPE_SET = new Set<string>(SYNC_ERROR_TYPES);
const ERROR_CODE_SET = new Set<string>(SYNC_ERROR_CODES);
const PHASE_SET = new Set<string>(SYNC_PHASES);
const SANITIZED_REASON_SET = new Set<string>(SANITIZED_REASONS);
const ENTITY_SET = new Set<string>(["tag", "todo", "task", "memo"]);

const normalizeErrorCode = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/^firestore\//, "");
};

const readErrorCode = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return "";
  }
  return normalizeErrorCode((error as { code?: unknown }).code);
};

const readErrorMessageForClassificationOnly = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return typeof error === "string" ? error.toLowerCase() : "";
};

const classification = (
  errorType: SyncErrorType,
  errorCode: SyncErrorCode,
  sanitizedReason: SanitizedSyncReason,
): SyncErrorClassification => ({ errorType, errorCode, sanitizedReason });

export class ClassifiedSyncError extends Error {
  readonly classification: SyncErrorClassification;

  constructor(value: SyncErrorClassification) {
    super(value.sanitizedReason);
    this.name = "ClassifiedSyncError";
    this.classification = value;
  }
}

export const classifyValidationFailure = (
  reason: "corrupt" | "unsupported_legacy" | "future_version",
): SyncErrorClassification => {
  if (reason === "future_version" || reason === "unsupported_legacy") {
    return classification(
      "Validation",
      "SYNC-VAL-001",
      "Remote schema version unsupported",
    );
  }
  return classification(
    "Validation",
    "SYNC-VAL-003",
    "Remote record validation failed",
  );
};

export const classifySyncError = (
  error: unknown,
  phase: SyncPhase,
): SyncErrorClassification => {
  if (error instanceof ClassifiedSyncError) {
    return error.classification;
  }

  const code = readErrorCode(error);
  const message = readErrorMessageForClassificationOnly(error);

  if (
    ["unauthenticated", "auth/user-token-expired", "auth/id-token-expired"].includes(
      code,
    ) ||
    message.includes("sign in with google") ||
    message.includes("authentication required")
  ) {
    return classification("Auth", "SYNC-AUTH-001", "Authentication required");
  }
  if (code === "permission-denied") {
    return classification("Permission", "SYNC-PERM-001", "Permission denied");
  }
  if (
    ["resource-exhausted", "quota-exceeded", "too-many-requests"].includes(code)
  ) {
    return classification("RateLimit", "SYNC-RATE-001", "Rate limit exceeded");
  }
  if (
    ["unavailable", "deadline-exceeded", "network-request-failed"].includes(code) ||
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("offline")
  ) {
    return classification("Network", "SYNC-NET-001", "Network unavailable");
  }
  if (message.includes("refusing to write legacy")) {
    return classification(
      "Validation",
      "SYNC-VAL-001",
      "Remote schema version unsupported",
    );
  }
  if (message.includes("refusing to write invalid")) {
    return classification(
      "Validation",
      "SYNC-VAL-002",
      "Remote record format invalid",
    );
  }
  if (phase === "validate_remote_records") {
    return classification(
      "Validation",
      "SYNC-VAL-003",
      "Remote record validation failed",
    );
  }
  if (
    phase === "write_local_db" ||
    phase === "load_local_changes" ||
    phase === "mark_synced"
  ) {
    return classification(
      "LocalDB",
      "SYNC-LDB-001",
      "Local database operation failed",
    );
  }
  if (phase === "resolve_conflicts") {
    return classification(
      "Conflict",
      "SYNC-CON-001",
      "Conflict resolution failed",
    );
  }
  if (phase === "fetch_remote_changes") {
    return classification("RemoteDB", "SYNC-RDB-001", "Firestore read failed");
  }
  if (phase === "upload_local_changes") {
    return classification("RemoteDB", "SYNC-RDB-002", "Firestore write failed");
  }
  return classification("Unknown", "SYNC-UNK-001", "Unexpected sync failure");
};

const safeNonNegativeInteger = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;

const safeVersionString = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return /^[A-Za-z0-9._+-]{1,80}$/.test(trimmed) ? trimmed : fallback;
};

/**
 * Rebuilds the event from a strict allowlist. Unknown properties are never
 * copied, even if a caller accidentally passes a memo or an exception object.
 */
export const sanitizeSyncDiagnosticEvent = (
  input: SyncDiagnosticEventInput | Record<string, unknown>,
): SyncDiagnosticEvent | null => {
  const anonymousUserId =
    typeof input.anonymousUserId === "string" ? input.anonymousUserId : "";
  const syncId = typeof input.syncId === "string" ? input.syncId : "";
  if (!/^[a-f0-9]{64}$/.test(anonymousUserId)) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(syncId)) {
    return null;
  }
  if (
    typeof input.entity !== "string" ||
    !ENTITY_SET.has(input.entity) ||
    typeof input.phase !== "string" ||
    !PHASE_SET.has(input.phase)
  ) {
    return null;
  }

  const event: SyncDiagnosticEvent = {
    anonymousUserId,
    syncId,
    entity: input.entity as SyncEntityType,
    phase: input.phase as SyncPhase,
    successCount: safeNonNegativeInteger(input.successCount),
    failedCount: safeNonNegativeInteger(input.failedCount),
    retryCount: safeNonNegativeInteger(input.retryCount),
    durationMs: safeNonNegativeInteger(input.durationMs),
    appVersion: safeVersionString(input.appVersion, "unknown"),
    osVersion: safeVersionString(input.osVersion, "unknown"),
    schemaVersion: safeNonNegativeInteger(input.schemaVersion),
    migrationVersion: safeVersionString(input.migrationVersion, "unknown"),
  };

  if (
    typeof input.errorType === "string" &&
    ERROR_TYPE_SET.has(input.errorType) &&
    typeof input.errorCode === "string" &&
    ERROR_CODE_SET.has(input.errorCode) &&
    typeof input.sanitizedReason === "string" &&
    SANITIZED_REASON_SET.has(input.sanitizedReason)
  ) {
    event.errorType = input.errorType as SyncErrorType;
    event.errorCode = input.errorCode as SyncErrorCode;
    event.sanitizedReason = input.sanitizedReason as SanitizedSyncReason;
  }

  return event;
};

export const toCrashlyticsAttributes = (
  event: SyncDiagnosticEvent,
): Record<string, string> => ({
  anonymousUserId: event.anonymousUserId,
  syncId: event.syncId,
  entity: event.entity,
  phase: event.phase,
  successCount: String(event.successCount),
  failedCount: String(event.failedCount),
  errorType: event.errorType ?? "None",
  errorCode: event.errorCode ?? "None",
  appVersion: event.appVersion,
  osVersion: event.osVersion,
  retryCount: String(event.retryCount),
  durationMs: String(event.durationMs),
  schemaVersion: String(event.schemaVersion),
  migrationVersion: event.migrationVersion,
});

export type SyncDiagnosticSink = (
  event: SyncDiagnosticEvent,
  options: { recordAsError: boolean },
) => void | Promise<void>;

export const createSyncDiagnosticReporter = (options: {
  sink?: SyncDiagnosticSink;
  writeConsole?: (message: string) => void;
}) => ({
  report: async (
    input: SyncDiagnosticEventInput | Record<string, unknown>,
    reportOptions: { recordAsError?: boolean } = {},
  ): Promise<void> => {
    const event = sanitizeSyncDiagnosticEvent(input);
    if (!event) {
      return;
    }
    try {
      options.writeConsole?.(`[sync-diagnostic] ${JSON.stringify(event)}`);
    } catch {
      // Diagnostics must never affect the sync operation.
    }
    try {
      await options.sink?.(event, {
        recordAsError: reportOptions.recordAsError === true,
      });
    } catch {
      // Crashlytics/network/native failures are deliberately non-fatal.
    }
  },
});

export type SyncDiagnosticReporter = ReturnType<
  typeof createSyncDiagnosticReporter
>;

export const createAnonymousUserId = async (
  internalId: string,
  salt: string,
  digest: (value: string) => Promise<string>,
): Promise<string> => {
  if (!internalId.trim()) {
    throw new Error("An internal user id is required for anonymous diagnostics.");
  }
  const value = await digest(`${salt}\u0000${internalId}`);
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("Anonymous user id digest must be a SHA-256 hex value.");
  }
  return normalized;
};

export const createUserFacingSyncError = (
  value: SyncErrorClassification,
): string =>
  `同期に失敗しました。\n時間をおいて再度お試しください。\n\nエラーコード: ${value.errorCode}`;
