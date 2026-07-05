import {
  loadLastCloudSyncedAt,
  loadSyncQueue,
  loadTagRecords,
  saveLastCloudSyncedAt,
  saveSyncQueue,
  saveTagRecords,
} from "../../../storage";
import type { SyncIdentity, SyncQueueItem, TagRecord } from "../../types";
import { pullTagRecords, pushTagRecord } from "./firestoreTagAdapter";
import {
  cleanupExpiredRemoteTagRecords,
  finalizeExpiredLocalTagRecords,
} from "./syncRetention";

const getRetryDelayMs = (attemptCount: number) =>
  Math.min(60_000, 1_000 * 2 ** Math.max(0, attemptCount));

const compareTimestamps = (left: number, right: number) => {
  if (left === right) {
    return 0;
  }
  return left > right ? 1 : -1;
};

const compareRecords = (left: TagRecord, right: TagRecord) => {
  const updatedAtOrder = compareTimestamps(left.updatedAt, right.updatedAt);
  if (updatedAtOrder !== 0) {
    return updatedAtOrder;
  }
  const deletedAtOrder = compareTimestamps(left.deletedAt ?? 0, right.deletedAt ?? 0);
  if (deletedAtOrder !== 0) {
    return deletedAtOrder;
  }
  const archivedAtOrder = compareTimestamps(
    left.archivedAt ?? 0,
    right.archivedAt ?? 0,
  );
  if (archivedAtOrder !== 0) {
    return archivedAtOrder;
  }
  return (left.deviceId ?? "").localeCompare(right.deviceId ?? "");
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
): Promise<{ queue: SyncQueueItem[]; firstError: Error | null }> => {
  const now = Date.now();
  const queue = await loadSyncQueue();
  const nextQueue: SyncQueueItem[] = [];
  let firstError: Error | null = null;

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

  await saveSyncQueue(nextQueue);
  return { queue: nextQueue, firstError };
};

export const syncTagRecords = async (identity: SyncIdentity): Promise<{
  pushed: number;
  pulled: number;
}> => {
  const now = Date.now();
  const [loadedLocalRecords, lastSyncedAt] = await Promise.all([
    loadTagRecords(),
    loadLastCloudSyncedAt(),
  ]);
  let localRecords = loadedLocalRecords;
  const localCleanup = await cleanupExpiredRemoteTagRecords(
    identity.userId,
    localRecords,
    now,
  );
  if (localCleanup.expiredEntityIds.length > 0) {
    await finalizeExpiredLocalTagRecords(
      localCleanup.keptRecords,
      localCleanup.expiredEntityIds,
    );
  }
  localRecords = localCleanup.keptRecords;
  const { queue, firstError } = await syncQueuedTags(identity);
  const pulledRemoteRecords = await pullTagRecords(identity.userId);
  const remoteCleanup = await cleanupExpiredRemoteTagRecords(
    identity.userId,
    pulledRemoteRecords,
    now,
  );
  const remoteRecords = remoteCleanup.keptRecords;
  const remoteById = new Map(remoteRecords.map((record) => [record.id, record]));
  const reconciliationPushes = localRecords.filter((record) => {
    const remote = remoteById.get(record.id);
    return !remote || compareRecords(record, remote) > 0;
  });
  let reconciliationError = firstError;
  let pushed = 0;

  for (const record of reconciliationPushes) {
    try {
      await pushTagRecord(identity.userId, record);
      pushed += 1;
    } catch (error) {
      if (!reconciliationError) {
        reconciliationError =
          error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  const merged = mergeTagRecords(localRecords, remoteRecords);
  await saveTagRecords(merged);
  await saveLastCloudSyncedAt(Date.now());

  if (reconciliationError) {
    throw reconciliationError;
  }

  return {
    pushed: Math.max(pushed, localRecords.length - queue.length),
    pulled: lastSyncedAt === null ? remoteRecords.length : remoteRecords.length,
  };
};
