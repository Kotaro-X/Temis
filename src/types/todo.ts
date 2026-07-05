import type { Tag } from "./tag";

export type TodoRepeat = "none" | "daily" | "weekly" | "monthly" | "yearly";

export type SimpleTodoItem = {
  id: string;
  text: string;
  memo: string;
  tags: Tag[];
  isDone: boolean;
  createdAt: number;
  doneAt: number | null;
  reminderDate: string | null;
  reminderTime: string | null;
  repeat: TodoRepeat;
  notificationId: string | null;
  notificationIds: string[];
  seriesId: string | null;
  seriesAnchorDate: string | null;
  occurrenceDate: string | null;
  isDeleted: boolean;
};
