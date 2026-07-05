import type { Tag } from "./tag";

export type ResearchNote = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  tags: Tag[];
  weekId: string;
  weeklyPromptId: string;
};
