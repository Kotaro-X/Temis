import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useEffect } from "react";

import {
  getRoutineSuggestions,
  type Suggestion,
} from "../../features/routineSuggestions";
import type { LogEntry, SlotKey, Tag, TodayState } from "../../types";
import type { FlatTaskItem } from "./types";

type UseTaskEffectsArgs = {
  storageReady: boolean;
  selectedDate: string;
  defaultTag?: Tag;
  currentSlot: SlotKey;
  todayState: TodayState | null;
  flatTasks: FlatTaskItem[];
  selectionMode: boolean;
  activeTaskId: string | null;
  setActiveTaskId: (taskId: string | null) => void;
  setRoutineSuggestions: Dispatch<SetStateAction<Suggestion[]>>;
  setSelectedTaskIds: Dispatch<SetStateAction<string[]>>;
  loadLogs: () => Promise<LogEntry[]>;
  loadForDate: (date: string, fallbackTag?: Tag) => Promise<TodayState>;
  allowNoActiveTaskRef: MutableRefObject<boolean>;
};

export const useTaskEffects = ({
  storageReady,
  selectedDate,
  defaultTag,
  currentSlot,
  todayState,
  flatTasks,
  selectionMode,
  activeTaskId,
  setActiveTaskId,
  setRoutineSuggestions,
  setSelectedTaskIds,
  loadLogs,
  loadForDate,
  allowNoActiveTaskRef,
}: UseTaskEffectsArgs) => {
  useEffect(() => {
    if (!storageReady) {
      return;
    }
    void loadLogs();
  }, [loadLogs, storageReady]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }
    void loadForDate(selectedDate, defaultTag);
  }, [defaultTag, loadForDate, selectedDate, storageReady]);

  useEffect(() => {
    if (!storageReady) {
      setRoutineSuggestions([]);
      return;
    }
    let active = true;
    getRoutineSuggestions({
      todayKey: selectedDate,
      currentSlot,
    })
      .then((items) => {
        if (active) {
          setRoutineSuggestions(items);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[RoutineSuggest] load failed: ${message}`);
        if (active) {
          setRoutineSuggestions([]);
        }
      });
    return () => {
      active = false;
    };
  }, [currentSlot, selectedDate, storageReady, setRoutineSuggestions, todayState]);

  useEffect(() => {
    if (!todayState) {
      return;
    }
    if (flatTasks.length === 0) {
      if (activeTaskId) {
        setActiveTaskId(null);
      }
      return;
    }
    if (!activeTaskId) {
      if (allowNoActiveTaskRef.current) {
        return;
      }
      setActiveTaskId(flatTasks[0].task.id);
      return;
    }
    const exists = flatTasks.some((item) => item.task.id === activeTaskId);
    if (!exists) {
      if (allowNoActiveTaskRef.current) {
        setActiveTaskId(null);
        return;
      }
      setActiveTaskId(flatTasks[0].task.id);
    }
  }, [activeTaskId, allowNoActiveTaskRef, flatTasks, setActiveTaskId, todayState]);

  useEffect(() => {
    if (!selectionMode) {
      return;
    }
    const existingIds = new Set(flatTasks.map((item) => item.task.id));
    setSelectedTaskIds((prev) => prev.filter((id) => existingIds.has(id)));
  }, [flatTasks, selectionMode, setSelectedTaskIds]);
};
