import { nanoid } from "nanoid/non-secure";

import { loadSyncDeviceId, saveSyncDeviceId } from "../../../storage";
import type { SyncIdentity } from "../../types";
import { getCurrentGoogleSyncUser } from "../auth/googleSignIn";
import { getFirebaseAuth } from "./firebaseApp";
import { ensureSyncAuthToken } from "./syncAuth";

export const getOrCreateDeviceId = async (): Promise<string> => {
  const existing = await loadSyncDeviceId();
  if (existing) {
    return existing;
  }
  const created = nanoid();
  await saveSyncDeviceId(created);
  return created;
};

export const getSyncIdentity = async (): Promise<SyncIdentity> => {
  const [deviceId] = await Promise.all([getOrCreateDeviceId()]);
  const user = getCurrentGoogleSyncUser();
  const firebaseUser = getFirebaseAuth().currentUser;
  if (!user || !firebaseUser) {
    throw new Error("Sign in with Google before using Cloud Sync.");
  }
  // The first sync can run immediately after Google sign-in. Wait for Firebase
  // Auth to mint/restore its ID token before issuing Firestore requests.
  await ensureSyncAuthToken(() => firebaseUser.getIdToken());
  return {
    userId: user.id,
    deviceId,
  };
};
