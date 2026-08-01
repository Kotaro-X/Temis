import test from "node:test";
import assert from "node:assert/strict";

import { buildTodaySections } from "../src/hooks/tasks/taskSelectors.ts";
import type { TodayState } from "../src/types/index.ts";

const state: TodayState = {
  date: "2026-07-30",
  slots: {
    morning: {
      tasks: [
        {
          id: "completed-task",
          taskName: "Completed task",
          tags: [],
          estimateMinutes: 30,
          elapsedMinutes: 30,
          status: "DONE",
          isArchived: false,
          startAt: null,
        },
        {
          id: "active-task",
          taskName: "Active task",
          tags: [],
          estimateMinutes: 45,
          elapsedMinutes: 0,
          status: "TODO",
          isArchived: false,
          startAt: null,
        },
      ],
    },
    forenoon: { tasks: [] },
    afternoon: { tasks: [] },
    night: { tasks: [] },
  },
};

const schedule = {
  morning: { start: "08:00", end: "09:00" },
  forenoon: { start: "09:00", end: "12:00" },
  afternoon: { start: "12:00", end: "18:00" },
  night: { start: "18:00", end: "24:00" },
} as const;

test("time box remaining time includes completed task estimates", () => {
  const morning = buildTodaySections(state, schedule)[0];

  assert.equal(morning.incompleteEstimate, 45);
  assert.equal(morning.totalEstimate, 75);
  assert.equal(morning.remainingMinutes, 0);
  assert.equal(morning.overflow, 15);
});
