import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { changedProjectTaskFields, projectTaskElapsed, projectTaskOwner, transitionProjectTask } from "../src/services/collaboration/projectTaskCore.ts";
import type { ProjectTask } from "../src/types/collaboration.ts";

const task: ProjectTask = { id: "task", projectId: "project", kind: "task", ownerUserId: "alice", creatorUserId: "alice", title: "Title", status: "todo", createdAt: 1, updatedAt: 1, completedAt: null, deletedAt: null };
test("legacy ownership falls back only when assignment is absent, explicit null remains unassigned", () => {
  assert.equal(projectTaskOwner(task), "alice");
  assert.equal(projectTaskOwner(task, ["bob"]), null);
  assert.equal(projectTaskOwner(task, ["alice"]), "alice");
  assert.equal(projectTaskOwner({ ...task, assigneeUserId: "bob" }), "bob");
  assert.equal(projectTaskOwner({ ...task, assigneeUserId: null }), null);
  assert.equal(projectTaskOwner({ ...task, creatorUserId: null, ownerUserId: null }), null);
});
test("shared timer starts, pauses, resumes and completes without repeated time accumulation", () => {
  const started = transitionProjectTask(task, "in_progress", 1000);
  assert.equal(projectTaskElapsed(started, 61000), 1);
  assert.equal(transitionProjectTask(started, "in_progress", 5000).startAt, 1000);
  const paused = transitionProjectTask(started, "paused", 61000);
  assert.equal(paused.elapsedMinutes, 1); assert.equal(paused.startAt, null);
  assert.equal(transitionProjectTask(paused, "paused", 121000).elapsedMinutes, 1);
  const done = transitionProjectTask(transitionProjectTask(paused, "in_progress", 121000), "completed", 181000);
  assert.equal(done.elapsedMinutes, 2); assert.equal(done.completedAt, 181000);
  assert.equal(transitionProjectTask(done, "completed", 241000).completedAt, 181000);
});
test("old running tasks start at zero rather than inventing an elapsed duration", () => {
  assert.equal(projectTaskElapsed({ ...task, status: "in_progress" }, 1000000), 0);
});
test("form patch contains only changed fields, preserving a colleague's status, assignment and tags", () => {
  assert.deepEqual(changedProjectTaskFields({ title: "A", status: "todo", tags: ["x"] }, { title: "B", status: "todo", tags: ["x"] }), { title: "B" });
});

function fixture(role: string | null = "member", initial: ProjectTask = task) {
  const records = new Map<string, any>([["projectTasks/task", initial], ["projects/project", { id: "project", taskEnabled: true, updatedAt: 1 }], ["profiles/alice", { displayName: "Alice" }]]);
  if (role) { records.set("projects/project/members/alice", { userId: "alice", role }); records.set("projectMemberships/project__alice", { userId: "alice", projectId: "project", role }); }
  records.set("projects/project/members/bob", { userId: "bob", role: "viewer" });
  const snapshot = (ref: string) => ({ exists: () => records.has(ref), data: () => records.get(ref) });
  let serial = Promise.resolve();
  const listeners = new Map<string, (snapshot: any) => void>();
  const docs = (path: string) => [...records].filter(([key]) => key.startsWith(path + "/") && !key.slice(path.length + 1).includes("/")).map(([key, data]) => ({ id: key.split("/").at(-1), data: () => data }));
  const firestore = {
    collection: (_db: unknown, ...parts: string[]) => parts.join("/"), query: (path: string) => path,
    where: () => ({}), getDocs: async (path: string) => ({ docs: docs(path) }),
    onSnapshot: (path: string, action: any) => { listeners.set(path, action); action({ docs: docs(path) }); return () => listeners.delete(path); },
    doc: (_db: unknown, ...parts: string[]) => parts.join("/"), getDoc: async (ref: string) => snapshot(ref),
    runTransaction: (_db: unknown, action: any) => {
      const pending = serial.then(async () => {
        const writes: [string, any][] = [];
        const result = await action({ get: async (ref: string) => snapshot(ref), set: (ref: string, data: any) => writes.push([ref, data]) });
        writes.forEach(([ref, data]) => records.set(ref, data)); return result;
      });
      serial = pending.catch(() => {}); return pending;
    },
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync("src/services/collaboration/collaborationService.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: (name: string) => name === "firebase/firestore" ? firestore : name.endsWith("projectTaskCore") ? { projectTaskOwner, transitionProjectTask } : name.endsWith("firebaseApp") ? {
      getFirebaseFirestore: () => ({}), getFirebaseAuth: () => ({ currentUser: { uid: "alice" } }),
    } : name.startsWith("nanoid") ? { nanoid: () => "created" } : {},
  });
  return { records, api: exports, listeners, emit: () => listeners.forEach((action, path) => action({ docs: docs(path) })) };
}
test("member can assign, unassign and move a task; nonmember assignment is rejected", async () => {
  const f = fixture();
  await f.api.updateProjectTask("task", { assigneeUserId: "bob", privateDate: "2026-10-07", privateSlotKey: "night" });
  assert.equal(f.records.get("projectTasks/task").assigneeUserId, "bob");
  await assert.rejects(f.api.updateProjectTask("task", { assigneeUserId: "outsider" }));
  await f.api.updateProjectTask("task", { assigneeUserId: null });
  assert.equal(f.records.get("projectTasks/task").assigneeUserId, null);
});
test("departed creator cannot edit or delete even though creator metadata still matches", async () => {
  const f = fixture(null);
  await assert.rejects(f.api.updateProjectTask("task", { title: "Changed" }));
  await assert.rejects(f.api.deleteProjectTask("task"));
});
test("concurrent start and pause use the latest committed record and archive stops timing", async () => {
  const f = fixture();
  await Promise.all([f.api.updateProjectTask("task", { status: "in_progress" }), f.api.updateProjectTask("task", { status: "in_progress" })]);
  const started = f.records.get("projectTasks/task");
  assert.ok(started.startAt > 0);
  started.startAt -= 60000;
  await Promise.all([f.api.updateProjectTask("task", { status: "paused" }), f.api.updateProjectTask("task", { status: "paused" })]);
  assert.ok(f.records.get("projectTasks/task").elapsedMinutes >= 1 && f.records.get("projectTasks/task").elapsedMinutes < 1.1);
  await f.api.updateProjectTask("task", { status: "in_progress" });
  await f.api.updateProjectTask("task", { isArchived: true });
  assert.equal(f.records.get("projectTasks/task").status, "paused");
  assert.equal(f.records.get("projectTasks/task").startAt, null);
});
test("task content and linked memo are saved together without changing authorship", async () => {
  const f = fixture();
  await f.api.updateProjectTask("task", { description: "Shared body" });
  const saved = f.records.get("projectTasks/task");
  const note = f.records.get(`projectNotes/${saved.relatedMemoId}`);
  assert.equal(note.body, saved.description); assert.equal(note.sourceTaskId, "task");
  await f.api.upsertProjectSharedNote({ ...note, body: "Edited by viewer", ownerUserId: "bob" });
  assert.equal(f.records.get("projectTasks/task").description, "Edited by viewer");
  assert.equal(f.records.get(`projectNotes/${saved.relatedMemoId}`).ownerUserId, "alice");
});
test("new tasks default to the author and member can create; explicit unassigned is preserved", async () => {
  const f = fixture();
  const result = await f.api.createProjectTask({ projectId: "project", kind: "task", title: "New", status: "todo", description: "Body" });
  assert.equal(result.assigneeUserId, "alice"); assert.equal(result.elapsedMinutes, 0);
  assert.equal(f.records.get(`projectNotes/${result.relatedMemoId}`).sourceTaskId, result.id);
  const unassigned = await f.api.createProjectTask({ projectId: "project", kind: "task", title: "New", status: "todo", assigneeUserId: null });
  assert.equal(unassigned.assigneeUserId, null);
});
test("a task cannot take over an unrelated memo and deleted tasks cannot be edited", async () => {
  const f = fixture(); f.records.set("projectNotes/project-task-task", { projectId: "project", ownerUserId: "bob", body: "Private authorship" });
  await assert.rejects(f.api.updateProjectTask("task", { description: "Takeover" }));
  await f.api.deleteProjectTask("task");
  await assert.rejects(f.api.updateProjectTask("task", { title: "Restore deleted" }));
});

test("deletion stops the timer and hides the linked memo atomically", async () => {
  const f = fixture();
  await f.api.updateProjectTask("task", { description: "Linked", status: "in_progress" });
  const id = f.records.get("projectTasks/task").relatedMemoId;
  await f.api.deleteProjectTask("task");
  const deleted = f.records.get("projectTasks/task");
  assert.equal(deleted.startAt, null); assert.equal(deleted.status, "paused");
  assert.equal(f.records.get(`projectNotes/${id}`).deletedAt, deleted.deletedAt);
  await assert.rejects(f.api.upsertProjectSharedNote({ ...f.records.get(`projectNotes/${id}`), body: "Resurrect" }));
});

test("Private listing follows the assignee rather than the creator and excludes unassigned tasks", async () => {
  const f = fixture();
  f.records.set("projectTasks/other", { ...task, id: "other", ownerUserId: "bob", creatorUserId: "bob", assigneeUserId: "alice" });
  f.records.set("projectTasks/unassigned", { ...task, id: "unassigned", assigneeUserId: null });
  f.records.set("projectTasks/task", { ...task, assigneeUserId: "bob" });
  assert.deepEqual(Array.from(await f.api.listMyProjectTasks("task"), (item: any) => item.task.id), ["other"]);
});
test("live ownership is recomputed after member departure and both listeners are disposed", () => {
  const f = fixture(); let received: any[] = [];
  const stop = f.api.subscribeProjectTasks("project", (tasks: any[]) => { received = tasks; }, (error: Error) => { throw error; });
  assert.equal(received[0].assigneeUserId, "alice");
  f.records.delete("projects/project/members/alice"); f.emit();
  assert.equal(received[0].assigneeUserId, null);
  stop(); assert.equal(f.listeners.size, 0);
});

test("editing an old linked memo upgrades its association and preserves untouched task fields", async () => {
  const f = fixture("member", { ...task, relatedMemoId: "old-note", title: "Colleague title", description: "Original" });
  f.records.set("projectNotes/old-note", { id: "old-note", projectId: "project", ownerUserId: "bob", title: "Colleague title", body: "Original" });
  await f.api.upsertProjectSharedNote({ id: "old-note", projectId: "project", ownerUserId: "bob", sourceTaskId: "task", title: "Stale title", body: "Changed" }, { description: "Changed" });
  assert.equal(f.records.get("projectTasks/task").title, "Colleague title");
  assert.equal(f.records.get("projectTasks/task").description, "Changed");
  assert.equal(f.records.get("projectNotes/old-note").sourceTaskId, "task");
  assert.equal(f.records.get("projectNotes/old-note").ownerUserId, "bob");
});

test("viewer cannot create, edit or delete shared tasks", async () => {
  const f = fixture('viewer');
  await assert.rejects(f.api.updateProjectTask('task', { title: 'Changed' }));
  await assert.rejects(f.api.deleteProjectTask('task'));
  await assert.rejects(f.api.createProjectTask({ projectId: 'project', kind: 'task', title: 'New', status: 'todo' }));
});
test("legacy Project ToDo is converted in place, preserving its ID and linked memo", async () => {
  const f = fixture('member', { ...task, kind: 'todo', description: 'Legacy body' });
  const saved = await f.api.updateProjectTask('task', { kind: 'task', privateDate: null, privateSlotKey: 'morning' });
  assert.equal(saved.id, 'task'); assert.equal(saved.kind, 'task'); assert.equal(saved.privateDate, null);
  assert.equal(f.records.get(`projectNotes/${saved.relatedMemoId}`).body, 'Legacy body');
});
