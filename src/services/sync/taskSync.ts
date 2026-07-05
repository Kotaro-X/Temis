import { loadSyncEntityRecords, saveSyncEntityRecords } from "../../../storage";
import * as taskRepository from "../../repositories/taskRepository";
import type {
  SyncEntityEnvelope,
  SyncIdentity,
  TaskSyncRecord,
  TodayState,
} from "../../types";
import { SLOT_KEYS } from "../../types";
import { pullSyncEnvelopes, pushSyncEnvelope } from "./firestoreSyncAdapter";
import {
  buildTaskLogSyncEnvelope,
  buildTaskSyncEnvelope,
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

const inferTaskUpdatedAt = (record: {
  date: string;
  task: { id: string; startAt: number | null };
}) => {
  const idTimestamp = Number(record.task.id.split("-")[0]);
  const dateTimestamp = new Date(`${record.date}T00:00:00`).getTime();
  return Math.max(
    Number.isFinite(idTimestamp) ? idTimestamp : 0,
    record.task.startAt ?? 0,
    dateTimestamp,
  );
};

const buildBootstrapTaskRecords = async (): Promise<
  SyncEntityEnvelope<"task">[]
> => {
  const [states, logs] = await Promise.all([
    taskRepository.loadAllTaskStates(),
    taskRepository.loadTaskLogs(),
  ]);
  const taskRecords = states.flatMap((state) =>
    SLOT_KEYS.flatMap((slotKey) =>
      state.slots[slotKey].tasks.map((task) =>
        buildTaskSyncEnvelope({
          date: state.date,
          slotKey,
          task,
          updatedAt: inferTaskUpdatedAt({ date: state.date, task }),
          deviceId: null,
        }),
      ),
    ),
  );
  const logRecords = logs.map((log) =>
    buildTaskLogSyncEnvelope({
      log,
      updatedAt: log.endedAt,
      deviceId: null,
    }),
  );
  return [...taskRecords, ...logRecords];
};

const loadTaskSyncRecords = async (): Promise<SyncEntityEnvelope<"task">[]> => {
  const existing = await loadSyncEntityRecords("task");
  if (existing.length > 0) {
    return existing;
  }
  const bootstrapped = await buildBootstrapTaskRecords();
  if (bootstrapped.length > 0) {
    await saveSyncEntityRecords("task", bootstrapped);
  }
  return bootstrapped;
};

const buildGroupedStates = (records: SyncEntityEnvelope<"task">[]) => {
  const byDate = new Map<string, TodayState>();
  for (const envelope of records) {
    if (envelope.deletedAt !== null || envelope.record.kind !== "state") {
      continue;
    }
    const { date, slotKey, task } = envelope.record;
    const current =
      byDate.get(date) ??
      ({
        date,
        slots: SLOT_KEYS.reduce(
          (acc, key) => {
            acc[key] = { tasks: [] };
            return acc;
          },
          {} as TodayState["slots"],
        ),
      } satisfies TodayState);
    current.slots[slotKey].tasks = [
      ...current.slots[slotKey].tasks.filter((entry) => entry.id !== task.id),
      task,
    ];
    byDate.set(date, current);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

const applyMergedTaskEnvelopes = async (
  records: SyncEntityEnvelope<"task">[],
): Promise<void> => {
  const nextStates = buildGroupedStates(records);
  const nextLogs = records
    .filter(
      (envelope): envelope is SyncEntityEnvelope<"task"> & {
        record: Extract<TaskSyncRecord, { kind: "log" }>;
      } => envelope.deletedAt === null && envelope.record.kind === "log",
    )
    .map((envelope) => envelope.record.log)
    .sort((left, right) => left.endedAt - right.endedAt);

  await taskRepository.replaceAllTaskStates(nextStates);
  await taskRepository.saveTaskLogs(nextLogs, { enqueueSync: false });
};

export const syncTaskRecords = async (identity: SyncIdentity): Promise<{
  pushed: number;
  pulled: number;
}> => {
  const now = Date.now();
  let localRecords = await loadTaskSyncRecords();
  const localCleanup = await cleanupExpiredRemoteSyncEnvelopes(
    identity.userId,
    "task",
    localRecords,
    now,
  );
  if (localCleanup.expiredEntityIds.length > 0) {
    await finalizeExpiredLocalSyncEntityRecords(
      "task",
      localCleanup.keptRecords,
      localCleanup.expiredEntityIds,
    );
  }
  localRecords = localCleanup.keptRecords;
  const { firstError, pushedCount } = await syncQueuedEnvelopes(
    "task",
    async (envelope) => {
      await pushSyncEnvelope(identity.userId, envelope);
    },
  );
  const pulledRemoteRecords = await pullSyncEnvelopes(identity.userId, "task");
  const remoteCleanup = await cleanupExpiredRemoteSyncEnvelopes(
    identity.userId,
    "task",
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
  await applyMergedTaskEnvelopes(merged);
  await saveSyncEntityRecords("task", merged);

  if (reconciliationError) {
    throw reconciliationError;
  }

  return {
    pushed: pushedCount + pushed,
    pulled: remoteRecords.length,
  };
};
