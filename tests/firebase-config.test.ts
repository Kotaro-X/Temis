import test from "node:test";
import assert from "node:assert/strict";

import {
  FIREBASE_ENV_KEYS,
  createFirebaseConfigErrorMessage,
  getMissingFirebaseEnvKeys,
  isFirebaseConfigComplete,
  readFirebaseConfigFromEnv,
} from "../src/services/sync/firebaseConfig.ts";

test("firebase config reader trims values from env", () => {
  const config = readFirebaseConfigFromEnv({
    EXPO_PUBLIC_FIREBASE_API_KEY: " key ",
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: " auth.example.com ",
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: " project-id ",
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: " bucket ",
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: " sender ",
    EXPO_PUBLIC_FIREBASE_APP_ID: " app-id ",
  });

  assert.deepEqual(config, {
    apiKey: "key",
    authDomain: "auth.example.com",
    projectId: "project-id",
    storageBucket: "bucket",
    messagingSenderId: "sender",
    appId: "app-id",
  });
});

test("firebase config helper reports the exact missing env keys", () => {
  const missing = getMissingFirebaseEnvKeys({
    EXPO_PUBLIC_FIREBASE_API_KEY: "configured",
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "",
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: "project-id",
  });

  assert.deepEqual(missing, [
    "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "EXPO_PUBLIC_FIREBASE_APP_ID",
  ]);
});

test("firebase config completeness and error message stay aligned", () => {
  assert.equal(isFirebaseConfigComplete({}), false);
  assert.equal(
    createFirebaseConfigErrorMessage({}),
    `Firebase config is missing: ${FIREBASE_ENV_KEYS.join(", ")}.`,
  );
});
