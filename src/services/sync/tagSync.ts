import {
  loadSyncQueue,
  loadSyncEntityMetadata,
  loadTagRecords,
  saveSyncEntityMetadata,
  saveSyncQueue,
  saveTagRecords,
} from "../../../storage";
import type {
  SyncEntityMetadata,
  SyncIdentity,
  SyncQueueItem,
  TagRecord,
} from "../../types";
import {
  pullTagRecordPage,
  pushTagRecord,
} from "./firestoreTagAdapter";
import {
  compareSyncVersions,
  completeSyncEntityMetadata,
  createEmptySyncEntityMetadata,
  failSyncEntityMetadata,
  runIncrementalPull,
} from "./syncCore";
import {
  createSyncDiagnosticObserver,
  type SyncRunDiagnosticContext,
} from "./syncDiagnosticObserver";
import { syncDiagnosticReporter } from "./syncTelemetry";
import {
  ClassifiedSyncError,
  classifySyncError,
} from "./syncDiagnostics";

const getRetryDelayMs = (attemptCount: number) =>
  Math.min(60_000, 1_000 * 2 ** Math.max(0, attemptCount));

const compareRecords = (left: TagRecord, right: TagRecord) => {
  return compareSyncVersions(left, right);
};

const mergeTagRecords = (local: TagRecord[], remote: TagRecord[]): TagRecord[] => {
  const merged = new Map<string, TagRecord>();
  for (const record of [...local, ...remote]) {
    const current = merged.get(record.id);
    if (!current || compareRecords(record, current) >= 0) {
      merged.set(record.id, record);
    }
  }
  return [...merged.values()].sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    return a.id.localeCompare(b.id);
  });
};

const syncQueuedTags = async (
  identity: SyncIdentity,
): Promise<{
  queue: SyncQueueItem[];
  firstError: Error | null;
  pushedCount: number;
  pendingCount: number;
  retryCount: number;
}> => {
  const now = Date.now();
  const queue = await loadSyncQueue();
  const nextQueue: SyncQueueItem[] = [];
  let firstError: Error | null = null;
  let pushedCount = 0;
  let retryCount = 0;

  for (const item of queue) {
    if (item.entityType !== "tag") {
      nextQueue.push(item);
      continue;
    }
    if (item.nextRetryAt > now) {
      nextQueue.push(item);
      continue;
    }
    const record = (item.payload as { record?: TagRecord })?.record;
    if (!record) {
      continue;
    }
    try {
      await pushTagRecord(identity.userId, record);
      pushedCount += 1;
    } catch (error) {
      const classified = classifySyncError(error, "upload_local_changes");
      const nextAttemptCount = item.attemptCount + 1;
      retryCount = Math.max(retryCount, nextAttemptCount);
      nextQueue.push({
        ...item,
        attemptCount: nextAttemptCount,
        lastError: classified.errorCode,
        updatedAt: now,
        nextRetryAt: now + getRetryDelayMs(nextAttemptCount),
      });
      if (!firstError) {
        firstError = new ClassifiedSyncError(classified);
      }
    }
  }

  await saveSyncQueue(nextQueue);
  return {
    queue: nextQueue,
    firstError,
    pushedCount,
    pendingCount: nextQueue.filter((item) => item.entityType === "tag").length,
    retryCount,
  };
};

const enqueueMissingTagRecords = async (records: TagRecord[]) => {
  if (records.length === 0) {
    return;
  }
  const queue = await loadSyncQueue();
  const existingIds = new Set(
    queue.filter((item) => item.entityType === "tag").map((item) => item.entityId),
  );
  const now = Date.now();
  const additions: SyncQueueItem[] = records
    .filter((record) => !existingIds.has(record.id))
    .map((record) => ({
      id: `tag-bootstrap:${record.id}`,
      entityType: "tag" as const,
      entityId: record.id,
      operation: "upsert" as const,
      payload: { record },
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      lastError: null,
      nextRetryAt: 0,
    }));
  if (additions.length > 0) {
    await saveSyncQueue([...queue, ...additions]);
  }
};

export const syncTagRecords = async (
  identity: SyncIdentity,
  diagnosticContext: SyncRunDiagnosticContext,
): Promise<{
  pushed: number;
  pulled: number;
}> => {
  const diagnostics = createSyncDiagnosticObserver({
    context: diagnosticContext,
    entity: "tag",
    reporter: syncDiagnosticReporter,
  });
  await diagnostics.start();
  let metadata: SyncEntityMetadata = createEmptySyncEntityMetadata();
  let retryCount = 0;

  try {
    await diagnostics.phase("load_local_changes");
    metadata = {
      ...metadata,
      ...(await loadSyncEntityMetadata(identity.userId, "tag")),
      status: "syncing",
      error: null,
    };
    const isFreshInitialSync =
      !metadata.initialSyncCompleted &&
      metadata.lastPulledAt === null &&
      metadata.lastPulledId === null;
    await saveSyncEntityMetadata(identity.userId, "tag", metadata);
    let localRecords = await loadTagRecords();
    if (isFreshInitialSync) {
      await enqueueMissingTagRecords(localRecords);
    }
    await diagnostics.phase("upload_local_changes");
    const queueResult = await syncQueuedTags(identity);
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
        const page = await pullTagRecordPage(identity.userId, request, {
          onValidationFailure: async () => {
            await diagnostics.validationFailure("corrupt");
          },
        });
        await diagnostics.phase("validate_remote_records", {
          successCount: queueResult.pushedCount + page.records.length,
          retryCount,
        });
        return page;
      },
      applyPage: async (remotePage) => {
        await diagnostics.phase("resolve_conflicts", { retryCount });
        localRecords = mergeTagRecords(localRecords, remotePage);
        await diagnostics.phase("write_local_db", { retryCount });
        await saveTagRecords(localRecords);
      },
      saveProgress: async (progress) => {
        metadata = progress;
        await saveSyncEntityMetadata(identity.userId, "tag", progress);
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
        `tag sync still has ${queueResult.pendingCount} pending upload(s).`,
      );
    }
    await diagnostics.phase("mark_synced", { retryCount });
    metadata = completeSyncEntityMetadata(
      metadata,
      queueResult.pushedCount > 0 ? Date.now() : null,
    );
    await saveSyncEntityMetadata(identity.userId, "tag", metadata);
    await diagnostics.complete({
      successCount: queueResult.pushedCount + pullResult.pulled,
      retryCount,
    });
    return { pushed: queueResult.pushedCount, pulled: pullResult.pulled };
  } catch (error) {
    const classifiedError = await diagnostics.fail(error);
    metadata = failSyncEntityMetadata(
      metadata,
      classifiedError.classification.errorCode,
    );
    try {
      await saveSyncEntityMetadata(identity.userId, "tag", metadata);
    } catch {
      // Preserve the primary failure; diagnostics and recovery metadata are best effort.
    }
    throw classifiedError;
  }
};
