import { useCallback, useEffect, useRef, useState } from "react";

import { runCloudSync } from "../services/sync/syncService";
import type {
  SyncCapabilities,
  SyncEntityStatus,
  SyncEntityType,
  SyncResult,
  SyncStatus,
} from "../types";
import {
  getCurrentGoogleSyncUser,
  restoreGoogleSyncUser,
  signInGoogleSyncUser,
  signOutSyncUser,
} from "../services/auth/googleSignIn";
import {
  isAppleSignInCancelledError,
  requestAppleAccountDeletionAuthorizationCode,
  signInAppleSyncUser,
} from "../services/auth/appleSignIn";
import { deleteCurrentCloudAccount, type AccountDeletionResult } from "../services/account/accountDeletion";
import { deleteAllLocalAccountData } from "../services/account/localAccountData";
import { logOutRevenueCatUser } from "../services/subscription/revenueCat";
import { isSyncFirebaseUser, toSyncUser, type SyncUser } from "../services/auth/syncUser";
import { getFirebaseAuth } from "../services/sync/firebaseApp";
import { subscribeSyncQueueChanges } from "../services/sync/syncQueueEvents";
import { waitForResolvedValue } from "../services/auth/waitForResolvedValue";
import { clearAccountDeletionState, readAccountDeletionState, saveAccountDeletionState } from "../services/account/accountDeletionState";
import { accountDeletionErrorMessage } from "../services/account/accountDeletionErrors";
import {
  getAccountDeletionBlockers,
  resolveAccountDeletionBlocker,
  type AccountDeletionBlockers,
  type AccountDeletionResolution,
} from "../services/account/accountDeletionBlockers";

const SYNC_CAPABILITIES: SyncCapabilities = {
  tag: "enabled",
  todo: "enabled",
  task: "enabled",
  memo: "enabled",
};

export const useCloudSync = ({
  enabled,
  entitled,
  onEntitySynced,
}: {
  enabled: boolean;
  entitled: boolean;
  onEntitySynced?: (entity: SyncEntityType) => Promise<void> | void;
}) => {
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResultMessage, setLastResultMessage] = useState<string | null>(null);
  const [initialSyncStatus, setInitialSyncStatus] =
    useState<SyncEntityStatus>("idle");
  const [authStatus, setAuthStatus] = useState<
    "restoring" | "signedOut" | "signingIn" | "deleting" | "signedIn"
  >("restoring");
  const [user, setUser] = useState<SyncUser | null>(null);
  const [accountDeletionBlockers, setAccountDeletionBlockers] =
    useState<AccountDeletionBlockers | null>(null);
  const [accountDeletionBlockersStatus, setAccountDeletionBlockersStatus] =
    useState<"idle" | "loading" | "error">("idle");
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncInFlightRef = useRef<Promise<SyncResult | null> | null>(null);
  const autoSyncPendingRef = useRef(false);
  const scheduleAutoSyncRef = useRef<() => void>(() => {});
  const syncSuspendedRef = useRef(false);
  const deletingRef = useRef(false);
  const resolvingDeletionRef = useRef(false);
  const entityCallbackRef = useRef(onEntitySynced);
  entityCallbackRef.current = onEntitySynced;
  const canSync = enabled && entitled;

  const clearAutoSyncTimer = useCallback(() => {
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = null;
    }
  }, []);

  const restoreSession = useCallback(async () => {
    try {
      const deletionState = await readAccountDeletionState();
      if (deletionState) {
        syncSuspendedRef.current = true;
        const current = getFirebaseAuth().currentUser;
        const remainingUser = deletionState === "pending" && isSyncFirebaseUser(current) ? toSyncUser(current) : null;
        setUser(remainingUser);
        setAuthStatus(remainingUser ? "signedIn" : "signedOut");
        if (deletionState === "pending") setError(accountDeletionErrorMessage(null));
        if (deletionState === "deleted") await signOutSyncUser({ accountDeleted: true }).catch(() => {});
        return remainingUser;
      }
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

  const syncNow = useCallback((): Promise<SyncResult | null> => {
    if (syncSuspendedRef.current) return Promise.resolve(null);
    if (syncInFlightRef.current) {
      return syncInFlightRef.current;
    }
    clearAutoSyncTimer();

    const operation = (async (): Promise<SyncResult | null> => {
      if (await readAccountDeletionState()) {
        syncSuspendedRef.current = true;
        return null;
      }
      if (!entitled || !enabled) {
        autoSyncPendingRef.current = false;
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
      if (syncSuspendedRef.current) return null;
      setUser(restoredUser);
      setAuthStatus("signedIn");
      setStatus("syncing");
      setInitialSyncStatus("syncing");
      setError(null);
      setLastResultMessage("Sync started.");
      const result = await runCloudSync((entity) => entityCallbackRef.current?.(entity));
      setStatus(result.status);
      setLastSyncedAt(result.syncedAt);
      setError(result.status === "error" ? result.message ?? null : null);
      setLastResultMessage(result.message ?? result.status);
      setInitialSyncStatus(
        result.initialSyncCompleted ? "succeeded" : "failed",
      );
      return result;
    })().catch(() => {
      setStatus("error");
      setInitialSyncStatus("failed");
      setError("同期を完了できませんでした。接続を確認して再試行してください。");
      return null;
    });

    syncInFlightRef.current = operation;
    void operation
      .then((result) => {
        if (syncInFlightRef.current !== operation) {
          return;
        }
        syncInFlightRef.current = null;
        if (autoSyncPendingRef.current) {
          autoSyncPendingRef.current = false;
          // A failed bootstrap must not keep scheduling itself indefinitely.
          if (result?.status === "synced" && !syncSuspendedRef.current) scheduleAutoSyncRef.current();
        }
      })
      .catch(() => {
        // Sync errors are converted to a user-visible SyncResult above.
      });
    return operation;
  }, [clearAutoSyncTimer, enabled, entitled, restoreSession]);

  const scheduleAutoSync = useCallback(() => {
    if (syncSuspendedRef.current || !canSync || authStatus !== "signedIn") {
      autoSyncPendingRef.current = false;
      clearAutoSyncTimer();
      return;
    }
    if (syncInFlightRef.current) {
      autoSyncPendingRef.current = true;
      return;
    }
    clearAutoSyncTimer();
    autoSyncTimerRef.current = setTimeout(() => {
      autoSyncTimerRef.current = null;
      void syncNow();
    }, 750);
  }, [authStatus, canSync, clearAutoSyncTimer, syncNow]);

  scheduleAutoSyncRef.current = scheduleAutoSync;

  const signIn = useCallback(async () => {
    syncSuspendedRef.current = false;
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
      await clearAccountDeletionState();
      setAccountDeletionBlockers(null);
      setAccountDeletionBlockersStatus("idle");
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
    syncSuspendedRef.current = false;
    setAuthStatus("signingIn");
    setError(null);
    try {
      const signedInUser = await signInAppleSyncUser();
      await clearAccountDeletionState();
      setUser(signedInUser);
      setAccountDeletionBlockers(null);
      setAccountDeletionBlockersStatus("idle");
      setAuthStatus("signedIn");
      return signedInUser;
    } catch (signInError) {
      if (isAppleSignInCancelledError(signInError)) {
        const currentUser = getFirebaseAuth().currentUser;
        const restoredUser = isSyncFirebaseUser(currentUser)
          ? toSyncUser(currentUser)
          : null;
        setUser(restoredUser);
        setAuthStatus(restoredUser ? "signedIn" : "signedOut");
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
    syncSuspendedRef.current = true;
    autoSyncPendingRef.current = false;
    clearAutoSyncTimer();
    try {
      await syncInFlightRef.current;
      await signOutSyncUser();
      setUser(null);
      setAccountDeletionBlockers(null);
      setAccountDeletionBlockersStatus("idle");
      setAuthStatus("signedOut");
      setStatus("idle");
      setInitialSyncStatus("idle");
      setError(null);
      setLastResultMessage("Signed out.");
    } catch (signOutError) {
      const message =
        signOutError instanceof Error ? signOutError.message : String(signOutError);
      setError(message);
      setLastResultMessage(message);
    }
  }, [clearAutoSyncTimer]);

  const deleteAccount = useCallback(
    async ({ deleteLocalData }: { deleteLocalData: boolean }): Promise<AccountDeletionResult> => {
      if (deletingRef.current) throw new Error("Account deletion already running");
      if (resolvingDeletionRef.current) throw new Error("Shared data cleanup already running");
      const firebaseUser = getFirebaseAuth().currentUser;
      if (!isSyncFirebaseUser(firebaseUser)) {
        throw new Error("Sign in before deleting an account.");
      }
      deletingRef.current = true;
      setAuthStatus("deleting");
      syncSuspendedRef.current = true;
      autoSyncPendingRef.current = false;
      clearAutoSyncTimer();
      setError(null);
      setLastResultMessage(null);
      let cloudDeleted = false;
      let priorDeletionPending = true;
      try {
        // Drain any upload already started before contacting the delete function.
        await syncInFlightRef.current;
        priorDeletionPending = Boolean(await readAccountDeletionState());
        const usesAppleSignIn = firebaseUser.providerData.some(
          (provider) => provider.providerId === "apple.com",
        );
        const appleAuthorizationCode = usesAppleSignIn
          ? await requestAppleAccountDeletionAuthorizationCode()
          : null;
        if (usesAppleSignIn && !appleAuthorizationCode) {
          throw Object.assign(new Error("Cancelled"), { code: "ERR_REQUEST_CANCELED" });
        }
        await saveAccountDeletionState("pending");
        const result = await deleteCurrentCloudAccount(
          appleAuthorizationCode ? { appleAuthorizationCode } : {},
        );
        cloudDeleted = true;

        // The cloud account is gone at this point. Sign out locally before
        // clearing storage so Firebase and RevenueCat cannot retain the old UID.
        const cleanup = await Promise.allSettled([logOutRevenueCatUser(), signOutSyncUser({ accountDeleted: true })]);
        const signOutPending = cleanup[1].status === "rejected";
        let localCleanupPending = false;
        try {
          if (deleteLocalData) await deleteAllLocalAccountData();
        } catch {
          localCleanupPending = true;
        }
        // Keep silent Google restoration disabled even when local storage was cleared.
        await saveAccountDeletionState("deleted");
        setUser(null);
        setAccountDeletionBlockers(null);
        setAccountDeletionBlockersStatus("idle");
        setAuthStatus("signedOut");
        setStatus("idle");
        setInitialSyncStatus("idle");
        setLastResultMessage("Account deleted.");
        return { ...result, localCleanupPending, signOutPending };
      } catch (deleteError) {
        const details = (deleteError as { details?: { stage?: string } })?.details;
        if (details?.stage === "shared_data" && !priorDeletionPending) {
          await clearAccountDeletionState();
          syncSuspendedRef.current = false;
        }
        if (isAppleSignInCancelledError(deleteError) && !priorDeletionPending) syncSuspendedRef.current = false;
        const message = cloudDeleted
          ? "Firebaseアカウントとクラウドデータは削除済みです。端末の後処理に失敗しました。アプリを再起動し、端末データの状態を確認してください。"
          : accountDeletionErrorMessage(deleteError);
        setAuthStatus(cloudDeleted ? "signedOut" : "signedIn");
        if (cloudDeleted) setUser(null);
        setStatus("idle");
        setError(message);
        setLastResultMessage(message);
        throw deleteError;
      } finally {
        deletingRef.current = false;
      }
    },
    [clearAutoSyncTimer],
  );

  const loadAccountDeletionBlockers = useCallback(async () => {
    setAccountDeletionBlockersStatus("loading");
    try {
      const blockers = await getAccountDeletionBlockers();
      setAccountDeletionBlockers(blockers);
      setAccountDeletionBlockersStatus("idle");
      return blockers;
    } catch (blockerError) {
      setAccountDeletionBlockersStatus("error");
      setError("共有データを確認できませんでした。接続を確認して再読み込みしてください。アカウントの削除は開始していません。");
      throw blockerError;
    }
  }, []);

  const resolveDeletionBlocker = useCallback(
    async (input: AccountDeletionResolution) => {
      if (deletingRef.current || resolvingDeletionRef.current) {
        throw new Error("Account deletion operation already running");
      }
      resolvingDeletionRef.current = true;
      setAccountDeletionBlockersStatus("loading");
      try {
        const blockers = await resolveAccountDeletionBlocker(input);
        setAccountDeletionBlockers(blockers);
        setAccountDeletionBlockersStatus("idle");
        return blockers;
      } catch (blockerError) {
        setAccountDeletionBlockersStatus("error");
        setError("共有データの整理を完了できませんでした。一部の整理が完了している可能性があります。再読み込みして残っている項目を確認してください。アカウント本体の削除は開始していません。");
        throw blockerError;
      } finally {
        resolvingDeletionRef.current = false;
      }
    },
    [],
  );

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
    deleteAccount,
    accountDeletionBlockers,
    accountDeletionBlockersStatus,
    loadAccountDeletionBlockers,
    resolveDeletionBlocker,
    capabilities: SYNC_CAPABILITIES,
    initialSyncStatus,
  };
};
