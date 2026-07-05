import React, { useMemo } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";

import Header from "../components/common/Header";
import TaskArchiveList, {
  type TaskArchiveListProps,
} from "../components/tasks/TaskArchiveList";
import TaskRestoreModal, {
  type TaskRestoreModalProps,
} from "../components/tasks/TaskRestoreModal";
import type { ArchivedTaskItem } from "../hooks/useTasks";

type TaskArchiveListBaseProps = Omit<TaskArchiveListProps, "onRestore">;
type RestoreResult = "idle" | "invalid_date" | "failed" | "restored";
type RestoreOpenResult = "opened" | "not_allowed";

type Props = {
  styles: Record<string, any>;
  contentPaddingTop: number;
  refreshing: boolean;
  onRefresh: () => void;
  title: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  archiveListBaseProps: TaskArchiveListBaseProps;
  restoreModalProps: Omit<TaskRestoreModalProps, "onConfirm">;
  onOpenRestoreModal: (item: ArchivedTaskItem) => RestoreOpenResult;
  onApplyRestoreTask: () => Promise<RestoreResult>;
};

const TaskArchiveScreen = ({
  styles,
  contentPaddingTop,
  refreshing,
  onRefresh,
  title,
  headerLeft,
  headerRight,
  archiveListBaseProps,
  restoreModalProps,
  onOpenRestoreModal,
  onApplyRestoreTask,
}: Props) => {
  const archiveListProps = useMemo<TaskArchiveListProps>(
    () => ({
      ...archiveListBaseProps,
      onRestore: (item) => {
        if (onOpenRestoreModal(item) === "not_allowed") {
          Alert.alert(
            archiveListBaseProps.tr("task.restoreNotAllowedTitle"),
            archiveListBaseProps.tr("task.restoreNotAllowedBody"),
          );
        }
      },
    }),
    [archiveListBaseProps, onOpenRestoreModal],
  );

  const resolvedRestoreModalProps = useMemo<TaskRestoreModalProps>(
    () => ({
      ...restoreModalProps,
      onConfirm: () => {
        void onApplyRestoreTask().then((result) => {
          if (result === "failed") {
            Alert.alert(
              archiveListBaseProps.tr("task.restoreFailedTitle"),
              archiveListBaseProps.tr("task.restoreFailedBody"),
            );
          }
        });
      },
    }),
    [archiveListBaseProps, onApplyRestoreTask, restoreModalProps],
  );

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: contentPaddingTop },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Header
          styles={styles}
          title={title}
          left={headerLeft}
          right={headerRight}
        />
        <View style={styles.archiveBox}>
          <TaskArchiveList {...archiveListProps} />
        </View>
      </ScrollView>
      <TaskRestoreModal {...resolvedRestoreModalProps} />
    </>
  );
};

export default TaskArchiveScreen;
