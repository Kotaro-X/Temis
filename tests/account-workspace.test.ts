import test from "node:test";
import assert from "node:assert/strict";
import { createAccountWorkspaceStore } from "../src/services/account/accountWorkspaceCore.ts";
import { withAllLocalEntityMutations, withLocalEntityMutation } from "../src/services/sync/localMutationLock.ts";
import { advanceWorkspaceEpoch } from "../src/services/account/workspaceEpoch.ts";

const storage = () => {
  const values = new Map<string, string>();
  return { values, getItem: async (key: string) => values.get(key) ?? null,
    getAllKeys: async () => [...values.keys()],
    setItem: async (key: string, value: string) => { values.set(key, value); } };
};

test("first login adopts guest/legacy data in place, while other accounts remain isolated", async () => {
  const db = storage();
  const workspace = createAccountWorkspaceStore(db);
  await workspace.initialize();
  db.values.set(workspace.mapKey("simpleTodos"), "guest-todo");
  db.values.set(workspace.mapKey("syncQueue"), "guest-queue");
  await workspace.bind("apple-user");
  assert.equal(workspace.ownerUid(), "apple-user");
  assert.equal(workspace.scope(), "legacy");
  assert.equal(db.values.get(workspace.mapKey("simpleTodos")), "guest-todo");
  assert.equal(await workspace.bind("apple-user"), false);
  await workspace.bind("google-user");
  assert.equal(db.values.get(workspace.mapKey("simpleTodos")), undefined);
  assert.equal(db.values.get(workspace.mapKey("syncQueue")), undefined);
  assert.equal(workspace.mapKey("appLanguage"), "appLanguage");
  assert.equal(workspace.mapKey("cloudSyncEnabled"), "cloudSyncEnabled");
  db.values.set(workspace.mapKey("simpleTodos"), "google-todo");
  assert.ok(workspace.visibleKeys([...db.values.keys()]).includes("simpleTodos"));
  await workspace.bind("apple-user");
  assert.equal(db.values.get(workspace.mapKey("simpleTodos")), "guest-todo");
  assert.equal(db.values.get(workspace.mapKey("syncQueue")), "guest-queue");
  assert.ok(!workspace.visibleKeys([...db.values.keys()]).some(key => key.startsWith("@temis/private-workspace/")));
});

test("existing UID-scoped sync metadata protects legacy data from a different first login", async () => {
  const db = storage();
  db.values.set("syncMetadata:v2:old-account:memo", "{}");
  db.values.set("simpleTodos", "old-account-todos");
  const workspace = createAccountWorkspaceStore(db);
  await workspace.initialize();
  await workspace.bind("new-account");
  assert.equal(db.values.get(workspace.mapKey("simpleTodos")), undefined);
  await workspace.bind("old-account");
  assert.equal(db.values.get(workspace.mapKey("simpleTodos")), "old-account-todos");
});

test("restart restores the active account scope and its independent database name", async () => {
  const db = storage();
  const first = createAccountWorkspaceStore(db);
  await first.bind("a");
  await first.bind("b");
  const restarted = createAccountWorkspaceStore(db);
  await restarted.initialize();
  assert.equal(restarted.scope(), first.scope());
  assert.equal(restarted.mapKey("syncRecords:memo"), first.mapKey("syncRecords:memo"));
  assert.deepEqual(restarted.databaseScopes(), ["legacy", "b"]);
});

test("failed binding preserves the original data scope and can be retried", async () => {
  const db = storage();
  let fail = false;
  const workspace = createAccountWorkspaceStore({ ...db, setItem: async (key, value) => {
    if (fail) throw new Error("disk");
    await db.setItem(key, value);
  } });
  await workspace.bind("a");
  fail = true;
  await assert.rejects(workspace.bind("b"), /disk/);
  assert.equal(workspace.ownerUid(), "a");
  fail = false;
  await workspace.bind("b");
  assert.equal(workspace.ownerUid(), "b");
});

test("switch waits for local writes and rejects old edits queued behind the switch", async () => {
  let release!: () => void;
  const events: string[] = [];
  const writing = withLocalEntityMutation("memo", async () => {
    await new Promise<void>(resolve => { release = resolve; });
    events.push("saved");
  });
  await Promise.resolve();
  const switching = withAllLocalEntityMutations(async () => { events.push("switched"); advanceWorkspaceEpoch(); });
  // Let the switch acquire tag/task/todo locks and queue behind the active memo write.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const stale = withLocalEntityMutation("memo", async () => { events.push("stale"); });
  const rejected = assert.rejects(stale, /アカウントが切り替わりました/);
  release();
  await Promise.all([writing, switching, rejected]);
  assert.deepEqual(events, ["saved", "switched"]);
});

test('task view preferences and ToDo migration checkpoints are isolated between accounts', async () => {
  const db = storage(), workspace = createAccountWorkspaceStore(db); await workspace.initialize(); await workspace.bind('alice');
  for (const key of ['task-planner-view:private', 'task-planner-view:project', 'task-todo-migration-v1']) db.values.set(workspace.mapKey(key),'alice');
  await workspace.bind('bob');
  for (const key of ['task-planner-view:private', 'task-planner-view:project', 'task-todo-migration-v1']) assert.equal(db.values.get(workspace.mapKey(key)),undefined);
  await workspace.bind('alice'); assert.equal(db.values.get(workspace.mapKey('task-todo-migration-v1')),'alice');
});
