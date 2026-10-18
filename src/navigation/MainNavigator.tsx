import TaskPlanningProvider from '../features/taskPlanning/TaskPlanningProvider';
import CommunityAccessBoundary from "../components/CommunityAccessBoundary";
import ProfileSetupBoundary from "../screens/ProfileSetupScreen";
import AccountEntryBoundary from "../screens/AccountEntryScreen";
import React, { useEffect } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppChromeShell, {
  type AppChromeTab,
} from "../components/app-shell/AppChromeShell";
import AppProviders from "../components/app-shell/AppProviders";
import MemoWorkspaceShell from "../components/memo-shell/MemoWorkspaceShell";
import SettingsShell from "../components/settings-shell/SettingsShell";
import TaskWorkspaceShell from "../components/task-shell/TaskWorkspaceShell";
import ProjectsScreen from "../screens/ProjectsScreen";
import ProjectWorkspaceScreen from "../screens/ProjectWorkspaceScreen";
import GuildScreen from "../screens/GuildScreen";
import DirectMessagesScreen from "../screens/DirectMessagesScreen";
import GuildAdminScreen from "../screens/GuildAdminScreen";
import { useAppUI } from "../context/AppUIContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasStaffFreeAccess } from "../services/subscription/staffAccess";

const AppContent = () => {
  const insets = useSafeAreaInsets();
  const {
    rootScreen,
    openTasks,
    openMemos,
    openProjects,
    openGuild,
    openSettingsAccount,
    openSettingsHome,
    openMemoSearch,
    openMenu,
    workspaceScope,
    activeProjectId,
    selectProject,
  } = useAppUI();
  const { accessGrant } = useSubscription();
  const hasGuildAdminAccess = hasStaffFreeAccess(accessGrant);
  const activeTab: AppChromeTab | null =
    rootScreen === "dm" ? null : rootScreen === "memos" ? "memos" : rootScreen === "projects" ? "projects" : rootScreen === "guild" ? "guild" : "tasks";
  const settingsContentPaddingTop = insets.top + 16;
  // Private workspace headers start at the safe-area edge. Keep project
  // workspace headers on the exact same baseline rather than using Settings'
  // extra 16px content inset.
  const workspaceContentPaddingTop = insets.top;
  const isPrivateWorkspace = workspaceScope === "private";

  useEffect(() => { if (rootScreen === "todo") openTasks("today"); }, [rootScreen, openTasks]);

  useEffect(() => {
    if (!hasGuildAdminAccess && rootScreen === "guildAdmin") {
      openTasks();
    }
  }, [hasGuildAdminAccess, openTasks, rootScreen]);

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
    if (tab === "guild" && rootScreen === "guild") return;
    if (tab === "tasks") {
      openTasks();
      return;
    }
    if (tab === "projects") {
      openProjects();
      return;
    }
    if (tab === "guild") {
      openGuild();
      return;
    }
    if (tab === "todo") {
      openTasks();
      return;
    }
    openMemos();
  };

  return (
    <MemoWorkspaceShell
      active={isPrivateWorkspace && rootScreen === "memos"}
    >
      {(memoWorkspace) => (
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
                  onOpenTodo={() => openTasks("today")}
                  onOpenSettings={openSettingsHome}
                  onOpenAccountSettings={openSettingsAccount}
                >
                  <>
                    {taskWorkspace}
                    {memoWorkspace}
                    <SettingsShell
                      active={rootScreen === "settings"}
                      contentPaddingTop={settingsContentPaddingTop}
                    >
                      {(settingsWorkspace) => settingsWorkspace}
                    </SettingsShell>
                    <CommunityAccessBoundary visible={workspaceScope === "projects" && ["projects", "tasks", "todo", "memos"].includes(rootScreen)} title="プロジェクト" contentPaddingTop={workspaceContentPaddingTop}>
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
                          active={workspaceScope === "projects" && rootScreen === "memos"}
                          tab="memos"
                          contentPaddingTop={workspaceContentPaddingTop}
                        />
                    </CommunityAccessBoundary>
                    <CommunityAccessBoundary visible={workspaceScope === "private" && rootScreen === "guild"} title="Commons" contentPaddingTop={workspaceContentPaddingTop}>
                    <GuildScreen
                      visible={workspaceScope === "private" && rootScreen === "guild"}
                      contentPaddingTop={workspaceContentPaddingTop}
                      onOpenMenu={openMenu}
                    />
                    </CommunityAccessBoundary>
                    {rootScreen === "dm" ? <DirectMessagesScreen contentPaddingTop={workspaceContentPaddingTop} /> : null}
                    <CommunityAccessBoundary visible={hasGuildAdminAccess && workspaceScope === "private" && rootScreen === "guildAdmin"} title="Commons" contentPaddingTop={workspaceContentPaddingTop}>
                    <GuildAdminScreen
                      visible={hasGuildAdminAccess && workspaceScope === "private" && rootScreen === "guildAdmin"}
                      contentPaddingTop={workspaceContentPaddingTop}
                      onBack={openGuild}
                    />
                    </CommunityAccessBoundary>
                  </>
                </AppChromeShell>
              )}
            </TaskWorkspaceShell>
      )}
    </MemoWorkspaceShell>
  );
};

export default function MainNavigator() {
  return (
    <AppProviders>
      <AccountEntryBoundary><ProfileSetupBoundary><TaskPlanningProvider><AppContent /></TaskPlanningProvider></ProfileSetupBoundary></AccountEntryBoundary>
    </AppProviders>
  );
}
