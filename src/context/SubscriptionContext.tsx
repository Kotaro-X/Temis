import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import Purchases, { type CustomerInfo } from "react-native-purchases";

import {
  getFirebaseAuth,
} from "../services/sync/firebaseApp";
import {
  configurePurchases,
  getCustomerInfo,
  isCloudSyncEntitled as isRevenueCatCloudSyncEntitled,
  isRevenueCatSupportedPlatform,
  purchaseCloudSyncPlan,
  restorePurchases,
} from "../services/subscription/revenueCat";
import { isRevenueCatPurchaseCancelledError } from "../services/subscription/revenueCatErrors";
import {
  grantsFreeCloudSyncAccess,
  hasInviteDiscountAccess,
  loadCloudSyncAccessGrant,
  redeemInviteCode,
  type CloudSyncAccessGrant,
} from "../services/subscription/cloudSyncAccess";
import { isGoogleSyncFirebaseUser } from "../services/auth/googleSignIn";

type SubscriptionStatus = "idle" | "loading" | "ready" | "purchasing" | "error";
type InviteStatus = "idle" | "redeeming" | "error";
type CloudSyncAccessSource =
  | "none"
  | "revenuecat"
  | "staff_free"
  | "invite_free"
  | "invite_discount";

type SubscriptionContextValue = {
  status: SubscriptionStatus;
  inviteStatus: InviteStatus;
  customerInfo: CustomerInfo | null;
  accessGrant: CloudSyncAccessGrant | null;
  revenueCatEntitled: boolean;
  isCloudSyncEntitled: boolean;
  cloudSyncAccessSource: CloudSyncAccessSource;
  discountedOfferingId: string | null;
  discountedPackageId: string | null;
  error: string | null;
  inviteError: string | null;
  purchase: () => Promise<CustomerInfo | null>;
  restore: () => Promise<CustomerInfo | null>;
  refresh: () => Promise<CustomerInfo | null>;
  redeemInviteCode: (code: string) => Promise<CloudSyncAccessGrant | null>;
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toInviteRedeemerProfile = (user: User) => ({
  userId: user.uid,
  email: user.email,
  name: user.displayName,
});

const resolveCloudSyncAccessSource = ({
  revenueCatEntitled,
  accessGrant,
}: {
  revenueCatEntitled: boolean;
  accessGrant: CloudSyncAccessGrant | null;
}): CloudSyncAccessSource => {
  if (revenueCatEntitled) {
    return "revenuecat";
  }
  if (grantsFreeCloudSyncAccess(accessGrant)) {
    return accessGrant?.grantType ?? "none";
  }
  if (hasInviteDiscountAccess(accessGrant)) {
    return "invite_discount";
  }
  return "none";
};

export const SubscriptionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [status, setStatus] = useState<SubscriptionStatus>("idle");
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("idle");
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [accessGrant, setAccessGrant] = useState<CloudSyncAccessGrant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);

  const applyCustomerInfo = useCallback((nextCustomerInfo: CustomerInfo | null) => {
    setCustomerInfo(nextCustomerInfo);
    setError(null);
    setStatus("ready");
    return nextCustomerInfo;
  }, []);

  const refreshAccessGrant = useCallback(
    async (user: User | null): Promise<CloudSyncAccessGrant | null> => {
      if (!user || !isGoogleSyncFirebaseUser(user)) {
        setAccessGrant(null);
        return null;
      }
      try {
        const nextGrant = await loadCloudSyncAccessGrant(user.uid);
        setAccessGrant(nextGrant);
        return nextGrant;
      } catch (grantError) {
        setAccessGrant(null);
        setError(formatError(grantError));
        return null;
      }
    },
    [],
  );

  const refresh = useCallback(async (): Promise<CustomerInfo | null> => {
    setStatus("loading");
    setError(null);
    try {
      const nextCustomerInfo = await getCustomerInfo();
      await refreshAccessGrant(firebaseUser);
      return applyCustomerInfo(nextCustomerInfo);
    } catch (refreshError) {
      await refreshAccessGrant(firebaseUser);
      setStatus("error");
      setError(formatError(refreshError));
      return null;
    }
  }, [applyCustomerInfo, firebaseUser, refreshAccessGrant]);

  const purchase = useCallback(async (): Promise<CustomerInfo | null> => {
    setStatus("purchasing");
    setError(null);
    try {
      const nextCustomerInfo = await purchaseCloudSyncPlan(
        hasInviteDiscountAccess(accessGrant)
          ? {
              offeringId: accessGrant?.offeringId,
              packageId: accessGrant?.packageId,
            }
          : undefined,
      );
      return applyCustomerInfo(nextCustomerInfo);
    } catch (purchaseError) {
      if (isRevenueCatPurchaseCancelledError(purchaseError)) {
        setStatus("ready");
        setError(null);
        return customerInfo;
      }
      setStatus("error");
      setError(formatError(purchaseError));
      return null;
    }
  }, [accessGrant, applyCustomerInfo, customerInfo]);

  const restore = useCallback(async (): Promise<CustomerInfo | null> => {
    setStatus("loading");
    setError(null);
    try {
      const nextCustomerInfo = await restorePurchases();
      return applyCustomerInfo(nextCustomerInfo);
    } catch (restoreError) {
      setStatus("error");
      setError(formatError(restoreError));
      return null;
    }
  }, [applyCustomerInfo]);

  const redeemInviteCodeForAccess = useCallback(
    async (code: string): Promise<CloudSyncAccessGrant | null> => {
      if (!firebaseUser || !isGoogleSyncFirebaseUser(firebaseUser)) {
        setInviteStatus("error");
        setInviteError("Sign in with Google before redeeming an invite code.");
        return null;
      }
      setInviteStatus("redeeming");
      setInviteError(null);
      try {
        const nextGrant = await redeemInviteCode(
          toInviteRedeemerProfile(firebaseUser),
          code,
        );
        setAccessGrant(nextGrant);
        setInviteStatus("idle");
        return nextGrant;
      } catch (redeemError) {
        setInviteStatus("error");
        setInviteError(formatError(redeemError));
        return null;
      }
    },
    [firebaseUser],
  );

  useEffect(() => {
    let active = true;
    let removeCustomerInfoListener = false;

    const handleCustomerInfoUpdate = (nextCustomerInfo: CustomerInfo) => {
      if (!active) {
        return;
      }
      void applyCustomerInfo(nextCustomerInfo);
    };

    const unsubscribeAuth = onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
      if (!active) {
        return;
      }
      setFirebaseUser(nextUser);
      void refreshAccessGrant(nextUser);
    });

    const bootstrap = async () => {
      setStatus("loading");
      setError(null);
      try {
        const configured = await configurePurchases();
        if (!active) {
          return;
        }
        if (configured) {
          Purchases.addCustomerInfoUpdateListener(handleCustomerInfoUpdate);
          removeCustomerInfoListener = true;
          const nextCustomerInfo = await getCustomerInfo();
          if (!active) {
            return;
          }
          applyCustomerInfo(nextCustomerInfo);
          return;
        }
      } catch (bootstrapError) {
        if (active && isRevenueCatSupportedPlatform()) {
          setError(formatError(bootstrapError));
        }
      }

      if (!active) {
        return;
      }
      setStatus("ready");
    };

    void bootstrap();

    return () => {
      active = false;
      unsubscribeAuth();
      if (removeCustomerInfoListener && isRevenueCatSupportedPlatform()) {
        Purchases.removeCustomerInfoUpdateListener(handleCustomerInfoUpdate);
      }
    };
  }, [applyCustomerInfo, refreshAccessGrant]);

  const revenueCatEntitled = isRevenueCatCloudSyncEntitled(customerInfo);
  const isCloudSyncEntitled =
    revenueCatEntitled || grantsFreeCloudSyncAccess(accessGrant);
  const cloudSyncAccessSource = resolveCloudSyncAccessSource({
    revenueCatEntitled,
    accessGrant,
  });

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      status,
      inviteStatus,
      customerInfo,
      accessGrant,
      revenueCatEntitled,
      isCloudSyncEntitled,
      cloudSyncAccessSource,
      discountedOfferingId: hasInviteDiscountAccess(accessGrant)
        ? accessGrant?.offeringId ?? null
        : null,
      discountedPackageId: hasInviteDiscountAccess(accessGrant)
        ? accessGrant?.packageId ?? null
        : null,
      error,
      inviteError,
      purchase,
      restore,
      refresh,
      redeemInviteCode: redeemInviteCodeForAccess,
    }),
    [
      accessGrant,
      cloudSyncAccessSource,
      customerInfo,
      error,
      inviteError,
      inviteStatus,
      isCloudSyncEntitled,
      purchase,
      redeemInviteCodeForAccess,
      refresh,
      restore,
      revenueCatEntitled,
      status,
    ],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error("useSubscription must be used within SubscriptionProvider");
  }
  return context;
};
