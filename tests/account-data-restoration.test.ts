import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as core from "../src/services/sync/syncCore.ts";
import { withLocalEntityMutation, withSyncStoreMutation } from "../src/services/sync/localMutationLock.ts";

function fixture(tag = false) {
  let current = true;
  let release!: (page: any) => void;
  let started!: () => void;
  const fetching = new Promise<void>(resolve => { started = resolve; });
  const writes: string[] = [];
  let local: any[] = [];
  const record = (id: string, updatedAt: number) => tag
    ? { id, name: id, order: 1, createdAt: 1, updatedAt, archivedAt: null, deletedAt: null }
    : { entityType: "todo", entityId: id, updatedAt, deletedAt: null, deviceId: null, record: { id, text: id } };
  local = [record("guest", 1)];
  const assertCurrent = () => { if (!current) throw new Error("account changed"); };
  const metadata: any[] = [];
  const storage = {
    loadSyncEntityMetadata: async () => core.createEmptySyncEntityMetadata(),
    saveSyncEntityMetadata: async (_: any, __: any, value: any) => { metadata.push(value); },
    saveSyncEntityRecords: async () => { writes.push("envelopes"); },
    loadTagRecords: async () => local,
    saveTagRecords: async (records: any[]) => { writes.push("tags"); local = records; },
    loadSyncQueue: async () => [], saveSyncQueue: async () => {},
  };
  const pull = async () => { started(); return new Promise(resolve => { release = resolve; }); };
  const modules: Record<string, any> = {
    "../../../storage": storage,
    "./syncCore": core,
    "./syncEnvelopeStore": { enqueueMissingSyncEnvelopes: async () => {} },
    "./syncQueueProcessor": { syncQueuedEnvelopes: async () => ({ pushedCount: 0, retryCount: 0, pendingCount: 0, firstError: null }) },
    "./firestoreSyncAdapter": { pullSyncEnvelopePage: pull },
    "./firestoreTagAdapter": { pullTagRecordPage: pull },
    "./syncDiagnosticObserver": { createSyncDiagnosticObserver: () => ({ start: async () => {}, phase: async () => {}, complete: async () => {}, fail: async (error: any) => Object.assign(error, { classification: { errorCode: "SYNC-UNK-001" } }) }) },
    "./syncTelemetry": {},
    "./localMutationLock": { withLocalEntityMutation, withSyncStoreMutation },
    "./syncAccountGuard": { assertSyncAccount: assertCurrent },
    "./reconcileProcessedQueue": { reconcileProcessedQueue: () => [] },
    "./syncDiagnostics": {},
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(tag ? "src/services/sync/tagSync.ts" : "src/services/sync/syncEntityRunner.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; },
  });
  const run = () => tag ? exports.syncTagRecords({ userId: "original", deviceId: "new-device" }, {})
    : exports.runEnvelopeEntitySync({ userId: "original", deviceId: "new-device" }, "todo", async () => local, async (records: any[]) => { writes.push("local"); local = records; }, {});
  return { run, fetching, writes, metadata, local: () => local, switchAccount: () => { current = false; },
    finish: () => release({ records: [record("remote", 2)], nextCursor: { entityId: "remote", updatedAt: 2 }, hasMore: false }) };
}

for (const tag of [false, true]) {
  test(`${tag ? "tag" : "Private"} restoration merges guest data and completes only after remote apply`, async () => {
    const f = fixture(tag);
    const pending = f.run(); await f.fetching;
    assert.equal(f.writes.length, 0);
    f.finish();
    const result = await pending;
    assert.equal(result.pulled, 1);
    assert.deepEqual(Array.from(f.local(), record => record.entityId ?? record.id).sort(), ["guest", "remote"]);
    assert.equal(f.metadata.at(-1).initialSyncCompleted, true);
  });
  test(`${tag ? "tag" : "Private"} restoration ignores responses after logout or account switch`, async () => {
    const f = fixture(tag);
    const pending = f.run(); await f.fetching;
    const metadataBefore = f.metadata.length;
    f.switchAccount(); f.finish();
    await assert.rejects(pending, /account changed/);
    assert.deepEqual(f.writes, []);
    assert.equal(f.metadata.length, metadataBefore);
    assert.equal(f.local().length, 1);
  });
}

test("SQLite storage selects an independent database for each account and preserves the legacy database", async () => {
  let scope = "legacy";
  const opened: string[] = [];
  const calls: string[] = [];
  const deleted: string[] = [];
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync("src/db/sqlite.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (name: string) => {
      if (name === "expo-sqlite") return { openDatabaseSync: (name: string) => {
        opened.push(name); return { getAllAsync: async () => { calls.push(name); return []; }, closeSync: () => {} };
      }, deleteDatabaseAsync: async (name: string) => { deleted.push(name); } };
      if (name === "./migrations") return { runMigrations: async (execute: any) => { await execute("migrate"); } };
      if (name === "../services/account/accountWorkspace") return { accountWorkspace: { initialize: async () => {}, scope: () => scope, databaseScopes: () => ["legacy", "second", "unused"] } };
      if (name === "../services/environment/runtimeEnvironment") return { getEnvironmentEpoch: () => 0 };
      throw new Error(name);
    },
  });
  await exports.ensureDbReady(); await exports.executeSql("read A");
  scope = "second";
  await exports.ensureDbReady(); await exports.executeSql("read B");
  scope = "legacy";
  await exports.ensureDbReady(); await exports.executeSql("read A again");
  assert.deepEqual(opened, ["wememo.db", "wememo-account-second.db"]);
  assert.deepEqual(calls, ["wememo.db", "wememo.db", "wememo-account-second.db", "wememo-account-second.db", "wememo.db"]);
  await exports.deleteLocalDatabase();
  assert.deepEqual(deleted, ["wememo.db", "wememo-account-second.db", "wememo-account-unused.db"]);
});
