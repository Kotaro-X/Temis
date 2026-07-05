import { nanoid } from "nanoid/non-secure";

import {
  loadSimpleTodos,
  loadSyncDeviceId,
  saveSimpleTodos,
} from "../../storage";
import type { SimpleTodoItem, Tag, TodoRepeat } from "../types";
import { buildTodoSyncEnvelope } from "../services/sync/syncEntityModels";
import { persistAndEnqueueSyncEnvelope } from "../services/sync/syncEnvelopeStore";

export const loadTodos = async (): Promise<SimpleTodoItem[]> => loadSimpleTodos();

type SaveTodosOptions = {
  enqueueSync?: boolean;
};

const areTodosEqual = (left: SimpleTodoItem, right: SimpleTodoItem) =>
  JSON.stringify(left) === JSON.stringify(right);

export const saveTodos = async (
  items: SimpleTodoItem[],
  options?: SaveTodosOptions,
): Promise<void> => {
  const previousItems = await loadSimpleTodos();
  await saveSimpleTodos(items);
  if (options?.enqueueSync === false) {
    return;
  }

  const deviceId = await loadSyncDeviceId();
  const now = Date.now();
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  const nextById = new Map(items.map((item) => [item.id, item]));
  const syncJobs: Promise<void>[] = [];

  for (const item of items) {
    const previous = previousById.get(item.id);
    if (previous && areTodosEqual(previous, item)) {
      continue;
    }
    syncJobs.push(
      persistAndEnqueueSyncEnvelope(
        buildTodoSyncEnvelope({
          todo: item,
          updatedAt: now,
          deletedAt: item.isDeleted ? now : null,
          deviceId,
        }),
      ),
    );
  }

  for (const previous of previousItems) {
    if (nextById.has(previous.id)) {
      continue;
    }
    syncJobs.push(
      persistAndEnqueueSyncEnvelope(
        buildTodoSyncEnvelope({
          todo: {
            ...previous,
            isDeleted: true,
          },
          updatedAt: now,
          deletedAt: now,
          deviceId,
        }),
      ),
    );
  }

  await Promise.all(syncJobs);
};

export const createTodo = (input: {
  text: string;
  memo?: string;
  tags?: Tag[];
  reminderDate?: string | null;
  reminderTime?: string | null;
  repeat?: TodoRepeat;
}): SimpleTodoItem => {
  const id = nanoid();
  const repeat = input.repeat ?? "none";
  const reminderDate = input.reminderDate ?? null;
  return {
    id,
    text: input.text,
    memo: input.memo ?? "",
    tags: input.tags ?? [],
    isDone: false,
    createdAt: Date.now(),
    doneAt: null,
    reminderDate,
    reminderTime: input.reminderTime ?? null,
    repeat,
    notificationId: null,
    notificationIds: [],
    seriesId: repeat === "none" ? null : id,
    seriesAnchorDate: repeat === "none" ? null : reminderDate,
    occurrenceDate: null,
    isDeleted: false,
  };
};

export const updateTodo = (
  items: SimpleTodoItem[],
  todoId: string,
  updater: (item: SimpleTodoItem) => SimpleTodoItem,
): SimpleTodoItem[] =>
  items.map((item) => (item.id === todoId ? updater(item) : item));

export const toggleTodo = (
  items: SimpleTodoItem[],
  todoId: string,
): SimpleTodoItem[] =>
  updateTodo(items, todoId, (item) => ({
    ...item,
    isDone: !item.isDone,
    doneAt: item.isDone ? null : Date.now(),
  }));

export const deleteTodo = (
  items: SimpleTodoItem[],
  todoId: string,
): SimpleTodoItem[] => items.filter((item) => item.id !== todoId);
