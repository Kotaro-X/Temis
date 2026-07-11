import {
  collection,
  doc,
  getDoc,
  runTransaction,
} from "firebase/firestore";

import { getFirebaseFirestore } from "../sync/firebaseApp";

export type CloudSyncGrantType =
  | "staff_free"
  | "invite_free"
  | "invite_discount";

export type CloudSyncAccessGrant = {
  userId: string;
  active: boolean;
  grantType: CloudSyncGrantType;
  inviteCode: string | null;
  offeringId: string | null;
  packageId: string | null;
  expiresAt: number | null;
  grantedBy: string | null;
  note: string | null;
  redeemedAt: number | null;
  updatedAt: number | null;
};

export type InviteCodeRecord = {
  code: string;
  active: boolean;
  grantType: Extract<CloudSyncGrantType, "invite_free" | "invite_discount">;
  offeringId: string | null;
  packageId: string | null;
  expiresAt: number | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  createdBy: string | null;
  note: string | null;
  updatedAt: number | null;
};

export type InviteRedeemerProfile = {
  userId: string;
  email: string | null;
  name: string | null;
};

const getSubscriptionAccessDoc = (userId: string) =>
  doc(getFirebaseFirestore(), "subscriptionAccess", userId);

const getInviteCodeDoc = (code: string) =>
  doc(getFirebaseFirestore(), "inviteCodes", code);

const getInviteRedemptionDoc = (code: string, userId: string) =>
  doc(collection(getInviteCodeDoc(code), "redemptions"), userId);

const normalizeString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const normalizeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeBoolean = (value: unknown): boolean => value === true;

const isCloudSyncGrantType = (value: unknown): value is CloudSyncGrantType =>
  value === "staff_free" || value === "invite_free" || value === "invite_discount";

const isInviteGrantType = (
  value: unknown,
): value is Extract<CloudSyncGrantType, "invite_free" | "invite_discount"> =>
  value === "invite_free" || value === "invite_discount";

export const normalizeInviteCode = (value: string): string =>
  value.replace(/\s+/g, "").trim().toUpperCase();

export const parseCloudSyncAccessGrant = (
  userId: string,
  raw: unknown,
): CloudSyncAccessGrant | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!isCloudSyncGrantType(record.grantType)) {
    return null;
  }
  return {
    userId,
    active: normalizeBoolean(record.active),
    grantType: record.grantType,
    inviteCode: normalizeString(record.inviteCode),
    offeringId: normalizeString(record.offeringId),
    packageId: normalizeString(record.packageId),
    expiresAt: normalizeNumber(record.expiresAt),
    grantedBy: normalizeString(record.grantedBy),
    note: normalizeString(record.note),
    redeemedAt: normalizeNumber(record.redeemedAt),
    updatedAt: normalizeNumber(record.updatedAt),
  };
};

const parseInviteCodeRecord = (
  code: string,
  raw: unknown,
): InviteCodeRecord | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!isInviteGrantType(record.grantType)) {
    return null;
  }
  return {
    code,
    active: normalizeBoolean(record.active),
    grantType: record.grantType,
    offeringId: normalizeString(record.offeringId),
    packageId: normalizeString(record.packageId),
    expiresAt: normalizeNumber(record.expiresAt),
    maxRedemptions: normalizeNumber(record.maxRedemptions),
    redeemedCount:
      typeof record.redeemedCount === "number" && Number.isFinite(record.redeemedCount)
        ? Math.max(0, Math.floor(record.redeemedCount))
        : 0,
    createdBy: normalizeString(record.createdBy),
    note: normalizeString(record.note),
    updatedAt: normalizeNumber(record.updatedAt),
  };
};

export const isCloudSyncGrantActive = (
  grant: CloudSyncAccessGrant | null | undefined,
  now = Date.now(),
): boolean => {
  if (!grant?.active) {
    return false;
  }
  return grant.expiresAt === null || grant.expiresAt > now;
};

export const grantsFreeCloudSyncAccess = (
  grant: CloudSyncAccessGrant | null | undefined,
): boolean =>
  isCloudSyncGrantActive(grant) &&
  (grant?.grantType === "staff_free" || grant?.grantType === "invite_free");

export const hasInviteDiscountAccess = (
  grant: CloudSyncAccessGrant | null | undefined,
): boolean => isCloudSyncGrantActive(grant) && grant?.grantType === "invite_discount";

export const loadCloudSyncAccessGrant = async (
  userId: string,
): Promise<CloudSyncAccessGrant | null> => {
  const snapshot = await getDoc(getSubscriptionAccessDoc(userId));
  if (!snapshot.exists()) {
    return null;
  }
  return parseCloudSyncAccessGrant(userId, snapshot.data());
};

export const redeemInviteCode = async (
  profile: InviteRedeemerProfile,
  inputCode: string,
): Promise<CloudSyncAccessGrant> => {
  const code = normalizeInviteCode(inputCode);
  if (!code) {
    throw new Error("Invite code is empty.");
  }

  const firestore = getFirebaseFirestore();
  return runTransaction(firestore, async (transaction) => {
    const inviteRef = getInviteCodeDoc(code);
    const accessRef = getSubscriptionAccessDoc(profile.userId);
    const redemptionRef = getInviteRedemptionDoc(code, profile.userId);

    const [inviteSnapshot, accessSnapshot, redemptionSnapshot] = await Promise.all([
      transaction.get(inviteRef),
      transaction.get(accessRef),
      transaction.get(redemptionRef),
    ]);

    if (!inviteSnapshot.exists()) {
      throw new Error("Invite code was not found.");
    }

    const invite = parseInviteCodeRecord(code, inviteSnapshot.data());
    if (!invite || !invite.active) {
      throw new Error("Invite code is not active.");
    }
    if (invite.expiresAt !== null && invite.expiresAt <= Date.now()) {
      throw new Error("Invite code has expired.");
    }
    if (
      invite.maxRedemptions !== null &&
      invite.redeemedCount >= invite.maxRedemptions &&
      !redemptionSnapshot.exists()
    ) {
      throw new Error("Invite code has reached its redemption limit.");
    }

    const existingGrant = accessSnapshot.exists()
      ? parseCloudSyncAccessGrant(profile.userId, accessSnapshot.data())
      : null;
    if (
      existingGrant &&
      existingGrant.grantType === "staff_free" &&
      isCloudSyncGrantActive(existingGrant)
    ) {
      throw new Error("This account already has a staff grant.");
    }
    if (
      existingGrant &&
      existingGrant.inviteCode &&
      existingGrant.inviteCode !== code &&
      isCloudSyncGrantActive(existingGrant) &&
      existingGrant.grantType !== "staff_free"
    ) {
      throw new Error("This account already redeemed another invite code.");
    }

    const now = Date.now();
    const nextGrant: CloudSyncAccessGrant = {
      userId: profile.userId,
      active: true,
      grantType: invite.grantType,
      inviteCode: invite.code,
      offeringId: invite.offeringId,
      packageId: invite.packageId,
      expiresAt: invite.expiresAt,
      grantedBy: invite.createdBy,
      note: invite.note,
      redeemedAt:
        existingGrant?.inviteCode === code && existingGrant.redeemedAt !== null
          ? existingGrant.redeemedAt
          : now,
      updatedAt: now,
    };

    transaction.set(accessRef, nextGrant, { merge: true });

    if (!redemptionSnapshot.exists()) {
      transaction.set(redemptionRef, {
        userId: profile.userId,
        inviteCode: invite.code,
        grantType: invite.grantType,
        email: profile.email,
        name: profile.name,
        redeemedAt: now,
      });
      transaction.set(
        inviteRef,
        {
          redeemedCount: invite.redeemedCount + 1,
          updatedAt: now,
        },
        { merge: true },
      );
    }

    return nextGrant;
  });
};
