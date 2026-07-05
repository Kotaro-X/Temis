import React from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppSettings } from "../../context/AppSettingsContext";
import { useAppUI } from "../../context/AppUIContext";
import { t } from "../../i18n";
import appChromeStyles from "../../styles/appChromeStyles";
import AppLanguageBridge from "../app-bridges/AppLanguageBridge";
import AppMenuBridge from "../app-bridges/AppMenuBridge";
import AppNoticeBridge from "../app-bridges/AppNoticeBridge";
import AppPickerBridge from "../app-bridges/AppPickerBridge";

export type AppChromeTab = "tasks" | "todo" | "memos";

type Props = {
  insetsTop: number;
  insetsBottom: number;
  activeTab: AppChromeTab;
  onTabPress: (tab: AppChromeTab) => void;
  onOpenTodo: () => void;
  onOpenSettings: () => void;
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
}: {
  activeTab: AppChromeTab;
  onTabPress: (tab: AppChromeTab) => void;
  bottomInset: number;
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
  children,
}: Props) => {
  const { languagePickerOpen, selectInitialLanguage, tr } = useAppSettings();
  const {
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

  return (
    <SafeAreaView style={appChromeStyles.container} edges={["left", "right"]}>
      <View style={[appChromeStyles.statusBarFill, { height: insetsTop }]} />
      <View style={appChromeStyles.body}>{children}</View>
      <BottomTabBar
        activeTab={activeTab}
        onTabPress={onTabPress}
        bottomInset={insetsBottom}
      />
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
        tr={tr}
        helpUrl={HELP_URL}
      />
    </SafeAreaView>
  );
};

export default AppChromeShell;
