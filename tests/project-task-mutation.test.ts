import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createProjectTaskMutation } = require("../functions/projectTaskMutationCore.cjs");

function fixture() {
  const records = new Map<string, any>([
    ["projects/p", { taskEnabled: true }],
    ["projects/p/members/alice", { role: "viewer" }],
    ["projects/p/members/bob", { role: "member" }],
    ["projectAccessStates/alice", { userId: "alice", status: "ready", freeProjectId: "p" }],
    ["profiles/alice", { displayName: "Alice" }],
  ]);
  const db = {
    doc: (path: string) => path,
    runTransaction: async (fn: any) => {
      const writes: [string, any][] = [];
      const result = await fn({
        get: async (path: string) => ({ exists: records.has(path), data: () => records.get(path) }),
        set: (path: string, value: any) => { writes.push([path, value]); },
      });
      for (const [path, value] of writes) records.set(path, value);
      return result;
    },
  };
  return { records, mutate: createProjectTaskMutation(db), db };
}
const patch = { title: "Task", description: "Memo", status: "todo", estimateMinutes: 25, tags: [], assigneeUserIds: ["alice", "bob"] };

test("viewer creates and updates multiple assignees with linked memo atomically", async () => {
  const f = fixture();
  const created = await f.mutate("alice", { action: "create", taskId: "t", projectId: "p", patch });
  assert.deepEqual(created.assigneeUserIds, ["alice", "bob"]);
  assert.equal(created.assigneeUserId, "alice");
  assert.equal(f.records.get("projectNotes/project-task-t").body, "Memo");
  const updated = await f.mutate("alice", { action: "update", taskId: "t", expectedAssigneeIds: ["alice", "bob"], patch: { assigneeUserIds: ["bob"], description: "Changed" } });
  assert.deepEqual(updated.assigneeUserIds, ["bob"]);
  assert.equal(f.records.get("projectNotes/project-task-t").body, "Changed");
});

test("rejects outsiders, absent access, nonmembers, forged fields and stale selections", async () => {
  const f = fixture();
  for (const bad of ["outsider", ""]) await assert.rejects(f.mutate(bad, { action: "create", taskId: "t", projectId: "p", patch }));
  await assert.rejects(f.mutate("alice", { action: "create", taskId: "t", projectId: "p", patch: { ...patch, assigneeUserIds: ["outsider"] } }));
  await assert.rejects(f.mutate("alice", { action: "create", taskId: "t", projectId: "p", patch: { ...patch, ownerUserId: "bob" } }));
  await f.mutate("alice", { action: "create", taskId: "t", projectId: "p", patch });
  await assert.rejects(f.mutate("alice", { action: "update", taskId: "t", expectedAssigneeIds: ["alice"], patch: { assigneeUserIds: [] } }), (error: any) => error.code === "aborted");
  assert.deepEqual(f.records.get("projectTasks/t").assigneeUserIds, ["alice", "bob"]);
  f.records.delete("projectAccessStates/alice");
  await assert.rejects(f.mutate("alice", { action: "update", taskId: "t", patch: { title: "Denied" } }));
});

test("test-environment role restrictions are enforced by the server", async () => {
  const f = fixture();
  const mutate = createProjectTaskMutation(f.db, { allowedRoles: ["owner", "member"] });
  await assert.rejects(mutate("alice", { action: "create", taskId: "t", projectId: "p", patch }), (error: any) => error.code === "permission-denied");
  f.records.set("projects/p/members/alice", { role: "member" });
  assert.equal((await mutate("alice", { action: "create", taskId: "t", projectId: "p", patch })).id, "t");
});

test("status transitions and deletion preserve shared timer and hide the linked memo", async () => {
  const f = fixture();
  await f.mutate("alice", { action: "create", taskId: "t", projectId: "p", patch: { ...patch, status: "in_progress" } });
  f.records.get("projectTasks/t").startAt -= 60000;
  const deleted = await f.mutate("alice", { action: "delete", taskId: "t" });
  assert.equal(deleted.status, "paused");
  assert.ok(deleted.elapsedMinutes >= 1);
  assert.equal(f.records.get("projectNotes/project-task-t").deletedAt, deleted.deletedAt);
});


test("planning fields and occurrence updates survive multi-assignee edits", async () => {
  const f = fixture();
  const created = await f.mutate("alice", { action: "create", taskId: "t", projectId: "p", patch: { ...patch, plannedStartAt: 1000000, plannedEndAt: 1300000, repeat: "weekly", repeatAnchorDate: "2026-10-30" } });
  assert.equal(created.repeat, "weekly");
  const updated = await f.mutate("alice", { action: "update", taskId: "t", patch: { occurrenceOverrides: { "2026-11-06": { completed: true } } } });
  assert.equal(updated.occurrenceOverrides["2026-11-06"].completed, true);
  await assert.rejects(f.mutate("alice", { action: "update", taskId: "t", expectedUpdatedAt: -1, patch: { title: "stale" } }), (error: any) => error.code === "aborted");
  await assert.rejects(f.mutate("alice", { action: "update", taskId: "t", patch: { plannedEndAt: 1000001 } }));
});

// The planner sends these fields even when no time or repeat is selected.
for (const assigneeUserIds of [["alice"], ["alice", "bob"]]) {
  test(`planner saves an unscheduled task with ${assigneeUserIds.length} assignees`, async () => {
    const f = fixture();
    const input = { ...patch, description: "", assigneeUserIds, privateDate: "2026-11-01", privateSlotKey: "morning",
      plannedStartAt: null, plannedEndAt: null, repeat: "none", repeatAnchorDate: null };
    const created = await f.mutate("alice", JSON.parse(JSON.stringify({ action: "create", taskId: "t", projectId: "p", patch: input })));
    assert.equal(created.title, "Task");
    assert.deepEqual(created.assigneeUserIds, assigneeUserIds);
    assert.equal(created.plannedStartAt, null);
    assert.equal(created.repeat, "none");
    const updated = await f.mutate("alice", { action: "update", taskId: "t", patch: { title: "読書", plannedStartAt: 1000000, plannedEndAt: 1300000, repeat: "daily", repeatAnchorDate: "2026-11-01" } });
    assert.equal(updated.title, "読書");
    assert.equal(updated.plannedEndAt, 1300000);
    assert.equal(updated.repeat, "daily");
    assert.deepEqual(updated.assigneeUserIds, assigneeUserIds);
  });
}

test("occurrence edits merge without discarding earlier dates or fields", async () => {
  const f = fixture();
  await f.mutate("alice", { action: "create", taskId: "t", projectId: "p", patch });
  await f.mutate("alice", { action: "update", taskId: "t", patch: { occurrenceOverrides: { "2026-11-01": { completed: true, title: "First" }, "2026-11-02": { title: "Second" } } } });
  const updated = await f.mutate("alice", { action: "update", taskId: "t", patch: { occurrenceOverrides: { "2026-11-01": { title: "Changed" } } } });
  assert.deepEqual(updated.occurrenceOverrides, { "2026-11-01": { completed: true, title: "Changed" }, "2026-11-02": { title: "Second" } });
});
