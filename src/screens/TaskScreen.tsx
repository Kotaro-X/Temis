import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import type { Suggestion } from "../features/routineSuggestions";
import TaskList, { type TaskListProps } from "../components/tasks/TaskList";
import type { TaskDragPreview } from "../components/tasks/TaskItem";
import TaskMoveModal, {
  type TaskMoveModalProps,
} from "../components/tasks/TaskMoveModal";
import type { SlotKey, TaskState, TimeBoxSchedule } from "../types";
import type { MyProjectTask } from "../services/collaboration/collaborationService";

const AUTO_SCROLL_INTERVAL_MS = 16;
const AUTO_SCROLL_STEP = 6;
const TOP_AUTO_SCROLL_RATIO = 0.2;
const BOTTOM_AUTO_SCROLL_RATIO = 0.1;

type TaskListBaseProps = Omit<
  TaskListProps,
  | "openSwipeTaskId"
  | "onOpenSwipe"
  | "onCloseSwipe"
  | "onTaskPress"
  | "onMove"
  | "onArchive"
  | "onDelete"
  | "onRegisterDropZone"
  | "onDropTask"
  | "onTaskDragStart"
  | "onTaskDragMove"
  | "onTaskDragEnd"
  | "onTaskDragStateChange"
  | "timeBoxSchedule"
  | "projectTasksBySlot"
  | "onProjectTaskChanged"
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
  onOpenMoveSelectedModal: (taskIds: string[]) => void;
  onMoveTaskToSlot: (
    fromSlotKey: SlotKey,
    taskId: string,
    targetSlotKey: SlotKey,
  ) => void;
  taskListBaseProps: TaskListBaseProps;
  moveModalProps: TaskMoveModalProps;
  projectTasksBySlot?: Record<SlotKey, MyProjectTask[]>;
  onProjectTaskChanged?: () => void;
  timeBoxSchedule: TimeBoxSchedule;
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
  onOpenMoveSelectedModal,
  onMoveTaskToSlot,
  taskListBaseProps,
  moveModalProps,
  projectTasksBySlot,
  onProjectTaskChanged,
  timeBoxSchedule,
}: Props) => {
  const [openSwipeTaskId, setOpenSwipeTaskId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<TaskDragPreview | null>(null);
  const [isTaskDragging, setIsTaskDragging] = useState(false);
  const dragSurfaceRef = React.useRef<View>(null);
  const dragSurfaceOriginRef = React.useRef({ x: 0, y: 0 });
  const dragTouchOffsetRef = React.useRef({ x: 0, y: 0 });
  const dragPointerRef = React.useRef({ x: 0, y: 0 });
  const dragPosition = React.useRef(new Animated.ValueXY()).current;
  const scrollViewRef = React.useRef<ScrollView>(null);
  const scrollViewportMeasureRef = React.useRef<View>(null);
  const scrollViewportRef = React.useRef({ top: 0, height: 0 });
  const scrollOffsetRef = React.useRef(0);
  const scrollContentHeightRef = React.useRef(0);
  const autoScrollDirectionRef = React.useRef<-1 | 0 | 1>(0);
  const autoScrollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const dropZoneRefs = React.useRef<Partial<Record<SlotKey, View | null>>>({});
  const selectionMode = taskListBaseProps.selectionMode;
  const selectedCount = taskListBaseProps.selectedSet.size;
  const canDeleteSelected = selectedCount > 0;

  useEffect(() => {
    if (selectionMode || moveModalProps.visible) {
      setOpenSwipeTaskId(null);
    }
  }, [moveModalProps.visible, selectionMode]);

  useEffect(
    () => () => {
      if (autoScrollTimerRef.current) {
        clearInterval(autoScrollTimerRef.current);
      }
    },
    [],
  );

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

  const registerDropZone = (slotKey: SlotKey, node: View | null) => {
    dropZoneRefs.current[slotKey] = node;
  };

  const updateDragPosition = (pageX: number, pageY: number) => {
    const origin = dragSurfaceOriginRef.current;
    const offset = dragTouchOffsetRef.current;
    dragPosition.setValue({
      x: pageX - origin.x - offset.x,
      y: pageY - origin.y - offset.y,
    });
  };

  const measureScrollViewport = () => {
    scrollViewportMeasureRef.current?.measureInWindow((_x, top, _width, height) => {
      scrollViewportRef.current = { top, height };
    });
  };

  const stopAutoScroll = () => {
    autoScrollDirectionRef.current = 0;
    if (autoScrollTimerRef.current) {
      clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
  };

  const startAutoScroll = (direction: -1 | 1) => {
    if (autoScrollDirectionRef.current === direction) {
      return;
    }
    stopAutoScroll();
    autoScrollDirectionRef.current = direction;
    autoScrollTimerRef.current = setInterval(() => {
      const viewportHeight = scrollViewportRef.current.height;
      const maxOffset = Math.max(0, scrollContentHeightRef.current - viewportHeight);
      const nextOffset = Math.max(
        0,
        Math.min(maxOffset, scrollOffsetRef.current + direction * AUTO_SCROLL_STEP),
      );
      if (nextOffset === scrollOffsetRef.current) {
        stopAutoScroll();
        return;
      }
      scrollOffsetRef.current = nextOffset;
      scrollViewRef.current?.scrollTo({ y: nextOffset, animated: false });
    }, AUTO_SCROLL_INTERVAL_MS);
  };

  const updateAutoScroll = (pageY: number) => {
    const { top, height } = scrollViewportRef.current;
    if (!height) {
      return;
    }
    if (pageY <= top + height * TOP_AUTO_SCROLL_RATIO) {
      startAutoScroll(-1);
      return;
    }
    if (pageY >= top + height * (1 - BOTTOM_AUTO_SCROLL_RATIO)) {
      startAutoScroll(1);
      return;
    }
    stopAutoScroll();
  };

  const handleTaskDragStart = (preview: TaskDragPreview) => {
    dragTouchOffsetRef.current = {
      x: preview.touchOffsetX,
      y: preview.touchOffsetY,
    };
    dragPointerRef.current = { x: preview.pageX, y: preview.pageY };
    measureScrollViewport();
    dragSurfaceRef.current?.measureInWindow((x, y) => {
      dragSurfaceOriginRef.current = { x, y };
      updateDragPosition(dragPointerRef.current.x, dragPointerRef.current.y);
      setDragPreview(preview);
    });
    updateAutoScroll(preview.pageY);
  };

  const handleTaskDragMove = (pageX: number, pageY: number) => {
    dragPointerRef.current = { x: pageX, y: pageY };
    updateDragPosition(pageX, pageY);
    updateAutoScroll(pageY);
  };

  const handleTaskDragEnd = () => {
    stopAutoScroll();
    dragPosition.stopAnimation();
    setDragPreview(null);
    setIsTaskDragging(false);
  };

  const handleDropTask = (
    fromSlotKey: SlotKey,
    taskId: string,
    pageY: number,
  ) => {
    const measurements = Object.entries(dropZoneRefs.current).flatMap(
      ([slotKey, node]) => {
        if (!node) {
          return [];
        }
        return [
          new Promise<{ slotKey: SlotKey; top: number; bottom: number }>((resolve) => {
            node.measureInWindow((_x, top, _width, height) =>
              resolve({ slotKey: slotKey as SlotKey, top, bottom: top + height }),
            );
          }),
        ];
      },
    );

    void Promise.all(measurements).then((zones) => {
      const targetSlotKey = zones.find(
        (zone) => pageY >= zone.top && pageY <= zone.bottom,
      )?.slotKey;
      if (targetSlotKey && targetSlotKey !== fromSlotKey) {
        onMoveTaskToSlot(fromSlotKey, taskId, targetSlotKey);
      }
    });
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
      onRegisterDropZone: registerDropZone,
      onDropTask: handleDropTask,
      onTaskDragStart: handleTaskDragStart,
      onTaskDragMove: handleTaskDragMove,
      onTaskDragEnd: handleTaskDragEnd,
      onTaskDragStateChange: setIsTaskDragging,
      projectTasksBySlot,
      onProjectTaskChanged,
      timeBoxSchedule,
    }),
    [
      onArchiveTask,
      onDeleteTask,
      onOpenMoveModal,
      onOpenTaskDetail,
      openSwipeTaskId,
      selectionMode,
      taskListBaseProps,
      handleDropTask,
      handleTaskDragEnd,
      handleTaskDragMove,
      handleTaskDragStart,
      registerDropZone,
      projectTasksBySlot,
      onProjectTaskChanged,
      timeBoxSchedule,
    ],
  );

  return (
    <View ref={dragSurfaceRef} style={styles.taskScreenRoot}>
      <View style={[styles.todayStickyHeader, { top: insetsTop }]}>
        <View style={[styles.header, styles.todayStickyHeaderRow]}>
          <View style={styles.headerLeft}>{headerLeft ?? null}</View>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerRight}>{headerRight ?? null}</View>
        </View>
      </View>
      <View ref={scrollViewportMeasureRef} style={styles.taskScrollViewport}>
        <ScrollView
          ref={scrollViewRef}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: contentPaddingTop,
            paddingBottom: footerPaddingBottom,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!isTaskDragging}
        scrollEventThrottle={16}
        onLayout={measureScrollViewport}
        onContentSizeChange={(_width, height) => {
          scrollContentHeightRef.current = height;
        }}
        onScroll={(event) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
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
                styles.bulkMoveButton,
                !canDeleteSelected && styles.bulkDeleteButtonDisabled,
              ]}
              onPress={() =>
                onOpenMoveSelectedModal(Array.from(taskListBaseProps.selectedSet))
              }
              disabled={!canDeleteSelected}
            >
              <Text style={styles.bulkMoveButtonText}>
                {taskListBaseProps.tr("task.bulkMove")}
              </Text>
            </Pressable>
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
      </View>
      <TaskMoveModal {...moveModalProps} />
      {dragPreview ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.taskDragPreview,
            {
              width: dragPreview.width,
              transform: [...dragPosition.getTranslateTransform(), { scale: 1.03 }],
            },
          ]}
        >
          <View style={styles.taskDragPreviewCard}>
            <View
              style={[
                styles.taskDragPreviewStatusBar,
                { backgroundColor: dragPreview.palette.bar },
              ]}
            />
            <View style={styles.taskDragPreviewContent}>
              <Text
                numberOfLines={1}
                style={[
                  styles.taskDragPreviewTitle,
                  dragPreview.completed && styles.taskDragPreviewTitleDone,
                ]}
              >
                {dragPreview.taskName}
              </Text>
              <Text numberOfLines={1} style={styles.taskDragPreviewMeta}>
                {dragPreview.completed
                  ? dragPreview.completedTime ?? ""
                  : dragPreview.tags.length > 0
                    ? dragPreview.tags.join(", ")
                    : taskListBaseProps.noTagLabel}
              </Text>
            </View>
            <View
              style={[
                styles.taskDragPreviewBadge,
                { backgroundColor: dragPreview.palette.badgeBg },
              ]}
            >
              <Text
                style={[
                  styles.taskDragPreviewBadgeText,
                  { color: dragPreview.palette.badgeText },
                ]}
              >
                {dragPreview.statusLabel}
              </Text>
            </View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
};

export default TaskScreen;
