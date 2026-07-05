import { loadSyncEntityRecords } from "../../storage";
import { upsertMemoRecord } from "../db/memoRepo";
import { upsertNoteRecord } from "../db/noteRepo";
import * as taskRepository from "../repositories/taskRepository";
import * as todoRepository from "../repositories/todoRepository";
import {
  buildNoteSyncEnvelope,
  buildResearchSyncEnvelope,
  buildTaskMemoSyncEnvelope,
} from "./sync/syncEntityModels";
import { getOrCreateDeviceId } from "./sync/syncIdentity";
import { persistAndEnqueueSyncEnvelope } from "./sync/syncEnvelopeStore";
import { upsertResearchNoteRecord } from "./researchNoteService";
import { DELETED_ITEM_RETENTION_MS } from "./sync/syncRetention";
import type {
  MemoSyncRecord,
  NoteSyncRecord,
  ResearchSyncRecord,
  SimpleTodoItem,
  SyncEntityEnvelope,
  TaskMemo,
  TaskSyncRecord,
  TodoSyncRecord,
} from "../types";
import { SLOT_KEYS, type TodayState } from "../types";

export type DeletedItemKind = "todo" | "task" | "taskMemo" | "note" | "research";

type DeletedTaskRecord = Extract<TaskSyncRecord, { kind: "state" }>;

export type DeletedItem = {
  key: string;
  kind: DeletedItemKind;
  entityId: string;
  title: string;
  detail: string | null;
  deletedAt: number;
  expiresAt: number;
  payload:
    | TodoSyncRecord
    | DeletedTaskRecord
    | MemoSyncRecord;
};

const truncate = (value: string, maxLength = 80) => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
};

const isRestorable = (deletedAt: number, now: number) =>
  deletedAt + DELETED_ITEM_RETENTION_MS > now;

const buildTodoDeletedItem = (
  envelope: SyncEntityEnvelope<"todo">,
  deletedAt: number,
): DeletedItem => ({
  key: `todo:${envelope.entityId}:${deletedAt}`,
  kind: "todo",
  entityId: envelope.entityId,
  title: truncate(envelope.record.text) || "Untitled ToDo",
  detail: envelope.record.reminderDate ?? null,
  deletedAt,
  expiresAt: deletedAt + DELETED_ITEM_RETENTION_MS,
  payload: envelope.record,
});

const buildTaskDeletedItem = (
  envelope: SyncEntityEnvelope<"task">,
  deletedAt: number,
): DeletedItem | null => {
  if (envelope.record.kind !== "state") {
    return null;
  }
  return {
    key: `task:${envelope.entityId}:${deletedAt}`,
    kind: "task",
    entityId: envelope.entityId,
    title: truncate(envelope.record.task.taskName) || "Untitled Task",
    detail: `${envelope.record.date} / ${envelope.record.slotKey}`,
    deletedAt,
    expiresAt: deletedAt + DELETED_ITEM_RETENTION_MS,
    payload: envelope.record,
  };
};

const buildMemoDeletedItem = (
  envelope: SyncEntityEnvelope<"memo">,
  deletedAt: number,
): DeletedItem => {
  if (envelope.record.kind === "taskMemo") {
    return {
      key: `taskMemo:${envelope.entityId}:${deletedAt}`,
      kind: "taskMemo",
      entityId: envelope.entityId,
      title: truncate(envelope.record.data.body) || "Task Memo",
      detail: envelope.record.data.taskId,
      deletedAt,
      expiresAt: deletedAt + DELETED_ITEM_RETENTION_MS,
      payload: envelope.record,
    };
  }
  if (envelope.record.kind === "note") {
    return {
      key: `note:${envelope.entityId}:${deletedAt}`,
      kind: "note",
      entityId: envelope.entityId,
      title:
        truncate(
          envelope.record.data.type === "daily"
            ? envelope.record.data.date ?? ""
            : envelope.record.data.title ?? "",
        ) || truncate(envelope.record.data.body) || "Note",
      detail: envelope.record.data.type,
      deletedAt,
      expiresAt: deletedAt + DELETED_ITEM_RETENTION_MS,
      payload: envelope.record,
    };
  }
  return {
    key: `research:${envelope.entityId}:${deletedAt}`,
    kind: "research",
    entityId: envelope.entityId,
    title:
      truncate(envelope.record.data.title) ||
      truncate(envelope.record.data.body) ||
      "Research Note",
    detail: envelope.record.data.weekId || null,
    deletedAt,
    expiresAt: deletedAt + DELETED_ITEM_RETENTION_MS,
    payload: envelope.record,
  };
};

export const loadDeletedItems = async (
  now = Date.now(),
): Promise<DeletedItem[]> => {
  const [todoEnvelopes, taskEnvelopes, memoEnvelopes] = await Promise.all([
    loadSyncEntityRecords("todo"),
    loadSyncEntityRecords("task"),
    loadSyncEntityRecords("memo"),
  ]);

  const items: DeletedItem[] = [];

  for (const envelope of todoEnvelopes) {
    const deletedAt = envelope.deletedAt;
    if (deletedAt === null || !isRestorable(deletedAt, now)) {
      continue;
    }
    items.push(buildTodoDeletedItem(envelope, deletedAt));
  }

  for (const envelope of taskEnvelopes) {
    const deletedAt = envelope.deletedAt;
    if (deletedAt === null || !isRestorable(deletedAt, now)) {
      continue;
    }
    const item = buildTaskDeletedItem(envelope, deletedAt);
    if (item) {
      items.push(item);
    }
  }

  for (const envelope of memoEnvelopes) {
    const deletedAt = envelope.deletedAt;
    if (deletedAt === null || !isRestorable(deletedAt, now)) {
      continue;
    }
    items.push(buildMemoDeletedItem(envelope, deletedAt));
  }

  return items.sort((left, right) => right.deletedAt - left.deletedAt);
};

const upsertTodo = async (todo: SimpleTodoItem) => {
  const todos = await todoRepository.loadTodos();
  const nextTodos = [
    { ...todo, isDeleted: false },
    ...todos.filter((item) => item.id !== todo.id),
  ];
  await todoRepository.saveTodos(nextTodos);
};

const upsertTaskIntoState = (state: TodayState, record: DeletedTaskRecord): TodayState => {
  const slots = SLOT_KEYS.reduce(
    (acc, slotKey) => {
      const slot = state.slots[slotKey];
      acc[slotKey] = {
        ...slot,
        tasks: slot.tasks.filter((task) => task.id !== record.task.id),
      };
      return acc;
    },
    {} as TodayState["slots"],
  );

  const targetSlot = slots[record.slotKey];
  return {
    ...state,
    slots: {
      ...slots,
      [record.slotKey]: {
        ...targetSlot,
        tasks: [...targetSlot.tasks, record.task],
      },
    },
  };
};

const restoreTask = async (record: DeletedTaskRecord) => {
  const state = await taskRepository.loadTasks(record.date);
  const nextState = upsertTaskIntoState(state, record);
  await taskRepository.saveTasks(nextState);
};

const restoreTaskMemo = async (record: TaskMemo) => {
  const deviceId = await getOrCreateDeviceId();
  const restored = {
    ...record,
    updatedAt: Date.now(),
  };
  await upsertMemoRecord(restored);
  await persistAndEnqueueSyncEnvelope(
    buildTaskMemoSyncEnvelope({
      memo: restored,
      deviceId,
    }),
  );
};

const restoreNote = async (record: NoteSyncRecord) => {
  const deviceId = await getOrCreateDeviceId();
  const restored = {
    ...record,
    updatedAt: Date.now(),
  };
  await upsertNoteRecord(restored);
  await persistAndEnqueueSyncEnvelope(
    buildNoteSyncEnvelope({
      note: restored,
      deviceId,
    }),
  );
};

const restoreResearch = async (record: ResearchSyncRecord) => {
  const deviceId = await getOrCreateDeviceId();
  const restored = {
    ...record,
    updatedAt: Date.now(),
  };
  await upsertResearchNoteRecord(restored);
  await persistAndEnqueueSyncEnvelope(
    buildResearchSyncEnvelope({
      note: restored,
      deviceId,
    }),
  );
};

export const restoreDeletedItem = async (
  item: DeletedItem,
  now = Date.now(),
): Promise<boolean> => {
  if (!isRestorable(item.deletedAt, now)) {
    return false;
  }

  if (item.kind === "todo") {
    await upsertTodo(item.payload as TodoSyncRecord);
    return true;
  }

  if (item.kind === "task") {
    await restoreTask(item.payload as DeletedTaskRecord);
    return true;
  }

  if (item.kind === "taskMemo") {
    await restoreTaskMemo((item.payload as Extract<MemoSyncRecord, { kind: "taskMemo" }>).data);
    return true;
  }

  if (item.kind === "note") {
    await restoreNote((item.payload as Extract<MemoSyncRecord, { kind: "note" }>).data);
    return true;
  }

  await restoreResearch((item.payload as Extract<MemoSyncRecord, { kind: "research" }>).data);
  return true;
};
