import { nanoid } from "nanoid/non-secure";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
} from "firebase/firestore";

import { getFirebaseAuth, getFirebaseFirestore } from "../sync/firebaseApp";
import { unpublishGuildPostsForProfile, updateGuildPostAuthorSnapshot } from "../guild/guildService";
import type { SyncUser } from "../auth/syncUser";
import {
  USERNAME_CHANGE_INTERVAL_MS,
  USERNAME_RELEASE_RESERVATION_MS,
  canInviteToProject,
  connectionIdFor,
  isProjectContentCreatedBy,
  normalizeUsername,
  validateUsername,
  type Connection,
  type Project,
  type ProjectInvitation,
  type ProjectMember,
  type ProjectMembership,
  type ProjectRole,
  type ProjectSharedNote,
  type ProjectTask,
  type UserProfile,
} from "../../types/collaboration";

type UsernameClaim = {
  userId: string;
  username: string;
  reservedUntil: number | null;
  updatedAt: number;
};

const db = () => getFirebaseFirestore();
const now = () => Date.now();
const profileRef = (userId: string) => doc(db(), "profiles", userId);
const usernameRef = (username: string) => doc(db(), "usernames", username);
const connectionRef = (leftUserId: string, rightUserId: string) =>
  doc(db(), "connections", connectionIdFor(leftUserId, rightUserId));
const projectRef = (projectId: string) => doc(db(), "projects", projectId);
const memberRef = (projectId: string, userId: string) =>
  doc(db(), "projects", projectId, "members", userId);
const membershipRef = (projectId: string, userId: string) =>
  doc(db(), "projectMemberships", `${projectId}__${userId}`);
const invitationRef = (invitationId: string) => doc(db(), "projectInvitations", invitationId);
const projectTaskRef = (taskId: string) => doc(db(), "projectTasks", taskId);
const sharedNoteRef = (noteId: string) => doc(db(), "projectNotes", noteId);
const sortedUserIds = (leftUserId: string, rightUserId: string): [string, string] =>
  [leftUserId, rightUserId].sort() as [string, string];

const requireCurrentUserId = (): string => {
  const userId = getFirebaseAuth().currentUser?.uid;
  if (!userId) throw new Error("アカウントにログインしてから連携機能を利用してください。");
  return userId;
};

const makeTemporaryUsername = (userId: string, attempt: number) =>
  `user_${userId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 16)}${attempt || ""}`.slice(0, 30);

const profileDefaults = (user: SyncUser, username: string, timestamp: number): UserProfile => ({
  userId: user.id,
  username,
  displayName: user.name?.trim() || "Temisユーザー",
  photoUrl: null,
  bio: null,
  interestTags: [],
  skillTags: [],
  affiliation: null,
  profileVisibility: "public",
  connectionRequestPolicy: "everyone",
  createdAt: timestamp,
  updatedAt: timestamp,
  usernameChangedAt: null,
});

type ProjectTaskInput = Omit<
  ProjectTask,
  "id" | "ownerUserId" | "creatorUserId" | "createdAt" | "updatedAt" | "completedAt" | "deletedAt"
>;

type ProjectTaskUpdate = Pick<
  ProjectTask,
  | "title"
  | "description"
  | "status"
  | "tags"
  | "estimateMinutes"
  | "isArchived"
  | "priority"
  | "dueAt"
  | "privateDate"
  | "privateSlotKey"
  | "assigneeUserId"
  | "relatedMemoId"
>;

const normalizeProjectTask = (task: ProjectTask): ProjectTask => ({
  ...task,
  kind: task.kind ?? "task",
  tags: Array.isArray(task.tags) ? task.tags : [],
  estimateMinutes:
    typeof task.estimateMinutes === "number" && Number.isFinite(task.estimateMinutes)
      ? Math.max(0, task.estimateMinutes)
      : 25,
  isArchived: task.isArchived === true,
});

/** Creates one signed-in user profile and atomically claims its temporary public ID. */
export const ensureUserProfile = async (user: SyncUser): Promise<UserProfile> => {
  const existing = await getDoc(profileRef(user.id));
  if (existing.exists()) return existing.data() as UserProfile;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = makeTemporaryUsername(user.id, attempt);
    const timestamp = now();
    try {
      return await runTransaction(db(), async (transaction) => {
        const current = await transaction.get(profileRef(user.id));
        if (current.exists()) return current.data() as UserProfile;
        const claim = await transaction.get(usernameRef(username));
        if (claim.exists()) throw new Error("temporary_username_taken");
        const profile = profileDefaults(user, username, timestamp);
        transaction.set(profileRef(user.id), profile);
        transaction.set(usernameRef(username), {
          userId: user.id, username, reservedUntil: null, updatedAt: timestamp,
        } satisfies UsernameClaim);
        return profile;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "temporary_username_taken") continue;
      throw error;
    }
  }
  throw new Error("一時ユーザーIDを作成できませんでした。もう一度お試しください。");
};

/** Client transaction is the concurrency boundary for username ownership and release reservation. */
export const updateUsername = async (input: string): Promise<UserProfile> => {
  const userId = requireCurrentUserId();
  const username = normalizeUsername(input);
  const error = validateUsername(username);
  if (error) throw new Error(error);
  const timestamp = now();
  return runTransaction(db(), async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef(userId));
    if (!profileSnapshot.exists()) throw new Error("プロフィールが見つかりません。");
    const profile = profileSnapshot.data() as UserProfile;
    if (profile.username === username) return profile;
    if (
      profile.usernameChangedAt &&
      timestamp - profile.usernameChangedAt < USERNAME_CHANGE_INTERVAL_MS
    ) {
      throw new Error("ユーザーIDは30日に1回まで変更できます。");
    }
    const nextClaimSnapshot = await transaction.get(usernameRef(username));
    const nextClaim = nextClaimSnapshot.exists()
      ? (nextClaimSnapshot.data() as UsernameClaim)
      : null;
    if (
      nextClaim &&
      nextClaim.userId !== userId &&
      (nextClaim.reservedUntil === null || nextClaim.reservedUntil > timestamp)
    ) {
      throw new Error("このユーザーIDはすでに使用されています。");
    }
    const updated: UserProfile = {
      ...profile, username, usernameChangedAt: timestamp, updatedAt: timestamp,
    };
    transaction.set(usernameRef(profile.username), {
      userId, username: profile.username,
      reservedUntil: timestamp + USERNAME_RELEASE_RESERVATION_MS,
      updatedAt: timestamp,
    } satisfies UsernameClaim);
    transaction.set(usernameRef(username), {
      userId, username, reservedUntil: null, updatedAt: timestamp,
    } satisfies UsernameClaim);
    transaction.set(profileRef(userId), updated);
    return updated;
  });
};

export const updateDisplayName = async (input: string): Promise<UserProfile> => {
  const displayName = input.trim();
  if (!displayName) throw new Error("表示名を入力してください。");
  if (displayName.length > 50) throw new Error("表示名は50文字以内で入力してください。");

  const userId = requireCurrentUserId();
  const updated = await runTransaction(db(), async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef(userId));
    if (!profileSnapshot.exists()) throw new Error("プロフィールが見つかりません。");
    const updated: UserProfile = {
      ...(profileSnapshot.data() as UserProfile),
      displayName,
      updatedAt: now(),
    };
    transaction.set(profileRef(userId), updated);
    return updated;
  });
  await updateGuildPostAuthorSnapshot({ displayName: updated.displayName, photoUrl: updated.photoUrl ?? null });
  return updated;
};

export const updateUserProfile = async (
  input: Pick<UserProfile, "displayName" | "bio" | "photoUrl" | "interestTags" | "skillTags" | "affiliation" | "profileVisibility" | "connectionRequestPolicy">,
): Promise<void> => {
  const userId = requireCurrentUserId();
  await setDoc(profileRef(userId), { ...input, updatedAt: now() }, { merge: true });
  if (input.profileVisibility !== "public") {
    await unpublishGuildPostsForProfile();
  }
  await updateGuildPostAuthorSnapshot({ displayName: input.displayName, photoUrl: input.photoUrl ?? null });
};

export const searchProfiles = async (input: string): Promise<UserProfile[]> => {
  const keyword = input.trim().toLowerCase().replace(/^@/, "");
  if (!keyword) return [];
  const usernameResults = await getDocs(query(
    collection(db(), "profiles"),
    where("profileVisibility", "==", "public"),
    where("username", ">=", keyword), where("username", "<=", `${keyword}\uf8ff`),
    orderBy("username"), limit(20),
  ));
  return usernameResults.docs.map((item) => item.data() as UserProfile);
};

export const getProfile = async (userId: string): Promise<UserProfile | null> => {
  const result = await getDoc(profileRef(userId));
  return result.exists() ? (result.data() as UserProfile) : null;
};

/** Resolves display names for project content without failing on private profiles. */
export const listProjectCreatorProfiles = async (
  userIds: string[],
): Promise<UserProfile[]> => {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const profiles = await Promise.all(uniqueIds.map(async (userId) => {
    try {
      return await getProfile(userId);
    } catch {
      return null;
    }
  }));
  return profiles.filter((profile): profile is UserProfile => profile !== null);
};

export const sendConnectionRequest = async (recipientUserId: string): Promise<void> => {
  const requesterUserId = requireCurrentUserId();
  if (recipientUserId === requesterUserId) throw new Error("自分自身にはつながり申請できません。");
  const ref = connectionRef(requesterUserId, recipientUserId);

  const settleExisting = async (connection: Connection): Promise<void> => {
    if (connection.status === "blocked") throw new Error("このユーザーには申請できません。");
    if (connection.status === "connected" || connection.requesterUserId === requesterUserId) return;
    await setDoc(ref, { ...connection, status: "connected", updatedAt: now() });
  };

  const existing = await getConnectionWithUser(recipientUserId);
  if (existing) {
    await settleExisting(existing);
    return;
  }

  const timestamp = now();
  try {
    await setDoc(ref, {
      id: ref.id, userIds: sortedUserIds(requesterUserId, recipientUserId), requesterUserId,
      recipientUserId, status: "pending", createdAt: timestamp, updatedAt: timestamp,
    } satisfies Connection);
  } catch (cause) {
    // Two devices can both observe an empty query. If the other write won,
    // converge on the newly-created relationship instead of surfacing the
    // update-denied error from our create attempt.
    const raced = await getConnectionWithUser(recipientUserId);
    if (!raced) throw cause;
    await settleExisting(raced);
  }
};

/** Reads a single relationship without requiring permission to get a missing document. */
export const getConnectionWithUser = async (otherUserId: string): Promise<Connection | null> => {
  const userId = requireCurrentUserId();
  if (otherUserId === userId) return null;
  const result = await getDocs(query(
    collection(db(), "connections"),
    where("userIds", "array-contains", userId),
  ));
  const snapshot = result.docs.find((item) => {
    const connection = item.data() as Connection;
    return connection.userIds.includes(otherUserId);
  });
  return snapshot ? snapshot.data() as Connection : null;
};

export const respondToConnectionRequest = async (
  otherUserId: string,
  accept: boolean,
): Promise<void> => {
  const userId = requireCurrentUserId();
  const ref = connectionRef(userId, otherUserId);
  await runTransaction(db(), async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("つながり申請が見つかりません。");
    const connection = snapshot.data() as Connection;
    if (connection.recipientUserId !== userId || connection.status !== "pending") {
      throw new Error("この申請には応答できません。");
    }
    if (accept) transaction.set(ref, { ...connection, status: "connected", updatedAt: now() });
    else transaction.delete(ref);
  });
};

export const removeConnection = async (otherUserId: string): Promise<void> => {
  const userId = requireCurrentUserId();
  await runTransaction(db(), async (transaction) => transaction.delete(connectionRef(userId, otherUserId)));
};

export const setConnectionBlocked = async (otherUserId: string, blocked: boolean): Promise<void> => {
  const userId = requireCurrentUserId();
  const ref = connectionRef(userId, otherUserId);
  if (!blocked) {
    await runTransaction(db(), async (transaction) => transaction.delete(ref));
    return;
  }
  const timestamp = now();
  await setDoc(ref, {
    id: ref.id, userIds: sortedUserIds(userId, otherUserId), requesterUserId: userId,
    recipientUserId: otherUserId, status: "blocked", blockedByUserId: userId,
    createdAt: timestamp, updatedAt: timestamp,
  } satisfies Connection);
};

export const createProject = async (input: Pick<Project, "name" | "description" | "icon" | "tags">): Promise<Project> => {
  const ownerUserId = requireCurrentUserId();
  const id = nanoid();
  const timestamp = now();
  const project: Project = {
    id, name: input.name.trim(), description: input.description?.trim() || null,
    icon: input.icon ?? null, tags: input.tags, ownerUserId,
    visibility: "invite_only", joinPolicy: "invitation_only", invitationPolicy: "owner_only",
    taskEnabled: false, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
  await runTransaction(db(), async (transaction) => {
    transaction.set(projectRef(id), project);
    transaction.set(memberRef(id, ownerUserId), {
      userId: ownerUserId, role: "owner", invitationId: null, joinedAt: timestamp, updatedAt: timestamp,
    } satisfies ProjectMember);
    transaction.set(membershipRef(id, ownerUserId), {
      id: `${id}__${ownerUserId}`, projectId: id, userId: ownerUserId, role: "owner", updatedAt: timestamp,
    } satisfies ProjectMembership);
  });
  return project;
};

export const listMyProjects = async (): Promise<Project[]> => {
  const accesses = await listMyProjectAccess();
  return accesses.map(({ project }) => project);
};

export type ProjectAccess = {
  project: Project;
  role: ProjectRole;
};

export const listMyProjectAccess = async (): Promise<ProjectAccess[]> => {
  const userId = requireCurrentUserId();
  const memberships = await getDocs(query(collection(db(), "projectMemberships"), where("userId", "==", userId)));
  const results = await Promise.all(memberships.docs.map(async (membership) => {
    const access = membership.data() as ProjectMembership;
    const projectId = access.projectId;
    const project = await getDoc(projectRef(projectId));
    return project.exists() && !(project.data() as Project).deletedAt
      ? { project: project.data() as Project, role: access.role } satisfies ProjectAccess
      : null;
  }));
  return results.filter((access): access is ProjectAccess => access !== null)
    .sort((left, right) => right.project.updatedAt - left.project.updatedAt);
};

export const getProjectMember = async (projectId: string, userId: string): Promise<ProjectMember | null> => {
  const result = await getDoc(memberRef(projectId, userId));
  return result.exists() ? (result.data() as ProjectMember) : null;
};

export const listProjectMembers = async (projectId: string): Promise<ProjectMember[]> => {
  const result = await getDocs(collection(db(), "projects", projectId, "members"));
  return result.docs.map((item) => item.data() as ProjectMember);
};

export const inviteToProject = async (
  project: Project,
  inviterRole: ProjectRole,
  inviteeUserId: string,
  role: Exclude<ProjectRole, "owner"> = "member",
): Promise<ProjectInvitation> => {
  const inviterUserId = requireCurrentUserId();
  if (!canInviteToProject(project, inviterRole)) throw new Error("招待権限がありません。");
  const id = nanoid();
  const timestamp = now();
  const invitation: ProjectInvitation = {
    id, projectId: project.id, inviterUserId, inviteeUserId, role,
    status: "pending", createdAt: timestamp, updatedAt: timestamp, expiresAt: null,
  };
  await setDoc(invitationRef(id), invitation);
  return invitation;
};

export const listMyPendingInvitations = async (): Promise<ProjectInvitation[]> => {
  const userId = requireCurrentUserId();
  const result = await getDocs(query(collection(db(), "projectInvitations"), where("inviteeUserId", "==", userId), where("status", "==", "pending")));
  return result.docs.map((item) => item.data() as ProjectInvitation);
};

export const respondToProjectInvitation = async (invitationId: string, accept: boolean): Promise<void> => {
  const userId = requireCurrentUserId();
  await runTransaction(db(), async (transaction) => {
    const invitationSnapshot = await transaction.get(invitationRef(invitationId));
    if (!invitationSnapshot.exists()) throw new Error("招待が見つかりません。");
    const invitation = invitationSnapshot.data() as ProjectInvitation;
    if (invitation.inviteeUserId !== userId || invitation.status !== "pending") {
      throw new Error("この招待には応答できません。");
    }
    const timestamp = now();
    transaction.set(invitationRef(invitationId), { ...invitation, status: accept ? "accepted" : "declined", updatedAt: timestamp });
    if (accept) transaction.set(memberRef(invitation.projectId, userId), {
      userId, role: invitation.role, invitationId, joinedAt: timestamp, updatedAt: timestamp,
    } satisfies ProjectMember);
    if (accept) transaction.set(membershipRef(invitation.projectId, userId), {
      id: `${invitation.projectId}__${userId}`, projectId: invitation.projectId,
      userId, role: invitation.role, updatedAt: timestamp,
    } satisfies ProjectMembership);
  });
};

export const setProjectTaskEnabled = async (projectId: string, enabled: boolean): Promise<void> => {
  const userId = requireCurrentUserId();
  await runTransaction(db(), async (transaction) => {
    const [projectSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(projectRef(projectId)), transaction.get(memberRef(projectId, userId)),
    ]);
    if (!projectSnapshot.exists() || memberSnapshot.data()?.role !== "owner") throw new Error("設定権限がありません。");
    transaction.set(projectRef(projectId), { taskEnabled: enabled, updatedAt: now() }, { merge: true });
  });
};

/** Guild can only expose public projects through approval-required joining. */
export const setProjectGuildVisibility = async (projectId: string, isPublic: boolean): Promise<Project> => {
  const userId = requireCurrentUserId();
  return runTransaction(db(), async (transaction) => {
    const [projectSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(projectRef(projectId)), transaction.get(memberRef(projectId, userId)),
    ]);
    if (!projectSnapshot.exists() || memberSnapshot.data()?.role !== "owner") throw new Error("公開設定を変更する権限がありません。");
    const updated: Project = {
      ...(projectSnapshot.data() as Project),
      visibility: isPublic ? "public" : "private",
      joinPolicy: isPublic ? "approval_required" : "invitation_only",
      updatedAt: now(),
    };
    transaction.set(projectRef(projectId), updated);
    return updated;
  });
};

export const upsertProjectSharedNote = async (note: ProjectSharedNote): Promise<void> => {
  const userId = requireCurrentUserId();
  if (note.ownerUserId !== userId) throw new Error("自分のメモだけを共有できます。");
  await runTransaction(db(), async (transaction) => {
    const member = await transaction.get(memberRef(note.projectId, userId));
    if (!member.exists() || member.data()?.role === "viewer") throw new Error("このプロジェクトへメモを共有する権限がありません。");
    transaction.set(sharedNoteRef(note.id), note);
  });
};

export const removeProjectSharedNote = async (noteId: string): Promise<void> => {
  const userId = requireCurrentUserId();
  await runTransaction(db(), async (transaction) => {
    const snapshot = await transaction.get(sharedNoteRef(noteId));
    if (!snapshot.exists() || snapshot.data()?.ownerUserId !== userId) throw new Error("このメモの共有を解除する権限がありません。");
    transaction.delete(sharedNoteRef(noteId));
  });
};

export const listProjectSharedNotes = async (projectId: string): Promise<ProjectSharedNote[]> => {
  const result = await getDocs(query(
    collection(db(), "projectNotes"),
    where("projectId", "==", projectId),
  ));
  return result.docs
    .map((item) => item.data() as ProjectSharedNote)
    .sort((left, right) => right.updatedAt - left.updatedAt);
};

export const createProjectTask = async (input: ProjectTaskInput): Promise<ProjectTask> => {
  const userId = requireCurrentUserId();
  const id = nanoid();
  const timestamp = now();
  let creatorProfile: UserProfile | null = null;
  try {
    creatorProfile = await getProfile(userId);
  } catch {
    // A transient profile read must not prevent the member from creating work.
  }
  const task = normalizeProjectTask({
    ...input, kind: input.kind ?? "task", id, ownerUserId: userId, creatorUserId: userId, createdAt: timestamp,
    creatorDisplayName: creatorProfile?.displayName?.trim() || (creatorProfile?.username ? `@${creatorProfile.username}` : null),
    updatedAt: timestamp, completedAt: input.status === "completed" ? timestamp : null,
    deletedAt: null,
  });
  await runTransaction(db(), async (transaction) => {
    const [project, member, assignee] = await Promise.all([
      transaction.get(projectRef(task.projectId)), transaction.get(memberRef(task.projectId, userId)),
      task.assigneeUserId ? transaction.get(memberRef(task.projectId, task.assigneeUserId)) : Promise.resolve(null),
    ]);
    if (!project.exists() || project.data()?.taskEnabled !== true || !member.exists() || member.data()?.role === "viewer") throw new Error("このプロジェクトでは共有タスクを作成できません。");
    if (task.assigneeUserId && !assignee?.exists()) throw new Error("担当者はプロジェクトメンバーから選択してください。");
    transaction.set(projectTaskRef(id), task);
  });
  return task;
};

export const updateProjectTask = async (
  taskId: string,
  update: Partial<ProjectTaskUpdate>,
): Promise<ProjectTask> => {
  const userId = requireCurrentUserId();
  return runTransaction(db(), async (transaction) => {
    const taskSnapshot = await transaction.get(projectTaskRef(taskId));
    if (!taskSnapshot.exists()) throw new Error("共有タスクが見つかりません。");
    const existing = normalizeProjectTask(taskSnapshot.data() as ProjectTask);
    const membershipSnapshot = await transaction.get(memberRef(existing.projectId, userId));
    const role = membershipSnapshot.data()?.role as ProjectRole | undefined;
    const canEdit = role === "owner" || role === "member"
      || existing.ownerUserId === userId || existing.creatorUserId === userId || existing.assigneeUserId === userId;
    if (!canEdit) throw new Error("この共有タスクを編集する権限がありません。");
    if (update.assigneeUserId) {
      const assignee = await transaction.get(memberRef(existing.projectId, update.assigneeUserId));
      if (!assignee.exists()) throw new Error("担当者はプロジェクトメンバーから選択してください。");
    }
    const nextStatus = update.status ?? existing.status;
    const updated = normalizeProjectTask({
      ...existing,
      ...update,
      updatedAt: now(),
      completedAt:
        nextStatus === "completed"
          ? existing.status === "completed"
            ? existing.completedAt ?? now()
            : now()
          : null,
    });
    transaction.set(projectTaskRef(taskId), updated);
    return updated;
  });
};

/** Permanently hides a task after the same editor-permission check as an edit. */
export const deleteProjectTask = async (taskId: string): Promise<void> => {
  const userId = requireCurrentUserId();
  await runTransaction(db(), async (transaction) => {
    const taskSnapshot = await transaction.get(projectTaskRef(taskId));
    if (!taskSnapshot.exists()) throw new Error("共有タスクが見つかりません。");
    const existing = normalizeProjectTask(taskSnapshot.data() as ProjectTask);
    const membershipSnapshot = await transaction.get(memberRef(existing.projectId, userId));
    const role = membershipSnapshot.data()?.role as ProjectRole | undefined;
    const canEdit = role === "owner" || role === "member"
      || existing.ownerUserId === userId || existing.creatorUserId === userId || existing.assigneeUserId === userId;
    if (!canEdit) throw new Error("この共有タスクを消去する権限がありません。");
    transaction.set(projectTaskRef(taskId), {
      ...existing,
      deletedAt: now(),
      updatedAt: now(),
    });
  });
};

export const listProjectTasks = async (
  projectId: string,
  kind?: ProjectTask["kind"],
): Promise<ProjectTask[]> => {
  const result = await getDocs(query(
    collection(db(), "projectTasks"),
    where("projectId", "==", projectId),
  ));
  return result.docs
    .map((item) => normalizeProjectTask(item.data() as ProjectTask))
    .filter((task) => !task.deletedAt)
    .filter((task) => !kind || (task.kind ?? "task") === kind)
    .sort((left, right) => right.updatedAt - left.updatedAt);
};

export type MyProjectTask = {
  project: Project;
  task: ProjectTask;
};

/**
 * Private workspace uses this to surface only project tasks created by the
 * signed-in user. The project document remains the single source of truth.
 */
export const listMyProjectTasks = async (
  kind: ProjectTask["kind"],
): Promise<MyProjectTask[]> => {
  const userId = requireCurrentUserId();
  const projects = await listMyProjects();
  const grouped = await Promise.all(projects.map(async (project) => ({
    project,
    tasks: await listProjectTasks(project.id, kind),
  })));
  return grouped.flatMap(({ project, tasks }) => tasks
    .filter((task) => isProjectContentCreatedBy(task, userId))
    .map((task) => ({ project, task })))
    .sort((left, right) => right.task.updatedAt - left.task.updatedAt);
};
