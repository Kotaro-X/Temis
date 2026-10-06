import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import vm from "node:vm";
import ts from "typescript";

function lifecycle(options: { apple?: boolean; cancel?: boolean; localFailure?: boolean; cloudFailure?: boolean; sync?: () => Promise<unknown>; resolve?: () => Promise<unknown> } = {}) {
  const events: string[] = [];
  let persisted: string | null = null;
  const user = { uid: "test-user", providerData: [{ providerId: options.apple ? "apple.com" : "google.com" }] };
  const modules: Record<string, unknown> = {
    react: {
      useCallback: (fn: unknown) => fn,
      useEffect: () => {},
      useRef: (current: unknown) => ({ current }),
      useState: (initial: unknown) => [initial, () => {}],
    },
    "../services/sync/syncService": { runCloudSync: options.sync ?? (async () => ({})) },
    "../services/auth/googleSignIn": {
      signOutSyncUser: async () => { events.push("sign-out"); },
    },
    "../services/auth/appleSignIn": {
      isAppleSignInCancelledError: (error: any) => error?.code === "ERR_REQUEST_CANCELED",
      requestAppleAccountDeletionAuthorizationCode: async () => {
        events.push("reauthenticate");
        if (options.cancel) throw { code: "ERR_REQUEST_CANCELED" };
        return "test-authorization";
      },
    },
    "../services/auth/syncUser": { isSyncFirebaseUser: Boolean, toSyncUser: (value: unknown) => value },
    "../services/sync/firebaseApp": { getFirebaseAuth: () => ({ currentUser: user }) },
    "../services/collaboration/profileCompletionCache": { clearCompletedProfile: async (uid: string) => {
      assert.equal(uid, 'test-user'); events.push('profile-cache-clear');
    } },
    "../services/account/accountDeletion": {
      deleteCurrentCloudAccount: async () => {
        events.push("cloud-delete");
        if (options.cloudFailure) throw new Error("offline");
        return { deleted: true, externalCleanupPending: [] };
      },
    },
    "../services/account/localAccountData": {
      deleteAllLocalAccountData: async () => {
        events.push("local-delete");
        if (options.localFailure) throw new Error("disk");
      },
    },
    "../services/subscription/revenueCat": { logOutRevenueCatUser: async () => { events.push("billing-sign-out"); } },
    "../services/account/accountDeletionState": {
      readAccountDeletionState: async () => persisted,
      saveAccountDeletionState: async (state: string) => { events.push(state); persisted = state; },
      clearAccountDeletionState: async () => { persisted = null; },
    },
    "../services/account/accountDeletionErrors": { accountDeletionErrorMessage: () => "Deletion failed" },
    "../services/account/accountDeletionBlockers": { resolveAccountDeletionBlocker: options.resolve },
    "../services/sync/syncQueueEvents": {},
    "../services/auth/waitForResolvedValue": {},
  };
  const source = readFileSync(new URL("../src/hooks/useCloudSync.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports: Record<string, any> = {};
  vm.runInNewContext(outputText, {
    exports, setTimeout, clearTimeout,
    require: (name: string) => {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return { hook: exports.useCloudSync({ enabled: true, entitled: true }), events, state: () => persisted };
}

test("cancelling Apple reauthentication does not delete cloud or local data", async () => {
  const fixture = lifecycle({ apple: true, cancel: true });
  await assert.rejects(fixture.hook.deleteAccount({ deleteLocalData: true }));
  assert.deepEqual(fixture.events, ["reauthenticate"]);
  assert.equal(fixture.state(), null);
});

test("keeping local data still signs out and persists the completed deletion state", async () => {
  const fixture = lifecycle();
  const result = await fixture.hook.deleteAccount({ deleteLocalData: false });
  assert.equal(result.deleted, true);
  assert.deepEqual(fixture.events, ["pending", "cloud-delete", "profile-cache-clear", "billing-sign-out", "sign-out", "deleted"]);
  assert.equal(fixture.state(), "deleted");
});

test("local cleanup failure is reported separately from successful cloud deletion", async () => {
  const fixture = lifecycle({ localFailure: true });
  const result = await fixture.hook.deleteAccount({ deleteLocalData: true });
  assert.equal(result.deleted, true);
  assert.equal(result.localCleanupPending, true);
  assert.ok(fixture.events.indexOf("local-delete") > fixture.events.indexOf("cloud-delete"));
  assert.equal(fixture.state(), "deleted");
});

test("network failure preserves pending state and local data for retry", async () => {
  const fixture = lifecycle({ cloudFailure: true });
  await assert.rejects(fixture.hook.deleteAccount({ deleteLocalData: true }));
  assert.deepEqual(fixture.events, ["pending", "cloud-delete"]);
  assert.equal(fixture.state(), "pending");
  assert.equal(await fixture.hook.syncNow(), null);
});

test("deletion drains an ongoing upload, blocks duplicate deletion and suppresses new sync", async () => {
  let release!: (result: unknown) => void;
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => { started = resolve; });
  const fixture = lifecycle({ sync: () => {
    started();
    return new Promise((resolve) => { release = resolve; });
  } });
  const sync = fixture.hook.syncNow();
  await didStart;
  const deletion = fixture.hook.deleteAccount({ deleteLocalData: false });
  await assert.rejects(fixture.hook.deleteAccount({ deleteLocalData: false }), /already running/);
  assert.equal(await fixture.hook.syncNow(), null);
  assert.deepEqual(fixture.events, []);
  release({ status: "success", syncedAt: 1, initialSyncCompleted: true });
  await sync;
  assert.equal((await deletion).deleted, true);
  assert.equal(fixture.state(), "deleted");
});

test("shared cleanup excludes simultaneous account deletion and releases its guard after failure", async () => {
  let reject!: (error: Error) => void;
  const fixture = lifecycle({ resolve: () => new Promise((_, fail) => { reject = fail; }) });
  const resolution = fixture.hook.resolveDeletionBlocker({ action: "delete_connections" });
  await assert.rejects(fixture.hook.deleteAccount({ deleteLocalData: true }), /cleanup already running/);
  await assert.rejects(fixture.hook.resolveDeletionBlocker({ action: "delete_connections" }), /already running/);
  assert.deepEqual(fixture.events, []);
  reject(new Error("offline"));
  await assert.rejects(resolution);
  assert.equal((await fixture.hook.deleteAccount({ deleteLocalData: false })).deleted, true);
});
