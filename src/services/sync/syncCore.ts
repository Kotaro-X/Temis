import type {
  SyncEntityEnvelope,
  SyncEntityMetadata,
  SyncEntityType,
  SyncPullCursor,
} from "../../types/sync.ts";

export const SYNC_PAGE_SIZE = 500;

export const createEmptySyncEntityMetadata = (): SyncEntityMetadata => ({
  lastPulledAt: null,
  lastPulledId: null,
  lastPushedAt: null,
  initialSyncCompleted: false,
  status: "idle",
  error: null,
});

export const completeSyncEntityMetadata = (
  metadata: SyncEntityMetadata,
  pushedAt?: number | null,
): SyncEntityMetadata => ({
  ...metadata,
  // An empty initial collection needs a durable lower bound so the next run
  // uses a delta query instead of repeating a full collection scan.
  lastPulledAt: metadata.lastPulledAt ?? 0,
  lastPulledId: null,
  lastPushedAt: pushedAt ?? metadata.lastPushedAt,
  initialSyncCompleted: true,
  status: "succeeded",
  error: null,
});

export const failSyncEntityMetadata = (
  metadata: SyncEntityMetadata,
  error: unknown,
): SyncEntityMetadata => ({
  ...metadata,
  status: "failed",
  error: error instanceof Error ? error.message : String(error),
});

export type IncrementalPullRequest = {
  /** Strict lower bound used for a new incremental cycle. */
  updatedAfter: number | null;
  /** Exact page cursor used only to resume/continue an incomplete cycle. */
  after: SyncPullCursor | null;
  pageSize: number;
};

export type IncrementalPullPage<TRecord> = {
  records: TRecord[];
  nextCursor: SyncPullCursor | null;
  hasMore: boolean;
};

export const createIncrementalPullRequest = (
  metadata: SyncEntityMetadata,
): IncrementalPullRequest => ({
  updatedAfter: metadata.lastPulledId === null ? metadata.lastPulledAt : null,
  after:
    metadata.lastPulledAt !== null && metadata.lastPulledId !== null
      ? {
          updatedAt: metadata.lastPulledAt,
          entityId: metadata.lastPulledId,
        }
      : null,
  pageSize: SYNC_PAGE_SIZE,
});

/**
 * Pulls and applies pages sequentially. The metadata callback is deliberately
 * invoked only after applyPage resolves, so a crash can at worst replay an
 * already-applied page (which LWW upserts make idempotent).
 */
export const runIncrementalPull = async <TRecord>(params: {
  metadata: SyncEntityMetadata;
  pullPage: (
    request: IncrementalPullRequest,
  ) => Promise<IncrementalPullPage<TRecord>>;
  applyPage: (records: TRecord[]) => Promise<void>;
  saveProgress: (metadata: SyncEntityMetadata) => Promise<void>;
}): Promise<{
  metadata: SyncEntityMetadata;
  pulled: number;
  pages: number;
}> => {
  let metadata = params.metadata;
  let request = createIncrementalPullRequest(metadata);
  let pulled = 0;
  let pages = 0;

  while (true) {
    const page = await params.pullPage(request);
    if (page.records.length > 0) {
      await params.applyPage(page.records);
      pulled += page.records.length;
    }

    if (page.nextCursor) {
      metadata = {
        ...metadata,
        lastPulledAt: page.nextCursor.updatedAt,
        lastPulledId: page.hasMore ? page.nextCursor.entityId : null,
        status: "syncing",
        error: null,
      };
      await params.saveProgress(metadata);
    }
    pages += 1;

    if (!page.hasMore) {
      return { metadata, pulled, pages };
    }
    if (!page.nextCursor) {
      throw new Error("Incremental pull page marked hasMore without a cursor.");
    }
    request = {
      updatedAfter: request.updatedAfter,
      after: page.nextCursor,
      pageSize: SYNC_PAGE_SIZE,
    };
  }
};

const compareTimestamps = (left: number | null | undefined, right: number | null | undefined) => {
  const normalizedLeft = left ?? 0;
  const normalizedRight = right ?? 0;
  if (normalizedLeft === normalizedRight) {
    return 0;
  }
  return normalizedLeft > normalizedRight ? 1 : -1;
};

export const compareSyncVersions = (
  left: {
    updatedAt: number;
    deletedAt?: number | null;
    deviceId?: string | null;
  },
  right: {
    updatedAt: number;
    deletedAt?: number | null;
    deviceId?: string | null;
  },
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

export const compareSyncEnvelopes = <
  TType extends SyncEntityType,
>(
  left: SyncEntityEnvelope<TType>,
  right: SyncEntityEnvelope<TType>,
) => {
  return compareSyncVersions(left, right);
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
