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
import { assertValidSyncEnvelopeForWrite } from "./syncEnvelopeValidator";

let storeMutation: Promise<void> = Promise.resolve();

const serializeStoreMutation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = storeMutation.then(operation, operation);
  storeMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

export {
  compareSyncEnvelopes,
  mergeSyncEnvelopes,
  upsertSyncEnvelope,
} from "./syncCore";

export const persistSyncEnvelope = async <TType extends SyncEntityType>(
  envelope: SyncEntityEnvelope<TType>,
): Promise<void> => serializeStoreMutation(async () => {
  const validatedEnvelope = assertValidSyncEnvelopeForWrite(envelope);
  const current = await loadSyncEntityRecords(validatedEnvelope.entityType);
  const next = upsertSyncEnvelope(current, validatedEnvelope);
  await saveSyncEntityRecords(validatedEnvelope.entityType, next);
});

export const enqueueSyncEnvelope = async <TType extends SyncEntityType>(
  envelope: SyncEntityEnvelope<TType>,
): Promise<void> => serializeStoreMutation(async () => {
  const validatedEnvelope = assertValidSyncEnvelopeForWrite(envelope);
  const queue = await loadSyncQueue();
  const now = Date.now();
  const existing = queue.find(
    (item) =>
      item.entityType === validatedEnvelope.entityType &&
      item.entityId === validatedEnvelope.entityId,
  );
  const nextItem: SyncQueueItem<{ envelope: SyncEntityEnvelope<TType> }> = {
    id: existing?.id ?? nanoid(),
    entityType: validatedEnvelope.entityType,
    entityId: validatedEnvelope.entityId,
    operation: "upsert",
    payload: { envelope: validatedEnvelope },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    attemptCount: 0,
    lastError: null,
    nextRetryAt: 0,
  };
  const nextQueue = queue.filter(
    (item) =>
      !(
        item.entityType === validatedEnvelope.entityType &&
        item.entityId === validatedEnvelope.entityId
      ),
  );
  nextQueue.push(nextItem);
  await saveSyncQueue(nextQueue);
  notifySyncQueueChanged();
});

/** Adds bootstrap records without replacing already queued local edits. */
export const enqueueMissingSyncEnvelopes = async <
  TType extends Exclude<SyncEntityType, "tag">,
>(
  envelopes: SyncEntityEnvelope<TType>[],
): Promise<void> => serializeStoreMutation(async () => {
  if (envelopes.length === 0) {
    return;
  }
  const queue = await loadSyncQueue();
  const now = Date.now();
  const existingKeys = new Set(
    queue.map((item) => `${item.entityType}:${item.entityId}`),
  );
  const additions: SyncQueueItem[] = [];
  for (const envelope of envelopes) {
    const validatedEnvelope = assertValidSyncEnvelopeForWrite(envelope);
    const key = `${validatedEnvelope.entityType}:${validatedEnvelope.entityId}`;
    if (existingKeys.has(key)) {
      continue;
    }
    existingKeys.add(key);
    additions.push({
      id: nanoid(),
      entityType: validatedEnvelope.entityType,
      entityId: validatedEnvelope.entityId,
      operation: "upsert",
      payload: { envelope: validatedEnvelope },
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      lastError: null,
      nextRetryAt: 0,
    });
  }
  if (additions.length === 0) {
    return;
  }
  await saveSyncQueue([...queue, ...additions]);
  notifySyncQueueChanged();
});

export const persistAndEnqueueSyncEnvelope = async <
  TType extends SyncEntityType,
>(
  envelope: SyncEntityEnvelope<TType>,
): Promise<void> => {
  await persistSyncEnvelope(envelope);
  await enqueueSyncEnvelope(envelope);
};
