import type { SyncEntityEnvelope, SyncEntityType } from "../../types/sync.ts";

const compareTimestamps = (left: number | null | undefined, right: number | null | undefined) => {
  const normalizedLeft = left ?? 0;
  const normalizedRight = right ?? 0;
  if (normalizedLeft === normalizedRight) {
    return 0;
  }
  return normalizedLeft > normalizedRight ? 1 : -1;
};

export const compareSyncEnvelopes = <
  TType extends SyncEntityType,
>(
  left: SyncEntityEnvelope<TType>,
  right: SyncEntityEnvelope<TType>,
) => {
  const updatedAtOrder = compareTimestamps(left.updatedAt, right.updatedAt);
  if (updatedAtOrder !== 0) {
    return updatedAtOrder;
  }
  const deletedAtOrder = compareTimestamps(left.deletedAt, right.deletedAt);
  if (deletedAtOrder !== 0) {
    return deletedAtOrder;
  }
  return (left.deviceId ?? "").localeCompare(right.deviceId ?? "");
};

export const mergeSyncEnvelopes = <TType extends SyncEntityType>(
  local: SyncEntityEnvelope<TType>[],
  remote: SyncEntityEnvelope<TType>[],
): SyncEntityEnvelope<TType>[] => {
  const merged = new Map<string, SyncEntityEnvelope<TType>>();
  for (const envelope of [...local, ...remote]) {
    const current = merged.get(envelope.entityId);
    if (!current || compareSyncEnvelopes(envelope, current) >= 0) {
      merged.set(envelope.entityId, envelope);
    }
  }
  return [...merged.values()].sort((left, right) =>
    left.entityId.localeCompare(right.entityId),
  );
};

export const upsertSyncEnvelope = <TType extends SyncEntityType>(
  records: SyncEntityEnvelope<TType>[],
  envelope: SyncEntityEnvelope<TType>,
): SyncEntityEnvelope<TType>[] => {
  const current = records.find((entry) => entry.entityId === envelope.entityId);
  if (current && compareSyncEnvelopes(current, envelope) > 0) {
    return records;
  }
  const next = records.filter((entry) => entry.entityId !== envelope.entityId);
  next.push(envelope);
  next.sort((left, right) => left.entityId.localeCompare(right.entityId));
  return next;
};

export const findReconciliationPushes = <
  TType extends Exclude<SyncEntityType, "tag">,
>(
  localRecords: SyncEntityEnvelope<TType>[],
  remoteRecords: SyncEntityEnvelope<TType>[],
) => {
  const remoteById = new Map(remoteRecords.map((record) => [record.entityId, record]));
  return localRecords.filter((record) => {
    const remote = remoteById.get(record.entityId);
    return !remote || compareSyncEnvelopes(record, remote) > 0;
  });
};
