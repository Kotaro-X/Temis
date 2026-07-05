import { loadSyncEntityRecords, saveSyncEntityRecords } from "../../../storage";
import {
  deleteMemoById,
  listAllMemos,
  upsertMemoRecord,
} from "../../db/memoRepo";
import {
  deleteNoteById,
  listAllNotes,
  upsertNoteRecord,
} from "../../db/noteRepo";
import {
  deleteResearchNoteById,
  listResearchNotes,
  upsertResearchNoteRecord,
} from "../researchNoteService";
import type { MemoSyncRecord, SyncEntityEnvelope, SyncIdentity } from "../../types";
import { pullSyncEnvelopes, pushSyncEnvelope } from "./firestoreSyncAdapter";
import {
  buildNoteSyncEnvelope,
  buildResearchSyncEnvelope,
  buildTaskMemoSyncEnvelope,
} from "./syncEntityModels";
import { mergeSyncEnvelopes } from "./syncEnvelopeStore";
import {
  cleanupExpiredRemoteSyncEnvelopes,
  finalizeExpiredLocalSyncEntityRecords,
} from "./syncRetention";
import {
  findReconciliationPushes,
  syncQueuedEnvelopes,
} from "./syncQueueProcessor";

const buildBootstrapMemoRecords = async (): Promise<
  SyncEntityEnvelope<"memo">[]
> => {
  const [taskMemos, notes, researchNotes] = await Promise.all([
    listAllMemos(),
    listAllNotes(),
    listResearchNotes(),
  ]);
  return [
    ...taskMemos.map((memo) =>
      buildTaskMemoSyncEnvelope({
        memo,
        deviceId: null,
      }),
    ),
    ...notes.map((note) =>
      buildNoteSyncEnvelope({
        note,
        deviceId: null,
      }),
    ),
    ...researchNotes.map((note) =>
      buildResearchSyncEnvelope({
        note,
        deviceId: null,
      }),
    ),
  ];
};

const loadMemoSyncRecords = async (): Promise<SyncEntityEnvelope<"memo">[]> => {
  const existing = await loadSyncEntityRecords("memo");
  if (existing.length > 0) {
    return existing;
  }
  const bootstrapped = await buildBootstrapMemoRecords();
  if (bootstrapped.length > 0) {
    await saveSyncEntityRecords("memo", bootstrapped);
  }
  return bootstrapped;
};

const applyMemoRecord = async (record: MemoSyncRecord) => {
  if (record.kind === "taskMemo") {
    await upsertMemoRecord(record.data, { indexMode: "sync" });
    return;
  }
  if (record.kind === "note") {
    await upsertNoteRecord(record.data);
    return;
  }
  await upsertResearchNoteRecord(record.data);
};

const deleteMemoRecord = async (record: MemoSyncRecord) => {
  if (record.kind === "taskMemo") {
    await deleteMemoById(record.data.id, { enqueueSync: false });
    return;
  }
  if (record.kind === "note") {
    await deleteNoteById(record.data.id, { enqueueSync: false });
    return;
  }
  await deleteResearchNoteById(record.data.id, { enqueueSync: false });
};

const applyMergedMemoEnvelopes = async (
  records: SyncEntityEnvelope<"memo">[],
): Promise<void> => {
  for (const envelope of records) {
    if (envelope.deletedAt !== null) {
      await deleteMemoRecord(envelope.record);
      continue;
    }
    await applyMemoRecord(envelope.record);
  }
};

export const syncMemoRecords = async (identity: SyncIdentity): Promise<{
  pushed: number;
  pulled: number;
}> => {
  const now = Date.now();
  let localRecords = await loadMemoSyncRecords();
  const localCleanup = await cleanupExpiredRemoteSyncEnvelopes(
    identity.userId,
    "memo",
    localRecords,
    now,
  );
  if (localCleanup.expiredEntityIds.length > 0) {
    await finalizeExpiredLocalSyncEntityRecords(
      "memo",
      localCleanup.keptRecords,
      localCleanup.expiredEntityIds,
    );
  }
  localRecords = localCleanup.keptRecords;
  const { firstError, pushedCount } = await syncQueuedEnvelopes(
    "memo",
    async (envelope) => {
      await pushSyncEnvelope(identity.userId, envelope);
    },
  );
  const pulledRemoteRecords = await pullSyncEnvelopes(identity.userId, "memo");
  const remoteCleanup = await cleanupExpiredRemoteSyncEnvelopes(
    identity.userId,
    "memo",
    pulledRemoteRecords,
    now,
  );
  const remoteRecords = remoteCleanup.keptRecords;
  const reconciliationPushes = findReconciliationPushes(localRecords, remoteRecords);
  let reconciliationError = firstError;
  let pushed = 0;

  for (const record of reconciliationPushes) {
    try {
      await pushSyncEnvelope(identity.userId, record);
      pushed += 1;
    } catch (error) {
      if (!reconciliationError) {
        reconciliationError =
          error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  const merged = mergeSyncEnvelopes(localRecords, remoteRecords);
  await applyMergedMemoEnvelopes(merged);
  await saveSyncEntityRecords("memo", merged);

  if (reconciliationError) {
    throw reconciliationError;
  }

  return {
    pushed: pushedCount + pushed,
    pulled: remoteRecords.length,
  };
};
