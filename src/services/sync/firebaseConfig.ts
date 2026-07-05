export const FIREBASE_ENV_KEYS = [
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "EXPO_PUBLIC_FIREBASE_APP_ID",
] as const;

export type FirebaseEnvKey = (typeof FIREBASE_ENV_KEYS)[number];

export type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

type FirebaseEnvSource = Record<string, string | undefined>;

const normalizeValue = (value: string | undefined) => value?.trim() ?? "";

export const readFirebaseConfigFromEnv = (
  env: FirebaseEnvSource,
): FirebaseConfig => ({
  apiKey: normalizeValue(env.EXPO_PUBLIC_FIREBASE_API_KEY),
  authDomain: normalizeValue(env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: normalizeValue(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID),
  storageBucket: normalizeValue(env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: normalizeValue(env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  appId: normalizeValue(env.EXPO_PUBLIC_FIREBASE_APP_ID),
});

export const getMissingFirebaseEnvKeys = (
  env: FirebaseEnvSource,
): FirebaseEnvKey[] =>
  FIREBASE_ENV_KEYS.filter((key) => normalizeValue(env[key]).length === 0);

export const isFirebaseConfigComplete = (env: FirebaseEnvSource): boolean =>
  getMissingFirebaseEnvKeys(env).length === 0;

export const createFirebaseConfigErrorMessage = (
  env: FirebaseEnvSource,
): string => {
  const missingKeys = getMissingFirebaseEnvKeys(env);
  if (missingKeys.length === 0) {
    return "";
  }
  return `Firebase config is missing: ${missingKeys.join(", ")}.`;
};
