import type {
  SimpleTodoItem,
  SyncEntityEnvelope,
  SyncEntityType,
  SyncQueueItem,
  TagRecord,
} from "../../types";

export const DELETED_ITEM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const loadStorageModule = () => import("../../../storage.ts");

export const getDeletionTimestampForTodo = (todo: SimpleTodoItem) =>
  todo.doneAt ?? todo.createdAt;

export const isDeletionExpired = (
  deletedAt: number | null | undefined,
  now: number,
): deletedAt is number =>
  typeof deletedAt === "number" && deletedAt + DELETED_ITEM_RETENTION_MS <= now;

export const pruneExpiredDeletedTodos = (
  todos: SimpleTodoItem[],
  now: number,
): { keptTodos: SimpleTodoItem[]; removedTodoIds: string[] } => {
  const keptTodos: SimpleTodoItem[] = [];
  const removedTodoIds: string[] = [];

  for (const todo of todos) {
    if (todo.isDeleted && isDeletionExpired(getDeletionTimestampForTodo(todo), now)) {
      removedTodoIds.push(todo.id);
      continue;
    }
    keptTodos.push(todo);
  }

  return { keptTodos, removedTodoIds };
};

export const pruneExpiredDeletedEnvelopes = <
  TType extends Exclude<SyncEntityType, "tag">,
>(
  records: SyncEntityEnvelope<TType>[],
  now: number,
): {
  keptRecords: SyncEntityEnvelope<TType>[];
  expiredRecords: SyncEntityEnvelope<TType>[];
  expiredEntityIds: string[];
} => {
  const keptRecords: SyncEntityEnvelope<TType>[] = [];
  const expiredRecords: SyncEntityEnvelope<TType>[] = [];

  for (const record of records) {
    if (isDeletionExpired(record.deletedAt, now)) {
      expiredRecords.push(record);
      continue;
    }
    keptRecords.push(record);
  }

  return {
    keptRecords,
    expiredRecords,
    expiredEntityIds: expiredRecords.map((record) => record.entityId),
  };
};

export const pruneExpiredDeletedTagRecords = (
  records: TagRecord[],
  now: number,
): {
  keptRecords: TagRecord[];
  expiredRecords: TagRecord[];
  expiredEntityIds: string[];
} => {
  const keptRecords: TagRecord[] = [];
  const expiredRecords: TagRecord[] = [];

  for (const record of records) {
    if (isDeletionExpired(record.deletedAt, now)) {
      expiredRecords.push(record);
      continue;
    }
    keptRecords.push(record);
  }

  return {
    keptRecords,
    expiredRecords,
    expiredEntityIds: expiredRecords.map((record) => record.id),
  };
};

export const pruneSyncQueueItems = (
  queue: SyncQueueItem[],
  entityType: SyncEntityType,
  entityIds: Set<string>,
) =>
  queue.filter(
    (item) => item.entityType !== entityType || !entityIds.has(item.entityId),
  );

export const cleanupExpiredDeletedTodoStorage = async (
  now = Date.now(),
): Promise<string[]> => {
  const { loadSimpleTodos, saveSimpleTodos } = await loadStorageModule();
  const todos = await loadSimpleTodos();
  const { keptTodos, removedTodoIds } = pruneExpiredDeletedTodos(todos, now);
  if (removedTodoIds.length > 0) {
    await saveSimpleTodos(keptTodos);
  }
  return removedTodoIds;
};

export const cleanupExpiredLocalDeletedState = async (
  now = Date.now(),
): Promise<{
  todoIds: string[];
  taskIds: string[];
  memoIds: string[];
  tagIds: string[];
}> => {
  const {
    loadSimpleTodos,
    loadSyncEntityRecords,
    loadSyncQueue,
    loadTagRecords,
    saveSimpleTodos,
    saveSyncEntityRecords,
    saveSyncQueue,
    saveTagRecords,
  } = await loadStorageModule();
  const [todos, todoRecords, taskRecords, memoRecords, tagRecords, queue] =
    await Promise.all([
      loadSimpleTodos(),
      loadSyncEntityRecords("todo"),
      loadSyncEntityRecords("task"),
      loadSyncEntityRecords("memo"),
      loadTagRecords(),
      loadSyncQueue(),
    ]);

  const todoCleanup = pruneExpiredDeletedTodos(todos, now);
  const todoRecordCleanup = pruneExpiredDeletedEnvelopes(todoRecords, now);
  const taskCleanup = pruneExpiredDeletedEnvelopes(taskRecords, now);
  const memoCleanup = pruneExpiredDeletedEnvelopes(memoRecords, now);
  const tagCleanup = pruneExpiredDeletedTagRecords(tagRecords, now);

  const expiredTodoIds = new Set([
    ...todoCleanup.removedTodoIds,
    ...todoRecordCleanup.expiredEntityIds,
  ]);
  const nextTodos =
    expiredTodoIds.size === 0
      ? todos
      : todos.filter((todo) => !(todo.isDeleted && expiredTodoIds.has(todo.id)));

  let nextQueue = queue;
  if (expiredTodoIds.size > 0) {
    nextQueue = pruneSyncQueueItems(nextQueue, "todo", expiredTodoIds);
  }
  if (taskCleanup.expiredEntityIds.length > 0) {
    nextQueue = pruneSyncQueueItems(
      nextQueue,
      "task",
      new Set(taskCleanup.expiredEntityIds),
    );
  }
  if (memoCleanup.expiredEntityIds.length > 0) {
    nextQueue = pruneSyncQueueItems(
      nextQueue,
      "memo",
      new Set(memoCleanup.expiredEntityIds),
    );
  }
  if (tagCleanup.expiredEntityIds.length > 0) {
    nextQueue = pruneSyncQueueItems(
      nextQueue,
      "tag",
      new Set(tagCleanup.expiredEntityIds),
    );
  }

  const saveJobs: Promise<void>[] = [];

  if (nextTodos.length !== todos.length) {
    saveJobs.push(saveSimpleTodos(nextTodos));
  }
  if (todoRecordCleanup.keptRecords.length !== todoRecords.length) {
    saveJobs.push(saveSyncEntityRecords("todo", todoRecordCleanup.keptRecords));
  }
  if (taskCleanup.keptRecords.length !== taskRecords.length) {
    saveJobs.push(saveSyncEntityRecords("task", taskCleanup.keptRecords));
  }
  if (memoCleanup.keptRecords.length !== memoRecords.length) {
    saveJobs.push(saveSyncEntityRecords("memo", memoCleanup.keptRecords));
  }
  if (tagCleanup.keptRecords.length !== tagRecords.length) {
    saveJobs.push(saveTagRecords(tagCleanup.keptRecords));
  }
  if (nextQueue.length !== queue.length) {
    saveJobs.push(saveSyncQueue(nextQueue));
  }

  if (saveJobs.length > 0) {
    await Promise.all(saveJobs);
  }

  return {
    todoIds: [...expiredTodoIds],
    taskIds: taskCleanup.expiredEntityIds,
    memoIds: memoCleanup.expiredEntityIds,
    tagIds: tagCleanup.expiredEntityIds,
  };
};

const finalizeExpiredQueueItems = async (
  entityType: SyncEntityType,
  expiredEntityIds: string[],
) => {
  if (expiredEntityIds.length === 0) {
    return;
  }
  const { loadSyncQueue, saveSyncQueue } = await loadStorageModule();
  const queue = await loadSyncQueue();
  const nextQueue = pruneSyncQueueItems(queue, entityType, new Set(expiredEntityIds));
  if (nextQueue.length !== queue.length) {
    await saveSyncQueue(nextQueue);
  }
};

export const finalizeExpiredLocalSyncEntityRecords = async <
  TType extends Exclude<SyncEntityType, "tag">,
>(
  entityType: TType,
  keptRecords: SyncEntityEnvelope<TType>[],
  expiredEntityIds: string[],
): Promise<void> => {
  if (expiredEntityIds.length === 0) {
    return;
  }
  const { loadSimpleTodos, saveSimpleTodos, saveSyncEntityRecords } =
    await loadStorageModule();
  await saveSyncEntityRecords(entityType, keptRecords);
  await finalizeExpiredQueueItems(entityType, expiredEntityIds);
  if (entityType !== "todo") {
    return;
  }
  const todos = await loadSimpleTodos();
  const expiredTodoIds = new Set(expiredEntityIds);
  const nextTodos = todos.filter(
    (todo) => !(todo.isDeleted && expiredTodoIds.has(todo.id)),
  );
  if (nextTodos.length !== todos.length) {
    await saveSimpleTodos(nextTodos);
  }
};

export const finalizeExpiredLocalTagRecords = async (
  keptRecords: TagRecord[],
  expiredEntityIds: string[],
): Promise<void> => {
  if (expiredEntityIds.length === 0) {
    return;
  }
  const { saveTagRecords } = await loadStorageModule();
  await saveTagRecords(keptRecords);
  await finalizeExpiredQueueItems("tag", expiredEntityIds);
};

export const cleanupExpiredRemoteSyncEnvelopes = async <
  TType extends Exclude<SyncEntityType, "tag">,
>(
  userId: string,
  entityType: TType,
  records: SyncEntityEnvelope<TType>[],
  now: number,
) => {
  const result = pruneExpiredDeletedEnvelopes(records, now);
  if (result.expiredEntityIds.length > 0) {
    const { deleteSyncEnvelope } = await import("./firestoreSyncAdapter.ts");
    await Promise.all(
      result.expiredEntityIds.map((entityId) =>
        deleteSyncEnvelope(userId, entityType, entityId),
      ),
    );
  }
  return result;
};

export const cleanupExpiredRemoteTagRecords = async (
  userId: string,
  records: TagRecord[],
  now: number,
) => {
  const result = pruneExpiredDeletedTagRecords(records, now);
  if (result.expiredEntityIds.length > 0) {
    const { deleteTagRecord } = await import("./firestoreTagAdapter.ts");
    await Promise.all(
      result.expiredEntityIds.map((entityId) => deleteTagRecord(userId, entityId)),
    );
  }
  return result;
};
