import { isTestEnvironment } from "../environment/runtimeEnvironment.ts";
import type { Auth } from "firebase/auth";
import { isSyncFirebaseUser, toSyncUser, type SyncUser } from "./syncUser.ts";

export const restoreSyncSession = async (
  auth: Pick<Auth, "authStateReady" | "currentUser">,
  restoreGoogle: () => Promise<SyncUser | null>,
): Promise<SyncUser | null> => {
  // AsyncStorage restoration completes after Auth is created. Reading earlier
  // can mistake a persisted Apple session for a signed-out account.
  await auth.authStateReady();
  return isSyncFirebaseUser(auth.currentUser)
    ? toSyncUser(auth.currentUser)
    : isTestEnvironment() ? null : restoreGoogle();
};
