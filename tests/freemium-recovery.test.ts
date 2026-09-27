import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import { aiUsageErrorMessage, projectInvitationErrorMessage, TemisUsageError } from "../src/services/freemium/freemiumErrors.ts";
const { planBackfillWrites } = createRequire(import.meta.url)("../scripts/freemium-backfill-core.cjs");

test("backfill preserves a concurrent valid Plus lease and an in-progress selection", () => {
  const savedAccess = { userId: "user", tier: "plus", verifiedUntil: 5000 };
  const writes = planBackfillWrites({ uid: "user", verifiedAccess: { userId: "user", tier: "free", verifiedUntil: 4000 }, savedAccess, savedStateExists: true, memberships: [], now: 1000 });
  assert.equal(writes.access, null);
  assert.equal(writes.state, null);
});

test("backfill initializes missing state from live memberships and refuses unverified access", () => {
  const input = { uid: "user", verifiedAccess: { userId: "user", tier: "free", verifiedUntil: 5000 }, savedAccess: null, savedStateExists: false, memberships: [{ projectId: "project" }], now: 1000 };
  const writes = planBackfillWrites(input);
  assert.equal(writes.state.membershipCount, 1);
  assert.equal(writes.state.freeProjectId, "project");
  assert.throws(() => planBackfillWrites({ ...input, verifiedAccess: null }));
  assert.throws(() => planBackfillWrites({ ...input, now: 6000 }));
});

test("quota, authentication, endpoint failure and expired/deleted invitations have distinct safe messages", () => {
  assert.match(aiUsageErrorMessage({ code: "functions/resource-exhausted" }), /使い切り/);
  assert.match(aiUsageErrorMessage({ code: "functions/unauthenticated" }), /ログイン/);
  assert.doesNotMatch(aiUsageErrorMessage({ code: "functions/not-found", message: "PRIVATE" }), /PRIVATE|not-found/);
  assert.match(projectInvitationErrorMessage({ code: "functions/not-found" }), /サービス/);
  assert.match(projectInvitationErrorMessage({ code: "functions/not-found", details: { reason: "invitation_missing" } }), /削除/);
  assert.match(projectInvitationErrorMessage({ details: { reason: "invitation_expired" } }), /有効期限/);
  assert.match(projectInvitationErrorMessage({ code: "functions/resource-exhausted" }), /1件/);
});

test("AI usage labels distinguish loading, authentication, failure, free quota and Plus", () => {
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("src/context/TemisAIUsageContext.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "react" ? { createContext: () => ({}) } : {} });
  const label = exports.formatTemisAIUsageLabel;
  assert.equal(label(null, "loading"), "利用回数を確認中");
  assert.equal(label(null, "signed_out"), "ログインしてください");
  assert.equal(label({ unlimited: true }, "error"), "利用回数を確認できません");
  assert.equal(label({ unlimited: false, remaining: 10 }, "ready"), "今週あと10回");
  assert.equal(label({ unlimited: true }, "ready"), "無制限");
});

test("memo reservation rejection prevents search and preserves the actionable quota error", async () => {
  let cursor = 0;
  const states: any[] = [];
  let searches = 0;
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("src/hooks/useAI.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, setTimeout, clearTimeout, require: (name: string) => {
    if (name === "react") return {
      useCallback: (fn: any) => fn,
      useState: (value: any) => { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], (next: any) => { states[i] = next; }]; },
      useRef: (value: any) => { const i = cursor++; if (!(i in states)) states[i] = { current: value }; return states[i]; },
    };
    if (name.endsWith("aiService")) return { searchAndGenerateAnswer: async () => { searches++; } };
    if (name.endsWith("temisFreemiumService")) return { createAIRequestId: () => "request-test" };
    if (name.endsWith("freemiumErrors")) return { TemisUsageError };
    throw new Error(name);
  } });
  const usage = { begin: async () => { throw new TemisUsageError("今週の無料枠を使い切りました。"); }, refresh: async () => {} };
  const render = () => { cursor = 0; return exports.useAI({ searchError: "generic" }, usage); };
  await render().run("質問");
  assert.equal(searches, 0);
  assert.match(render().error, /使い切り/);
});
