import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_TIMEBOX_SCHEDULE } from "../src/types/timer.ts";
import type { ProjectTask } from "../src/types/collaboration.ts";
import {
  getProjectTaskPrivateDate,
  getProjectTaskPrivateSlot,
} from "../src/utils/projectTaskPlacement.ts";

const task = (overrides: Partial<ProjectTask> = {}): ProjectTask => ({
  id: "project-task-1",
  ownerUserId: "owner",
  creatorUserId: "owner",
  projectId: "project-1",
  title: "共有タスク",
  status: "todo",
  createdAt: new Date("2026-08-08T09:30:00").getTime(),
  updatedAt: 1,
  ...overrides,
});

test("Private placement uses an explicitly selected date and time box", () => {
  const projectTask = task({ privateDate: "2026-08-12", privateSlotKey: "night" });

  assert.equal(getProjectTaskPrivateDate(projectTask), "2026-08-12");
  assert.equal(getProjectTaskPrivateSlot(projectTask, DEFAULT_TIMEBOX_SCHEDULE), "night");
});

test("existing project tasks fall back to the due date and creation-time box", () => {
  const projectTask = task({ dueAt: new Date("2026-08-10T00:00:00").getTime() });

  assert.equal(getProjectTaskPrivateDate(projectTask), "2026-08-10");
  assert.equal(getProjectTaskPrivateSlot(projectTask, DEFAULT_TIMEBOX_SCHEDULE), "forenoon");
});
