import React from "react";

import { useAppRefresh } from "../../context/AppRefreshContext";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useAppUI } from "../../context/AppUIContext";
import { TaskWorkspaceProvider } from "../../context/TaskWorkspaceContext";
import TaskWorkspaceScreen from "../../screens/TaskWorkspaceScreen";
import type { TaskStatus } from "../../types";

type TaskWorkspaceViewConfig = {
  insetsTop: number;
  insetsBottom: number;
  onSearchToken: (keyword: string) => void;
};

type Props = {
  active: boolean;
  viewConfig: TaskWorkspaceViewConfig;
  children: (taskWorkspace: React.ReactNode) => React.ReactNode;
};

const TaskWorkspaceShell = ({
  active,
  viewConfig,
  children,
}: Props) => {
  const { isRefreshing, refreshApp } = useAppRefresh();
  const {
    appLanguage,
    noTagLabel,
    storageReady,
    statusLabel,
    tagLibrary,
    tagOptions,
    timeBoxSchedule,
    tr,
    trf,
    untitledLabel,
  } = useAppSettings();
  const {
    selectedDate,
    openMenu,
    openDatePicker,
    taskScreen,
    setTaskScreen,
  } = useAppUI();
  const statusPalette: Record<
    TaskStatus,
    { bar: string; badgeBg: string; badgeText: string }
  > = {
    TODO: {
      bar: "#9ca3af",
      badgeBg: "#f3f4f6",
      badgeText: "#374151",
    },
    IN_PROGRESS: {
      bar: "#2563eb",
      badgeBg: "#dbeafe",
      badgeText: "#1e40af",
    },
    PAUSED: {
      bar: "#f59e0b",
      badgeBg: "#fef3c7",
      badgeText: "#92400e",
    },
    DONE: {
      bar: "#16a34a",
      badgeBg: "#dcfce7",
      badgeText: "#166534",
    },
  };
  const todayStickyHeaderHeight = 40;
  const defaultContentPaddingTop = viewConfig.insetsTop + 16;
  const todayContentPaddingTop = viewConfig.insetsTop + todayStickyHeaderHeight + 12;
  const footerPaddingBottom = 56 + viewConfig.insetsBottom + 16;

  const taskWorkspace = (
    <TaskWorkspaceScreen
      visible={active}
      insetsTop={viewConfig.insetsTop}
      currentScreen={active ? taskScreen : null}
      onChangeScreen={setTaskScreen}
      selectedDate={selectedDate}
      refreshing={isRefreshing}
      onRefresh={() => {
        void refreshApp();
      }}
      onOpenMenu={openMenu}
      onOpenDatePicker={openDatePicker}
      tr={tr}
      trf={trf}
      language={appLanguage}
      noTagLabel={noTagLabel}
      untitledLabel={untitledLabel}
      statusLabel={statusLabel}
      statusPalette={statusPalette}
      tagOptions={tagOptions}
      timeBoxSchedule={timeBoxSchedule}
      onSearchToken={viewConfig.onSearchToken}
      defaultContentPaddingTop={defaultContentPaddingTop}
      todayContentPaddingTop={todayContentPaddingTop}
      footerPaddingBottom={footerPaddingBottom}
    />
  );

  return (
    <TaskWorkspaceProvider
      selectedDate={selectedDate}
      storageReady={storageReady}
      tagLibrary={tagLibrary}
      timeBoxSchedule={timeBoxSchedule}
      currentScreen={active ? taskScreen : null}
      language={appLanguage}
      noTagLabel={noTagLabel}
      untitledLabel={untitledLabel}
      tr={tr}
    >
      {children(taskWorkspace)}
    </TaskWorkspaceProvider>
  );
};

export default TaskWorkspaceShell;
