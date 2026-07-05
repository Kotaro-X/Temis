import { useCallback, useEffect, useRef, useState } from "react";

import { runCloudSync } from "../services/sync/syncService";
import type { SyncCapabilities, SyncStatus } from "../types";
import {
  getCurrentGoogleSyncUser,
  restoreGoogleSyncUser,
  signInGoogleSyncUser,
  signOutGoogleSyncUser,
  type GoogleSyncUser,
} from "../services/auth/googleSignIn";
import { subscribeSyncQueueChanges } from "../services/sync/syncQueueEvents";
import { waitForResolvedValue } from "../services/auth/waitForResolvedValue";

const SYNC_CAPABILITIES: SyncCapabilities = {
  tag: "enabled",
  todo: "enabled",
  task: "enabled",
  memo: "enabled",
};

export const useCloudSync = ({
  enabled,
}: {
  enabled: boolean;
}) => {
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResultMessage, setLastResultMessage] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<
    "restoring" | "signedOut" | "signingIn" | "signedIn"
  >("restoring");
  const [user, setUser] = useState<GoogleSyncUser | null>(null);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restoreSession = useCallback(async () => {
    try {
      const restoredUser = await restoreGoogleSyncUser();
      setUser(restoredUser);
      setAuthStatus(restoredUser ? "signedIn" : "signedOut");
      return restoredUser;
    } catch (restoreError) {
      const message =
        restoreError instanceof Error ? restoreError.message : String(restoreError);
      setUser(null);
      setAuthStatus("signedOut");
      setError(message);
      return null;
    }
  }, []);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const syncNow = useCallback(async () => {
    if (!enabled) {
      setStatus("idle");
      setError("Cloud Sync is disabled.");
      setLastResultMessage("Cloud Sync is disabled.");
      return null;
    }
    const restoredUser = getCurrentGoogleSyncUser() ?? (await restoreSession());
    if (!restoredUser) {
      setUser(null);
      setAuthStatus("signedOut");
      setStatus("idle");
      setError("Sign in with Google before using Cloud Sync.");
      setLastResultMessage("Sign in with Google before using Cloud Sync.");
      return null;
    }
    setUser(restoredUser);
    setAuthStatus("signedIn");
    setStatus("syncing");
    setError(null);
    setLastResultMessage("Sync started.");
    const result = await runCloudSync();
    setStatus(result.status);
    setLastSyncedAt(result.syncedAt);
    setError(result.status === "error" ? result.message ?? null : null);
    setLastResultMessage(result.message ?? result.status);
    return result;
  }, [enabled, restoreSession]);

  const scheduleAutoSync = useCallback(() => {
    if (!enabled || authStatus !== "signedIn") {
      return;
    }
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
    }
    autoSyncTimerRef.current = setTimeout(() => {
      autoSyncTimerRef.current = null;
      void syncNow();
    }, 750);
  }, [authStatus, enabled, syncNow]);

  const signIn = useCallback(async () => {
    setAuthStatus("signingIn");
    setError(null);
    try {
      const signedInUser =
        (await signInGoogleSyncUser()) ??
        (await waitForResolvedValue(
          async () => {
            return getCurrentGoogleSyncUser() ?? (await restoreGoogleSyncUser());
          },
          { attempts: 4, delayMs: 400 },
        ));
      if (!signedInUser) {
        const currentUser = getCurrentGoogleSyncUser();
        setUser(currentUser);
        setAuthStatus(currentUser ? "signedIn" : "signedOut");
        return null;
      }
      setUser(signedInUser);
      setAuthStatus("signedIn");
      return signedInUser;
    } catch (signInError) {
      const message =
        signInError instanceof Error ? signInError.message : String(signInError);
      setUser(null);
      setAuthStatus("signedOut");
      setError(message);
      setLastResultMessage(message);
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await signOutGoogleSyncUser();
      setUser(null);
      setAuthStatus("signedOut");
      setStatus("idle");
      setError(null);
      setLastResultMessage("Signed out.");
    } catch (signOutError) {
      const message =
        signOutError instanceof Error ? signOutError.message : String(signOutError);
      setError(message);
      setLastResultMessage(message);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeSyncQueueChanges(() => {
      scheduleAutoSync();
    });
    return () => {
      unsubscribe();
    };
  }, [scheduleAutoSync]);

  useEffect(() => {
    if (enabled && authStatus === "signedIn") {
      scheduleAutoSync();
      return;
    }
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = null;
    }
  }, [authStatus, enabled, scheduleAutoSync]);

  useEffect(
    () => () => {
      if (autoSyncTimerRef.current) {
        clearTimeout(autoSyncTimerRef.current);
      }
    },
    [],
  );

  return {
    status,
    lastSyncedAt,
    error,
    lastResultMessage,
    syncNow,
    authStatus,
    user,
    signIn,
    signOut,
    capabilities: SYNC_CAPABILITIES,
  };
};
