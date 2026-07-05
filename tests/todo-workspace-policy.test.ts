import test from "node:test";
import assert from "node:assert/strict";

import {
  applyTodoWorkspaceDeactivationPolicy,
  createClosedTodoComposerState,
} from "../src/hooks/todos/todoWorkspacePolicy.ts";

test("closing the composer discards the in-progress draft", () => {
  const closedState = createClosedTodoComposerState();

  assert.deepEqual(closedState.todoDraft, {
    text: "",
    memo: "",
    reminderDate: "",
    reminderTime: "",
    repeat: "none",
    tags: [],
  });
  assert.equal(closedState.todoCreateOpen, false);
  assert.equal(closedState.todoEditingContext, null);
  assert.equal(closedState.todoDatePickerOpen, false);
  assert.equal(closedState.todoTimePickerOpen, false);
  assert.equal(closedState.todoDateError, null);
});

test("deactivating the todo workspace keeps filters but clears transient UI state", () => {
  const nextState = applyTodoWorkspaceDeactivationPolicy({
    openSwipeTodoId: "todo-1",
    todoCreateOpen: true,
    todoEditingContext: {
      todoId: "todo-1",
      seriesId: "series-1",
      occurrenceDate: "2026-06-22",
      isRecurringSeries: true,
    },
    todoDraft: {
      text: "draft title",
      memo: "draft body",
      reminderDate: "2026-06-22",
      reminderTime: "09:30",
      repeat: "weekly",
      tags: ["連絡"],
    },
    todoDatePickerOpen: true,
    todoTimePickerOpen: true,
    todoDateError: "invalid",
    todoViewMode: "calendar" as const,
    todoListRange: "month" as const,
  });

  assert.equal(nextState.openSwipeTodoId, null);
  assert.equal(nextState.todoCreateOpen, false);
  assert.equal(nextState.todoEditingContext, null);
  assert.deepEqual(nextState.todoDraft, {
    text: "",
    memo: "",
    reminderDate: "",
    reminderTime: "",
    repeat: "none",
    tags: [],
  });
  assert.equal(nextState.todoDatePickerOpen, false);
  assert.equal(nextState.todoTimePickerOpen, false);
  assert.equal(nextState.todoDateError, null);
  assert.equal(nextState.todoViewMode, "calendar");
  assert.equal(nextState.todoListRange, "month");
});
