import { useCallback, useMemo, useState } from "react";

import type { SlotKey } from "../../types";
import type { TaskDetailInfo } from "./types";

type UseTaskScreenStateArgs = {
  getTaskInfo: (
    taskId: string,
    preferredSlotKey?: SlotKey | null,
  ) => TaskDetailInfo | null;
};

export const useTaskScreenState = ({
  getTaskInfo,
}: UseTaskScreenStateArgs) => {
  const [taskDetailId, setTaskDetailId] = useState<string | null>(null);
  const [taskDetailSlotKey, setTaskDetailSlotKey] = useState<SlotKey | null>(
    null,
  );

  const detailTaskInfo = useMemo(() => {
    if (!taskDetailId) {
      return null;
    }
    return getTaskInfo(taskDetailId, taskDetailSlotKey);
  }, [getTaskInfo, taskDetailId, taskDetailSlotKey]);

  const openTaskDetail = useCallback((slotKey: SlotKey, taskId: string) => {
    setTaskDetailId(taskId);
    setTaskDetailSlotKey(slotKey);
  }, []);

  const closeTaskDetail = useCallback(() => {
    setTaskDetailId(null);
    setTaskDetailSlotKey(null);
  }, []);

  return {
    taskDetailId,
    taskDetailSlotKey,
    detailTaskInfo,
    openTaskDetail,
    closeTaskDetail,
  };
};
