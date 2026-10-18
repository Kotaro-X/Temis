import type { TodoRepeat } from './todo';
import type { SlotKey } from './timer';

export type TaskReminder = { enabled: boolean; mode: 'start' | 'custom'; offsetMinutes: number; at: number | null };
export type TaskOccurrenceOverride = {
  date: string; slot: SlotKey; plannedStartAt: number | null; plannedEndAt: number | null;
  estimateMinutes: number; executionStatus?: 'TODO' | 'IN_PROGRESS' | 'PAUSED' | 'DONE'; elapsedMinutes?: number; startAt?: number | null; title?: string; memo?: string; tags?: string[]; completed?: boolean; deleted?: boolean;
};
export type TaskPlanning = {
  plannedStartAt?: number | null;
  plannedEndAt?: number | null;
  repeat?: TodoRepeat;
  repeatAnchorDate?: string | null;
  occurrenceOverrides?: Record<string, TaskOccurrenceOverride>;
  reminder?: TaskReminder;
  migratedTodoId?: string;
};
