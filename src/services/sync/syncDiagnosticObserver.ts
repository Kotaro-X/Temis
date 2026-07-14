import type { SyncEntityType } from "../../types";
import {
  ClassifiedSyncError,
  classifySyncError,
  classifyValidationFailure,
  type SyncDiagnosticEventInput,
  type SyncDiagnosticReporter,
  type SyncErrorClassification,
  type SyncPhase,
} from "./syncDiagnostics.ts";

export type SyncRunDiagnosticContext = {
  anonymousUserId: string;
  syncId: string;
  appVersion: string;
  osVersion: string;
  schemaVersion: number;
  migrationVersion: string;
};

type Metrics = Partial<
  Pick<
    SyncDiagnosticEventInput,
    "successCount" | "failedCount" | "retryCount"
  >
>;

export const createSyncDiagnosticObserver = (options: {
  context: SyncRunDiagnosticContext;
  entity: SyncEntityType;
  reporter: SyncDiagnosticReporter;
  now?: () => number;
}) => {
  const now = options.now ?? Date.now;
  const startedAt = now();
  let currentPhase: SyncPhase = "sync_start";
  let metrics: Required<Metrics> = {
    successCount: 0,
    failedCount: 0,
    retryCount: 0,
  };

  const buildEvent = (
    phase: SyncPhase,
    nextMetrics: Metrics = {},
    failure?: SyncErrorClassification,
  ): SyncDiagnosticEventInput => {
    metrics = { ...metrics, ...nextMetrics };
    return {
      ...options.context,
      entity: options.entity,
      phase,
      ...metrics,
      durationMs: Math.max(0, now() - startedAt),
      ...failure,
    };
  };

  return {
    start: async () => {
      currentPhase = "sync_start";
      await options.reporter.report(buildEvent(currentPhase));
    },
    phase: async (phase: SyncPhase, nextMetrics: Metrics = {}) => {
      currentPhase = phase;
      await options.reporter.report(buildEvent(phase, nextMetrics));
    },
    validationFailure: async (
      reason: "corrupt" | "unsupported_legacy" | "future_version",
    ) => {
      const failure = classifyValidationFailure(reason);
      const failedCount = metrics.failedCount + 1;
      await options.reporter.report(
        buildEvent("validate_remote_records", { failedCount }, failure),
        { recordAsError: false },
      );
      return failure;
    },
    fail: async (error: unknown): Promise<ClassifiedSyncError> => {
      const failure = classifySyncError(error, currentPhase);
      const failedCount = Math.max(1, metrics.failedCount);
      await options.reporter.report(
        buildEvent(currentPhase, { failedCount }, failure),
        { recordAsError: true },
      );
      await options.reporter.report(
        buildEvent("sync_failed", { failedCount }, failure),
      );
      return new ClassifiedSyncError(failure);
    },
    complete: async (nextMetrics: Metrics = {}) => {
      currentPhase = "sync_complete";
      await options.reporter.report(buildEvent(currentPhase, nextMetrics));
    },
    getCurrentPhase: () => currentPhase,
  };
};

export type SyncDiagnosticObserver = ReturnType<
  typeof createSyncDiagnosticObserver
>;
