import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import { Auth, getAuth, initializeAuth } from "firebase/auth";
import { Firestore, getFirestore } from "firebase/firestore";

import {
  createFirebaseConfigErrorMessage,
  isFirebaseConfigComplete,
  readFirebaseConfigFromEnv,
  type FirebaseConfig,
} from "./firebaseConfig";

declare const require: (id: string) => any;

const { getReactNativePersistence } = require("@firebase/auth/dist/rn/index.js") as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => unknown;
};

let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;

const readFirebaseConfig = (): FirebaseConfig => ({
  ...readFirebaseConfigFromEnv(process.env),
});

export const isFirebaseConfigured = (): boolean => {
  return isFirebaseConfigComplete(process.env);
};

export const getFirebaseApp = () => {
  if (!isFirebaseConfigured()) {
    throw new Error(createFirebaseConfigErrorMessage(process.env));
  }
  return getApps().length > 0 ? getApp() : initializeApp(readFirebaseConfig());
};

export const getFirebaseAuth = (): Auth => {
  if (authInstance) {
    return authInstance;
  }
  const app = getFirebaseApp();
  try {
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage) as any,
    });
  } catch {
    authInstance = getAuth(app);
  }
  return authInstance;
};

export const getFirebaseFirestore = (): Firestore => {
  if (firestoreInstance) {
    return firestoreInstance;
  }
  firestoreInstance = getFirestore(getFirebaseApp());
  return firestoreInstance;
};
