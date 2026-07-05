import {
  createEmptyTask as createEmptyTaskState,
  loadAllTodayStates,
  loadLogs as loadStoredLogs,
  loadSyncDeviceId,
  loadTodayState,
  saveAllTodayStates,
  saveLogs as saveStoredLogs,
  saveTodayState,
} from "../../storage";
import type {
  LogEntry,
  SlotKey,
  SlotState,
  Tag,
  TaskState,
  TodayState,
} from "../types";
import {
  buildTaskLogSyncEnvelope,
  buildTaskSyncEnvelope,
} from "../services/sync/syncEntityModels";
import { persistAndEnqueueSyncEnvelope } from "../services/sync/syncEnvelopeStore";
import { SLOT_KEYS } from "../types";

export const loadTasks = async (
  date: string,
  defaultTag?: Tag,
): Promise<TodayState> => loadTodayState(date, defaultTag);

type SaveTasksOptions = {
  enqueueSync?: boolean;
};

type SaveTaskLogsOptions = {
  enqueueSync?: boolean;
};

const flattenStateTasks = (state: TodayState) =>
  SLOT_KEYS.flatMap((slotKey) =>
    state.slots[slotKey].tasks.map((task) => ({ slotKey, task })),
  );

const areTasksEqual = (left: TaskState, right: TaskState) =>
  JSON.stringify(left) === JSON.stringify(right);

const areLogsEqual = (left: LogEntry, right: LogEntry) =>
  JSON.stringify(left) === JSON.stringify(right);

export const saveTasks = async (
  state: TodayState,
  options?: SaveTasksOptions,
): Promise<void> => {
  const previousState = await loadTodayState(state.date);
  await saveTodayState(state);
  if (options?.enqueueSync === false) {
    return;
  }

  const deviceId = await loadSyncDeviceId();
  const now = Date.now();
  const previousById = new Map(
    flattenStateTasks(previousState).map(({ slotKey, task }) => [task.id, { slotKey, task }]),
  );
  const nextById = new Map(
    flattenStateTasks(state).map(({ slotKey, task }) => [task.id, { slotKey, task }]),
  );
  const syncJobs: Promise<void>[] = [];

  for (const { slotKey, task } of flattenStateTasks(state)) {
    const previous = previousById.get(task.id);
    if (
      previous &&
      previous.slotKey === slotKey &&
      areTasksEqual(previous.task, task)
    ) {
      continue;
    }
    syncJobs.push(
      persistAndEnqueueSyncEnvelope(
        buildTaskSyncEnvelope({
          date: state.date,
          slotKey,
          task,
          updatedAt: now,
          deletedAt: null,
          deviceId,
        }),
      ),
    );
  }

  for (const [taskId, previous] of previousById) {
    if (nextById.has(taskId)) {
      continue;
    }
    syncJobs.push(
      persistAndEnqueueSyncEnvelope(
        buildTaskSyncEnvelope({
          date: previousState.date,
          slotKey: previous.slotKey,
          task: previous.task,
          updatedAt: now,
          deletedAt: now,
          deviceId,
        }),
      ),
    );
  }

  await Promise.all(syncJobs);
};

export const loadTaskLogs = async (): Promise<LogEntry[]> => loadStoredLogs();

export const saveTaskLogs = async (
  logs: LogEntry[],
  options?: SaveTaskLogsOptions,
): Promise<void> => {
  const previousLogs = await loadStoredLogs();
  await saveStoredLogs(logs);
  if (options?.enqueueSync === false) {
    return;
  }

  const deviceId = await loadSyncDeviceId();
  const now = Date.now();
  const previousById = new Map(previousLogs.map((log) => [log.id, log]));
  const nextById = new Map(logs.map((log) => [log.id, log]));
  const syncJobs: Promise<void>[] = [];

  for (const log of logs) {
    const previous = previousById.get(log.id);
    if (previous && areLogsEqual(previous, log)) {
      continue;
    }
    syncJobs.push(
      persistAndEnqueueSyncEnvelope(
        buildTaskLogSyncEnvelope({
          log,
          updatedAt: log.endedAt || now,
          deletedAt: null,
          deviceId,
        }),
      ),
    );
  }

  for (const previous of previousLogs) {
    if (nextById.has(previous.id)) {
      continue;
    }
    syncJobs.push(
      persistAndEnqueueSyncEnvelope(
        buildTaskLogSyncEnvelope({
          log: previous,
          updatedAt: now,
          deletedAt: now,
          deviceId,
        }),
      ),
    );
  }

  await Promise.all(syncJobs);
};

export const createTask = (
  state: TodayState,
  slotKey: SlotKey,
  defaultTag?: Tag,
): { nextState: TodayState; task: TaskState } => {
  const task = createEmptyTaskState(defaultTag);
  return {
    task,
    nextState: {
      ...state,
      slots: {
        ...state.slots,
        [slotKey]: {
          ...state.slots[slotKey],
          tasks: [...state.slots[slotKey].tasks, task],
        },
      },
    },
  };
};

export const updateTask = (
  state: TodayState,
  slotKey: SlotKey,
  taskId: string,
  updater: (task: TaskState) => TaskState,
): TodayState => ({
  ...state,
  slots: {
    ...state.slots,
    [slotKey]: {
      ...state.slots[slotKey],
      tasks: state.slots[slotKey].tasks.map((task) =>
        task.id === taskId ? updater(task) : task,
      ),
    },
  },
});

export const deleteTask = (
  state: TodayState,
  taskId: string,
): TodayState => {
  const nextSlots = SLOT_KEYS.reduce(
    (acc, slotKey) => {
      const slot = state.slots[slotKey];
      acc[slotKey] = {
        ...slot,
        tasks: slot.tasks.filter((task) => task.id !== taskId),
      };
      return acc;
    },
    {} as Record<SlotKey, SlotState>,
  );
  return { ...state, slots: nextSlots };
};

export const moveTask = async (params: {
  currentState: TodayState;
  taskId: string;
  fromSlotKey: SlotKey;
  targetDate: string;
  targetSlotKey: SlotKey;
  defaultTag?: Tag;
}): Promise<{
  sourceState: TodayState;
  targetState?: TodayState;
}> => {
  const { currentState, taskId, fromSlotKey, targetDate, targetSlotKey, defaultTag } =
    params;
  const sourceSlot = currentState.slots[fromSlotKey];
  const movingTask = sourceSlot.tasks.find((task) => task.id === taskId);
  if (!movingTask) {
    return { sourceState: currentState };
  }

  const nextSourceSlot: SlotState = {
    ...sourceSlot,
    tasks: sourceSlot.tasks.filter((task) => task.id !== taskId),
  };

  if (targetDate === currentState.date) {
    const targetSlot = currentState.slots[targetSlotKey];
    return {
      sourceState: {
        ...currentState,
        slots: {
          ...currentState.slots,
          [fromSlotKey]: nextSourceSlot,
          [targetSlotKey]: {
            ...targetSlot,
            tasks: [...targetSlot.tasks, movingTask],
          },
        },
      },
    };
  }

  const targetState = await loadTodayState(targetDate, defaultTag);
  const targetSlot = targetState.slots[targetSlotKey];
  return {
    sourceState: {
      ...currentState,
      slots: { ...currentState.slots, [fromSlotKey]: nextSourceSlot },
    },
    targetState: {
      ...targetState,
      slots: {
        ...targetState.slots,
        [targetSlotKey]: {
          ...targetSlot,
          tasks: [...targetSlot.tasks, movingTask],
        },
      },
    },
  };
};

export const restoreTask = async (
  taskId: string,
  targetDate: string,
  slotKey: SlotKey,
): Promise<void> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error("Invalid target date.");
  }
  const states = await loadAllTodayStates();
  let sourceState: TodayState | null = null;
  let sourceSlotKey: SlotKey | null = null;
  let sourceTask: TaskState | null = null;

  for (const state of states) {
    for (const key of SLOT_KEYS) {
      const task = state.slots[key].tasks.find((item) => item.id === taskId);
      if (task) {
        sourceState = state;
        sourceSlotKey = key;
        sourceTask = task;
        break;
      }
    }
    if (sourceState) {
      break;
    }
  }

  if (!sourceState || !sourceSlotKey || !sourceTask) {
    throw new Error("Task not found.");
  }

  const restoredTask: TaskState = {
    ...sourceTask,
    isArchived: false,
    status: "TODO",
    startAt: null,
  };

  const targetState =
    sourceState.date === targetDate
      ? sourceState
      : states.find((state) => state.date === targetDate) ??
        (await loadTodayState(targetDate));

  const nextSourceState: TodayState = {
    ...sourceState,
    slots: {
      ...sourceState.slots,
      [sourceSlotKey]: {
        ...sourceState.slots[sourceSlotKey],
        tasks: sourceState.slots[sourceSlotKey].tasks.filter(
          (task) => task.id !== taskId,
        ),
      },
    },
  };

  const targetSlot = targetState.slots[slotKey];
  const nextTargetState: TodayState = {
    ...targetState,
    slots: {
      ...targetState.slots,
      [slotKey]: {
        ...targetSlot,
        tasks: [
          ...targetSlot.tasks.filter((task) => task.id !== taskId),
          restoredTask,
        ],
      },
    },
  };

  if (sourceState.date === targetDate) {
    await saveTasks(nextTargetState);
    return;
  }

  await saveTasks(nextSourceState);
  await saveTasks(nextTargetState);
};

export const loadAllTaskStates = async (): Promise<TodayState[]> =>
  loadAllTodayStates();

export const replaceAllTaskStates = async (
  states: TodayState[],
): Promise<void> => {
  await saveAllTodayStates(states);
};

export const findTaskById = (
  state: TodayState,
  taskId: string,
): { slotKey: SlotKey; task: TaskState } | null => {
  for (const slotKey of SLOT_KEYS) {
    const task = state.slots[slotKey].tasks.find((item) => item.id === taskId);
    if (task) {
      return { slotKey, task };
    }
  }
  return null;
};

export const createEmptyTask = (defaultTag?: Tag): TaskState =>
  createEmptyTaskState(defaultTag);
