import React, { useCallback, useEffect, useState } from "react";
import { Keyboard, ScrollView, Text } from "react-native";

import Header from "../components/common/Header";
import TaskDetailView from "../components/tasks/TaskDetailView";
import TaskMemoPanel from "../components/tasks/TaskMemoPanel";
import TaskTagPickerModal from "../components/tasks/TaskTagPickerModal";
import type { TaskDetailInfo } from "../hooks/useTasks";
import type { AppLanguage } from "../i18n";
import type { Tag, TaskStatus } from "../types";

type Props = {
  styles: Record<string, any>;
  contentPaddingTop: number;
  title: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  detailTaskInfo: TaskDetailInfo | null;
  tr: (key: string) => string;
  untitledLabel: string;
  statusLabel: Record<TaskStatus, string>;
  statusPalette: Record<
    TaskStatus,
    { bar: string; badgeBg: string; badgeText: string }
  >;
  tagOptions: Tag[];
  onUpdateTaskName: (text: string) => void;
  onUpdateTaskEstimate: (text: string) => void;
  onToggleTaskTag: (tag: Tag) => void;
  onStart: () => void;
  onPause: () => void;
  onDone: () => void;
  onSearchToken?: (token: string) => void;
  language: AppLanguage;
};

const TaskDetailScreen = ({
  styles,
  contentPaddingTop,
  title,
  headerLeft,
  headerRight,
  detailTaskInfo,
  tr,
  untitledLabel,
  statusLabel,
  statusPalette,
  tagOptions,
  onUpdateTaskName,
  onUpdateTaskEstimate,
  onToggleTaskTag,
  onStart,
  onPause,
  onDone,
  onSearchToken,
  language,
}: Props) => {
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);

  useEffect(() => {
    setTagDropdownOpen(false);
  }, [detailTaskInfo?.task.id]);

  const openTagPicker = useCallback(() => {
    // Do not expand a list in the same ScrollView while its TextInput owns the
    // iOS keyboard. That combination can repeatedly relayout the detail view.
    Keyboard.dismiss();
    setTagDropdownOpen(true);
  }, []);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: contentPaddingTop },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Header
        styles={styles}
        title={title}
        left={headerLeft}
        right={headerRight}
      />
      {!detailTaskInfo ? (
        <Text style={styles.mutedText}>{tr("task.notFound")}</Text>
      ) : (
        <TaskDetailView
          styles={styles}
          tr={tr}
          task={detailTaskInfo.task}
          slotKey={detailTaskInfo.slotKey}
          untitledLabel={untitledLabel}
          statusLabel={statusLabel}
          statusPalette={statusPalette}
          onOpenTagPicker={openTagPicker}
          onUpdateTaskName={onUpdateTaskName}
          onUpdateTaskEstimate={onUpdateTaskEstimate}
          onStart={onStart}
          onPause={onPause}
          onDone={onDone}
        >
          <TaskMemoPanel
            taskId={detailTaskInfo.task.id}
            onSearchToken={onSearchToken}
            language={language}
          />
        </TaskDetailView>
      )}
      {detailTaskInfo ? (
        <TaskTagPickerModal
          styles={styles}
          visible={tagDropdownOpen}
          title={tr("task.tags")}
          closeLabel={tr("common.cancel")}
          tagOptions={tagOptions}
          selectedTags={detailTaskInfo.task.tags}
          onToggleTag={onToggleTaskTag}
          onClose={() => setTagDropdownOpen(false)}
        />
      ) : null}
    </ScrollView>
  );
};

export default TaskDetailScreen;
