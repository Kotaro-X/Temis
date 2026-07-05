import { loadSyncEntityRecords, saveSyncEntityRecords } from "../../../storage";
import * as todoRepository from "../../repositories/todoRepository";
import type {
  SyncEntityEnvelope,
  SyncIdentity,
  TodoSyncRecord,
} from "../../types";
import { pullSyncEnvelopes, pushSyncEnvelope } from "./firestoreSyncAdapter";
import { buildTodoSyncEnvelope } from "./syncEntityModels";
import { mergeSyncEnvelopes } from "./syncEnvelopeStore";
import {
  cleanupExpiredRemoteSyncEnvelopes,
  finalizeExpiredLocalSyncEntityRecords,
} from "./syncRetention";
import {
  findReconciliationPushes,
  syncQueuedEnvelopes,
} from "./syncQueueProcessor";

const buildBootstrapTodoRecords = async (): Promise<
  SyncEntityEnvelope<"todo">[]
> => {
  const todos = await todoRepository.loadTodos();
  return todos.map((todo) =>
    buildTodoSyncEnvelope({
      todo,
      updatedAt: todo.doneAt ?? todo.createdAt,
      deletedAt: todo.isDeleted ? todo.doneAt ?? todo.createdAt : null,
      deviceId: null,
    }),
  );
};

const loadTodoSyncRecords = async (): Promise<SyncEntityEnvelope<"todo">[]> => {
  const existing = await loadSyncEntityRecords("todo");
  if (existing.length > 0) {
    return existing;
  }
  const bootstrapped = await buildBootstrapTodoRecords();
  if (bootstrapped.length > 0) {
    await saveSyncEntityRecords("todo", bootstrapped);
  }
  return bootstrapped;
};

const applyMergedTodoEnvelopes = async (
  records: SyncEntityEnvelope<"todo">[],
): Promise<void> => {
  const nextTodos: TodoSyncRecord[] = [];
  for (const envelope of records) {
    const todo = envelope.record;
    if (envelope.deletedAt !== null) {
      if (todo.occurrenceDate) {
        nextTodos.push({ ...todo, isDeleted: true });
      }
      continue;
    }
    nextTodos.push({ ...todo, isDeleted: false });
  }
  nextTodos.sort((left, right) => right.createdAt - left.createdAt);
  await todoRepository.saveTodos(nextTodos, { enqueueSync: false });
};

export const syncTodoRecords = async (identity: SyncIdentity): Promise<{
  pushed: number;
  pulled: number;
}> => {
  const now = Date.now();
  let localRecords = await loadTodoSyncRecords();
  const localCleanup = await cleanupExpiredRemoteSyncEnvelopes(
    identity.userId,
    "todo",
    localRecords,
    now,
  );
  if (localCleanup.expiredEntityIds.length > 0) {
    await finalizeExpiredLocalSyncEntityRecords(
      "todo",
      localCleanup.keptRecords,
      localCleanup.expiredEntityIds,
    );
  }
  localRecords = localCleanup.keptRecords;
  const { firstError, pushedCount } = await syncQueuedEnvelopes(
    "todo",
    async (envelope) => {
      await pushSyncEnvelope(identity.userId, envelope);
    },
  );
  const pulledRemoteRecords = await pullSyncEnvelopes(identity.userId, "todo");
  const remoteCleanup = await cleanupExpiredRemoteSyncEnvelopes(
    identity.userId,
    "todo",
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
  await applyMergedTodoEnvelopes(merged);
  await saveSyncEntityRecords("todo", merged);

  if (reconciliationError) {
    throw reconciliationError;
  }

  return {
    pushed: pushedCount + pushed,
    pulled: remoteRecords.length,
  };
};
