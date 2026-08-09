import React, { useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";

import SwipeableRow from "../common/SwipeableRow";
import type { TaskState } from "../../types";

export type TaskDragPreview = {
  taskName: string;
  tags: string[];
  statusLabel: string;
  palette: { bar: string; badgeBg: string; badgeText: string };
  completed: boolean;
  completedTime: string | null;
  width: number;
  height: number;
  pageX: number;
  pageY: number;
  touchOffsetX: number;
  touchOffsetY: number;
};

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
  onDragStart?: (preview: TaskDragPreview) => void;
  onDragMove?: (pageX: number, pageY: number) => void;
  onDragEnd?: () => void;
  onDragStateChange?: (isDragging: boolean) => void;
  onDrop?: (pageY: number) => void;
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
  swipeEnabled?: boolean;
  draggable?: boolean;
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
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragStateChange,
  onDrop,
  onToggleSelection,
  onStart,
  onPause,
  onDone,
  actions,
  completedTime,
  completed = false,
  swipeEnabled = true,
  draggable = true,
}: Props) => {
  const rowRef = useRef<View>(null);
  const isDraggingRef = useRef(false);
  const dragResponderActiveRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleLongPress = (event: GestureResponderEvent) => {
    isDraggingRef.current = true;
    setIsDragging(true);
    onDragStateChange?.(true);
    const { pageX, pageY } = event.nativeEvent;
    rowRef.current?.measureInWindow((x, y, width, height) => {
      onDragStart?.({
        taskName: task.taskName || untitledLabel,
        tags: task.tags,
        statusLabel,
        palette,
        completed,
        completedTime: completedTime ?? null,
        width,
        height,
        pageX,
        pageY,
        touchOffsetX: pageX - x,
        touchOffsetY: pageY - y,
      });
    });
  };

  const handlePress = () => {
    if (isDraggingRef.current) {
      return;
    }
    onPress();
  };

  const finishDrag = (pageY: number) => {
    if (!isDraggingRef.current) {
      return;
    }
    isDraggingRef.current = false;
    dragResponderActiveRef.current = false;
    setIsDragging(false);
    onDragEnd?.();
    onDragStateChange?.(false);
    onDrop?.(pageY);
  };

  const dragPanResponder = useMemo(
    () =>
      PanResponder.create({
        // Once a long press has started, retain vertical movement instead of
        // letting the parent ScrollView cancel the pending drop.
        onMoveShouldSetPanResponderCapture: () => isDraggingRef.current,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragResponderActiveRef.current = true;
        },
        onPanResponderMove: (_, gesture) => {
          onDragMove?.(gesture.moveX, gesture.moveY);
        },
        onPanResponderRelease: (_, gesture) => {
          finishDrag(gesture.moveY);
        },
        // Programmatic edge scrolling can transiently ask to terminate this
        // responder. A task is dropped only when the user releases their finger.
        onPanResponderTerminate: () => {},
      }),
    [onDragMove, onDrop],
  );

  const handlePressOut = (pageY: number) => {
    // A stationary long press never claims the PanResponder, so resolve it
    // here. Dragged rows resolve from onPanResponderRelease with final moveY.
    if (!dragResponderActiveRef.current) {
      finishDrag(pageY);
    }
  };

  return (
    <SwipeableRow
      styles={styles}
      actions={actions}
      enabled={swipeEnabled && !selectionMode && !isDragging}
      isOpen={isOpen}
      onOpen={onOpen}
      onClose={onClose}
      revealOnLeft
      swipeActivationDistance={6}
      swipeOpenThreshold={0.2}
      swipeVelocityThreshold={0.22}
      swipeHorizontalDominanceRatio={0.6}
      swipeMaxVerticalDrift={40}
    >
      <View
        ref={rowRef}
        {...(draggable ? dragPanResponder.panHandlers : {})}
        style={isDragging ? styles.taskDragSource : undefined}
      >
        {completed ? (
          <View style={styles.completedTaskRow}>
            <View style={[styles.statusBar, { backgroundColor: palette.bar }]} />
            <Pressable
              style={styles.completedTaskBody}
              onPress={handlePress}
              onLongPress={selectionMode || !draggable ? undefined : handleLongPress}
              onPressOut={draggable ? (event) => handlePressOut(event.nativeEvent.pageY) : undefined}
              delayLongPress={400}
            >
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
                  onPress={handlePress}
                  onLongPress={selectionMode || !draggable ? undefined : handleLongPress}
                  onPressOut={draggable ? (event) => handlePressOut(event.nativeEvent.pageY) : undefined}
                  delayLongPress={400}
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
      </View>
    </SwipeableRow>
  );
};

export default TaskItem;
