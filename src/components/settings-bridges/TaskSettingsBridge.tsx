import React, { useCallback, useMemo } from "react";

import { useAppRefresh } from "../../context/AppRefreshContext";
import { useAppUI } from "../../context/AppUIContext";
import { useTaskWorkspace } from "../../context/TaskWorkspaceContext";
import type { Tag } from "../../types";
import type { DeletedItemsSectionProps } from "../settings/DeletedItemsSection";
import type { TagSettingsSectionProps } from "../settings/TagSettingsSection";
import type { TimeBoxSettingsSectionProps } from "../settings/TimeBoxSettingsSection";
import SettingsScreen, {
  type SettingsScreenProps,
} from "../../screens/SettingsScreen";

type TimeBoxBridgeProps = Omit<
  TimeBoxSettingsSectionProps,
  "slotTaskPreviews" | "onOpenTask"
>;
type TagBridgeProps = Omit<
  TagSettingsSectionProps,
  "onRenameTag" | "onArchiveTag"
>;
type DeletedItemsBridgeProps = DeletedItemsSectionProps;

type Props = Omit<
  SettingsScreenProps,
  "timeBoxSectionProps" | "tagSectionProps" | "deletedItemsSectionProps" | "onRefresh" | "onBack"
> & {
  onBackToSettings?: () => void;
  timeBoxSectionBaseProps: TimeBoxBridgeProps;
  tagSectionBaseProps: TagBridgeProps;
  deletedItemsSectionBaseProps: DeletedItemsBridgeProps;
  onRenameTagBase: (current: Tag, nextName: string) => boolean;
  onArchiveTagBase: (tag: Tag) => void;
};

const TaskSettingsBridge = ({
  onBackToSettings,
  timeBoxSectionBaseProps,
  tagSectionBaseProps,
  deletedItemsSectionBaseProps,
  onRenameTagBase,
  onArchiveTagBase,
  ...settingsProps
}: Props) => {
  const { refreshApp } = useAppRefresh();
  const { openTaskToday } = useAppUI();
  const { timeBoxTaskPreviews, focusTask, renameTag, archiveTag } =
    useTaskWorkspace();

  const timeBoxSectionProps = useMemo<TimeBoxSettingsSectionProps>(
    () => ({
      ...timeBoxSectionBaseProps,
      slotTaskPreviews: timeBoxTaskPreviews,
      onOpenTask: (taskId: string) => {
        openTaskToday();
        focusTask(taskId);
      },
    }),
    [focusTask, openTaskToday, timeBoxSectionBaseProps, timeBoxTaskPreviews],
  );

  const tagSectionProps = useMemo<TagSettingsSectionProps>(
    () => ({
      ...tagSectionBaseProps,
      onRenameTag: (current: Tag, nextName: string) => {
        const ok = onRenameTagBase(current, nextName);
        if (ok) {
          renameTag(current, nextName.trim());
        }
        return ok;
      },
      onArchiveTag: (tag: Tag) => {
        onArchiveTagBase(tag);
        archiveTag(tag);
      },
    }),
    [archiveTag, onArchiveTagBase, onRenameTagBase, renameTag, tagSectionBaseProps],
  );

  const handleBack = useCallback(() => {
    if (settingsProps.showMenuButtons) {
      openTaskToday();
      return;
    }
    onBackToSettings?.();
  }, [onBackToSettings, openTaskToday, settingsProps.showMenuButtons]);

  return (
    <SettingsScreen
      {...settingsProps}
      onBack={handleBack}
      onRefresh={() => {
        void refreshApp();
      }}
      timeBoxSectionProps={timeBoxSectionProps}
      tagSectionProps={tagSectionProps}
      deletedItemsSectionProps={deletedItemsSectionBaseProps}
    />
  );
};

export default TaskSettingsBridge;
