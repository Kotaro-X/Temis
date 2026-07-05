import {
  deleteMemoById,
  getMemoById,
  getMemoByTaskId,
  listAllMemos,
  setTaskIndex,
  upsertMemoForTask,
} from "../db/memoRepo";
import type { TaskMemo } from "../types";

export const loadMemos = async (): Promise<TaskMemo[]> => listAllMemos();

export const loadMemoById = async (memoId: string): Promise<TaskMemo | null> =>
  getMemoById(memoId);

export const loadMemoByTaskId = async (
  taskId: string,
): Promise<TaskMemo | null> => getMemoByTaskId(taskId);

export const createMemo = async (
  taskId: string,
  body: string,
): Promise<TaskMemo> => upsertMemoForTask(taskId, body);

export const updateMemo = async (
  taskId: string,
  body: string,
  options?: { indexMode?: "sync" | "async" },
): Promise<TaskMemo> => upsertMemoForTask(taskId, body, options);

export const deleteMemo = async (memoId: string): Promise<void> =>
  deleteMemoById(memoId);

export const updateTaskIndex = (
  entries: Array<{ taskId: string; taskTitle: string }>,
): void => {
  setTaskIndex(entries);
};
