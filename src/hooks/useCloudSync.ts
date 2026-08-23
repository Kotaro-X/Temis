import { useCallback, useEffect, useRef, useState } from "react";

import { runCloudSync } from "../services/sync/syncService";
import type {
  SyncCapabilities,
  SyncEntityStatus,
  SyncStatus,
} from "../types";
import {
  getCurrentGoogleSyncUser,
  restoreGoogleSyncUser,
  signInGoogleSyncUser,
  signOutGoogleSyncUser,
  type GoogleSyncUser,
} from "../services/auth/googleSignIn";
import {
  isAppleSignInCancelledError,
  signInAppleSyncUser,
} from "../services/auth/appleSignIn";
import { isSyncFirebaseUser, toSyncUser, type SyncUser } from "../services/auth/syncUser";
import { getFirebaseAuth } from "../services/sync/firebaseApp";
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
  entitled,
}: {
  enabled: boolean;
  entitled: boolean;
}) => {
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResultMessage, setLastResultMessage] = useState<string | null>(null);
  const [initialSyncStatus, setInitialSyncStatus] =
    useState<SyncEntityStatus>("idle");
  const [authStatus, setAuthStatus] = useState<
    "restoring" | "signedOut" | "signingIn" | "signedIn"
  >("restoring");
  const [user, setUser] = useState<SyncUser | null>(null);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSyncStatusRef = useRef<SyncEntityStatus>("idle");
  const initialSyncUserIdRef = useRef<string | null>(null);
  const canSync = enabled && entitled;

  const updateInitialSyncStatus = useCallback((next: SyncEntityStatus) => {
    initialSyncStatusRef.current = next;
    setInitialSyncStatus(next);
  }, []);

  const clearAutoSyncTimer = useCallback(() => {
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = null;
    }
  }, []);

  const restoreSession = useCallback(async () => {
    try {
      const firebaseUser = getFirebaseAuth().currentUser;
      const restoredUser = isSyncFirebaseUser(firebaseUser)
        ? toSyncUser(firebaseUser)
        : await restoreGoogleSyncUser();
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
    if (!entitled) {
      setStatus("idle");
      setError(null);
      setLastResultMessage(null);
      clearAutoSyncTimer();
      return null;
    }
    if (!enabled) {
      setStatus("idle");
      setError(null);
      setLastResultMessage(null);
      clearAutoSyncTimer();
      return null;
    }
    const firebaseUser = getFirebaseAuth().currentUser;
    const restoredUser = isSyncFirebaseUser(firebaseUser)
      ? toSyncUser(firebaseUser)
      : getCurrentGoogleSyncUser() ?? (await restoreSession());
    if (!restoredUser) {
      setUser(null);
      setAuthStatus("signedOut");
      setStatus("idle");
      setError("Sign in before using Cloud Sync.");
      setLastResultMessage("Sign in before using Cloud Sync.");
      return null;
    }
    setUser(restoredUser);
    setAuthStatus("signedIn");
    if (initialSyncUserIdRef.current !== restoredUser.id) {
      initialSyncUserIdRef.current = restoredUser.id;
      updateInitialSyncStatus("idle");
    }
    const isInitialSync = initialSyncStatusRef.current !== "succeeded";
    setStatus("syncing");
    if (isInitialSync) {
      updateInitialSyncStatus("syncing");
    }
    setError(null);
    setLastResultMessage("Sync started.");
    const result = await runCloudSync();
    setStatus(result.status);
    setLastSyncedAt(result.syncedAt);
    setError(result.status === "error" ? result.message ?? null : null);
    setLastResultMessage(result.message ?? result.status);
    if (isInitialSync) {
      updateInitialSyncStatus(
        result.initialSyncCompleted ? "succeeded" : "failed",
      );
    }
    return result;
  }, [
    clearAutoSyncTimer,
    enabled,
    entitled,
    restoreSession,
    updateInitialSyncStatus,
  ]);

  const scheduleAutoSync = useCallback(() => {
    if (!canSync || authStatus !== "signedIn") {
      clearAutoSyncTimer();
      return;
    }
    clearAutoSyncTimer();
    autoSyncTimerRef.current = setTimeout(() => {
      autoSyncTimerRef.current = null;
      void syncNow();
    }, 750);
  }, [authStatus, canSync, clearAutoSyncTimer, syncNow]);

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

  const signInWithApple = useCallback(async () => {
    setAuthStatus("signingIn");
    setError(null);
    try {
      const signedInUser = await signInAppleSyncUser();
      setUser(signedInUser);
      setAuthStatus("signedIn");
      return signedInUser;
    } catch (signInError) {
      if (isAppleSignInCancelledError(signInError)) {
        const currentUser = getFirebaseAuth().currentUser;
        setUser(isSyncFirebaseUser(currentUser) ? toSyncUser(currentUser) : null);
        setAuthStatus(isSyncFirebaseUser(currentUser) ? "signedIn" : "signedOut");
        return null;
      }
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
      initialSyncUserIdRef.current = null;
      updateInitialSyncStatus("idle");
      setError(null);
      setLastResultMessage("Signed out.");
    } catch (signOutError) {
      const message =
        signOutError instanceof Error ? signOutError.message : String(signOutError);
      setError(message);
      setLastResultMessage(message);
    }
  }, [updateInitialSyncStatus]);

  useEffect(() => {
    const unsubscribe = subscribeSyncQueueChanges(() => {
      scheduleAutoSync();
    });
    return () => {
      unsubscribe();
    };
  }, [scheduleAutoSync]);

  useEffect(() => {
    if (canSync && authStatus === "signedIn") {
      scheduleAutoSync();
      return;
    }
    clearAutoSyncTimer();
  }, [authStatus, canSync, clearAutoSyncTimer, scheduleAutoSync]);

  useEffect(
    () => () => {
      clearAutoSyncTimer();
    },
    [clearAutoSyncTimer],
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
    signInWithApple,
    signOut,
    capabilities: SYNC_CAPABILITIES,
    initialSyncStatus,
    // Local data remains usable while both the first and later syncs run.
    isInitialSyncBlocking: false,
  };
};
