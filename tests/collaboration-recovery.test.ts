import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: any) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  const slots: any[] = [];
  let cursor = 0;
  const auth = { currentUser: { uid: "alice" } as { uid: string } | null };
  const profiles: ReturnType<typeof deferred>[] = [];
  const projects: ReturnType<typeof deferred>[] = [];
  const react = {
    createContext: () => ({ Provider: "Provider" }),
    createElement: (_type: unknown, props: any) => props,
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: any) => { slots[index] = next; }];
    },
    useRef: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect: () => {},
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => fn(),
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("src/context/CollaborationContext.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return react;
    if (name === "firebase/auth" || name === "react-native") return {};
    if (name.endsWith("firebaseApp")) return { getFirebaseAuth: () => auth };
    if (name.endsWith("syncUser")) return { isSyncFirebaseUser: (user: any) => !!user, toSyncUser: (user: any) => user };
    if (name.endsWith("collaborationService")) return {
      ensureUserProfile: () => { const task = deferred(); profiles.push(task); return task.promise; },
      updateUsername: async (username: string) => ({ userId: auth.currentUser?.uid, username }),
      updateDisplayName: async (displayName: string) => ({ userId: auth.currentUser?.uid, displayName }),
    };
    if (name.endsWith("temisFreemiumService")) return {
      refreshProjectAccess: () => { const task = deferred(); projects.push(task); return task.promise; },
    };
    if (name.endsWith("types/collaboration")) return { canInviteToProject: () => true };
    throw new Error(name);
  } });
  return { auth, profiles, projects, render: () => { cursor = 0; return exports.CollaborationProvider({ children: null }).value; } };
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
