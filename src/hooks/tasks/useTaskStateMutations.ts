import { useCallback } from "react";

import * as taskRepository from "../../repositories/taskRepository";
import type { SlotKey, SlotState, TaskState, TodayState } from "../../types";

export type UpdateToday = (next: TodayState) => void;

export type UpdateSlot = (
  slotKey: SlotKey,
  updater: (slot: SlotState) => SlotState,
) => void;

export type UpdateTask = (
  slotKey: SlotKey,
  taskId: string,
  updater: (task: TaskState) => TaskState,
) => void;

type UseTaskStateMutationsArgs = {
  todayState: TodayState | null;
  persistTodayState: (next: TodayState) => Promise<void>;
};

export const useTaskStateMutations = ({
  todayState,
  persistTodayState,
}: UseTaskStateMutationsArgs) => {
  const updateToday = useCallback<UpdateToday>(
    (next) => {
      void persistTodayState(next);
    },
    [persistTodayState],
  );

  const updateSlot = useCallback<UpdateSlot>(
    (slotKey, updater) => {
      if (!todayState) {
        return;
      }
      updateToday({
        ...todayState,
        slots: {
          ...todayState.slots,
          [slotKey]: updater(todayState.slots[slotKey]),
        },
      });
    },
    [todayState, updateToday],
  );

  const updateTask = useCallback<UpdateTask>(
    (slotKey, taskId, updater) => {
      if (!todayState) {
        return;
      }
      updateToday(taskRepository.updateTask(todayState, slotKey, taskId, updater));
    },
    [todayState, updateToday],
  );

  return {
    updateToday,
    updateSlot,
    updateTask,
  };
};
