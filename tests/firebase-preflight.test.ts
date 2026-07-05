import test from "node:test";
import assert from "node:assert/strict";

import {
  parseEnvFile,
  resolveFirebasePreflight,
} from "../src/services/sync/firebasePreflight.ts";

test("env parser handles comments, export syntax, quotes, and blanks", () => {
  const parsed = parseEnvFile(`
# comment
export EXPO_PUBLIC_FIREBASE_API_KEY=" api-key "
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=auth.example.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID='project-id'
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=bucket # trailing comment
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=app-id
IGNORED_LINE
`);

  assert.deepEqual(parsed, {
    EXPO_PUBLIC_FIREBASE_API_KEY: " api-key ",
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "auth.example.com",
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: "project-id",
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "bucket",
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "",
    EXPO_PUBLIC_FIREBASE_APP_ID: "app-id",
  });
});

test("firebase preflight applies layer precedence and keeps empty overrides missing", () => {
  const result = resolveFirebasePreflight([
    {
      label: ".env",
      env: {
        EXPO_PUBLIC_FIREBASE_API_KEY: "base-key",
        EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "base.example.com",
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: "base-project",
        EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "base-bucket",
        EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "base-sender",
        EXPO_PUBLIC_FIREBASE_APP_ID: "base-app",
      },
    },
    {
      label: ".env.local",
      env: {
        EXPO_PUBLIC_FIREBASE_API_KEY: "",
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: "local-project",
      },
    },
    {
      label: "process.env",
      env: {
        EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "shell-bucket",
      },
    },
  ]);

  assert.equal(result.configComplete, false);
  assert.deepEqual(result.missingKeys, ["EXPO_PUBLIC_FIREBASE_API_KEY"]);
  assert.deepEqual(
    result.keys.find((entry) => entry.key === "EXPO_PUBLIC_FIREBASE_API_KEY"),
    {
      key: "EXPO_PUBLIC_FIREBASE_API_KEY",
      value: "",
      present: false,
      source: ".env.local",
    },
  );
  assert.equal(
    result.keys.find((entry) => entry.key === "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET")
      ?.source,
    "process.env",
  );
  assert.equal(
    result.keys.find((entry) => entry.key === "EXPO_PUBLIC_FIREBASE_PROJECT_ID")?.value,
    "local-project",
  );
});
