import type { ProjectRole } from "./collaboration";
import { extractHashtags } from "../utils/wikiLink.ts";

export type GuildPostType = "personal" | "project_activity" | "project_recruiting";
export type GuildPostStatus = "published" | "unpublished" | "deleted";
export type GuildFeedKind = "recommended" | "recent" | "connected";

export type GuildPost = {
  id: string;
  authorUserId: string;
  authorDisplayName: string;
  authorPhotoUrl: string | null;
  body: string;
  tags: string[];
  type: GuildPostType;
  projectId: string | null;
  /** Never expose this field in a public feed response. */
  source: { scope: "personal" | "project"; memoId: string };
  status: GuildPostStatus;
  moderation: {
    visibility: "visible" | "hidden";
    hiddenByUserId: string | null;
    hiddenAt: number | null;
    reason: string | null;
  };
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
};

/** Safe, source-free representation used by every non-owner Guild screen. */
export type GuildFeedPost = Omit<GuildPost, "source">;

export type GuildPostInput = {
  body: string;
  type: GuildPostType;
  projectId: string | null;
  source: GuildPost["source"];
};

export type GuildFeedPage = {
  posts: GuildFeedPost[];
  cursor: GuildFeedCursor | null;
};

export type GuildFeedCursor = {
  publishedAt: number;
  id: string;
};

export type ProjectJoinRequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "cancelled";

export type ProjectJoinRequest = {
  id: string;
  projectId: string;
  applicantUserId: string;
  requestedRole: Extract<ProjectRole, "member" | "viewer">;
  message: string | null;
  status: ProjectJoinRequestStatus;
  createdAt: number;
  updatedAt: number;
};

export type GuildReportStatus = "pending" | "reviewed" | "dismissed";
export type GuildReport = {
  id: string;
  postId: string;
  reporterUserId: string;
  reportedUserId: string;
  reason: string;
  status: GuildReportStatus;
  notificationStatus: "pending" | "sent" | "failed";
  createdAt: number;
  updatedAt: number;
};

/** Source-free post data paired with a report for staff moderation. */
export type GuildModerationReport = GuildReport & {
  post: GuildFeedPost | null;
};

export const normalizeGuildTag = (value: string): string =>
  value.normalize("NFKC").trim().toLocaleLowerCase();

export const normalizeGuildTags = (values: string[]): string[] => {
  const normalized = values.map(normalizeGuildTag).filter(Boolean);
  return [...new Set(normalized)].slice(0, 5);
};

/** Guild tags are the hashtags written in the post body, not a separate field. */
export const extractGuildTags = (body: string): string[] =>
  normalizeGuildTags(extractHashtags(body));

export const validateGuildPostInput = (input: GuildPostInput): string | null => {
  if (!input.body.trim()) return "投稿本文を入力してください。";
  if (input.type !== "personal" && !input.projectId) return "プロジェクトを選択してください。";
  return null;
};
