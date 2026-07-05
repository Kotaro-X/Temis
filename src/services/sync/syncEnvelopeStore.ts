import { nanoid } from "nanoid/non-secure";

import {
  loadSyncEntityRecords,
  loadSyncQueue,
  saveSyncEntityRecords,
  saveSyncQueue,
} from "../../../storage";
import type { SyncEntityEnvelope, SyncEntityType, SyncQueueItem } from "../../types";
import { upsertSyncEnvelope } from "./syncCore";
import { notifySyncQueueChanged } from "./syncQueueEvents";

export {
  compareSyncEnvelopes,
  mergeSyncEnvelopes,
  upsertSyncEnvelope,
} from "./syncCore";

export const persistSyncEnvelope = async <TType extends SyncEntityType>(
  envelope: SyncEntityEnvelope<TType>,
): Promise<void> => {
  const current = await loadSyncEntityRecords(envelope.entityType);
  const next = upsertSyncEnvelope(current, envelope);
  await saveSyncEntityRecords(envelope.entityType, next);
};

export const enqueueSyncEnvelope = async <TType extends SyncEntityType>(
  envelope: SyncEntityEnvelope<TType>,
): Promise<void> => {
  const queue = await loadSyncQueue();
  const now = Date.now();
  const existing = queue.find(
    (item) =>
      item.entityType === envelope.entityType &&
      item.entityId === envelope.entityId,
  );
  const nextItem: SyncQueueItem<{ envelope: SyncEntityEnvelope<TType> }> = {
    id: existing?.id ?? nanoid(),
    entityType: envelope.entityType,
    entityId: envelope.entityId,
    operation: "upsert",
    payload: { envelope },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    attemptCount: 0,
    lastError: null,
    nextRetryAt: 0,
  };
  const nextQueue = queue.filter(
    (item) =>
      !(
        item.entityType === envelope.entityType &&
        item.entityId === envelope.entityId
      ),
  );
  nextQueue.push(nextItem);
  await saveSyncQueue(nextQueue);
  notifySyncQueueChanged();
};

export const persistAndEnqueueSyncEnvelope = async <
  TType extends SyncEntityType,
>(
  envelope: SyncEntityEnvelope<TType>,
): Promise<void> => {
  await persistSyncEnvelope(envelope);
  await enqueueSyncEnvelope(envelope);
};
