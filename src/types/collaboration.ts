export const USERNAME_PATTERN = /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9._]{3,30}$/;

export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "support",
  "help",
  "official",
  "temis",
  "system",
  "project",
  "projects",
  "settings",
  "account",
  "accounts",
  "user",
  "users",
  "null",
  "undefined",
]);

export const USERNAME_CHANGE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
export const USERNAME_RELEASE_RESERVATION_MS = 14 * 24 * 60 * 60 * 1000;

export type ProfileVisibility = "public" | "connections_only" | "private";
export type ConnectionRequestPolicy =
  | "everyone"
  | "connections_only"
  | "disabled";

export type UserProfile = {
  userId: string;
  username: string;
  displayName: string;
  photoUrl?: string | null;
  bio?: string | null;
  interestTags: string[];
  skillTags: string[];
  affiliation?: string | null;
  profileVisibility: ProfileVisibility;
  connectionRequestPolicy: ConnectionRequestPolicy;
  createdAt: number;
  updatedAt: number;
  usernameChangedAt?: number | null;
  profileCompletedAt?: number | null;
  photoStoragePath?: string | null;
};

export type ConnectionStatus =
  | "none"
  | "outgoing_pending"
  | "incoming_pending"
  | "connected"
  | "blocked";

export type Connection = {
  id: string;
  userIds: [string, string];
  requesterUserId: string;
  recipientUserId: string;
  status: "pending" | "connected" | "blocked";
  blockedByUserId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProjectRole = "owner" | "member" | "viewer";
export type ProjectVisibility = "private" | "invite_only" | "public";
export type ProjectJoinPolicy = "invitation_only" | "approval_required" | "open";
export type ProjectInvitationPolicy = "owner_only" | "members";

export type Project = {
  id: string;
  name: string;
  description?: string | null;
  ownerUserId: string;
  icon?: string | null;
  tags: string[];
  visibility: ProjectVisibility;
  joinPolicy: ProjectJoinPolicy;
  invitationPolicy: ProjectInvitationPolicy;
  taskEnabled: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};

export type ProjectMember = {
  userId: string;
  role: ProjectRole;
  invitationId?: string | null;
  joinedAt: number;
  updatedAt: number;
};

export type ProjectMembership = {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  updatedAt: number;
};

export type ProjectInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired";

export type ProjectInvitation = {
  id: string;
  projectName?: string;
  projectId: string;
  inviterUserId: string;
  inviteeUserId: string;
  role: Exclude<ProjectRole, "owner">;
  status: ProjectInvitationStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number | null;
};

export type ContentScope =
  | { scope: "personal"; projectId: null }
  | { scope: "project"; projectId: string };

export type ProjectTaskStatus = "todo" | "in_progress" | "paused" | "completed";
export type ProjectTaskPriority = "low" | "medium" | "high";
export type ProjectTaskKind = "task" | "todo";

export type ProjectTask = {
  id: string;
  ownerUserId: string | null;
  creatorUserId: string | null;
  /** Snapshot for project members who cannot read a private profile later. */
  creatorDisplayName?: string | null;
  creatorAnonymizedAt?: number | null;
  anonymizedReason?: "project_exit" | null;
  assigneeUserId?: string | null;
  projectId: string;
  /** Older shared tasks are treated as `task` for backwards compatibility. */
  kind?: ProjectTaskKind;
  title: string;
  description?: string | null;
  status: ProjectTaskStatus;
  /**
   * Project tasks keep the same task-editing fields as personal tasks. They
   * deliberately do not have elapsed/start timestamps: project work does not
   * calculate or display remaining time.
   */
  tags?: string[];
  estimateMinutes?: number;
  isArchived?: boolean;
  priority?: ProjectTaskPriority | null;
  dueAt?: number | null;
  /** Date shown in the creator's Private workspace (YYYY-MM-DD). */
  privateDate?: string | null;
  /** Time box shown in the creator's Private workspace. */
  privateSlotKey?: "morning" | "forenoon" | "afternoon" | "night" | null;
  relatedMemoId?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
  deletedAt?: number | null;
};

export type ProjectSharedNote = {
  id: string;
  ownerUserId: string | null;
  /** Snapshot of the owner name at the time this shared note was created. */
  creatorDisplayName?: string | null;
  creatorAnonymizedAt?: number | null;
  anonymizedReason?: "project_exit" | null;
  projectId: string;
  sourceNoteId: string | null;
  title: string | null;
  body: string;
  updatedAt: number;
};

export const normalizeUsername = (value: string): string =>
  value.trim().replace(/^@+/, "").toLowerCase();

export const validateUsername = (value: string): string | null => {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    return "ユーザーIDは3〜30文字の英小文字・数字・アンダースコア・ピリオドのみ使用できます。";
  }
  if (RESERVED_USERNAMES.has(username)) {
    return "このユーザーIDは予約語のため使用できません。";
  }
  return null;
};

export const connectionIdFor = (leftUserId: string, rightUserId: string): string =>
  [leftUserId, rightUserId].sort().join("__");

export const getConnectionStatus = (
  connection: Connection | null,
  viewerUserId: string,
): ConnectionStatus => {
  if (!connection) return "none";
  if (connection.status === "blocked") return "blocked";
  if (connection.status === "connected") return "connected";
  return connection.requesterUserId === viewerUserId
    ? "outgoing_pending"
    : "incoming_pending";
};

export const canInviteToProject = (
  project: Project,
  role: ProjectRole | null,
): boolean =>
  role === "owner" || (role === "member" && project.invitationPolicy === "members");

export const canEditProjectTask = (
  task: ProjectTask,
  role: ProjectRole | null,
  userId: string,
): boolean =>
  role === "owner" ||
  role === "member" ||
  task.ownerUserId === userId ||
  task.creatorUserId === userId ||
  task.assigneeUserId === userId;

/** True when the current user owns or originally created project content. */
export const isProjectContentCreatedBy = (
  content: Pick<ProjectSharedNote, "ownerUserId"> | Pick<ProjectTask, "ownerUserId" | "creatorUserId">,
  userId: string | null | undefined,
): boolean => Boolean(userId) && (
  content.ownerUserId === userId ||
  ("creatorUserId" in content && content.creatorUserId === userId)
);

export const isAnonymizedProjectContent = (
  content: Pick<ProjectSharedNote | ProjectTask, "creatorAnonymizedAt" | "anonymizedReason">,
): boolean => content.anonymizedReason === "project_exit" && content.creatorAnonymizedAt != null;
