import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import type { Suggestion } from "../features/routineSuggestions";
import TaskList, { type TaskListProps } from "../components/tasks/TaskList";
import TaskMoveModal, {
  type TaskMoveModalProps,
} from "../components/tasks/TaskMoveModal";
import type { SlotKey, TaskState } from "../types";

type TaskListBaseProps = Omit<
  TaskListProps,
  | "openSwipeTaskId"
  | "onOpenSwipe"
  | "onCloseSwipe"
  | "onTaskPress"
  | "onMove"
  | "onArchive"
  | "onDelete"
>;

type Props = {
  styles: Record<string, any>;
  insetsTop: number;
  title: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  contentPaddingTop: number;
  footerPaddingBottom: number;
  refreshing: boolean;
  onRefresh: () => void;
  trf: (key: string, vars: Record<string, string | number>) => string;
  routineSuggestions: Suggestion[];
  currentSlotLabel: string;
  onAddSuggestion: (suggestion: Suggestion) => void;
  onDismissSuggestion: (suggestion: Suggestion) => void;
  onOpenTaskDetail: (slotKey: SlotKey, task: TaskState) => void;
  onDeleteTask: (taskId: string) => void;
  onDeleteSelectedTasks: () => void;
  onArchiveTask: (slotKey: SlotKey, taskId: string) => void;
  onOpenMoveModal: (slotKey: SlotKey, taskId: string) => void;
  taskListBaseProps: TaskListBaseProps;
  moveModalProps: TaskMoveModalProps;
};

const TaskScreen = ({
  styles,
  insetsTop,
  title,
  headerLeft,
  headerRight,
  contentPaddingTop,
  footerPaddingBottom,
  refreshing,
  onRefresh,
  trf,
  routineSuggestions,
  currentSlotLabel,
  onAddSuggestion,
  onDismissSuggestion,
  onOpenTaskDetail,
  onDeleteTask,
  onDeleteSelectedTasks,
  onArchiveTask,
  onOpenMoveModal,
  taskListBaseProps,
  moveModalProps,
}: Props) => {
  const [openSwipeTaskId, setOpenSwipeTaskId] = useState<string | null>(null);
  const selectionMode = taskListBaseProps.selectionMode;
  const selectedCount = taskListBaseProps.selectedSet.size;
  const canDeleteSelected = selectedCount > 0;

  useEffect(() => {
    if (selectionMode || moveModalProps.visible) {
      setOpenSwipeTaskId(null);
    }
  }, [moveModalProps.visible, selectionMode]);

  const confirmDeleteTask = (taskId: string) => {
    Alert.alert(
      taskListBaseProps.tr("task.deleteConfirmTitle"),
      taskListBaseProps.tr("task.deleteConfirmBody"),
      [
        { text: taskListBaseProps.tr("common.cancel"), style: "cancel" },
        {
          text: taskListBaseProps.tr("common.delete"),
          style: "destructive",
          onPress: () => onDeleteTask(taskId),
        },
      ],
    );
  };

  const confirmDeleteSelected = () => {
    if (!canDeleteSelected) {
      return;
    }
    Alert.alert(
      taskListBaseProps.tr("task.deleteConfirmTitle"),
      trf("task.deleteSelectedBody", { count: selectedCount }),
      [
        { text: taskListBaseProps.tr("common.cancel"), style: "cancel" },
        {
          text: taskListBaseProps.tr("common.delete"),
          style: "destructive",
          onPress: () => onDeleteSelectedTasks(),
        },
      ],
    );
  };

  const confirmArchiveTask = (slotKey: SlotKey, taskId: string) => {
    Alert.alert(
      taskListBaseProps.tr("task.deleteConfirmTitle"),
      taskListBaseProps.tr("task.archiveConfirmBody"),
      [
        { text: taskListBaseProps.tr("common.cancel"), style: "cancel" },
        {
          text: taskListBaseProps.tr("task.move"),
          style: "destructive",
          onPress: () => onArchiveTask(slotKey, taskId),
        },
      ],
    );
  };

  const taskListProps = useMemo<TaskListProps>(
    () => ({
      ...taskListBaseProps,
      openSwipeTaskId,
      onOpenSwipe: (taskId: string) => setOpenSwipeTaskId(taskId),
      onCloseSwipe: (taskId: string) =>
        setOpenSwipeTaskId((prev) => (prev === taskId ? null : prev)),
      onTaskPress: (slotKey: SlotKey, task: TaskState) => {
        if (selectionMode) {
          taskListBaseProps.onToggleSelection(task.id);
          return;
        }
        if (openSwipeTaskId === task.id) {
          setOpenSwipeTaskId(null);
          return;
        }
        onOpenTaskDetail(slotKey, task);
      },
      onMove: (slotKey: SlotKey, taskId: string) => {
        setOpenSwipeTaskId(null);
        onOpenMoveModal(slotKey, taskId);
      },
      onArchive: (slotKey: SlotKey, taskId: string) => {
        setOpenSwipeTaskId(null);
        confirmArchiveTask(slotKey, taskId);
      },
      onDelete: (taskId: string) => {
        setOpenSwipeTaskId(null);
        confirmDeleteTask(taskId);
      },
    }),
    [
      onArchiveTask,
      onDeleteTask,
      onOpenMoveModal,
      onOpenTaskDetail,
      openSwipeTaskId,
      selectionMode,
      taskListBaseProps,
    ],
  );

  return (
    <>
      <View style={[styles.todayStickyHeader, { top: insetsTop }]}>
        <View style={[styles.header, styles.todayStickyHeaderRow]}>
          <View style={styles.headerLeft}>{headerLeft ?? null}</View>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerRight}>{headerRight ?? null}</View>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: contentPaddingTop,
            paddingBottom: footerPaddingBottom,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {selectionMode ? (
          <View style={styles.selectionBar}>
            <Text style={styles.selectionText}>
              {`${taskListProps.tr("task.selectedCount")}: ${selectedCount}`}
            </Text>
            <Pressable
              style={[
                styles.bulkDeleteButton,
                !canDeleteSelected && styles.bulkDeleteButtonDisabled,
              ]}
              onPress={confirmDeleteSelected}
              disabled={!canDeleteSelected}
            >
              <Text style={styles.bulkDeleteButtonText}>
                {taskListBaseProps.tr("task.bulkDelete")}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {routineSuggestions.length > 0 ? (
          <View style={styles.routineSuggestionCard}>
            <View style={styles.routineSuggestionHeader}>
              <Text style={styles.routineSuggestionTitle}>
                {taskListBaseProps.tr("task.suggestionTitle")}
              </Text>
              <Text style={styles.routineSuggestionMeta}>
                {`${taskListBaseProps.tr("task.targetSlot")}: ${currentSlotLabel}`}
              </Text>
            </View>
            {routineSuggestions.map((suggestion) => (
              <View
                key={suggestion.normalizedName}
                style={styles.routineSuggestionRow}
              >
                <View style={styles.routineSuggestionInfo}>
                  <Text style={styles.routineSuggestionName}>
                    {suggestion.taskName}
                  </Text>
                  <Text style={styles.routineSuggestionReason}>
                    {suggestion.reason}
                  </Text>
                </View>
                <View style={styles.routineSuggestionActions}>
                  <Pressable
                    style={styles.routineSuggestionAdd}
                    onPress={() => onAddSuggestion(suggestion)}
                  >
                    <Text style={styles.routineSuggestionAddText}>
                      {taskListBaseProps.tr("task.addSuggestion")}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.routineSuggestionDismiss}
                    onPress={() => onDismissSuggestion(suggestion)}
                  >
                    <Text style={styles.routineSuggestionDismissText}>
                      {taskListBaseProps.tr("task.hideToday")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        <TaskList {...taskListProps} />
      </ScrollView>
      <TaskMoveModal {...moveModalProps} />
    </>
  );
};

export default TaskScreen;
