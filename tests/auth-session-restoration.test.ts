import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "firebase/auth";
import { restoreSyncSession } from "../src/services/auth/restoreSyncSession.ts";

const user = (providerId: string): User => ({
  uid: "saved-account", email: null, displayName: "Saved user",
  isAnonymous: false, providerData: [{ providerId }],
} as User);

for (const provider of ["apple.com", "google.com"]) {
  test(`waits for persisted ${provider} session before Google fallback`, async () => {
    let finish!: () => void;
    let googleCalls = 0;
    const auth = {
      currentUser: null as User | null,
      authStateReady: () => new Promise<void>((resolve) => { finish = resolve; }),
    };
    const pending = restoreSyncSession(auth, async () => { googleCalls++; return null; });
    assert.equal(googleCalls, 0);
    auth.currentUser = user(provider);
    finish();
    assert.deepEqual(await pending, { id: "saved-account", email: null, name: "Saved user" });
    assert.equal(googleCalls, 0);
  });
}

test("restores Google silently when no persisted supported session exists", async () => {
  let settled = false;
  const saved = { id: "google-account", email: null, name: null };
  const result = await restoreSyncSession({ currentUser: null, authStateReady: async () => { settled = true; } }, async () => {
    assert.equal(settled, true);
    return saved;
  });
  assert.deepEqual(result, saved);
});

test("an explicitly signed-out account stays signed out when Google has no session", async () => {
  assert.equal(await restoreSyncSession({ currentUser: null, authStateReady: async () => {} }, async () => null), null);
});
