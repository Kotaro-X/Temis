import { useCallback, useState } from "react";

import type { SlotKey, TaskState } from "../../types";
import { SLOT_KEYS } from "../../types";

const toDateString = (date: Date) => date.toISOString().slice(0, 10);

const parseDateString = (value: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

type UseTaskModalStateArgs = {
  selectedDate: string;
  moveTask: (
    taskId: string,
    fromSlotKey: SlotKey,
    targetDate: string,
    targetSlotKey: SlotKey,
  ) => Promise<void>;
  restoreTask: (
    taskId: string,
    targetDate: string,
    slotKey: SlotKey,
  ) => Promise<void>;
};

export type TaskModalValidation = "invalid_date";
export type TaskRestoreOpenResult = "opened" | "not_allowed";
export type TaskRestoreApplyResult = "idle" | "invalid_date" | "failed" | "restored";
export type TaskMoveApplyResult = "idle" | "invalid_date" | "closed" | "moved";

export const useTaskModalState = ({
  selectedDate,
  moveTask,
  restoreTask,
}: UseTaskModalStateArgs) => {
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTaskId, setMoveTaskId] = useState<string | null>(null);
  const [moveFromSlotKey, setMoveFromSlotKey] = useState<SlotKey | null>(null);
  const [moveDateDraft, setMoveDateDraftState] = useState(selectedDate);
  const [moveDateError, setMoveDateError] =
    useState<TaskModalValidation | null>(null);
  const [moveTargetSlotKey, setMoveTargetSlotKey] = useState<SlotKey>(
    SLOT_KEYS[0],
  );

  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreTaskId, setRestoreTaskId] = useState<string | null>(null);
  const [restoreDateDraft, setRestoreDateDraftState] = useState(
    toDateString(new Date()),
  );
  const [restoreDateError, setRestoreDateError] =
    useState<TaskModalValidation | null>(null);
  const [restoreTargetSlotKey, setRestoreTargetSlotKey] = useState<SlotKey>(
    SLOT_KEYS[0],
  );

  const setMoveDateDraft = useCallback((value: string) => {
    setMoveDateDraftState(value);
    setMoveDateError(null);
  }, []);

  const setRestoreDateDraft = useCallback((value: string) => {
    setRestoreDateDraftState(value);
    setRestoreDateError(null);
  }, []);

  const closeMoveModal = useCallback(() => {
    setMoveModalOpen(false);
    setMoveTaskId(null);
    setMoveFromSlotKey(null);
    setMoveDateError(null);
  }, []);

  const closeRestoreModal = useCallback(() => {
    setRestoreModalOpen(false);
    setRestoreTaskId(null);
    setRestoreDateError(null);
  }, []);

  const openMoveModal = useCallback(
    (slotKey: SlotKey, taskId: string) => {
      setMoveTaskId(taskId);
      setMoveFromSlotKey(slotKey);
      setMoveDateDraftState(selectedDate);
      setMoveTargetSlotKey(slotKey);
      setMoveDateError(null);
      setMoveModalOpen(true);
    },
    [selectedDate],
  );

  const openRestoreModal = useCallback(
    (task: TaskState, sourceSlotKey: SlotKey): TaskRestoreOpenResult => {
      if (task.status === "DONE") {
        return "not_allowed";
      }
      setRestoreTaskId(task.id);
      setRestoreTargetSlotKey(sourceSlotKey);
      setRestoreDateDraftState(toDateString(new Date()));
      setRestoreDateError(null);
      setRestoreModalOpen(true);
      return "opened";
    },
    [],
  );

  const shiftMoveDateDraft = useCallback(
    (delta: number) => {
      const base = parseDateString(moveDateDraft) ?? parseDateString(selectedDate);
      const date = base ?? new Date();
      const next = new Date(date);
      next.setDate(next.getDate() + delta);
      setMoveDateDraftState(toDateString(next));
      setMoveDateError(null);
    },
    [moveDateDraft, selectedDate],
  );

  const shiftRestoreDateDraft = useCallback(
    (delta: number) => {
      const base = parseDateString(restoreDateDraft) ?? new Date();
      const next = new Date(base);
      next.setDate(next.getDate() + delta);
      setRestoreDateDraftState(toDateString(next));
      setRestoreDateError(null);
    },
    [restoreDateDraft],
  );

  const applyMoveTask = useCallback(async (): Promise<TaskMoveApplyResult> => {
    if (!moveTaskId || !moveFromSlotKey) {
      return "idle";
    }
    const parsed = parseDateString(moveDateDraft);
    if (!parsed) {
      setMoveDateError("invalid_date");
      return "invalid_date";
    }
    const targetDate = toDateString(parsed);
    setMoveDateError(null);
    if (targetDate === selectedDate && moveTargetSlotKey === moveFromSlotKey) {
      closeMoveModal();
      return "closed";
    }
    await moveTask(moveTaskId, moveFromSlotKey, targetDate, moveTargetSlotKey);
    closeMoveModal();
    return "moved";
  }, [
    closeMoveModal,
    moveDateDraft,
    moveFromSlotKey,
    moveTargetSlotKey,
    moveTask,
    moveTaskId,
    selectedDate,
  ]);

  const applyRestoreTask = useCallback(
    async (): Promise<TaskRestoreApplyResult> => {
      if (!restoreTaskId) {
        return "idle";
      }
      const parsed = parseDateString(restoreDateDraft);
      if (!parsed) {
        setRestoreDateError("invalid_date");
        return "invalid_date";
      }
      try {
        const targetDate = toDateString(parsed);
        setRestoreDateError(null);
        await restoreTask(restoreTaskId, targetDate, restoreTargetSlotKey);
        closeRestoreModal();
        return "restored";
      } catch (_error) {
        return "failed";
      }
    },
    [
      closeRestoreModal,
      restoreDateDraft,
      restoreTargetSlotKey,
      restoreTask,
      restoreTaskId,
    ],
  );

  return {
    moveModalOpen,
    moveTaskId,
    moveFromSlotKey,
    moveDateDraft,
    moveDateError,
    moveTargetSlotKey,
    setMoveDateDraft,
    setMoveTargetSlotKey,
    openMoveModal,
    closeMoveModal,
    shiftMoveDateDraft,
    applyMoveTask,
    restoreModalOpen,
    restoreTaskId,
    restoreDateDraft,
    restoreDateError,
    restoreTargetSlotKey,
    setRestoreDateDraft,
    setRestoreTargetSlotKey,
    openRestoreModal,
    closeRestoreModal,
    shiftRestoreDateDraft,
    applyRestoreTask,
  };
};
