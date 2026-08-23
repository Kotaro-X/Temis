import type { User } from "firebase/auth";

export type SyncUser = {
  id: string;
  email: string | null;
  name: string | null;
};

const SUPPORTED_SYNC_PROVIDERS = new Set(["google.com", "apple.com"]);

export const isSyncFirebaseUser = (user: User | null): user is User =>
  Boolean(
    user &&
      !user.isAnonymous &&
      user.providerData.some((provider) =>
        SUPPORTED_SYNC_PROVIDERS.has(provider?.providerId ?? ""),
      ),
  );

export const toSyncUser = (user: User): SyncUser => ({
  id: user.uid,
  email: user.email,
  name: user.displayName,
});
