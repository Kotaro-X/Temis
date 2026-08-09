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
import ProjectsScreen from "../screens/ProjectsScreen";
import ProjectWorkspaceScreen from "../screens/ProjectWorkspaceScreen";
import { useAppUI } from "../context/AppUIContext";

const AppContent = () => {
  const insets = useSafeAreaInsets();
  const {
    rootScreen,
    openTasks,
    openTodo,
    openMemos,
    openProjects,
    openSettingsAccount,
    openSettingsHome,
    openMemoSearch,
    openMenu,
    workspaceScope,
    activeProjectId,
    selectProject,
  } = useAppUI();
  const activeTab: AppChromeTab =
    rootScreen === "memos" ? "memos" : rootScreen === "todo" ? "todo" : rootScreen === "projects" ? "projects" : "tasks";
  const settingsContentPaddingTop = insets.top + 16;
  // Private workspace headers start at the safe-area edge. Keep project
  // workspace headers on the exact same baseline rather than using Settings'
  // extra 16px content inset.
  const workspaceContentPaddingTop = insets.top;
  const isPrivateWorkspace = workspaceScope === "private";

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
    if (tab === "projects" && rootScreen === "projects") return;
    if (tab === "tasks") {
      openTasks();
      return;
    }
    if (tab === "projects") {
      openProjects();
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
      active={isPrivateWorkspace && rootScreen === "memos"}
    >
      {(memoWorkspace) => (
        <TodoWorkspaceShell
          active={isPrivateWorkspace && rootScreen === "todo"}
          viewConfig={{ insetsTop: insets.top }}
        >
          {(todoWorkspace) => (
            <TaskWorkspaceShell
              active={isPrivateWorkspace && rootScreen === "tasks"}
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
                  onOpenAccountSettings={openSettingsAccount}
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
                    <ProjectsScreen
                      visible={workspaceScope === "projects" && rootScreen === "projects"}
                      contentPaddingTop={workspaceContentPaddingTop}
                      onOpenMenu={openMenu}
                      activeProjectId={activeProjectId}
                      onSelectProject={selectProject}
                    />
                    <ProjectWorkspaceScreen
                      active={workspaceScope === "projects" && rootScreen === "tasks"}
                      tab="tasks"
                      contentPaddingTop={workspaceContentPaddingTop}
                    />
                    <ProjectWorkspaceScreen
                      active={workspaceScope === "projects" && rootScreen === "todo"}
                      tab="todo"
                      contentPaddingTop={workspaceContentPaddingTop}
                    />
                    <ProjectWorkspaceScreen
                      active={workspaceScope === "projects" && rootScreen === "memos"}
                      tab="memos"
                      contentPaddingTop={workspaceContentPaddingTop}
                    />
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
