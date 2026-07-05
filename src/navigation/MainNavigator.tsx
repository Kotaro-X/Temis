import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppChromeShell, {
  type AppChromeTab,
} from "../components/app-shell/AppChromeShell";
import AppProviders from "../components/app-shell/AppProviders";
import MemoWorkspaceShell from "../components/memo-shell/MemoWorkspaceShell";
import SettingsShell from "../components/settings-shell/SettingsShell";
import TaskWorkspaceShell from "../components/task-shell/TaskWorkspaceShell";
import TodoWorkspaceShell from "../components/todo-shell/TodoWorkspaceShell";
import { useAppUI } from "../context/AppUIContext";

const AppContent = () => {
  const insets = useSafeAreaInsets();
  const {
    rootScreen,
    openTasks,
    openTodo,
    openMemos,
    openSettingsHome,
    openMemoSearch,
  } = useAppUI();
  const activeTab: AppChromeTab =
    rootScreen === "memos" ? "memos" : rootScreen === "todo" ? "todo" : "tasks";
  const settingsContentPaddingTop = insets.top + 16;

  const handleTabPress = (tab: AppChromeTab) => {
    if (tab === "tasks" && rootScreen === "tasks") {
      return;
    }
    if (tab === "todo" && rootScreen === "todo") {
      return;
    }
    if (tab === "memos" && rootScreen === "memos") {
      return;
    }
    if (tab === "tasks") {
      openTasks();
      return;
    }
    if (tab === "todo") {
      openTodo();
      return;
    }
    openMemos();
  };

  return (
    <MemoWorkspaceShell
      active={rootScreen === "memos"}
    >
      {(memoWorkspace) => (
        <TodoWorkspaceShell
          active={rootScreen === "todo"}
          viewConfig={{ insetsTop: insets.top }}
        >
          {(todoWorkspace) => (
            <TaskWorkspaceShell
              active={rootScreen === "tasks"}
              viewConfig={{
                insetsTop: insets.top,
                insetsBottom: insets.bottom,
                onSearchToken: openMemoSearch,
              }}
            >
              {(taskWorkspace) => (
                <AppChromeShell
                  insetsTop={insets.top}
                  insetsBottom={insets.bottom}
                  activeTab={activeTab}
                  onTabPress={handleTabPress}
                  onOpenTodo={openTodo}
                  onOpenSettings={openSettingsHome}
                >
                  <>
                    {taskWorkspace}
                    {memoWorkspace}
                    {todoWorkspace}
                    <SettingsShell
                      active={rootScreen === "settings"}
                      contentPaddingTop={settingsContentPaddingTop}
                    >
                      {(settingsWorkspace) => settingsWorkspace}
                    </SettingsShell>
                  </>
                </AppChromeShell>
              )}
            </TaskWorkspaceShell>
          )}
        </TodoWorkspaceShell>
      )}
    </MemoWorkspaceShell>
  );
};

export default function MainNavigator() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}
