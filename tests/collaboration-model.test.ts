import assert from "node:assert/strict";
import test from "node:test";

import {
  USERNAME_CHANGE_INTERVAL_MS,
  canEditProjectTask,
  canInviteToProject,
  connectionIdFor,
  getConnectionStatus,
  isProjectContentCreatedBy,
  normalizeUsername,
  validateUsername,
  type Connection,
  type Project,
  type ProjectTask,
} from "../src/types/collaboration.ts";

test("username normalizes uppercase and rejects reserved or malformed values", () => {
  assert.equal(normalizeUsername(" @Kotaro_Doi "), "kotaro_doi");
  assert.equal(validateUsername("Kotaro.Doi"), null);
  assert.match(validateUsername("ab") ?? "", /3〜30/);
  assert.match(validateUsername("temis") ?? "", /予約語/);
  assert.match(validateUsername("a..b") ?? "", /英小文字/);
  assert.equal(USERNAME_CHANGE_INTERVAL_MS, 30 * 24 * 60 * 60 * 1000);
});

test("a connection has one canonical id and viewer-aware state", () => {
  assert.equal(connectionIdFor("bob", "alice"), "alice__bob");
  const pending: Connection = { id: "alice__bob", userIds: ["alice", "bob"], requesterUserId: "alice", recipientUserId: "bob", status: "pending", createdAt: 1, updatedAt: 1 };
  assert.equal(getConnectionStatus(pending, "alice"), "outgoing_pending");
  assert.equal(getConnectionStatus(pending, "bob"), "incoming_pending");
});

test("project permissions preserve the owner/member/viewer boundary", () => {
  const project: Project = { id: "p1", name: "P", ownerUserId: "owner", tags: [], visibility: "invite_only", joinPolicy: "invitation_only", invitationPolicy: "members", taskEnabled: true, createdAt: 1, updatedAt: 1 };
  const task: ProjectTask = { id: "t", ownerUserId: "owner", creatorUserId: "owner", projectId: "p1", title: "Task", status: "todo", createdAt: 1, updatedAt: 1 };
  assert.equal(canInviteToProject(project, "member"), true);
  assert.equal(canInviteToProject(project, "owner"), true);
  assert.equal(canInviteToProject(project, "viewer"), false);
  assert.equal(canInviteToProject({ ...project, invitationPolicy: "owner_only" }, "member"), false);
  assert.equal(canEditProjectTask(task, "viewer", "viewer"), false);
  assert.equal(canEditProjectTask(task, "member", "member"), true);
});

test("a project creator can find their own content from Private", () => {
  const note = { ownerUserId: "alice" };
  const task: ProjectTask = { id: "t", ownerUserId: "bob", creatorUserId: "alice", projectId: "p1", title: "Task", status: "todo", createdAt: 1, updatedAt: 1 };

  assert.equal(isProjectContentCreatedBy(note, "alice"), true);
  assert.equal(isProjectContentCreatedBy(task, "alice"), true);
  assert.equal(isProjectContentCreatedBy(task, "carol"), false);
});

test("project tasks retain personal-task editing fields without timer state", () => {
  const task: ProjectTask = {
    id: "t", ownerUserId: "owner", creatorUserId: "owner", projectId: "p1",
    title: "共有タスク", status: "paused", tags: ["開発"], estimateMinutes: 45,
    creatorDisplayName: "作成者", isArchived: false, createdAt: 1, updatedAt: 1,
  };
  assert.deepEqual(task.tags, ["開発"]);
  assert.equal(task.estimateMinutes, 45);
  assert.equal(task.status, "paused");
  assert.equal(task.creatorDisplayName, "作成者");
  assert.equal("elapsedMinutes" in task, false);
  assert.equal("startAt" in task, false);
});
