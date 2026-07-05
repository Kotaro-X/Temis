import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";

type UseTaskSelectionActionsArgs = {
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  setSelectedTaskIds: Dispatch<SetStateAction<string[]>>;
};

export const useTaskSelectionActions = ({
  setSelectionMode,
  setSelectedTaskIds,
}: UseTaskSelectionActionsArgs) => {
  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
    setSelectedTaskIds([]);
  }, [setSelectedTaskIds, setSelectionMode]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedTaskIds([]);
  }, [setSelectedTaskIds, setSelectionMode]);

  const toggleSelection = useCallback(
    (taskId: string) => {
      setSelectedTaskIds((prev) =>
        prev.includes(taskId)
          ? prev.filter((id) => id !== taskId)
          : [...prev, taskId],
      );
    },
    [setSelectedTaskIds],
  );

  return {
    enterSelectionMode,
    exitSelectionMode,
    toggleSelection,
  };
};
