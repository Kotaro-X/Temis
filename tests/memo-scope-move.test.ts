import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function fixture({ fail = false, linked = false, switchAccount = false, syncFail = false } = {}) {
  let uid = "alice";
  const original = { id: "source", type: "free", date: null, title: "Title", body: "Body", scope: "project", projectId: "origin", updatedAt: 1 };
  let local: any = original;
  const calls: string[] = [];
  const exports: any = {};
  const modules: any = {
    "nanoid/non-secure": { nanoid: () => "destination-record" },
    "../../db/noteRepo": { getNoteById: async () => local, upsertNoteRecord: async (note: any) => { calls.push(`stage:${note.projectId}`); local = note; }, setNoteScope: async () => { calls.push("sync"); if (syncFail) throw new Error("sync failed"); return local; } },
    "../sync/firebaseApp": { getFirebaseAuth: () => ({ currentUser: { uid } }) },
    "./collaborationService": {
      listProjectSharedNotes: async () => [{ id: "shared-record", sourceNoteId: "source", ownerUserId: "alice" }],
      listProjectTasks: async () => linked ? [{ relatedMemoId: "source" }] : [],
      moveProjectSharedNote: async (id: string, destination: string, next: string) => { calls.push(`move:${id}:${destination}:${next}`); if (switchAccount) uid = "bob"; if (fail || switchAccount) throw new Error("rejected"); },
    },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/services/collaboration/moveMemoScope.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: (name: string) => modules[name] });
  return { move: () => exports.moveMemoScope("source", "destination", { userId: "alice", username: "alice" }), calls, local: () => local, original };
}
test("move keeps source identity and transfers sharing before sync", async () => {
  const f = fixture(); await f.move();
  assert.deepEqual(f.calls, ["stage:destination", "move:shared-record:destination:destination-record", "sync"]);
  assert.equal(f.local().id, "source"); assert.equal(f.local().body, "Body");
});
test("cloud rejection restores the original content and scope", async () => {
  const f = fixture({ fail: true }); await assert.rejects(f.move()); assert.equal(f.local(), f.original);
  assert.equal(f.calls.includes("sync"), false);
});
test("task-linked notes cannot move", async () => {
  const f = fixture({ linked: true }); await assert.rejects(f.move()); assert.deepEqual(f.calls, []);
});
test("account switch suppresses rollback and sync in the next account", async () => {
  const f = fixture({ switchAccount: true }); await assert.rejects(f.move()); assert.equal(f.calls.length, 2); assert.equal(f.calls.includes("sync"), false);
});

test("post-commit sync failure reports the committed destination instead of restoring a stale scope", async () => {
  const f = fixture({ syncFail: true }); const result = await f.move();
  assert.equal(result.projectId, "destination"); assert.equal(result.syncPending, true); assert.equal(f.local().projectId, "destination");
});
