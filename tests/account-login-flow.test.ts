import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createAccountWorkspaceStore } from "../src/services/account/accountWorkspaceCore.ts";
import { loadAccountEntryState, saveAccountEntryState } from "../src/services/auth/accountEntryPolicy.ts";
import { restoreSyncSession } from "../src/services/auth/restoreSyncSession.ts";
import { isSyncFirebaseUser, toSyncUser } from "../src/services/auth/syncUser.ts";
import { withAllLocalEntityMutations } from "../src/services/sync/localMutationLock.ts";

function load(path: string, modules: Record<string, any>, globals: Record<string, any> = {}) {
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, ...globals, require: (name: string) => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`);
    return modules[name];
  } });
  return exports;
}

const firebaseUser = (uid: string, provider = "apple.com") => ({ uid, email: null, displayName: "Saved name", isAnonymous: false, providerData: [{ providerId: provider }] });

function fixture(initial: Record<string, string> = {}, restored: any = null) {
  const values = new Map(Object.entries(initial));
  const storage = { getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); } };
  const workspace = createAccountWorkspaceStore(storage);
  const entry = load("src/services/auth/accountEntry.ts", {
    "../account/accountWorkspace": storage,
    "./accountEntryPolicy": { loadAccountEntryState, saveAccountEntryState },
  });
  const auth = { currentUser: restored, authStateReady: async () => {} };
  let cancelled = false;
  let nextUid = "original-account";
  let entitled = true;
  let googleRestoreCalls = 0;
  let syncCalls = 0;
  const slots: any[] = [];
  let cursor = 0;
  const effects: (() => void)[] = [];
  const same = (a: any[], b: any[]) => a?.length === b?.length && a.every((value, index) => value === b[index]);
  const react = {
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = value; }];
    },
    useRef: (initial: any) => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: (fn: any, deps: any[]) => { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, fn }; return slots[index].fn; },
    useEffect: (fn: any, deps: any[]) => { const index = cursor++; if (!slots[index] || !same(slots[index], deps)) { slots[index] = deps; effects.push(fn); } },
  };
  const modules = {
    react,
    "../services/auth/accountEntry": entry,
    "../services/account/accountWorkspace": { accountWorkspace: workspace },
    "../services/sync/localMutationLock": { withAllLocalEntityMutations },
    "../services/hybridSearch": { invalidateHybridSearchCache: () => {} },
    "../services/auth/restoreSyncSession": { restoreSyncSession },
    "../services/auth/syncUser": { isSyncFirebaseUser, toSyncUser },
    "../services/sync/firebaseApp": { getFirebaseAuth: () => auth },
    "../services/auth/googleSignIn": {
      getCurrentGoogleSyncUser: () => auth.currentUser?.providerData[0].providerId === "google.com" ? toSyncUser(auth.currentUser) : null,
      restoreGoogleSyncUser: async () => { googleRestoreCalls++; return null; },
      signInGoogleSyncUser: async () => { if (cancelled) return null; auth.currentUser = firebaseUser(nextUid, "google.com"); return toSyncUser(auth.currentUser); },
      signOutSyncUser: async () => { auth.currentUser = null; },
    },
    "../services/auth/appleSignIn": {
      isAppleSignInCancelledError: (error: any) => error?.code === "ERR_REQUEST_CANCELED",
      signInAppleSyncUser: async () => { if (cancelled) throw { code: "ERR_REQUEST_CANCELED" }; auth.currentUser = firebaseUser(nextUid); return toSyncUser(auth.currentUser); },
    },
    "../services/sync/syncService": { runCloudSync: async () => {
      assert.equal(workspace.ownerUid(), auth.currentUser.uid);
      syncCalls++;
      return { status: "synced", syncedAt: 123, initialSyncCompleted: true };
    } },
    "../services/account/accountDeletion": {},
    "../services/account/localAccountData": {},
    "../services/subscription/revenueCat": {},
    "../services/collaboration/profileCompletionCache": {},
    "../services/sync/syncQueueEvents": { subscribeSyncQueueChanges: () => () => {} },
    "../services/account/accountDeletionState": { readAccountDeletionState: async () => null, clearAccountDeletionState: async () => {} },
    "../services/account/accountDeletionErrors": {},
    "../services/account/accountDeletionBlockers": {},
  };
  const hook = load("src/hooks/useCloudSync.ts", modules, { setTimeout: () => 1, clearTimeout: () => {} }).useCloudSync;
  const onAccountReady = async () => {};
  const render = () => {
    cursor = 0;
    const result = hook({ enabled: values.get("cloudSyncEnabled") === "true", entitled, onAccountReady });
    effects.splice(0).forEach(effect => effect());
    return result;
  };
  const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); return render(); };
  return { auth, workspace, values, render, settle,
    cancel: (value: boolean) => { cancelled = value; }, nextAccount: (uid: string) => { nextUid = uid; },
    entitlement: (value: boolean) => { entitled = value; }, counts: () => ({ googleRestoreCalls, syncCalls }) };
}

test("fresh install Apple login binds the original UID and enables cloud restoration", async () => {
  const f = fixture();
  assert.equal(f.render().authStatus, "restoring");
  let app = await f.settle();
  assert.equal(app.accountEntryRequired, true);
  const signedIn = await app.signInWithApple();
  assert.equal(signedIn.id, "original-account");
  app = f.render();
  assert.equal(app.accountEntryRequired, false);
  assert.equal(app.authStatus, "signedIn");
  assert.equal(f.values.get("cloudSyncEnabled"), "true");
  assert.equal(f.workspace.ownerUid(), "original-account");
  await app.syncNow();
  assert.equal(f.render().initialSyncStatus, "succeeded");
});

test("skip then Google login adopts guest data, while another account gets a separate store", async () => {
  const f = fixture(); f.render();
  let app = await f.settle();
  await app.skipAccountEntry();
  f.values.set(f.workspace.mapKey("simpleTodos"), "guest-todo");
  await f.render().signIn();
  assert.equal(f.values.get(f.workspace.mapKey("simpleTodos")), "guest-todo");
  app = f.render(); await app.signOut();
  f.nextAccount("other-account");
  await f.render().signInWithApple();
  assert.equal(f.workspace.ownerUid(), "other-account");
  assert.equal(f.values.get(f.workspace.mapKey("simpleTodos")), undefined);
  f.nextAccount("original-account");
  await f.render().signIn();
  assert.equal(f.values.get(f.workspace.mapKey("simpleTodos")), "guest-todo");
});

test("persisted Apple session avoids Google fallback and preserves explicit sync OFF", async () => {
  const f = fixture({ appLanguage: "ja", cloudSyncEnabled: "false" }, firebaseUser("saved-apple"));
  f.render(); const app = await f.settle();
  assert.equal(app.user.id, "saved-apple");
  assert.equal(app.authStatus, "signedIn");
  assert.equal(f.counts().googleRestoreCalls, 0);
  await app.syncNow();
  assert.equal(f.counts().syncCalls, 0);
  assert.equal(f.values.get("cloudSyncEnabled"), "false");
});

test("cold start does not decide signed-out state before Firebase restores Apple credentials", async () => {
  const f = fixture({ appLanguage: "ja" });
  let ready!: () => void;
  const waiting = new Promise<void>(resolve => { ready = resolve; });
  f.auth.authStateReady = () => waiting;
  f.render();
  assert.equal((await f.settle()).authStatus, "restoring");
  assert.equal(f.counts().googleRestoreCalls, 0);
  f.auth.currentUser = firebaseUser("saved-apple"); ready();
  const app = await f.settle();
  assert.equal(app.authStatus, "signedIn");
  assert.equal(app.user.id, "saved-apple");
  assert.equal(f.counts().googleRestoreCalls, 0);
});

test("cloud restore waits for entitlement, then can be retried without another login", async () => {
  const f = fixture(); f.entitlement(false); f.render();
  await f.settle(); await f.render().signInWithApple();
  await f.render().syncNow();
  assert.equal(f.counts().syncCalls, 0);
  f.entitlement(true);
  await f.render().syncNow();
  assert.equal(f.counts().syncCalls, 1);
});

test("cancelling either login keeps first-launch entry available and does not adopt guest data", async () => {
  const f = fixture(); f.render(); await f.settle(); f.cancel(true);
  await f.render().signInWithApple();
  await f.render().signIn();
  const app = f.render();
  assert.equal(app.accountEntryRequired, true);
  assert.equal(app.authStatus, "signedOut");
  assert.equal(f.workspace.ownerUid(), null);
  assert.equal(f.values.get("cloudSyncEnabled"), undefined);
});
