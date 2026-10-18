import { getAppEnvironment, assertEnvironmentReady, type AppEnvironment } from "../environment/runtimeEnvironment";
import testFirebaseConfig from "../environment/testFirebaseConfig.json";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { Auth, getAuth, initializeAuth } from "firebase/auth";
import { Firestore, getFirestore } from "firebase/firestore";

import {
  createFirebaseConfigErrorMessage,
  getFirebaseRuntimeEnv,
  isFirebaseConfigComplete,
  readFirebaseConfigFromEnv,
  type FirebaseConfig,
} from "./firebaseConfig";

declare const require: (id: string) => any;

const { getReactNativePersistence } = require("@firebase/auth/dist/rn/index.js") as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => unknown;
};

const authInstances = new Map<AppEnvironment, Auth>();
const firestoreInstances = new Map<AppEnvironment, Firestore>();

const readFirebaseConfig = (): FirebaseConfig => ({
  ...readFirebaseConfigFromEnv(getFirebaseRuntimeEnv()),
});

export const isFirebaseConfigured = (): boolean => {
  return isFirebaseConfigComplete(getFirebaseRuntimeEnv());
};

/** Production retains the default app name to preserve installed Auth persistence. */
export const getFirebaseApp = (selected?: AppEnvironment): FirebaseApp => {
  if (selected === undefined) assertEnvironmentReady();
  const environment = selected ?? getAppEnvironment();
  const name = environment === 'production' ? '[DEFAULT]' : 'temis-test';
  const existing = getApps().find(app => app.name === name);
  const config = environment === 'test' ? testFirebaseConfig : readFirebaseConfig();
  const expectedProject = environment === 'test' ? 'temis-test-c05aa' : 'temis-c05aa';
  const expectedSender = environment === 'test' ? '432065921405' : '9459134170';
  if (config.authDomain !== `${expectedProject}.firebaseapp.com`
    || ![`${expectedProject}.appspot.com`, `${expectedProject}.firebasestorage.app`].includes(config.storageBucket)
    || config.messagingSenderId !== expectedSender || !config.appId.startsWith(`1:${expectedSender}:`)) throw new Error('Firebase環境設定が一致しません。');
  if (config.projectId !== expectedProject || (existing && existing.options.projectId !== expectedProject)) {
    throw new Error('Firebase接続先が一致しません。');
  }
  if (environment === 'production' && !isFirebaseConfigured()) throw new Error(createFirebaseConfigErrorMessage(getFirebaseRuntimeEnv()));
  return existing ?? initializeApp(config, name);
};

export const getFirebaseAuth = (selected?: AppEnvironment): Auth => {
  if (selected === undefined) assertEnvironmentReady();
  const environment = selected ?? getAppEnvironment();
  const existing = authInstances.get(environment);
  if (existing) return existing;
  const app = getFirebaseApp(environment);
  let auth: Auth;
  try { auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) as any }); }
  catch (error) {
    if ((error as { code?: string }).code !== 'auth/already-initialized') throw error;
    auth = getAuth(app);
  }
  authInstances.set(environment, auth);
  return auth;
};

export const getFirebaseFirestore = (selected?: AppEnvironment): Firestore => {
  if (selected === undefined) assertEnvironmentReady();
  const environment = selected ?? getAppEnvironment();
  let firestore = firestoreInstances.get(environment);
  if (!firestore) { firestore = getFirestore(getFirebaseApp(environment)); firestoreInstances.set(environment, firestore); }
  return firestore;
};
