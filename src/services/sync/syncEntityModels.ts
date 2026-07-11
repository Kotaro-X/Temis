import type {
  LogEntry,
  MemoSyncRecord,
  ResearchSyncRecord,
  SyncEntityEnvelope,
  TaskMemo,
  TaskState,
  TaskSyncRecord,
  TodoSyncRecord,
} from "../../types";
import type { SlotKey } from "../../types";
import { CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION } from "./syncEnvelopeValidator";

const buildEnvelope = <TType extends SyncEntityEnvelope["entityType"]>(params: {
  entityType: TType;
  entityId: string;
  record: SyncEntityEnvelope<TType>["record"];
  updatedAt: number;
  deletedAt?: number | null;
  deviceId?: string | null;
}): SyncEntityEnvelope<TType> => ({
  schemaVersion: CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION,
  entityType: params.entityType,
  entityId: params.entityId,
  record: params.record,
  updatedAt: params.updatedAt,
  isDeleted: params.deletedAt != null,
  deletedAt: params.deletedAt ?? null,
  deviceId: params.deviceId ?? null,
});

export const buildTodoSyncEnvelope = (params: {
  todo: TodoSyncRecord;
  updatedAt?: number;
  deletedAt?: number | null;
  deviceId?: string | null;
}): SyncEntityEnvelope<"todo"> =>
  buildEnvelope({
    entityType: "todo",
    entityId: params.todo.id,
    record: params.todo,
    updatedAt: params.updatedAt ?? params.todo.doneAt ?? params.todo.createdAt,
    deletedAt: params.deletedAt ?? null,
    deviceId: params.deviceId ?? null,
  });

export const buildTaskSyncEnvelope = (params: {
  date: string;
  slotKey: SlotKey;
  task: TaskState;
  entityId?: string;
  updatedAt?: number;
  deletedAt?: number | null;
  deviceId?: string | null;
}): SyncEntityEnvelope<"task"> => {
  const record: TaskSyncRecord = {
    kind: "state",
    date: params.date,
    slotKey: params.slotKey,
    task: params.task,
  };
  return buildEnvelope({
    entityType: "task",
    entityId: params.entityId ?? `task:${params.task.id}`,
    record,
    updatedAt:
      params.updatedAt ??
      params.task.startAt ??
      Date.now(),
    deletedAt: params.deletedAt ?? null,
    deviceId: params.deviceId ?? null,
  });
};

export const buildTaskLogSyncEnvelope = (params: {
  log: LogEntry;
  entityId?: string;
  updatedAt?: number;
  deletedAt?: number | null;
  deviceId?: string | null;
}): SyncEntityEnvelope<"task"> => {
  const record: TaskSyncRecord = {
    kind: "log",
    log: params.log,
  };
  return buildEnvelope({
    entityType: "task",
    entityId: params.entityId ?? `log:${params.log.id}`,
    record,
    updatedAt: params.updatedAt ?? params.log.endedAt,
    deletedAt: params.deletedAt ?? null,
    deviceId: params.deviceId ?? null,
  });
};

export const buildTaskMemoSyncEnvelope = (params: {
  memo: TaskMemo;
  deletedAt?: number | null;
  deviceId?: string | null;
}): SyncEntityEnvelope<"memo"> => {
  const record: MemoSyncRecord = {
    kind: "taskMemo",
    data: params.memo,
  };
  return buildEnvelope({
    entityType: "memo",
    entityId: params.memo.id,
    record,
    updatedAt: params.memo.updatedAt,
    deletedAt: params.deletedAt ?? null,
    deviceId: params.deviceId ?? null,
  });
};

export const buildNoteSyncEnvelope = (params: {
  note: {
    id: string;
    type: "daily" | "free";
    date: string | null;
    title: string | null;
    body: string;
    updatedAt: number;
  };
  deletedAt?: number | null;
  deviceId?: string | null;
}): SyncEntityEnvelope<"memo"> => {
  const record: MemoSyncRecord = {
    kind: "note",
    data: params.note,
  };
  return buildEnvelope({
    entityType: "memo",
    entityId: params.note.id,
    record,
    updatedAt: params.note.updatedAt,
    deletedAt: params.deletedAt ?? null,
    deviceId: params.deviceId ?? null,
  });
};

export const buildResearchSyncEnvelope = (params: {
  note: ResearchSyncRecord;
  deletedAt?: number | null;
  deviceId?: string | null;
}): SyncEntityEnvelope<"memo"> => {
  const record: MemoSyncRecord = {
    kind: "research",
    data: params.note,
  };
  return buildEnvelope({
    entityType: "memo",
    entityId: params.note.id,
    record,
    updatedAt: params.note.updatedAt,
    deletedAt: params.deletedAt ?? null,
    deviceId: params.deviceId ?? null,
  });
};
