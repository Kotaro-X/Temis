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
}> => {
  const now = Date.now();
  const queue = await loadSyncQueue();
  const nextQueue: SyncQueueItem[] = [];
  let firstError: Error | null = null;
  let pushedCount = 0;

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
  return {
    queue: nextQueue,
    firstError,
    pushedCount,
    pendingCount: nextQueue.filter((item) => item.entityType === "tag").length,
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

export const syncTagRecords = async (identity: SyncIdentity): Promise<{
  pushed: number;
  pulled: number;
}> => {
  let metadata: SyncEntityMetadata = {
    ...createEmptySyncEntityMetadata(),
    ...(await loadSyncEntityMetadata(identity.userId, "tag")),
    status: "syncing",
    error: null,
  };
  const isFreshInitialSync =
    !metadata.initialSyncCompleted &&
    metadata.lastPulledAt === null &&
    metadata.lastPulledId === null;
  await saveSyncEntityMetadata(identity.userId, "tag", metadata);

  try {
    let localRecords = await loadTagRecords();
    if (isFreshInitialSync) {
      await enqueueMissingTagRecords(localRecords);
    }
    const queueResult = await syncQueuedTags(identity);
    const pullResult = await runIncrementalPull({
      metadata,
      pullPage: (request) => pullTagRecordPage(identity.userId, request),
      applyPage: async (remotePage) => {
        localRecords = mergeTagRecords(localRecords, remotePage);
        await saveTagRecords(localRecords);
      },
      saveProgress: async (progress) => {
        metadata = progress;
        await saveSyncEntityMetadata(identity.userId, "tag", progress);
      },
    });
    metadata = pullResult.metadata;
    if (queueResult.firstError) {
      throw queueResult.firstError;
    }
    if (queueResult.pendingCount > 0) {
      throw new Error(
        `tag sync still has ${queueResult.pendingCount} pending upload(s).`,
      );
    }
    metadata = completeSyncEntityMetadata(
      metadata,
      queueResult.pushedCount > 0 ? Date.now() : null,
    );
    await saveSyncEntityMetadata(identity.userId, "tag", metadata);
    return { pushed: queueResult.pushedCount, pulled: pullResult.pulled };
  } catch (error) {
    metadata = failSyncEntityMetadata(metadata, error);
    await saveSyncEntityMetadata(identity.userId, "tag", metadata);
    throw error;
  }
};
