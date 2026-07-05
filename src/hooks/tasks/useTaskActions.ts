import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { Suggestion } from "../../features/routineSuggestions";
import type { LogEntry, Tag, TodayState } from "../../types";
import type { FlatTaskItem } from "./types";
import { useTaskCrudActions } from "./useTaskCrudActions";
import { useTaskExecutionActions } from "./useTaskExecutionActions";
import { useTaskSelectionActions } from "./useTaskSelectionActions";
import { useTaskStateMutations } from "./useTaskStateMutations";

type UseTaskActionsArgs = {
  todayState: TodayState | null;
  selectedDate: string;
  defaultTag?: Tag;
  flatTasks: FlatTaskItem[];
  activeTaskId: string | null;
  selectedTaskIds: string[];
  setLogs: Dispatch<SetStateAction<LogEntry[]>>;
  setRoutineSuggestions: Dispatch<SetStateAction<Suggestion[]>>;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  setSelectedTaskIds: Dispatch<SetStateAction<string[]>>;
  setActiveTaskId: (taskId: string | null) => void;
  allowNoActiveTaskRef: MutableRefObject<boolean>;
  persistTodayState: (next: TodayState) => Promise<void>;
  persistLogs: (next: LogEntry[]) => Promise<void>;
  loadForDate: (date: string, fallbackTag?: Tag) => Promise<TodayState>;
};

export const useTaskActions = ({
  todayState,
  selectedDate,
  defaultTag,
  flatTasks,
  activeTaskId,
  selectedTaskIds,
  setLogs,
  setRoutineSuggestions,
  setSelectionMode,
  setSelectedTaskIds,
  setActiveTaskId,
  allowNoActiveTaskRef,
  persistTodayState,
  persistLogs,
  loadForDate,
}: UseTaskActionsArgs) => {
  const { updateToday, updateSlot, updateTask } = useTaskStateMutations({
    todayState,
    persistTodayState,
  });

  const crudActions = useTaskCrudActions({
    todayState,
    selectedDate,
    defaultTag,
    flatTasks,
    activeTaskId,
    selectedTaskIds,
    setRoutineSuggestions,
    setSelectionMode,
    setSelectedTaskIds,
    setActiveTaskId,
    allowNoActiveTaskRef,
    loadForDate,
    updateToday,
    updateSlot,
    updateTask,
  });

  const executionActions = useTaskExecutionActions({
    todayState,
    setLogs,
    setActiveTaskId,
    allowNoActiveTaskRef,
    persistLogs,
    updateToday,
    updateSlot,
    updateTask,
  });

  const selectionActions = useTaskSelectionActions({
    setSelectionMode,
    setSelectedTaskIds,
  });

  return {
    updateTask,
    ...crudActions,
    ...executionActions,
    ...selectionActions,
  };
};
