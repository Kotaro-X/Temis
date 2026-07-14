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
import {
  buildNoteSyncEnvelope,
  buildResearchSyncEnvelope,
  buildTaskMemoSyncEnvelope,
} from "./syncEntityModels";
import { runEnvelopeEntitySync } from "./syncEntityRunner";
import type { SyncRunDiagnosticContext } from "./syncDiagnosticObserver";

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

export const syncMemoRecords = async (
  identity: SyncIdentity,
  diagnosticContext: SyncRunDiagnosticContext,
): Promise<{
  pushed: number;
  pulled: number;
}> =>
  runEnvelopeEntitySync(
    identity,
    "memo",
    loadMemoSyncRecords,
    applyMergedMemoEnvelopes,
    diagnosticContext,
  );
