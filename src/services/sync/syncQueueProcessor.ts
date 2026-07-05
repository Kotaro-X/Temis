import type { SyncEntityEnvelope, SyncEntityType, SyncQueueItem } from "../../types";

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
}> => {
  const nextQueue: SyncQueueItem[] = [];
  let firstError: Error | null = null;
  let pushedCount = 0;

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
    try {
      await pushEnvelope(envelope);
      pushedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextAttemptCount = item.attemptCount + 1;
      nextQueue.push({
        ...item,
        attemptCount: nextAttemptCount,
        lastError: message,
        updatedAt: now,
        nextRetryAt: now + getRetryDelayMs(nextAttemptCount),
      });
      if (!firstError) {
        firstError = error instanceof Error ? error : new Error(message);
      }
    }
  }

  return { queue: nextQueue, firstError, pushedCount };
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
}> => {
  const { loadSyncQueue, saveSyncQueue } = await import("../../../storage.ts");
  const now = Date.now();
  const queue = await loadSyncQueue();
  const result = await processSyncQueue(entityType, queue, now, pushEnvelope);

  await saveSyncQueue(result.queue);
  return result;
};
