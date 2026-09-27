import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseApp } from "../sync/firebaseApp";
import type { Project, ProjectRole } from "../../types/collaboration";

const region = () =>
  process.env.EXPO_PUBLIC_OPENAI_FUNCTION_REGION?.trim() || "asia-northeast1";

const callable = <Request, Response>(name: string, timeout = 60_000) =>
  httpsCallable<Request, Response>(getFunctions(getFirebaseApp(), region()), name, { timeout });

export type TemisAccessState = {
  userId: string;
  tier: "free" | "plus";
  source: "revenuecat" | "staff_free" | "invite_free" | "none";
  verifiedAt: number;
  verifiedUntil: number;
  updatedAt: number;
};

export type ProjectAccessState = {
  userId: string;
  status: "ready" | "selection_required";
  membershipCount: number;
  freeProjectId: string | null;
  pendingFreeProjectId: string | null;
  updatedAt: number;
};

export type ProjectOverflowItem = {
  project: Project;
  role: ProjectRole;
  ownedNoteCount: number;
  ownedTaskCount: number;
  transferCandidates: { userId: string; label: string }[];
};

export type ProjectAccessResponse = {
  access: TemisAccessState;
  state: ProjectAccessState;
  projects: ProjectOverflowItem[];
};

export type TemisAIUsage = {
  tier: "free" | "plus";
  unlimited: boolean;
  weekKey: string;
  weekStartsAt: number;
  resetsAt: number;
  used: number;
  limit: number | null;
  remaining: number | null;
};

export type ProjectOverflowResolution = {
  projectId: string;
  action: "leave" | "transfer" | "delete";
  transferToUserId?: string;
};

export const refreshTemisAccess = async (): Promise<TemisAccessState> =>
  (await callable<Record<string, never>, TemisAccessState>("refreshTemisAccess")({})).data;

export const refreshProjectAccess = async (): Promise<ProjectAccessResponse> =>
  (await callable<Record<string, never>, ProjectAccessResponse>("refreshProjectAccess")({})).data;

export const createProjectWithQuota = async (
  input: Pick<Project, "name" | "description" | "icon" | "tags">,
): Promise<Project> => (await callable<typeof input, Project>("createProjectWithQuota")(input)).data;

export const respondToProjectInvitationWithQuota = async (
  invitationId: string,
  accept: boolean,
): Promise<void> => {
  await callable<{ invitationId: string; accept: boolean }, null>(
    "respondToProjectInvitationWithQuota",
  )({ invitationId, accept });
};

export const createProjectJoinRequestWithQuota = async <T,>(input: {
  projectId: string;
  role?: "member" | "viewer";
  message?: string | null;
}): Promise<T> => (await callable<typeof input, T>("createProjectJoinRequestWithQuota")(input)).data;

export const respondToProjectJoinRequestWithQuota = async (
  requestId: string,
  accept: boolean,
): Promise<void> => {
  await callable<{ requestId: string; accept: boolean }, null>(
    "respondToProjectJoinRequestWithQuota",
  )({ requestId, accept });
};

export const beginFreeProjectSelection = async (
  keepProjectId: string,
): Promise<ProjectAccessState> => (
  await callable<{ keepProjectId: string }, ProjectAccessState>("beginFreeProjectSelection")({ keepProjectId })
).data;

export const resolveProjectOverflow = async (
  keepProjectId: string,
  resolutions: ProjectOverflowResolution[],
): Promise<ProjectAccessResponse> => (
  await callable<
    { keepProjectId: string; resolutions: ProjectOverflowResolution[] },
    ProjectAccessResponse
  >("resolveProjectOverflow", 540_000)({ keepProjectId, resolutions })
).data;

export const getTemisAIUsage = async (): Promise<TemisAIUsage> =>
  (await callable<Record<string, never>, TemisAIUsage>("getTemisAIUsage")({})).data;

export const beginTemisAIUsage = async (
  surface: "memo" | "commons",
  requestId: string,
): Promise<TemisAIUsage> => (
  await callable<{ surface: "memo" | "commons"; requestId: string }, TemisAIUsage>(
    "beginTemisAIUsage",
  )({ surface, requestId })
).data;

export const cancelTemisAIUsage = async (requestId: string): Promise<TemisAIUsage> => (
  await callable<{ requestId: string }, TemisAIUsage>("cancelTemisAIUsage")({ requestId })
).data;

export const completeTemisAIUsage = async (requestId: string): Promise<TemisAIUsage> => (
  await callable<{ requestId: string }, TemisAIUsage>("completeTemisAIUsage")({ requestId })
).data;

export const createAIRequestId = (surface: "memo" | "commons"): string =>
  `${surface}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
