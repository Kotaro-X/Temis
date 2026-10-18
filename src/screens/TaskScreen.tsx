import TaskPlanner from '../components/tasks/TaskPlanner';
import React, { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import type { Suggestion } from "../features/routineSuggestions";
import { type TaskListProps } from "../components/tasks/TaskList";
import TaskMoveModal, {
  type TaskMoveModalProps,
} from "../components/tasks/TaskMoveModal";
import type { SlotKey, TaskState, TimeBoxSchedule } from "../types";
import type { MyProjectTask } from "../services/collaboration/collaborationService";

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
  planningProjectId?: string;
  planningSelectedDate?: string;
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
  planningProjectId, planningSelectedDate, styles, insetsTop, title, headerLeft, headerRight,
  contentPaddingTop, footerPaddingBottom, refreshing, onRefresh, routineSuggestions, currentSlotLabel,
  onAddSuggestion, onDismissSuggestion, taskListBaseProps, moveModalProps,
}: Props) => {
  const [isTaskDragging, setIsTaskDragging] = useState(false);
  return (
    <View style={styles.taskScreenRoot}>
      <View style={[styles.todayStickyHeader, { top: insetsTop }]}>
        <View style={[styles.header, styles.todayStickyHeaderRow]}>
          <View style={styles.headerLeft}>{headerLeft ?? null}</View>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerRight}>{headerRight ?? null}</View>
        </View>
      </View>
      <View style={styles.taskScrollViewport}>
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: contentPaddingTop, paddingBottom: footerPaddingBottom }]}
          keyboardShouldPersistTaps="always" scrollEnabled={!isTaskDragging}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
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
          <TaskPlanner onDraggingChange={setIsTaskDragging} projectId={planningProjectId} selectedDate={planningSelectedDate ?? title} selectionMode={taskListBaseProps.selectionMode} />
        </ScrollView>
      </View>
      <TaskMoveModal {...moveModalProps} />
    </View>
  );
};

export default TaskScreen;
