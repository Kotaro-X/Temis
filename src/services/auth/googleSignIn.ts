import { GoogleSignin } from "@react-native-google-signin/google-signin";
import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";

import { getFirebaseAuth } from "../sync/firebaseApp";

export type GoogleSyncUser = {
  id: string;
  email: string | null;
  name: string | null;
};

let googleSigninConfigured = false;

const configureGoogleSignin = () => {
  if (googleSigninConfigured) {
    return;
  }
  GoogleSignin.configure();
  googleSigninConfigured = true;
};

const isGoogleFirebaseUser = (user: User | null): user is User => {
  if (!user || user.isAnonymous) {
    return false;
  }
  return user.providerData.some((provider) => provider?.providerId === "google.com");
};

const toGoogleSyncUser = (user: User): GoogleSyncUser => ({
  id: user.uid,
  email: user.email,
  name: user.displayName,
});

const signInFirebaseWithGoogleIdToken = async (
  idToken: string,
): Promise<GoogleSyncUser> => {
  const auth = getFirebaseAuth();
  if (auth.currentUser?.isAnonymous) {
    await firebaseSignOut(auth);
  }
  const credential = GoogleAuthProvider.credential(idToken);
  const result = await signInWithCredential(auth, credential);
  return toGoogleSyncUser(result.user);
};

export const getCurrentGoogleSyncUser = (): GoogleSyncUser | null => {
  const currentUser = getFirebaseAuth().currentUser;
  return isGoogleFirebaseUser(currentUser) ? toGoogleSyncUser(currentUser) : null;
};

export const restoreGoogleSyncUser = async (): Promise<GoogleSyncUser | null> => {
  configureGoogleSignin();
  const currentUser = getCurrentGoogleSyncUser();
  if (currentUser) {
    return currentUser;
  }

  const result = await GoogleSignin.signInSilently();
  if (result.type !== "success") {
    return null;
  }

  const idToken = result.data.idToken;
  if (!idToken) {
    throw new Error("Google ID token could not be obtained.");
  }

  return signInFirebaseWithGoogleIdToken(idToken);
};

export const signInGoogleSyncUser = async (): Promise<GoogleSyncUser | null> => {
  configureGoogleSignin();
  const result = await GoogleSignin.signIn();
  if (result.type !== "success") {
    return null;
  }

  const idToken = result.data.idToken;
  if (!idToken) {
    throw new Error("Google ID token could not be obtained.");
  }

  return signInFirebaseWithGoogleIdToken(idToken);
};

export const signOutGoogleSyncUser = async (): Promise<void> => {
  configureGoogleSignin();
  await firebaseSignOut(getFirebaseAuth());
  await GoogleSignin.signOut();
};
