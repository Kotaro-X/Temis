export type WeeklyPrompt = {
  id: string;
  weekStart: string;
  title: string;
  prompt: string;
  why?: string;
  action?: string;
  status?: "draft" | "published";
};

export type WeeklyPromptsPayload = {
  version: number;
  timezone: string;
  updatedAt?: string;
  prompts: WeeklyPrompt[];
};
