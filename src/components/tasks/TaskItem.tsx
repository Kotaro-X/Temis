import React from "react";
import { Pressable, Text, View } from "react-native";

import SwipeableRow from "../common/SwipeableRow";
import type { TaskState } from "../../types";

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  task: TaskState;
  noTagLabel: string;
  untitledLabel: string;
  statusLabel: string;
  palette: { bar: string; badgeBg: string; badgeText: string };
  selectionMode?: boolean;
  selected?: boolean;
  isActive?: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPress: () => void;
  onToggleSelection?: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onDone?: () => void;
  actions: Array<{
    label: string;
    onPress: () => void;
    style?: object;
  }>;
  completedTime?: string | null;
  completed?: boolean;
};

const TaskItem = ({
  styles,
  tr,
  task,
  noTagLabel,
  untitledLabel,
  statusLabel,
  palette,
  selectionMode = false,
  selected = false,
  isActive = false,
  isOpen,
  onOpen,
  onClose,
  onPress,
  onToggleSelection,
  onStart,
  onPause,
  onDone,
  actions,
  completedTime,
  completed = false,
}: Props) => {
  return (
    <SwipeableRow
      styles={styles}
      actions={actions}
      enabled={!selectionMode}
      isOpen={isOpen}
      onOpen={onOpen}
      onClose={onClose}
    >
      {completed ? (
        <View style={styles.completedTaskRow}>
          <View style={[styles.statusBar, { backgroundColor: palette.bar }]} />
          <Pressable style={styles.completedTaskBody} onPress={onPress}>
            <View style={styles.completedTaskContent}>
              <Text style={styles.completedTaskTitle}>
                {task.taskName || untitledLabel}
              </Text>
              {completedTime ? (
                <Text style={styles.completedTaskTime}>
                  {`${tr("task.completedAt")} ${completedTime}`}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </View>
      ) : (
        <View style={styles.taskBox}>
          <View style={styles.taskHeaderRow}>
            <View style={[styles.statusBar, { backgroundColor: palette.bar }]} />
            <View style={styles.taskHeaderBody}>
              {selectionMode ? (
                <Pressable style={styles.checkbox} onPress={onToggleSelection}>
                  <Text style={styles.checkboxText}>{selected ? "[x]" : "[ ]"}</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[
                  styles.taskHeaderPressable,
                  isActive && !selectionMode && styles.taskHeaderActive,
                ]}
                onPress={onPress}
              >
                <View style={styles.taskHeaderContent}>
                  <Text style={styles.taskHeaderTitle}>
                    {task.taskName || untitledLabel}
                  </Text>
                  <Text style={styles.taskHeaderMeta}>
                    {task.tags.length > 0 ? task.tags.join(", ") : noTagLabel}
                  </Text>
                </View>
              </Pressable>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: palette.badgeBg },
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: palette.badgeText },
                  ]}
                >
                  {statusLabel}
                </Text>
              </View>
              <View style={styles.taskActions}>
                {task.status === "IN_PROGRESS" ? (
                  <>
                    <Pressable style={styles.inlineActionButton} onPress={onPause}>
                      <Text style={styles.inlineActionText}>{tr("task.pause")}</Text>
                    </Pressable>
                    <Pressable style={styles.inlineActionButton} onPress={onDone}>
                      <Text style={styles.inlineActionText}>{tr("task.done")}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable style={styles.startButton} onPress={onStart}>
                    <Text style={styles.startButtonText}>{tr("task.start")}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </View>
      )}
    </SwipeableRow>
  );
};

export default TaskItem;
