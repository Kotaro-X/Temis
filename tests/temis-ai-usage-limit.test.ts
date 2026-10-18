import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createTemisAIUsageService, getJstWeek } = require("../functions/temisAccessCore.cjs");

class TestHttpsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Sequential service tests; Firestore integration separately verifies concurrency.
const fixture = (tier = "free") => {
  const documents = new Map<string, Record<string, any>>();
  const snapshot = (path: string) => ({ exists: documents.has(path), data: () => documents.get(path) });
  const db = {
    doc: (path: string) => ({ path, get: async () => snapshot(path) }),
    collection: () => {
      const query = { where: () => query, get: async () => ({ docs: [] }) };
      return query;
    },
    runTransaction: async (operation: (transaction: any) => unknown) => operation({
      get: async (ref: { path: string }) => snapshot(ref.path),
      set: (ref: { path: string }, value: Record<string, any>) => documents.set(ref.path, value),
      update: (ref: { path: string }, value: Record<string, any>) => documents.set(ref.path, { ...documents.get(ref.path), ...value }),
    }),
  };
  return {
    documents,
    usage: createTemisAIUsageService({ db, HttpsError: TestHttpsError, getAccess: async () => ({ tier }) }),
  };
};

test("Memo (Private/Project) and Commons share five uses; retries do not consume another use", async () => {
  const { usage } = fixture();
  for (let index = 0; index < 5; index++) {
    const result = await usage.begin("user", index % 2 ? "commons" : "memo", `request_${index}`);
    assert.equal(result.used, index + 1);
    assert.equal(result.remaining, 4 - index);
  }
  const repeated = await usage.begin("user", "memo", "request_0");
  assert.equal(repeated.reused, true);
  assert.equal(repeated.used, 5);
  await assert.rejects(usage.begin("user", "commons", "request_5"), { code: "resource-exhausted" });
  await usage.claim("user", "memo", "request_0");
  await assert.rejects(usage.claim("user", "memo", "request_0"), { code: "failed-precondition" });
  await usage.cancel("user", "request_0");
  assert.equal((await usage.getUsage("user")).used, 5);
  await usage.complete("user", "request_0");
  await usage.cancel("user", "request_0");
  assert.equal((await usage.getUsage("user")).used, 5);
});

test("lowering the limit preserves existing usage and clamps remaining to zero", async () => {
  const { documents, usage } = fixture();
  const path = `temisAIWeeklyUsage/user__${getJstWeek().weekKey}`;
  documents.set(path, { used: 8, limit: 10 });
  const result = await usage.getUsage("user");
  assert.equal(result.used, 8);
  assert.equal(result.limit, 5);
  assert.equal(result.remaining, 0);
  await assert.rejects(usage.begin("user", "memo", "request_new"), { code: "resource-exhausted" });
  assert.deepEqual(documents.get(path), { used: 8, limit: 10 });
});

test("a new JST week starts with five available uses without deleting the previous week", async () => {
  const { documents, usage } = fixture();
  const previous = getJstWeek(getJstWeek().weekStartsAt - 1);
  const path = `temisAIWeeklyUsage/user__${previous.weekKey}`;
  documents.set(path, { used: 10 });
  assert.equal((await usage.getUsage("user")).remaining, 5);
  assert.equal((await usage.begin("user", "memo", "new_week_request")).used, 1);
  assert.deepEqual(documents.get(path), { used: 10 });
});

test("Plus uses remain unlimited without reserving or writing weekly counters", async () => {
  const { documents, usage } = fixture("plus");
  for (let index = 0; index < 6; index++) {
    const result = await usage.begin("plus", "memo", `request_${index}`);
    assert.equal(result.unlimited, true);
    assert.equal(result.remaining, null);
    assert.equal(result.limit, null);
    assert.equal(result.reserved, false);
  }
  assert.equal(documents.size, 0);
});
