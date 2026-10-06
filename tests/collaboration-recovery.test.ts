import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { isProfileComplete } from '../src/services/collaboration/profilePolicy.ts';

const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: any) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(cachedProfile: any = null, cacheReadTask?: ReturnType<typeof deferred>) {
  const slots: any[] = [];
  let cursor = 0;
  const auth = { currentUser: { uid: "alice" } as { uid: string } | null };
  const setupTasks: ReturnType<typeof deferred>[] = [];
  const photoTasks: ReturnType<typeof deferred>[] = [];
  const profiles: ReturnType<typeof deferred>[] = [];
  const projects: ReturnType<typeof deferred>[] = [];
  const effects: (() => void)[] = [];
  let mounted = false;
  let authListener: (user: any) => void = () => {};
  const cacheReads: string[] = [];
  const cacheWrites: any[] = [];
  const cacheClears: string[] = [];
  const react = {
    createContext: () => ({ Provider: "Provider" }),
    createElement: (_type: unknown, props: any) => props,
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect: (action: () => void) => { if (!mounted) effects.push(action); },
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => fn(),
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("src/context/CollaborationContext.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name.endsWith("guildAuthorService")) return { resolveGuildAuthors: async (posts: unknown) => posts };
    if (name.endsWith("guildPublicationQueue")) return { startPublicationSync: () => () => {} };
    if (name === "react") return react;
    if (name === "firebase/auth") return { onAuthStateChanged: (_auth: any, listener: any) => { authListener = listener; return () => {}; } };
    if (name === 'react-native') return { AppState: { addEventListener: () => ({ remove() {} }) } };
    if (name.endsWith("firebaseApp")) return { getFirebaseAuth: () => auth };
    if (name.endsWith("syncUser")) return { isSyncFirebaseUser: (user: any) => !!user, toSyncUser: (user: any) => user };
    if (name.endsWith("collaborationService")) return {
      completeUserProfile: () => { const task = deferred(); setupTasks.push(task); return task.promise; },
      ensureUserProfile: () => { const task = deferred(); profiles.push(task); return task.promise; },
      updateUsername: async (username: string) => ({ userId: auth.currentUser?.uid, username }),
      updateDisplayName: async (displayName: string) => ({ userId: auth.currentUser?.uid, displayName }),
    };
    if (name.endsWith("profilePhotoService")) return { selectAndSaveProfilePhoto: () => { const task = deferred(); photoTasks.push(task); return task.promise; } };
    if (name.endsWith("temisFreemiumService")) return {
      refreshProjectAccess: () => { const task = deferred(); projects.push(task); return task.promise; },
    };
    if (name.endsWith("types/collaboration")) return { canInviteToProject: () => true };
    if (name.endsWith('profilePolicy')) return { isProfileComplete };
    if (name.endsWith('profileCompletionCache')) return {
      cacheCompletedProfile: async (profile: any) => { cacheWrites.push(profile); },
      clearCompletedProfile: async (uid: string) => { cacheClears.push(uid); },
      readCompletedProfile: async (uid: string) => { cacheReads.push(uid); return cacheReadTask ? cacheReadTask.promise : cachedProfile; },
    };
    throw new Error(name);
  } });
  const render = () => { cursor = 0; return exports.CollaborationProvider({ children: null }).value; };
  return { auth, profiles, projects, setupTasks, photoTasks, cacheReads, cacheWrites, cacheClears, render,
    mount: () => { render(); mounted = true; effects.forEach((action) => action()); },
    authChanged: (uid: string | null) => { auth.currentUser = uid ? { uid } : null; authListener(auth.currentUser); },
  };
}

test("project not-found leaves the successful profile ready and project actions unavailable", async () => {
  const f = fixture();
  const refresh = f.render().refresh();
  f.profiles[0].resolve({ userId: "alice", username: "alice" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.render().status, "ready");
  assert.equal(f.render().projectStatus, "loading");
  f.projects[0].reject(new Error("not-found"));
  await refresh;
  assert.equal(f.render().profile.username, "alice");
  assert.equal(f.render().status, "ready");
  assert.equal(f.render().projectStatus, "error");
  assert.doesNotMatch(f.render().projectError, /not-found/);
  await assert.rejects(f.render().addProject({ name: "test" }), /利用状態/);
  await f.render().saveUsername("new_name");
  assert.equal(f.render().profile.username, "new_name");
  await f.render().saveDisplayName("新しい表示名");
  assert.equal(f.render().profile.displayName, "新しい表示名");
});

test("profile-only retry recovers without retrying the project service", async () => {
  const f = fixture();
  const refresh = f.render().refresh();
  f.profiles[0].reject(new Error("permission-denied"));
  f.projects[0].reject(new Error("not-found"));
  await refresh;
  assert.equal(f.render().status, "error");
  assert.equal(f.render().profile, null);
  const retry = f.render().refreshProfile();
  f.profiles[1].resolve({ userId: "alice", username: "restored" });
  await retry;
  assert.equal(f.render().status, "ready");
  assert.equal(f.projects.length, 1);
});

test("account switch and logout discard delayed profile and project responses", async () => {
  const f = fixture();
  const old = f.render().refresh();
  f.auth.currentUser = { uid: "bob" };
  const next = f.render().refresh();
  assert.equal(f.render().profile, null);
  f.profiles[1].resolve({ userId: "bob" });
  f.projects[1].reject(new Error("not-found"));
  await next;
  f.profiles[0].resolve({ userId: "alice" });
  f.projects[0].resolve({ access: {}, state: {}, projects: [] });
  await old;
  assert.equal(f.render().profile.userId, "bob");
  assert.equal(f.render().projectStatus, "error");
  const pending = f.render().refresh();
  f.auth.currentUser = null;
  await f.render().refresh();
  f.profiles[2].resolve({ userId: "bob" });
  f.projects[2].resolve({ access: {}, state: {}, projects: [] });
  await pending;
  assert.equal(f.render().profile, null);
  assert.equal(f.render().projectAccess, null);
  assert.equal(f.render().status, "signed_out");
});

test("a later foreground refresh wins over an earlier response for the same account", async () => {
  const f = fixture();
  const first = f.render().refresh();
  const second = f.render().refresh();
  f.profiles[1].resolve({ userId: "alice", displayName: "latest" });
  f.projects[1].resolve({ access: { tier: "free" }, state: { membershipCount: 0 }, projects: [] });
  await second;
  f.profiles[0].resolve({ userId: "alice", displayName: "stale" });
  f.projects[0].reject(new Error("not-found"));
  await first;
  assert.equal(f.render().profile.displayName, "latest");
  assert.equal(f.render().projectStatus, "ready");
});

test("Commons AI cannot call a legacy search endpoint when quota verification fails", async () => {
  let searches = 0;
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("src/services/guild/guildAISearch.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, process: { env: {} }, require: (name: string) => {
    if (name.endsWith("guildAuthorService")) return { resolveGuildAuthors: async (posts: unknown) => posts };
    if (name === "firebase/functions") return {
      getFunctions: () => ({}),
      httpsCallable: () => async () => { searches++; return { data: {} }; },
    };
    if (name.endsWith("firebaseApp")) return { getFirebaseApp: () => ({}) };
    if (name.endsWith("temisFreemiumService")) return {
      getTemisAIUsage: async () => { throw Object.assign(new Error("not-found"), { code: "functions/not-found" }); },
    };
    throw new Error(name);
  } });
  await assert.rejects(exports.searchGuildPostsWithAI("質問", "request-1"), (error: any) => {
    assert.doesNotMatch(error.message, /not-found/);
    return true;
  });
  assert.equal(searches, 0);
});


test("setup failures remain incomplete and a stale setup/photo response cannot enter another account", async () => {
  const f = fixture();
  const start = f.render().refresh();
  f.profiles[0].resolve({ userId: "alice", username: "user_alice", updatedAt: 1 });
  f.projects[0].resolve({ access: {}, state: {}, projects: [] });
  await start;
  const failure = f.render().completeProfile({ displayName: "Alice", username: "taken" });
  f.setupTasks[0].reject(new Error("別のユーザーIDを入力してください。"));
  await assert.rejects(failure, /別のユーザーID/);
  assert.equal(f.render().profile.username, "user_alice");
  assert.equal(f.render().profile.profileCompletedAt, undefined);
  const setup = f.render().completeProfile({ displayName: "Alice", username: "chosen" });
  const photo = f.render().editPhoto();
  f.auth.currentUser = { uid: "bob" };
  const change = f.render().refresh();
  f.setupTasks[1].resolve({ userId: "alice", username: "chosen", profileCompletedAt: 2, updatedAt: 2 });
  f.photoTasks[0].resolve({ userId: "alice", photoUrl: "alice.jpg", updatedAt: 3 });
  await Promise.all([setup, photo]);
  assert.equal(f.render().profile, null);
  assert.equal(f.render().status, "loading");
  f.profiles[1].resolve({ userId: "bob", username: "user_bob", updatedAt: 1 });
  f.projects[1].resolve({ access: {}, state: {}, projects: [] });
  await change;
  assert.equal(f.render().profile.userId, "bob");
});

const completedAlice = { userId: 'alice', username: 'alice', displayName: 'Alice', usernameChangedAt: 1, updatedAt: 1 };
const settle = () => new Promise((resolve) => setImmediate(resolve));
test('cold-start completion cache admits app before background fetch and retains access when fetch fails', async () => {
  const f = fixture(completedAlice);
  f.mount(); f.authChanged('alice');
  await settle();
  assert.equal(f.render().profileSetupStatus, 'complete');
  assert.equal(f.render().profile.displayName, 'Alice');
  f.profiles[0].reject(new Error('offline')); f.projects[0].reject(new Error('offline'));
  await settle();
  assert.equal(f.render().profileSetupStatus, 'complete');
  assert.equal(f.render().status, 'ready');
  const background = f.render().refreshProfile();
  f.profiles[1].resolve({ ...completedAlice, usernameChangedAt: null, displayName: '' });
  await background;
  assert.equal(f.render().profileSetupStatus, 'complete');
});
test('a fresh login verifies on server even when a completion cache exists; logout clears that account', async () => {
  const f = fixture(completedAlice);
  f.mount(); f.authChanged(null); f.authChanged('alice');
  await settle();
  assert.equal(f.cacheReads.length, 0);
  assert.equal(f.render().profileSetupStatus, 'checking');
  f.profiles[0].resolve({ ...completedAlice, usernameChangedAt: null });
  f.projects[0].resolve({ access: {}, state: {}, projects: [] });
  await settle();
  assert.equal(f.render().profileSetupStatus, 'required');
  const setup = f.render().completeProfile({ username: 'alice', displayName: 'Alice' });
  f.setupTasks[0].resolve(completedAlice); await setup;
  assert.equal(f.render().profileSetupStatus, 'complete');
  assert.equal(f.cacheWrites.at(-1).userId, 'alice');
  f.authChanged(null);
  assert.equal(f.render().profileSetupStatus, 'signed_out');
  assert.equal(f.render().profile, null);
  assert.ok(f.cacheClears.includes('alice'));
});
test('without a cache, initial load failures block until a successful retry', async () => {
  const f = fixture(); f.mount(); f.authChanged('alice'); await settle();
  f.profiles[0].reject(new Error('offline')); f.projects[0].reject(new Error('offline')); await settle();
  assert.equal(f.render().profileSetupStatus, 'error');
  const retry = f.render().refreshProfile();
  assert.equal(f.render().profileSetupStatus, 'checking');
  f.profiles[1].resolve(completedAlice); await retry;
  assert.equal(f.render().profileSetupStatus, 'complete');
});
test('a delayed cache read cannot restore a logged-out or switched account', async () => {
  const pending = deferred(); const f = fixture(null, pending); f.mount(); f.authChanged('alice');
  f.authChanged('bob'); pending.resolve(completedAlice); await settle();
  assert.equal(f.render().accountUserId, 'bob');
  assert.equal(f.render().profile, null);
  assert.equal(f.render().profileSetupStatus, 'checking');
  f.profiles[0].resolve({ ...completedAlice, userId: 'bob' });
  f.projects[0].resolve({ access: {}, state: {}, projects: [] }); await settle();
  assert.equal(f.render().profile.userId, 'bob');
});
