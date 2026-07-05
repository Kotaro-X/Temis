import type { TaskMemo } from "./memo";
import type { TagRecord } from "./tag";
import type { LogEntry, TaskState } from "./task";
import type { SlotKey } from "./timer";
import type { SimpleTodoItem } from "./todo";

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

export type SyncEntityType = "tag" | "todo" | "task" | "memo";
export type SyncOperation = "upsert";
export type SyncCapabilityStatus = "enabled" | "planned";

export type SyncMetadata = {
  updatedAt?: number | null;
  deletedAt?: number | null;
  syncStatus?: SyncStatus;
  deviceId?: string | null;
  lastSyncedAt?: number | null;
};

export type SyncResult = {
  status: Exclude<SyncStatus, "idle">;
  syncedAt: number;
  message?: string;
};

export type SyncIdentity = {
  userId: string;
  deviceId: string;
};

export type TodoSyncRecord = SimpleTodoItem;

export type TaskSyncRecord = {
  kind: "state";
  date: string;
  slotKey: SlotKey;
  task: TaskState;
} | {
  kind: "log";
  log: LogEntry;
};

export type NoteSyncRecord = {
  id: string;
  type: "daily" | "free";
  date: string | null;
  title: string | null;
  body: string;
  updatedAt: number;
};

export type ResearchSyncRecord = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  weekId: string;
  weeklyPromptId: string;
};

export type MemoSyncRecord =
  | {
      kind: "taskMemo";
      data: TaskMemo;
    }
  | {
      kind: "note";
      data: NoteSyncRecord;
    }
  | {
      kind: "research";
      data: ResearchSyncRecord;
    };

export type SyncPayloadByEntity = {
  tag: { record: TagRecord };
  todo: { record: TodoSyncRecord };
  task: { record: TaskSyncRecord };
  memo: { record: MemoSyncRecord };
};

export type SyncEntityEnvelope<TType extends SyncEntityType = SyncEntityType> = {
  entityType: TType;
  entityId: string;
  record: SyncPayloadByEntity[TType]["record"];
  updatedAt: number;
  deletedAt: number | null;
  deviceId: string | null;
};

export type SyncCapabilities = Record<SyncEntityType, SyncCapabilityStatus>;

export type SyncQueueItem<TPayload = unknown> = {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  payload: TPayload;
  createdAt: number;
  updatedAt: number;
  attemptCount: number;
  lastError: string | null;
  nextRetryAt: number;
};
