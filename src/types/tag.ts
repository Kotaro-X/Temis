export const DEFAULT_TAGS_JA = [
  "分析/生活",
  "事務",
  "学習",
  "開発",
  "連絡",
  "移動",
  "その他",
] as const;

export const DEFAULT_TAGS_EN = [
  "Analysis/Life",
  "Admin",
  "Learning",
  "Development",
  "Communication",
  "Travel",
  "Other",
] as const;

export const DEFAULT_TAGS = DEFAULT_TAGS_JA;

export type Tag = string;

export type TagRecord = {
  id: string;
  name: Tag;
  order: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
  deviceId: string | null;
};
