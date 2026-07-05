import test from "node:test";
import assert from "node:assert/strict";

import type { TodayState } from "../src/types/index.ts";
import { mergeTodayStatesWithLegacy } from "../src/utils/todayStateMerge.ts";

const createState = (date: string): TodayState => ({
  date,
  slots: {
    morning: { tasks: [] },
    forenoon: { tasks: [] },
    afternoon: { tasks: [] },
    night: { tasks: [] },
  },
});

test("mergeTodayStatesWithLegacy includes legacy state when no dated key exists", () => {
  const merged = mergeTodayStatesWithLegacy([], createState("2026-07-05"));

  assert.deepEqual(
    merged.map((state) => state.date),
    ["2026-07-05"],
  );
});

test("mergeTodayStatesWithLegacy keeps dated state when legacy duplicates the same date", () => {
  const scopedState = createState("2026-07-05");
  scopedState.slots.morning.tasks.push({
    id: "task-1",
    taskName: "dated",
    tags: [],
    estimateMinutes: 25,
    elapsedMinutes: 0,
    status: "TODO",
    isArchived: false,
    startAt: null,
  });

  const legacyState = createState("2026-07-05");
  legacyState.slots.night.tasks.push({
    id: "task-2",
    taskName: "legacy",
    tags: [],
    estimateMinutes: 25,
    elapsedMinutes: 0,
    status: "TODO",
    isArchived: false,
    startAt: null,
  });

  const merged = mergeTodayStatesWithLegacy([scopedState], legacyState);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].slots.morning.tasks[0]?.id, "task-1");
  assert.equal(merged[0].slots.night.tasks.length, 0);
});
