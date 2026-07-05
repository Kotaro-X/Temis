export type AppRootScreen = "tasks" | "todo" | "settings" | "memos";

export type TaskWorkspaceScreenKey =
  | "today"
  | "logs"
  | "archive"
  | "taskDetail";

export type MemoWorkspaceScreenKey = "memo" | "notes" | "research";

export type SettingsWorkspaceScreenKey =
  | "settings"
  | "sync"
  | "account"
  | "timeSettings"
  | "tags"
  | "deletedItems";

export type AppWorkspaceNavigationState = {
  rootScreen: AppRootScreen;
  taskScreen: TaskWorkspaceScreenKey;
  memoScreen: MemoWorkspaceScreenKey;
  settingsScreen: SettingsWorkspaceScreenKey;
  memoDetailId: string | null;
  memoSearchOpen: boolean;
  memoSearchQuery: string;
};

export const APP_WORKSPACE_TRANSITION_POLICY = {
  tasks: {
    // Keep the last top-level task screen across tab switches, but never
    // restore a stale detail screen when returning from another workspace.
    resetOnDeactivate: ["taskDetail"] as const,
    fallbackScreen: "today" as TaskWorkspaceScreenKey,
  },
  todo: {
    // Keep filters and calendar position, but close transient editors/pickers
    // and discard in-progress drafts when the workspace loses focus.
    resetTransientStateOnDeactivate: true,
    discardDraftOnDeactivate: true,
  },
  memos: {
    // Keep the current memo/research tab, but close detail overlays when
    // leaving the memo workspace. Search stays global because tasks can open it.
    resetDetailOnDeactivate: true,
    keepSearchOverlayAcrossTabs: true,
  },
  settings: {
    // Settings always opens from its root menu and rebuilds drafts from
    // persisted settings when activated.
    resetRouteOnOpen: true,
    rootScreen: "settings" as SettingsWorkspaceScreenKey,
  },
} as const;

export const applyAppRootExitPolicy = (
  state: AppWorkspaceNavigationState,
): AppWorkspaceNavigationState => {
  if (state.rootScreen === "tasks") {
    return {
      ...state,
      taskScreen:
        state.taskScreen === "taskDetail"
          ? APP_WORKSPACE_TRANSITION_POLICY.tasks.fallbackScreen
          : state.taskScreen,
    };
  }

  if (state.rootScreen === "memos") {
    return APP_WORKSPACE_TRANSITION_POLICY.memos.resetDetailOnDeactivate
      ? { ...state, memoDetailId: null }
      : state;
  }

  if (state.rootScreen === "settings") {
    return {
      ...state,
      settingsScreen: APP_WORKSPACE_TRANSITION_POLICY.settings.rootScreen,
    };
  }

  return state;
};

export const transitionAppRootScreen = (
  state: AppWorkspaceNavigationState,
  nextRoot: AppRootScreen,
): AppWorkspaceNavigationState => {
  if (state.rootScreen === nextRoot) {
    return state;
  }
  return {
    ...applyAppRootExitPolicy(state),
    rootScreen: nextRoot,
  };
};
