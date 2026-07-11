import { loadSyncEntityRecords, saveSyncEntityRecords } from "../../../storage";
import * as todoRepository from "../../repositories/todoRepository";
import type {
  SyncEntityEnvelope,
  SyncIdentity,
  TodoSyncRecord,
} from "../../types";
import { buildTodoSyncEnvelope } from "./syncEntityModels";
import { runEnvelopeEntitySync } from "./syncEntityRunner";

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
}> =>
  runEnvelopeEntitySync(
    identity,
    "todo",
    loadTodoSyncRecords,
    applyMergedTodoEnvelopes,
  );
