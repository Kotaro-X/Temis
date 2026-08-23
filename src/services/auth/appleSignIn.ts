import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import {
  OAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth";

import { getFirebaseAuth } from "../sync/firebaseApp";
import { toSyncUser, type SyncUser } from "./syncUser";

const nonceFromBytes = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const displayNameFromCredential = (
  fullName: AppleAuthentication.AppleAuthenticationFullName | null,
): string | null => {
  const value = [fullName?.givenName, fullName?.familyName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim();
  return value || null;
};

export const isAppleSignInAvailable = (): Promise<boolean> =>
  AppleAuthentication.isAvailableAsync();

export const isAppleSignInCancelledError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "ERR_REQUEST_CANCELED";

export const signInAppleSyncUser = async (): Promise<SyncUser> => {
  const rawNonce = nonceFromBytes(await Crypto.getRandomBytesAsync(32));
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
  const appleCredential = await AppleAuthentication.signInAsync({
    nonce: hashedNonce,
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!appleCredential.identityToken) {
    throw new Error("Apple ID token could not be obtained.");
  }

  const auth = getFirebaseAuth();
  if (auth.currentUser?.isAnonymous) {
    await firebaseSignOut(auth);
  }
  const provider = new OAuthProvider("apple.com");
  const credential = provider.credential({
    idToken: appleCredential.identityToken,
    rawNonce,
  });
  const result = await signInWithCredential(auth, credential);
  const displayName = displayNameFromCredential(appleCredential.fullName);
  if (displayName && !result.user.displayName) {
    await updateProfile(result.user, { displayName });
  }
  return toSyncUser(getFirebaseAuth().currentUser ?? result.user);
};
