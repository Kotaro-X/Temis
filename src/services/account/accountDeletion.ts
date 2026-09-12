import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseApp } from "../sync/firebaseApp";
import { assertAccountDeleted } from "./accountDeletionErrors";

export type AccountDeletionResult = {
  deleted: boolean;
  appleAuthorizationRevoked: boolean;
  externalCleanupPending: string[];
  completedStages?: string[];
  localCleanupPending?: boolean;
  signOutPending?: boolean;
};

type AccountDeletionRequest = {
  appleAuthorizationCode?: string;
};

const ACCOUNT_DELETION_REGION = "asia-northeast1";

export const deleteCurrentCloudAccount = async (
  input: AccountDeletionRequest = {},
): Promise<AccountDeletionResult> => {
  const functions = getFunctions(getFirebaseApp(), ACCOUNT_DELETION_REGION);
  const deleteAccount = httpsCallable<
    AccountDeletionRequest,
    AccountDeletionResult
  >(functions, "deleteAccount", { timeout: 150_000 });
  const result = await deleteAccount(input);
  assertAccountDeleted(result.data);
  return result.data;
};
