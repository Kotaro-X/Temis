import { nanoid } from "nanoid/non-secure";

import { loadSyncDeviceId, saveSyncDeviceId } from "../../../storage";
import type { SyncIdentity } from "../../types";
import { getCurrentGoogleSyncUser } from "../auth/googleSignIn";

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
  if (!user) {
    throw new Error("Sign in with Google before using Cloud Sync.");
  }
  return {
    userId: user.id,
    deviceId,
  };
};
