import { nanoid } from "nanoid/non-secure";
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type QueryConstraint,
} from "firebase/firestore";

import { getFirebaseAuth, getFirebaseFirestore } from "../sync/firebaseApp";
import { type Connection, type Project, type ProjectMember, type ProjectMembership } from "../../types/collaboration";
import {
  extractGuildTags,
  normalizeGuildTags,
  validateGuildPostInput,
  type GuildFeedCursor,
  type GuildFeedKind,
  type GuildFeedPage,
  type GuildFeedPost,
  type GuildModerationReport,
  type OwnedGuildFeedCursor,
  type OwnedGuildFeedPage,
  type GuildPost,
  type GuildPostInput,
  type GuildReport,
  type ProjectJoinRequest,
} from "../../types/guild";

const db = () => getFirebaseFirestore();
const now = () => Date.now();
const postRef = (id: string) => doc(db(), "guildPosts", id);
const projectRef = (id: string) => doc(db(), "projects", id);
const memberRef = (projectId: string, userId: string) => doc(db(), "projects", projectId, "members", userId);
const membershipRef = (projectId: string, userId: string) => doc(db(), "projectMemberships", `${projectId}__${userId}`);
const joinRequestRef = (id: string) => doc(db(), "projectJoinRequests", id);
const reportRef = (id: string) => doc(db(), "guildReports", id);
const requireUserId = () => {
  const userId = getFirebaseAuth().currentUser?.uid;
  if (!userId) throw new Error("アカウントにログインしてからギルドを利用してください。");
  return userId;
};

const omitSource = (post: GuildPost): GuildFeedPost => {
  const { source: _source, ...safe } = post;
  return safe;
};

const assertPostBytes = (input: GuildPostInput) => {
  // Firestore has a 1 MiB document limit. Keep a conservative margin for
  // metadata while intentionally not imposing a product-level character cap.
  const approximateBytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (approximateBytes > 900_000) throw new Error("投稿データが保存可能な上限を超えています。");
};

const loadViewerRelationships = async (userId: string) => {
  const [connections, memberships] = await Promise.all([
    getDocs(query(collection(db(), "connections"), where("userIds", "array-contains", userId))),
    getDocs(query(collection(db(), "projectMemberships"), where("userId", "==", userId))),
  ]);
  const blockedUserIds = new Set<string>();
  const connectedUserIds = new Set<string>();
  for (const snapshot of connections.docs) {
    const connection = snapshot.data() as Connection;
    const otherUserId = connection.userIds.find((id) => id !== userId);
    if (!otherUserId) continue;
    if (connection.status === "blocked") blockedUserIds.add(otherUserId);
    if (connection.status === "connected") connectedUserIds.add(otherUserId);
  }
  const projectIds = new Set(
    memberships.docs.map((snapshot) => (snapshot.data() as ProjectMembership).projectId),
  );
  return { blockedUserIds, connectedUserIds, projectIds };
};

const pageQuery = (tags: string[], cursor: GuildFeedCursor | null) => {
  const constraints: QueryConstraint[] = [
    where("status", "==", "published"),
    where("moderation.visibility", "==", "visible"),
  ];
  if (tags.length) constraints.push(where("tags", "array-contains-any", tags));
  constraints.push(orderBy("publishedAt", "desc"), orderBy(documentId(), "desc"));
  if (cursor) constraints.push(startAfter(cursor.publishedAt, cursor.id));
  constraints.push(limit(24));
  return query(collection(db(), "guildPosts"), ...constraints);
};

export const listGuildPosts = async ({
  feed,
  tags,
  cursor = null,
}: {
  feed: GuildFeedKind;
  tags: string[];
  cursor?: GuildFeedCursor | null;
}): Promise<GuildFeedPage> => {
  const userId = requireUserId();
  const normalizedTags = normalizeGuildTags(tags);
  const [snapshot, relationships] = await Promise.all([
    getDocs(pageQuery(normalizedTags, cursor)),
    loadViewerRelationships(userId),
  ]);
  let posts = snapshot.docs.map((item) => item.data() as GuildPost);
  posts = posts.filter((post) => !relationships.blockedUserIds.has(post.authorUserId));

  if (feed === "connected") {
    posts = posts.filter((post) => post.authorUserId === userId
      || relationships.connectedUserIds.has(post.authorUserId)
      || Boolean(post.projectId && relationships.projectIds.has(post.projectId)));
  }

  const tail = snapshot.docs.at(-1)?.data() as GuildPost | undefined;
  return {
    posts: posts.map(omitSource),
    cursor: tail?.publishedAt ? { publishedAt: tail.publishedAt, id: tail.id } : null,
  };
};

export const getGuildPost = async (postId: string): Promise<GuildFeedPost | null> => {
  const userId = requireUserId();
  const snapshot = await getDoc(postRef(postId));
  if (!snapshot.exists()) return null;
  const post = snapshot.data() as GuildPost;
  if (post.status !== "published" || post.moderation.visibility !== "visible") return null;
  const relationships = await loadViewerRelationships(userId);
  if (relationships.blockedUserIds.has(post.authorUserId)) return null;
  return omitSource(post);
};

export const listMyGuildPosts = async (
  cursor: OwnedGuildFeedCursor | null = null,
): Promise<OwnedGuildFeedPage> => {
  const userId = requireUserId();
  const constraints: QueryConstraint[] = [
    where("authorUserId", "==", userId),
    orderBy("updatedAt", "desc"),
    orderBy(documentId(), "desc"),
  ];
  if (cursor) constraints.push(startAfter(cursor.updatedAt, cursor.id));
  constraints.push(limit(24));
  const snapshot = await getDocs(query(collection(db(), "guildPosts"), ...constraints));
  const posts = snapshot.docs.map((item) => item.data() as GuildPost);
  const tail = posts.at(-1);
  return {
    posts,
    cursor: tail ? { updatedAt: tail.updatedAt, id: tail.id } : null,
  };
};

export const getOwnedGuildPost = async (postId: string): Promise<GuildPost | null> => {
  const userId = requireUserId();
  const snapshot = await getDoc(postRef(postId));
  if (!snapshot.exists()) return null;
  const post = snapshot.data() as GuildPost;
  return post.authorUserId === userId ? post : null;
};

export const createGuildPost = async (
  input: GuildPostInput,
  author: Pick<GuildPost, "authorUserId" | "authorDisplayName" | "authorPhotoUrl">,
): Promise<GuildPost> => {
  const userId = requireUserId();
  if (author.authorUserId !== userId) throw new Error("投稿者が一致しません。");
  const error = validateGuildPostInput(input);
  if (error) throw new Error(error);
  assertPostBytes(input);
  const timestamp = now();
  const post: GuildPost = {
    id: nanoid(), authorUserId: userId,
    authorDisplayName: author.authorDisplayName.trim() || "Temisユーザー",
    authorPhotoUrl: author.authorPhotoUrl ?? null,
    title: input.title?.trim() || null,
    body: input.body.trim(), tags: extractGuildTags(input.body), type: input.type,
    projectId: input.projectId, source: input.source, status: "published",
    moderation: { visibility: "visible", hiddenByUserId: null, hiddenAt: null, reason: null },
    createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
  await runTransaction(db(), async (transaction) => {
    if (post.projectId) {
      const [project, member] = await Promise.all([
        transaction.get(projectRef(post.projectId)), transaction.get(memberRef(post.projectId, userId)),
      ]);
      if (!project.exists() || !member.exists() || member.data()?.role === "viewer") {
        throw new Error("このプロジェクトのメモを投稿する権限がありません。");
      }
    }
    transaction.set(postRef(post.id), post);
  });
  return post;
};

export const updateGuildPost = async (postId: string, input: Pick<GuildPostInput, "title" | "body" | "type" | "projectId">): Promise<void> => {
  const userId = requireUserId();
  const tags = extractGuildTags(input.body);
  if (!input.body.trim() || (input.type !== "personal" && !input.projectId)) throw new Error("投稿内容を確認してください。");
  await runTransaction(db(), async (transaction) => {
    const snapshot = await transaction.get(postRef(postId));
    if (!snapshot.exists() || snapshot.data()?.authorUserId !== userId) throw new Error("この投稿は編集できません。");
    transaction.update(postRef(postId), { title: input.title?.trim() || null, body: input.body.trim(), tags, type: input.type, projectId: input.projectId, updatedAt: now() });
  });
};

export const setGuildPostStatus = async (postId: string, status: "published" | "unpublished" | "deleted"): Promise<void> => {
  const userId = requireUserId();
  await runTransaction(db(), async (transaction) => {
    const snapshot = await transaction.get(postRef(postId));
    if (!snapshot.exists() || snapshot.data()?.authorUserId !== userId) throw new Error("この投稿は変更できません。");
    const existing = snapshot.data() as GuildPost;
    if (existing.status === "deleted" && status === "published") throw new Error("削除した投稿は再公開できません。");
    if (status === "published" && existing.source.memoId.length === 0) throw new Error("元メモがない投稿は再公開できません。");
    transaction.update(postRef(postId), { status, publishedAt: status === "published" ? now() : null, updatedAt: now() });
  });
};

export const unpublishGuildPostsForSource = async (memoId: string): Promise<void> => {
  const userId = requireUserId();
  const posts = await getDocs(query(collection(db(), "guildPosts"), where("authorUserId", "==", userId), where("source.memoId", "==", memoId)));
  await Promise.all(posts.docs.map((item) => updateDoc(item.ref, { status: "unpublished", publishedAt: null, updatedAt: now() })));
};

export const unpublishGuildPostsForProfile = async (): Promise<void> => {
  const userId = requireUserId();
  const posts = await getDocs(query(collection(db(), "guildPosts"), where("authorUserId", "==", userId), where("status", "==", "published")));
  await Promise.all(posts.docs.map((item) => updateDoc(item.ref, { status: "unpublished", publishedAt: null, updatedAt: now() })));
};

export const updateGuildPostAuthorSnapshot = async ({
  displayName,
  photoUrl,
}: { displayName: string; photoUrl: string | null }): Promise<void> => {
  const userId = requireUserId();
  const posts = await getDocs(query(collection(db(), "guildPosts"), where("authorUserId", "==", userId)));
  await Promise.all(posts.docs.map((item) => updateDoc(item.ref, {
    authorDisplayName: displayName,
    authorPhotoUrl: photoUrl ?? null,
    updatedAt: now(),
  })));
};

export const createProjectJoinRequest = async ({ projectId, role = "member", message = null }: Pick<ProjectJoinRequest, "projectId"> & { role?: "member" | "viewer"; message?: string | null }): Promise<ProjectJoinRequest> => {
  const userId = requireUserId();
  const id = `${projectId}__${userId}`;
  const timestamp = now();
  return runTransaction(db(), async (transaction) => {
    const [projectSnapshot, memberSnapshot, requestSnapshot] = await Promise.all([
      transaction.get(projectRef(projectId)), transaction.get(memberRef(projectId, userId)), transaction.get(joinRequestRef(id)),
    ]);
    const project = projectSnapshot.data() as Project | undefined;
    if (!projectSnapshot.exists() || project?.visibility !== "public" || project.joinPolicy !== "approval_required") throw new Error("このプロジェクトには参加申請できません。");
    if (memberSnapshot.exists()) throw new Error("すでにプロジェクトへ参加しています。");
    if (requestSnapshot.exists() && requestSnapshot.data()?.status === "pending") throw new Error("参加申請はすでに送信済みです。");
    const request: ProjectJoinRequest = { id, projectId, applicantUserId: userId, requestedRole: role, message: message?.trim() || null, status: "pending", createdAt: requestSnapshot.data()?.createdAt ?? timestamp, updatedAt: timestamp };
    transaction.set(joinRequestRef(id), request);
    return request;
  });
};

export const respondToProjectJoinRequest = async (requestId: string, accept: boolean): Promise<void> => {
  const userId = requireUserId();
  await runTransaction(db(), async (transaction) => {
    const requestSnapshot = await transaction.get(joinRequestRef(requestId));
    if (!requestSnapshot.exists()) throw new Error("参加申請が見つかりません。");
    const request = requestSnapshot.data() as ProjectJoinRequest;
    const projectMember = await transaction.get(memberRef(request.projectId, userId));
    if (projectMember.data()?.role !== "owner" || request.status !== "pending") throw new Error("この申請は処理できません。");
    const timestamp = now();
    transaction.update(joinRequestRef(requestId), { status: accept ? "accepted" : "declined", updatedAt: timestamp });
    if (accept) {
      transaction.set(memberRef(request.projectId, request.applicantUserId), { userId: request.applicantUserId, role: "member", invitationId: null, joinedAt: timestamp, updatedAt: timestamp } satisfies ProjectMember);
      transaction.set(membershipRef(request.projectId, request.applicantUserId), { id: `${request.projectId}__${request.applicantUserId}`, projectId: request.projectId, userId: request.applicantUserId, role: "member", updatedAt: timestamp });
    }
  });
};

export const listProjectJoinRequests = async (projectId: string): Promise<ProjectJoinRequest[]> => {
  requireUserId();
  const snapshot = await getDocs(query(
    collection(db(), "projectJoinRequests"),
    where("projectId", "==", projectId),
    orderBy("createdAt", "desc"),
  ));
  return snapshot.docs.map((item) => item.data() as ProjectJoinRequest);
};

export const reportGuildPost = async (postId: string, reason: string): Promise<GuildReport> => {
  const reporterUserId = requireUserId();
  const cleanedReason = reason.trim();
  if (!cleanedReason) throw new Error("通報理由を入力してください。");
  const post = await getDoc(postRef(postId));
  if (!post.exists()) throw new Error("投稿が見つかりません。");
  const target = post.data() as GuildPost;
  const timestamp = now();
  const report: GuildReport = { id: nanoid(), postId, reporterUserId, reportedUserId: target.authorUserId, reason: cleanedReason, status: "pending", notificationStatus: "pending", createdAt: timestamp, updatedAt: timestamp };
  await setDoc(reportRef(report.id), report);
  return report;
};

export const listGuildReports = async (): Promise<GuildModerationReport[]> => {
  requireUserId();
  const snapshot = await getDocs(query(
    collection(db(), "guildReports"),
    where("status", "==", "pending"),
    orderBy("createdAt", "desc"),
    limit(100),
  ));
  const reports = snapshot.docs.map((item) => item.data() as GuildReport);
  const postsById = new Map<string, GuildFeedPost | null>();

  await Promise.all([...new Set(reports.map((report) => report.postId))].map(async (postId) => {
    const post = await getDoc(postRef(postId));
    postsById.set(postId, post.exists() ? omitSource(post.data() as GuildPost) : null);
  }));

  return reports.map((report) => ({ ...report, post: postsById.get(report.postId) ?? null }));
};

export const completeGuildReport = async (reportId: string): Promise<void> => {
  requireUserId();
  await updateDoc(reportRef(reportId), { status: "reviewed", updatedAt: now() });
};

export const setGuildPostModeration = async (postId: string, visible: boolean, reason: string | null = null): Promise<void> => {
  const userId = requireUserId();
  await updateDoc(postRef(postId), { moderation: { visibility: visible ? "visible" : "hidden", hiddenByUserId: visible ? null : userId, hiddenAt: visible ? null : now(), reason: visible ? null : reason?.trim() || "運営判断" }, updatedAt: now() });
};
