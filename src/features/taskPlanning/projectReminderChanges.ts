import type { TaskReminder } from '../../types/taskPlanning.ts';

export function projectReminderChanged(previous: TaskReminder | undefined, next: TaskReminder): boolean {
  if (!previous?.enabled && !next.enabled) return false;
  return !previous || previous.enabled !== next.enabled || previous.mode !== next.mode
    || previous.offsetMinutes !== next.offsetMinutes || previous.at !== next.at;
}
