import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAppRootExitPolicy,
  transitionAppRootScreen,
  type AppWorkspaceNavigationState,
} from "../src/types/appNavigation.ts";

const createState = (
  overrides: Partial<AppWorkspaceNavigationState> = {},
): AppWorkspaceNavigationState => ({
  rootScreen: "tasks",
  taskScreen: "today",
  memoScreen: "memo",
  memoTab: "all",
  settingsScreen: "settings",
  memoDetailId: null,
  memoSearchOpen: false,
  memoSearchQuery: "",
  ...overrides,
});

test("leaving task detail falls back to today before changing roots", () => {
  const nextState = transitionAppRootScreen(
    createState({
      rootScreen: "tasks",
      taskScreen: "taskDetail",
    }),
    "settings",
  );

  assert.equal(nextState.rootScreen, "settings");
  assert.equal(nextState.taskScreen, "today");
});

test("leaving memo workspace clears detail but keeps search state", () => {
  const nextState = transitionAppRootScreen(
    createState({
      rootScreen: "memos",
      memoScreen: "research",
      memoTab: "note",
      memoDetailId: "memo-1",
      memoSearchOpen: true,
      memoSearchQuery: "focus",
    }),
    "tasks",
  );

  assert.equal(nextState.rootScreen, "tasks");
  assert.equal(nextState.memoScreen, "research");
  assert.equal(nextState.memoTab, "note");
  assert.equal(nextState.memoDetailId, null);
  assert.equal(nextState.memoSearchOpen, true);
  assert.equal(nextState.memoSearchQuery, "focus");
});

test("leaving settings resets nested settings route to root", () => {
  const nextState = applyAppRootExitPolicy(
    createState({
      rootScreen: "settings",
      settingsScreen: "timeSettings",
    }),
  );

  assert.equal(nextState.settingsScreen, "settings");
});

test("switching to the same root is a no-op", () => {
  const currentState = createState({
    rootScreen: "todo",
    taskScreen: "logs",
  });

  const nextState = transitionAppRootScreen(currentState, "todo");

  assert.equal(nextState, currentState);
});
