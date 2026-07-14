import {
  loadSyncEntityMetadata,
  saveSyncEntityMetadata,
  saveSyncEntityRecords,
} from "../../../storage";
import type {
  SyncEntityEnvelope,
  SyncEntityMetadata,
  SyncEntityType,
  SyncIdentity,
} from "../../types";
import { pullSyncEnvelopePage, pushSyncEnvelope } from "./firestoreSyncAdapter";
import {
  createEmptySyncEntityMetadata,
  completeSyncEntityMetadata,
  failSyncEntityMetadata,
  mergeSyncEnvelopes,
  runIncrementalPull,
} from "./syncCore";
import { enqueueMissingSyncEnvelopes } from "./syncEnvelopeStore";
import { syncQueuedEnvelopes } from "./syncQueueProcessor";
import {
  createSyncDiagnosticObserver,
  type SyncRunDiagnosticContext,
} from "./syncDiagnosticObserver";
import { syncDiagnosticReporter } from "./syncTelemetry";

type EnvelopeEntityType = Exclude<SyncEntityType, "tag">;

export const runEnvelopeEntitySync = async <TType extends EnvelopeEntityType>(
  identity: SyncIdentity,
  entityType: TType,
  loadLocalRecords: () => Promise<SyncEntityEnvelope<TType>[]>,
  applyMergedRecords: (records: SyncEntityEnvelope<TType>[]) => Promise<void>,
  diagnosticContext: SyncRunDiagnosticContext,
): Promise<{ pushed: number; pulled: number }> => {
  const diagnostics = createSyncDiagnosticObserver({
    context: diagnosticContext,
    entity: entityType,
    reporter: syncDiagnosticReporter,
  });
  await diagnostics.start();
  let metadata: SyncEntityMetadata = createEmptySyncEntityMetadata();
  let retryCount = 0;

  try {
    await diagnostics.phase("load_local_changes");
    metadata = {
      ...metadata,
      ...(await loadSyncEntityMetadata(identity.userId, entityType)),
      status: "syncing",
      error: null,
    };
    const isFreshInitialSync =
      !metadata.initialSyncCompleted &&
      metadata.lastPulledAt === null &&
      metadata.lastPulledId === null;
    await saveSyncEntityMetadata(identity.userId, entityType, metadata);
    let localRecords = await loadLocalRecords();
    if (isFreshInitialSync) {
      await enqueueMissingSyncEnvelopes(localRecords);
    }

    await diagnostics.phase("upload_local_changes");
    const queueResult = await syncQueuedEnvelopes(entityType, async (envelope) => {
      await pushSyncEnvelope(identity.userId, envelope);
    });
    retryCount = queueResult.retryCount;
    await diagnostics.phase("upload_local_changes", {
      successCount: queueResult.pushedCount,
      failedCount: queueResult.firstError ? 1 : 0,
      retryCount,
    });

    const pullResult = await runIncrementalPull({
      metadata,
      pullPage: async (request) => {
        await diagnostics.phase("fetch_remote_changes", { retryCount });
        const page = await pullSyncEnvelopePage(
          identity.userId,
          entityType,
          request,
          {
            onValidationFailure: async (failure) => {
              await diagnostics.validationFailure(failure.reason);
            },
          },
        );
        await diagnostics.phase("validate_remote_records", {
          successCount: queueResult.pushedCount + page.records.length,
          retryCount,
        });
        return page;
      },
      applyPage: async (remotePage) => {
        await diagnostics.phase("resolve_conflicts", { retryCount });
        const merged = mergeSyncEnvelopes(localRecords, remotePage);
        await diagnostics.phase("write_local_db", { retryCount });
        await applyMergedRecords(merged);
        await saveSyncEntityRecords(entityType, merged);
        localRecords = merged;
      },
      saveProgress: async (progress) => {
        metadata = progress;
        await saveSyncEntityMetadata(identity.userId, entityType, progress);
      },
    });
    metadata = pullResult.metadata;

    if (queueResult.firstError) {
      await diagnostics.phase("upload_local_changes", {
        failedCount: 1,
        retryCount,
      });
      throw queueResult.firstError;
    }
    if (queueResult.pendingCount > 0) {
      await diagnostics.phase("upload_local_changes", {
        failedCount: queueResult.pendingCount,
        retryCount,
      });
      throw new Error(
        `${entityType} sync still has ${queueResult.pendingCount} pending upload(s).`,
      );
    }

    await diagnostics.phase("mark_synced", { retryCount });
    metadata = completeSyncEntityMetadata(
      metadata,
      queueResult.pushedCount > 0 ? Date.now() : null,
    );
    await saveSyncEntityMetadata(identity.userId, entityType, metadata);
    await diagnostics.complete({
      successCount: queueResult.pushedCount + pullResult.pulled,
      retryCount,
    });
    return {
      pushed: queueResult.pushedCount,
      pulled: pullResult.pulled,
    };
  } catch (error) {
    const classifiedError = await diagnostics.fail(error);
    metadata = failSyncEntityMetadata(
      metadata,
      classifiedError.classification.errorCode,
    );
    try {
      await saveSyncEntityMetadata(identity.userId, entityType, metadata);
    } catch {
      // Preserve the primary failure; diagnostics and recovery metadata are best effort.
    }
    throw classifiedError;
  }
};
