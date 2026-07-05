import React from "react";
import { Pressable, Text, View } from "react-native";

import type { SlotKey, TaskState, TaskStatus } from "../../types";
import type { TaskSectionItem } from "../../hooks/useTasks";
import TaskItem from "./TaskItem";

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  getSlotLabel: (slotKey: SlotKey) => string;
  section: TaskSectionItem;
  activeTaskId: string | null;
  noTagLabel: string;
  untitledLabel: string;
  statusLabel: Record<TaskStatus, string>;
  statusPalette: Record<TaskStatus, { bar: string; badgeBg: string; badgeText: string }>;
  selectionMode: boolean;
  selectedSet: Set<string>;
  activeExpanded: boolean;
  completedExpanded: boolean;
  completedTimeByTaskId: Map<string, string>;
  openSwipeTaskId: string | null;
  onToggleActive: (slotKey: SlotKey) => void;
  onToggleCompleted: (slotKey: SlotKey) => void;
  onAddTask: (slotKey: SlotKey) => void;
  onTaskPress: (slotKey: SlotKey, task: TaskState) => void;
  onToggleSelection: (taskId: string) => void;
  onOpenSwipe: (taskId: string) => void;
  onCloseSwipe: (taskId: string) => void;
  onMove: (slotKey: SlotKey, taskId: string) => void;
  onArchive: (slotKey: SlotKey, taskId: string) => void;
  onDelete: (taskId: string) => void;
  onStart: (slotKey: SlotKey, taskId: string) => void;
  onPause: (slotKey: SlotKey, taskId: string) => void;
  onDone: (slotKey: SlotKey, taskId: string) => void;
};

const TaskSection = ({
  styles,
  tr,
  getSlotLabel,
  section,
  activeTaskId,
  noTagLabel,
  untitledLabel,
  statusLabel,
  statusPalette,
  selectionMode,
  selectedSet,
  activeExpanded,
  completedExpanded,
  completedTimeByTaskId,
  openSwipeTaskId,
  onToggleActive,
  onToggleCompleted,
  onAddTask,
  onTaskPress,
  onToggleSelection,
  onOpenSwipe,
  onCloseSwipe,
  onMove,
  onArchive,
  onDelete,
  onStart,
  onPause,
  onDone,
}: Props) => {
  const taskCountLabel = `(${section.visibleTasks.length})`;
  return (
    <View style={styles.slotBox}>
      <View style={styles.slotHeader}>
        <Pressable
          style={styles.slotHeaderLeftToggle}
          onPress={() => onToggleActive(section.slotKey)}
          hitSlop={8}
        >
          <Text style={styles.slotChevron}>{activeExpanded ? "▼" : "▶︎"}</Text>
          <Text style={styles.slotTitle}>{getSlotLabel(section.slotKey)}</Text>
          <Text style={styles.slotCount}>{taskCountLabel}</Text>
        </Pressable>
        <View style={styles.slotHeaderRight}>
          <View style={styles.slotSummaryBox}>
            <Text
              style={[
                styles.slotSummary,
                section.overflow > 0 && styles.slotSummaryWarning,
              ]}
            >
              {`${tr("task.remaining")}: ${
                section.overflow > 0 ? 0 : section.remainingMinutes
              }${tr("task.minutes")}${
                section.overflow > 0
                  ? ` (${tr("task.overrun")} +${section.overflow}${tr("task.minutes")})`
                  : ""
              }`}
            </Text>
            <Text style={styles.slotSummary}>
              {`${tr("task.total")}: ${section.totalEstimate}${tr("task.minutes")}`}
            </Text>
          </View>
          <Pressable style={styles.addButton} onPress={() => onAddTask(section.slotKey)}>
            <Text style={styles.addButtonText}>+</Text>
          </Pressable>
        </View>
      </View>
      {activeExpanded &&
        section.activeTasks.map((task) => (
          <TaskItem
            key={task.id}
            styles={styles}
            tr={tr}
            task={task}
            noTagLabel={noTagLabel}
            untitledLabel={untitledLabel}
            statusLabel={statusLabel[task.status]}
            palette={statusPalette[task.status]}
            selectionMode={selectionMode}
            selected={selectedSet.has(task.id)}
            isActive={task.id === activeTaskId}
            isOpen={openSwipeTaskId === task.id}
            onOpen={() => onOpenSwipe(task.id)}
            onClose={() => onCloseSwipe(task.id)}
            onPress={() => onTaskPress(section.slotKey, task)}
            onToggleSelection={() => onToggleSelection(task.id)}
            onStart={() => onStart(section.slotKey, task.id)}
            onPause={() => onPause(section.slotKey, task.id)}
            onDone={() => onDone(section.slotKey, task.id)}
            actions={[
              {
                label: tr("task.move"),
                onPress: () => onMove(section.slotKey, task.id),
                style: styles.swipeMoveButton,
              },
              {
                label: tr("task.archive"),
                onPress: () => onArchive(section.slotKey, task.id),
                style: styles.swipeArchiveButton,
              },
              {
                label: tr("task.delete"),
                onPress: () => onDelete(task.id),
                style: styles.swipeDeleteButton,
              },
            ]}
          />
        ))}
      <View style={styles.completedSection}>
        <Pressable
          style={styles.completedToggleRow}
          onPress={() => onToggleCompleted(section.slotKey)}
        >
          <Text style={styles.completedToggleText}>
            {`${tr("task.status.done")}（${section.completedTasks.length}）${
              completedExpanded ? "▼" : "▶︎"
            }`}
          </Text>
        </Pressable>
        {completedExpanded &&
          (section.completedTasks.length === 0 ? (
            <Text style={styles.completedEmptyText}>{tr("task.completedNone")}</Text>
          ) : (
            section.completedTasks.map((task) => (
              <TaskItem
                key={task.id}
                styles={styles}
                tr={tr}
                task={task}
                noTagLabel={noTagLabel}
                untitledLabel={untitledLabel}
                statusLabel={statusLabel[task.status]}
                palette={statusPalette[task.status]}
                isOpen={openSwipeTaskId === task.id}
                onOpen={() => onOpenSwipe(task.id)}
                onClose={() => onCloseSwipe(task.id)}
                onPress={() => onTaskPress(section.slotKey, task)}
                completedTime={completedTimeByTaskId.get(task.id) ?? null}
                completed
                actions={[
                  {
                    label: tr("task.move"),
                    onPress: () => onMove(section.slotKey, task.id),
                    style: styles.swipeMoveButton,
                  },
                  {
                    label: tr("task.archive"),
                    onPress: () => onArchive(section.slotKey, task.id),
                    style: styles.swipeArchiveButton,
                  },
                  {
                    label: tr("task.delete"),
                    onPress: () => onDelete(task.id),
                    style: styles.swipeDeleteButton,
                  },
                ]}
              />
            ))
          ))}
      </View>
    </View>
  );
};

export default TaskSection;
