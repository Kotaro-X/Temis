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

type EnvelopeEntityType = Exclude<SyncEntityType, "tag">;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const runEnvelopeEntitySync = async <TType extends EnvelopeEntityType>(
  identity: SyncIdentity,
  entityType: TType,
  loadLocalRecords: () => Promise<SyncEntityEnvelope<TType>[]>,
  applyMergedRecords: (records: SyncEntityEnvelope<TType>[]) => Promise<void>,
): Promise<{ pushed: number; pulled: number }> => {
  let metadata: SyncEntityMetadata = {
    ...createEmptySyncEntityMetadata(),
    ...(await loadSyncEntityMetadata(identity.userId, entityType)),
    status: "syncing",
    error: null,
  };
  const isFreshInitialSync =
    !metadata.initialSyncCompleted &&
    metadata.lastPulledAt === null &&
    metadata.lastPulledId === null;
  await saveSyncEntityMetadata(identity.userId, entityType, metadata);

  try {
    let localRecords = await loadLocalRecords();
    if (isFreshInitialSync) {
      await enqueueMissingSyncEnvelopes(localRecords);
    }

    const queueResult = await syncQueuedEnvelopes(entityType, async (envelope) => {
      await pushSyncEnvelope(identity.userId, envelope);
    });

    const pullResult = await runIncrementalPull({
      metadata,
      pullPage: (request) =>
        pullSyncEnvelopePage(identity.userId, entityType, request),
      applyPage: async (remotePage) => {
        const merged = mergeSyncEnvelopes(localRecords, remotePage);
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
      throw queueResult.firstError;
    }
    if (queueResult.pendingCount > 0) {
      throw new Error(
        `${entityType} sync still has ${queueResult.pendingCount} pending upload(s).`,
      );
    }

    metadata = completeSyncEntityMetadata(
      metadata,
      queueResult.pushedCount > 0 ? Date.now() : null,
    );
    await saveSyncEntityMetadata(identity.userId, entityType, metadata);
    return {
      pushed: queueResult.pushedCount,
      pulled: pullResult.pulled,
    };
  } catch (error) {
    metadata = failSyncEntityMetadata(metadata, errorMessage(error));
    await saveSyncEntityMetadata(identity.userId, entityType, metadata);
    throw error;
  }
};
