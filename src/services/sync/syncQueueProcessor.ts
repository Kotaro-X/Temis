import type { SyncEntityEnvelope, SyncEntityType, SyncQueueItem } from "../../types";
import {
  logSkippedSyncEnvelope,
  validateSyncEnvelope,
} from "./syncEnvelopeValidator.ts";
import {
  ClassifiedSyncError,
  classifySyncError,
} from "./syncDiagnostics.ts";

export { findReconciliationPushes } from "./syncCore.ts";

const getRetryDelayMs = (attemptCount: number) =>
  Math.min(60_000, 1_000 * 2 ** Math.max(0, attemptCount));

export const processSyncQueue = async <
  TType extends Exclude<SyncEntityType, "tag">,
>(
  entityType: TType,
  queue: SyncQueueItem[],
  now: number,
  pushEnvelope: (envelope: SyncEntityEnvelope<TType>) => Promise<void>,
): Promise<{
  queue: SyncQueueItem[];
  firstError: Error | null;
  pushedCount: number;
  pendingCount: number;
  retryCount: number;
}> => {
  const nextQueue: SyncQueueItem[] = [];
  let firstError: Error | null = null;
  let pushedCount = 0;
  let retryCount = 0;

  for (const item of queue) {
    if (item.entityType !== entityType) {
      nextQueue.push(item);
      continue;
    }
    if (item.nextRetryAt > now) {
      nextQueue.push(item);
      continue;
    }
    const envelope = (item.payload as {
      envelope?: SyncEntityEnvelope<TType>;
    })?.envelope;
    if (!envelope || envelope.entityType !== entityType) {
      continue;
    }
    const validation = validateSyncEnvelope(entityType, envelope);
    if (!validation.ok) {
      logSkippedSyncEnvelope(entityType, `queue:${item.id}`, validation);
      continue;
    }
    try {
      await pushEnvelope(validation.envelope);
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

  return {
    queue: nextQueue,
    firstError,
    pushedCount,
    pendingCount: nextQueue.filter((item) => item.entityType === entityType).length,
    retryCount,
  };
};

export const syncQueuedEnvelopes = async <
  TType extends Exclude<SyncEntityType, "tag">,
>(
  entityType: TType,
  pushEnvelope: (envelope: SyncEntityEnvelope<TType>) => Promise<void>,
): Promise<{
  queue: SyncQueueItem[];
  firstError: Error | null;
  pushedCount: number;
  pendingCount: number;
  retryCount: number;
}> => {
  const { loadSyncQueue, saveSyncQueue } = await import("../../../storage.ts");
  const now = Date.now();
  const queue = await loadSyncQueue();
  const result = await processSyncQueue(entityType, queue, now, pushEnvelope);

  await saveSyncQueue(result.queue);
  return result;
};
