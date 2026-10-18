import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture(previous: any = null, role = "editor", userId = "alice") {
  const writes: any[] = [];
  const publications: any[] = [];
  const deletes: string[] = [];
  const exports: any = {};
  const snapshot = (data: any) => ({ exists: () => data !== null, data: () => data });
  const firestore = {
    doc: (_db: unknown, ...parts: string[]) => parts.join("/"),
    runTransaction: async (_db: unknown, action: any) => action({
      get: async (ref: string) => snapshot(ref.includes("/members/") ? { role } : ref.endsWith("/dest-record") ? null : previous),
      set: (_ref: string, data: any) => writes.push(data),
      delete: (ref: string) => deletes.push(ref),
    }),
  };
  const code = ts.transpileModule(readFileSync("src/services/collaboration/collaborationService.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === "firebase/firestore") return firestore;
    if (name.endsWith("firebaseApp")) return {
      getFirebaseFirestore: () => ({}), getFirebaseAuth: () => ({ currentUser: { uid: userId } }),
    };
    if (name.endsWith("guildPublicationQueue")) return { enqueuePublicationContent: async (data: any) => publications.push(data) };
    if (name.endsWith("syncUser")) return { isSyncFirebaseUser: () => true };
    return {};
  } });
  return { save: exports.upsertProjectSharedNote, move: exports.moveProjectSharedNote, writes, publications, deletes };
}
const note = { id: "note", sourceNoteId: "note", ownerUserId: "alice", projectId: "project", title: null, body: "ああああ", updatedAt: 2 };

test("a project editor can create a new untitled note without anonymous-note handling", async () => {
  const f = fixture();
  await f.save(note);
  assert.equal(f.writes[0].ownerUserId, "alice");
  assert.equal(f.writes[0].sourceNoteId, "note");
  assert.equal(f.writes[0].body, "ああああ");
  assert.equal(f.publications.length, 1);
});
test("saving from memo detail preserves creator metadata and the source identity", async () => {
  const previous = { ...note, creatorDisplayName: "Original name", creatorAnonymizedAt: null, anonymizedReason: null };
  const f = fixture(previous);
  await f.save({ ...note, body: "edited", creatorDisplayName: "Changed profile", sourceNoteId: "other" });
  assert.equal(f.writes[0].creatorDisplayName, "Original name");
  assert.equal(f.writes[0].sourceNoteId, "note");
  assert.equal(f.writes[0].body, "edited");
});
test("viewers and other authors cannot save notes", async () => {
  await assert.rejects(fixture(null, "viewer").save(note));
  await assert.rejects(fixture({ ...note, ownerUserId: "bob" }).save(note));
});
test("only the project owner can edit a departed member's anonymous note", async () => {
  const previous = { ...note, ownerUserId: null, anonymizedReason: "project_exit", creatorDisplayName: "匿名" };
  await assert.rejects(fixture(previous).save(note));
  const f = fixture(previous, "owner");
  await f.save({ ...note, body: "updated" });
  assert.equal(f.writes[0].ownerUserId, null);
  assert.equal(f.writes[0].anonymizedReason, "project_exit");
});

test("actual transfer service creates the destination before deleting the origin and keeps the source ID", async () => {
  const f = fixture(note, "owner"); const moved = await f.move("note", "destination", "dest-record");
  assert.equal(moved.sourceNoteId, "note"); assert.equal(moved.id, "dest-record");
  assert.equal(f.writes[0].projectId, "destination"); assert.deepEqual(f.deletes, ["projectNotes/note"]);
});
test("another author's memo cannot be transferred", async () => {
  const f = fixture({ ...note, ownerUserId: "bob" }, "owner");
  await assert.rejects(f.move("note", "destination", "dest-record")); assert.equal(f.writes.length, 0); assert.equal(f.deletes.length, 0);
});
