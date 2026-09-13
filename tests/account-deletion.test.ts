import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { URL } from "node:url";
import { accountDeletionErrorMessage, assertAccountDeleted } from "../src/services/account/accountDeletionErrors.ts";

const require = createRequire(import.meta.url);
const { runAccountDeletionStages, safeFailureCode, validateAppleDeletionConfig, validateRevenueCatProjectId, externalDeletionFailure } = require("../functions/accountDeletionCore.cjs");

test("deletion configuration rejects names and bundle IDs in identifier fields", () => {
  assert.doesNotThrow(() => validateAppleDeletionConfig({ teamId: "7A89K44X8N", keyId: "ABCDEFGHIJ" }));
  for (const config of [{ teamId: "77A89K44X8N", keyId: "ABCDEFGHIJ" }, { teamId: "7A89K44X8N", keyId: "com.anonymous.WeMemo" }]) {
    assert.throws(() => validateAppleDeletionConfig(config), (error: any) => safeFailureCode(error) === "configuration");
  }
  assert.throws(() => validateRevenueCatProjectId("Temis Account Deletion"));
  assert.doesNotThrow(() => validateRevenueCatProjectId("e8c122f8"));
});

test("external deletion errors retain only safe diagnostic categories", async () => {
  const error = await externalDeletionFailure({ status: 403, json: async () => ({ error: { message: "PRIVATE_PAYLOAD", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", metadata: { user: "PRIVATE_PAYLOAD" } }] } }) });
  assert.equal(safeFailureCode(error), "ACCESS_TOKEN_SCOPE_INSUFFICIENT");
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE_PAYLOAD/);
  const unknown = await externalDeletionFailure({ status: 403, json: async () => ({ error: { details: [{ reason: "PRIVATE_PAYLOAD" }] } }) });
  assert.equal(safeFailureCode(unknown), "http_403");
});

test("core deletion reports exactly completed steps and stops before Auth on failure", async () => {
  const events: string[] = [];
  await assert.rejects(runAccountDeletionStages([
    ["invitations", async () => { events.push("invitations"); }],
    ["cloud_data", async () => { throw Object.assign(new Error("sensitive"), { code: 7 }); }],
    ["firebase_auth", async () => { events.push("auth"); }],
  ]), (error: any) => {
    assert.equal(error.stage, "cloud_data");
    assert.deepEqual(error.completedStages, ["invitations"]);
    assert.equal(safeFailureCode(error.cause), "permission");
    return true;
  });
  assert.deepEqual(events, ["invitations"]);
});

test("client success requires deleted:true and never displays raw SDK data", () => {
  for (const result of [null, {}, { deleted: false }, { deleted: "true" }]) assert.throws(() => assertAccountDeleted(result));
  assert.doesNotThrow(() => assertAccountDeleted({ deleted: true }));
  assert.ok(!accountDeletionErrorMessage({ message: "secret-token", code: "functions/internal" }).includes("secret-token"));
  assert.match(accountDeletionErrorMessage({ details: { stage: "cloud_data", reason: "configuration", completedStages: ["invitations"] } }), /削除済み：招待履歴/);
  assert.match(accountDeletionErrorMessage({ code: "ERR_REQUEST_CANCELED" }), /送信していません/);
  assert.match(accountDeletionErrorMessage({ details: { stage: "apple_authorization", reason: "account_mismatch" } }), /同じApple Account/);
});

// The actual callable module runs against in-memory SDK stubs; no real account or network.
function callableFixture(options: { failStage?: string; apple?: boolean; externalFailure?: boolean; userMissing?: boolean; redemptionCount?: number; sharedData?: boolean } = {}) {
  const events: string[] = [];
  const logs: unknown[] = [];
  class HttpsError extends Error {
    code: string;
    details: unknown;
    constructor(code: string, message: string, details?: unknown) { super(message); this.code = code; this.details = details; }
  }
  const step = async (name: string) => {
    events.push(name);
    if (options.failStage === name) throw Object.assign(new Error("PRIVATE_PAYLOAD"), { code: 9 });
  };
  const bufferedDeletes: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  const db = {
    doc: (path: string) => ({ path, delete: () => step(path.startsWith("profiles/") ? "profile" : "subscription_access") }),
    collection: () => ({ where: () => ({
      get: async () => ({ docs: [], size: 0, empty: true }),
      limit: () => ({ get: async () => ({ docs: [], size: 0, empty: !options.sharedData }) }),
    }) }),
    recursiveDelete: () => step("cloud_data"),
    collectionGroup: () => ({ where: () => ({ get: async () => { await step("query"); return { docs: Array.from({ length: options.redemptionCount ?? 1 }, () => ({ ref: {} })) }; } }) }),
    bulkWriter: () => ({
      delete: () => new Promise<void>((resolve, reject) => bufferedDeletes.push({ resolve, reject })),
      close: async () => {
        // Like BulkWriter, close flushes writes but does not reject for an
        // individual write failure. Callers must observe the write promises.
        await Promise.all(bufferedDeletes.splice(0).map(async ({ resolve, reject }) => {
          try { await step("invitations"); resolve(); } catch (error) { reject(error); }
        }));
      },
    }),
  };
  const auth = {
    getUser: async () => {
      if (options.userMissing) throw { code: "auth/user-not-found" };
      return { providerData: options.apple ? [{ providerId: "apple.com", uid: "fake-subject" }] : [{ providerId: "google.com" }] };
    },
    deleteUser: async () => { await step("firebase_auth"); if (options.userMissing) throw { code: "auth/user-not-found" }; },
  };
  const exports: Record<string, any> = {};
  const sdk: Record<string, unknown> = {
    "node:crypto": require("node:crypto"),
    "./accountDeletionCore.cjs": require("../functions/accountDeletionCore.cjs"),
    "firebase-admin/app": { initializeApp() {}, getApp: () => ({ options: { projectId: "test", credential: { getAccessToken: async () => ({ access_token: "NOT_REAL" }) } } }) },
    "firebase-admin/auth": { getAuth: () => auth },
    "firebase-admin/firestore": { getFirestore: () => db },
    "firebase-functions": { logger: { error: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args) } },
    "firebase-functions/v2/https": { HttpsError, onCall: (_config: unknown, handler: unknown) => handler },
    "firebase-functions/params": { defineSecret: () => ({ value: () => "NOT_REAL" }) },
  };
  vm.runInNewContext(readFileSync(new URL("../functions/accountDeletion.cjs", import.meta.url), "utf8"), {
    require: (name: string) => { if (!(name in sdk)) throw new Error(`Unexpected dependency: ${name}`); return sdk[name]; },
    exports, URL, URLSearchParams, AbortSignal, setTimeout, clearTimeout,
    fetch: async () => { events.push("external"); return { ok: !options.externalFailure, status: options.externalFailure ? 403 : 200, json: async () => ({}) }; },
  });
  return {
    call: exports.deleteAccount,
    getBlockers: exports.getAccountDeletionBlockers,
    resolveBlocker: exports.resolveAccountDeletionBlocker,
    events,
    logs,
  };
}

const request = { auth: { uid: "FAKE_DISPOSABLE_UID", token: { firebase: { sign_in_provider: "google.com" } } }, data: {} };

test("actual callable: missing redemption index stops before all destructive work", async () => {
  const fixture = callableFixture({ failStage: "query" });
  await assert.rejects(fixture.call(request), (error: any) => {
    assert.equal(error.details.stage, "invitations");
    assert.equal(error.details.completedStages.length, 0);
    return true;
  });
  assert.deepEqual(fixture.events, ["query"]);
  assert.doesNotMatch(JSON.stringify(fixture.logs), /PRIVATE_PAYLOAD|FAKE_DISPOSABLE_UID/);
});

test("actual callable: BulkWriter item failure is not mistaken for deletion success", { timeout: 1000 }, async () => {
  const fixture = callableFixture({ failStage: "invitations" });
  await assert.rejects(fixture.call(request));
  assert.ok(!fixture.events.includes("firebase_auth"));
});

for (const count of [0, 1, 19, 21]) {
  test(`actual callable: flushes ${count} buffered redemptions before awaiting deletion`, { timeout: 1000 }, async () => {
    const fixture = callableFixture({ redemptionCount: count });
    const result = await fixture.call(request);
    assert.equal(result.deleted, true);
    assert.equal(fixture.events.filter((event) => event === "invitations").length, count);
    assert.ok(fixture.events.indexOf("firebase_auth") > fixture.events.indexOf("cloud_data"));
  });
}

test("actual callable: external outages leave Firebase success intact", async () => {
  const fixture = callableFixture({ externalFailure: true });
  const result = await fixture.call(request);
  assert.equal(result.deleted, true);
  assert.deepEqual(Array.from(result.externalCleanupPending), ["revenuecat", "crashlytics"]);
  assert.deepEqual(fixture.events.slice(0, 6), ["query", "invitations", "profile", "cloud_data", "subscription_access", "firebase_auth"]);
  assert.doesNotMatch(JSON.stringify(fixture.logs), /NOT_REAL|FAKE_DISPOSABLE_UID/);
});

test("actual callable: Apple-linked Google sessions cannot bypass reauthentication", async () => {
  const fixture = callableFixture({ apple: true });
  await assert.rejects(fixture.call(request), (error: any) => error.details.reason === "reauthentication");
  assert.deepEqual(fixture.events, []);
});

test("actual callable: repeated deletion accepts an already absent Firebase Auth user", async () => {
  assert.equal((await callableFixture({ userMissing: true }).call(request)).deleted, true);
});

test("actual callable: unauthenticated deletion has no side effects", async () => {
  const fixture = callableFixture();
  await assert.rejects(fixture.call({ data: {} }), (error: any) => error.code === "unauthenticated");
  assert.deepEqual(fixture.events, []);
});

test("shared-data inspection is authenticated and does not start deletion", async () => {
  const fixture = callableFixture();
  await assert.rejects(fixture.getBlockers({ data: {} }), (error: any) => error.code === "unauthenticated");
  const result = await fixture.getBlockers(request);
  assert.equal(result.total, 0);
  assert.deepEqual(fixture.events, []);
});

test("unsupported shared-data resolution is rejected without destructive work", async () => {
  const fixture = callableFixture();
  await assert.rejects(
    fixture.resolveBlocker({ ...request, data: { action: "not_supported" } }),
    (error: any) => error.code === "invalid-argument",
  );
  assert.deepEqual(fixture.events, []);
});

test("v2 shared content blocks deletion before Apple revocation or destructive writes", async () => {
  const fixture = callableFixture({ sharedData: true, apple: true });
  await assert.rejects(fixture.call(request), (error: any) => error.details.stage === "shared_data");
  assert.deepEqual(fixture.events, []);
});

test("deployment configuration includes the required redemption collection-group index", () => {
  const config = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
  const field = config.fieldOverrides.find((item: any) => item.collectionGroup === "redemptions" && item.fieldPath === "userId");
  assert.ok(field.indexes.some((item: any) => item.queryScope === "COLLECTION_GROUP" && item.order === "ASCENDING"));
});
