import assert from "node:assert/strict";
import test from "node:test";

import { isSyncFirebaseUser, toSyncUser } from "../src/services/auth/syncUser.ts";

const firebaseUser = (providerId: string | null, isAnonymous = false) =>
  ({
    uid: "firebase-user-id",
    email: "user@example.com",
    displayName: "Temis User",
    isAnonymous,
    providerData: [{ providerId }],
  }) as never;

test("Cloud Sync accepts Google and Apple Firebase users", () => {
  assert.equal(isSyncFirebaseUser(firebaseUser("google.com")), true);
  assert.equal(isSyncFirebaseUser(firebaseUser("apple.com")), true);
  assert.deepEqual(toSyncUser(firebaseUser("apple.com")), {
    id: "firebase-user-id",
    email: "user@example.com",
    name: "Temis User",
  });
});

test("Cloud Sync never treats anonymous or unsupported providers as accounts", () => {
  assert.equal(isSyncFirebaseUser(firebaseUser("google.com", true)), false);
  assert.equal(isSyncFirebaseUser(firebaseUser("password")), false);
  assert.equal(isSyncFirebaseUser(null), false);
});
