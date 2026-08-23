import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppSettings } from "../../context/AppSettingsContext";
import { useAppUI } from "../../context/AppUIContext";
import { useCollaboration } from "../../context/CollaborationContext";
import { useSubscription } from "../../context/SubscriptionContext";
import { hasStaffFreeAccess } from "../../services/subscription/staffAccess";
import { t } from "../../i18n";
import appChromeStyles from "../../styles/appChromeStyles";
import AppLanguageBridge from "../app-bridges/AppLanguageBridge";
import AppMenuBridge from "../app-bridges/AppMenuBridge";
import AppNoticeBridge from "../app-bridges/AppNoticeBridge";
import AppPickerBridge from "../app-bridges/AppPickerBridge";

export type AppChromeTab = "tasks" | "todo" | "memos" | "projects" | "guild";

type Props = {
  insetsTop: number;
  insetsBottom: number;
  activeTab: AppChromeTab;
  onTabPress: (tab: AppChromeTab) => void;
  onOpenTodo: () => void;
  onOpenSettings: () => void;
  onOpenAccountSettings: () => void;
  children: React.ReactNode;
};

const HELP_URL =
  "https://trusted-spandex-73d.notion.site/Temis-300429eff6fa80e1a78bdcd8e55ed56c?source=copy_link";

const TabButton = ({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="tab"
    accessibilityState={{ selected: active }}
    onPress={onPress}
    android_ripple={{ color: "#e5e7eb" }}
    style={({ pressed }) => [
      appChromeStyles.tabButton,
      active && appChromeStyles.tabButtonActive,
      pressed && appChromeStyles.tabButtonPressed,
    ]}
  >
    <View
      style={[
        appChromeStyles.tabIndicator,
        active && appChromeStyles.tabIndicatorActive,
      ]}
    />
    <Text
      style={[
        appChromeStyles.tabLabel,
        active && appChromeStyles.tabLabelActive,
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

const BottomTabBar = ({
  activeTab,
  onTabPress,
  bottomInset,
  showProjects,
  showGuild,
}: {
  activeTab: AppChromeTab;
  onTabPress: (tab: AppChromeTab) => void;
  bottomInset: number;
  showProjects: boolean;
  showGuild: boolean;
}) => {
  const { appLanguage } = useAppSettings();

  return (
    <View
      style={[
        appChromeStyles.tabBar,
        { height: 56 + bottomInset, paddingBottom: bottomInset },
      ]}
    >
      <TabButton
        label={t(appLanguage, "tab.tasks")}
        active={activeTab === "tasks"}
        onPress={() => onTabPress("tasks")}
      />
      <TabButton
        label={t(appLanguage, "tab.todos")}
        active={activeTab === "todo"}
        onPress={() => onTabPress("todo")}
      />
      <TabButton
        label={t(appLanguage, "tab.memos")}
        active={activeTab === "memos"}
        onPress={() => onTabPress("memos")}
      />
      {showProjects ? (
        <TabButton
          label="Projects"
          active={activeTab === "projects"}
          onPress={() => onTabPress("projects")}
        />
      ) : null}
      {showGuild ? (
        <TabButton
          label="ギルド"
          active={activeTab === "guild"}
          onPress={() => onTabPress("guild")}
        />
      ) : null}
    </View>
  );
};

const AppChromeShell = ({
  insetsTop,
  insetsBottom,
  activeTab,
  onTabPress,
  onOpenTodo,
  onOpenSettings,
  onOpenAccountSettings,
  children,
}: Props) => {
  const {
    cloudSyncEnabled,
    languagePickerOpen,
    selectInitialLanguage,
    storageReady,
    tr,
  } = useAppSettings();
  const {
    rootScreen,
    workspaceScope,
    activeProjectId,
    openPrivateWorkspace,
    openProjectWorkspace,
    openSettingsSync,
    openGuildAdmin,
    menuOpen,
    closeMenu,
    datePickerOpen,
    closeDatePicker,
    dateDraft,
    setDateDraft,
    dateError,
    calendarMonthLabel,
    calendarWeekdayLabels,
    calendarCells,
    shiftDateDraft,
    jumpToToday,
    shiftDatePickerMonth,
    selectDateFromCalendar,
    applyDateDraft,
    downloadCompleteNoticeOpen,
    dismissDownloadCompleteNotice,
  } = useAppUI();
  const { isCloudSyncEntitled, accessGrant } = useSubscription();
  const { projects, status: collaborationStatus } = useCollaboration();
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const isWorkspaceScreen = rootScreen !== "settings";
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const scopeLabel = workspaceScope === "private"
    ? "Private"
    : activeProject?.name ?? "Projects";

  const choosePrivateScope = () => {
    setScopePickerOpen(false);
    openPrivateWorkspace();
  };

  const chooseProjectScope = (projectId: string) => {
    setScopePickerOpen(false);
    openProjectWorkspace(projectId);
  };

  const showProjectSubscriptionNotice = () => {
    Alert.alert(
      "Temis Plus限定機能",
      "プロジェクト機能を利用するにはTemis Plusへの加入が必要です。",
      [
        { text: "あとで", style: "cancel" },
        {
          text: "Temis Plusを見る",
          onPress: () => {
            setScopePickerOpen(false);
            openSettingsSync();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={appChromeStyles.container} edges={["left", "right"]}>
      <View style={[appChromeStyles.statusBarFill, { height: insetsTop }]} />
      <View style={appChromeStyles.body}>{children}</View>
      {isWorkspaceScreen ? (
        <View style={[appChromeStyles.scopeTrigger, { top: insetsTop + 2 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ワークスペースを切り替える"
            style={appChromeStyles.scopeTriggerButton}
            onPress={() => setScopePickerOpen(true)}
          >
            <Text style={appChromeStyles.scopeTriggerText}>{scopeLabel}</Text>
            <Ionicons name="chevron-down" size={14} color="#4b5563" />
          </Pressable>
        </View>
      ) : null}
      <BottomTabBar
        activeTab={activeTab}
        onTabPress={onTabPress}
        bottomInset={insetsBottom}
        showProjects={workspaceScope === "projects" && isCloudSyncEntitled}
        showGuild={workspaceScope === "private"}
      />
      <Modal
        visible={scopePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setScopePickerOpen(false)}
      >
        <View style={appChromeStyles.scopePickerBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ワークスペース切替を閉じる"
            style={appChromeStyles.scopePickerDismiss}
            onPress={() => setScopePickerOpen(false)}
          />
          <ScrollView
            style={[appChromeStyles.scopePicker, { top: insetsTop + 42 }]}
            contentContainerStyle={appChromeStyles.scopePickerContent}
            bounces={false}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Private に切り替える"
              style={appChromeStyles.scopePickerItem}
              onPress={choosePrivateScope}
            >
              <View>
                <Text style={appChromeStyles.scopePickerTitle}>Private</Text>
                <Text style={appChromeStyles.scopePickerCaption}>個人のメモ・タスク</Text>
              </View>
              {workspaceScope === "private" ? (
                <Ionicons name="checkmark" size={22} color="#111827" />
              ) : null}
            </Pressable>

            <Text style={appChromeStyles.scopePickerSectionTitle}>Projects</Text>
            {!isCloudSyncEntitled ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Temis Plusでプロジェクト機能を利用する"
                style={appChromeStyles.scopePickerItem}
                onPress={showProjectSubscriptionNotice}
              >
                <View style={appChromeStyles.scopePickerProjectText}>
                  <Text style={appChromeStyles.scopePickerTitle}>Projects</Text>
                  <Text style={appChromeStyles.scopePickerCaption}>
                    Temis Plusに加入すると利用できます
                  </Text>
                </View>
                <Ionicons name="lock-closed-outline" size={20} color="#6b7280" />
              </Pressable>
            ) : (
              <>
                {collaborationStatus === "loading" ? (
                  <Text style={appChromeStyles.scopePickerEmpty}>プロジェクトを読み込み中です…</Text>
                ) : null}
                {collaborationStatus !== "loading" && projects.length === 0 ? (
                  <Text style={appChromeStyles.scopePickerEmpty}>参加中のプロジェクトはありません。</Text>
                ) : null}
                {projects.map((project) => {
                  const selected = workspaceScope === "projects" && activeProjectId === project.id;
                  return (
                    <Pressable
                      key={project.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${project.name} を開く`}
                      style={appChromeStyles.scopePickerItem}
                      onPress={() => chooseProjectScope(project.id)}
                    >
                      <View style={appChromeStyles.scopePickerProjectText}>
                        <Text numberOfLines={1} style={appChromeStyles.scopePickerTitle}>
                          {project.icon ? `${project.icon} ` : ""}{project.name}
                        </Text>
                        <Text numberOfLines={1} style={appChromeStyles.scopePickerCaption}>
                          {project.description || "プロジェクトの共有データ"}
                        </Text>
                      </View>
                      {selected ? (
                        <Ionicons name="checkmark" size={22} color="#111827" />
                      ) : null}
                    </Pressable>
                  );
                })}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
      <AppPickerBridge
        visible={datePickerOpen}
        onRequestClose={closeDatePicker}
        tr={tr}
        dateDraft={dateDraft}
        onChangeDateDraft={setDateDraft}
        dateError={dateError}
        calendarMonthLabel={calendarMonthLabel}
        calendarWeekdayLabels={calendarWeekdayLabels}
        calendarCells={calendarCells}
        onPrevDate={() => shiftDateDraft(-1)}
        onToday={jumpToToday}
        onNextDate={() => shiftDateDraft(1)}
        onPrevMonth={() => shiftDatePickerMonth(-1)}
        onNextMonth={() => shiftDatePickerMonth(1)}
        onSelectDate={selectDateFromCalendar}
        onConfirm={applyDateDraft}
      />
      <AppLanguageBridge
        visible={languagePickerOpen}
        onSelectLanguage={selectInitialLanguage}
      />
      <AppNoticeBridge
        visible={downloadCompleteNoticeOpen}
        onDismiss={dismissDownloadCompleteNotice}
        tr={tr}
        helpUrl={HELP_URL}
      />
      <AppMenuBridge
        visible={menuOpen}
        onCloseMenu={closeMenu}
        onOpenTodo={onOpenTodo}
        onOpenSettings={onOpenSettings}
        onOpenAccountSettings={onOpenAccountSettings}
        onOpenGuildAdmin={openGuildAdmin}
        showGuildAdmin={hasStaffFreeAccess(accessGrant)}
        showSyncUpgradePrompt={storageReady && !cloudSyncEnabled}
        tr={tr}
        helpUrl={HELP_URL}
      />
    </SafeAreaView>
  );
};

export default AppChromeShell;
