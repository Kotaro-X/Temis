import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseApp } from "../sync/firebaseApp";

export type AccountDeletionProjectBlocker = {
  projectId: string;
  projectName: string;
  role: "owner" | "member";
  ownedTaskCount: number;
  assignedTaskCount: number;
  ownedNoteCount: number;
  transferCandidates: { userId: string; label: string }[];
};

export type AccountDeletionBlockers = {
  projects: AccountDeletionProjectBlocker[];
  counts: {
    projects: number;
    invitations: number;
    joinRequests: number;
    guildPosts: number;
    guildReports: number;
    guildModeration: number;
    connections: number;
  };
  total: number;
};

export type AccountDeletionResolution =
  | { action: "leave_project"; projectId: string }
  | { action: "transfer_project_ownership"; projectId: string; targetUserId: string }
  | { action: "delete_project"; projectId: string; confirmed: true }
  | { action: "delete_invitations" }
  | { action: "delete_connections" }
  | { action: "delete_guild_content" };

const ACCOUNT_DELETION_REGION = "asia-northeast1";

const accountDeletionFunctions = () =>
  getFunctions(getFirebaseApp(), ACCOUNT_DELETION_REGION);

export const getAccountDeletionBlockers = async (): Promise<AccountDeletionBlockers> => {
  const callable = httpsCallable<void, AccountDeletionBlockers>(
    accountDeletionFunctions(),
    "getAccountDeletionBlockers",
    { timeout: 60_000 },
  );
  return (await callable()).data;
};

export const resolveAccountDeletionBlocker = async (
  input: AccountDeletionResolution,
): Promise<AccountDeletionBlockers> => {
  const callable = httpsCallable<AccountDeletionResolution, AccountDeletionBlockers>(
    accountDeletionFunctions(),
    "resolveAccountDeletionBlocker",
    { timeout: 120_000 },
  );
  return (await callable(input)).data;
};
