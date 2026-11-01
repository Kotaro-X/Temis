import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { SlotKey, TaskState, TaskStatus } from "../../types";
import { taskChipHitSlop, taskChipStyles } from './taskChipStyles';

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  task: TaskState;
  slotKey: SlotKey;
  untitledLabel: string;
  statusLabel: Record<TaskStatus, string>;
  statusPalette: Record<TaskStatus, { bar: string; badgeBg: string; badgeText: string }>;
  onOpenTagPicker: () => void;
  onUpdateTaskName: (text: string) => void;
  onUpdateTaskEstimate: (text: string) => void;
  onStart: () => void;
  onPause: () => void;
  onDone: () => void;
  children?: React.ReactNode;
};

const TaskDetailView = ({
  styles,
  tr,
  task,
  untitledLabel,
  statusLabel,
  statusPalette,
  onOpenTagPicker,
  onUpdateTaskName,
  onUpdateTaskEstimate,
  onStart,
  onPause,
  onDone,
  children,
}: Props) => {
  const [estimateText, setEstimateText] = useState(() =>
    String(task.estimateMinutes),
  );

  const estimateFocused = useRef(false);
  useEffect(() => { if (!estimateFocused.current) setEstimateText(String(task.estimateMinutes)); }, [task.estimateMinutes]);
  const handleEstimateFocus = () => {
    estimateFocused.current = true;
    if (task.estimateMinutes === 25 && estimateText === "25") {
      setEstimateText("");
    }
  };

  const handleEstimateChange = (text: string) => {
    setEstimateText(text);
    onUpdateTaskEstimate(text);
  };

  return (
    <View style={styles.taskDetailPanel}>
      <View style={styles.taskDetailHeader}>
        <Text style={styles.taskDetailTitle}>{task.taskName || untitledLabel}</Text>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: statusPalette[task.status].badgeBg },
          ]}
        >
          <Text
            style={[
              styles.statusBadgeText,
              { color: statusPalette[task.status].badgeText },
            ]}
          >
            {statusLabel[task.status]}
          </Text>
        </View>
      </View>
      <View style={styles.taskDetailActions}>
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
          <Pressable
            style={[
              styles.startButton,
              (task.status === "DONE" || task.isArchived) && styles.startButtonDisabled,
            ]}
            onPress={onStart}
            disabled={task.status === "DONE" || task.isArchived}
          >
            <Text style={styles.startButtonText}>{tr("task.start")}</Text>
          </Pressable>
        )}
      </View>
      <TextInput
        style={styles.input}
        placeholder={tr("task.namePlaceholder")}
        value={task.taskName}
        onChangeText={onUpdateTaskName}
      />
      <View style={styles.row}>
        <Text style={styles.label}>{tr("task.tags")}</Text>
        <View style={styles.tagDropdown}>
          <Pressable hitSlop={taskChipHitSlop} style={[styles.tagDropdownButton, taskChipStyles.chip, { backgroundColor: '#f0f0ee' }]} onPress={onOpenTagPicker}>
            <Text style={styles.tagDropdownText}>
              {task.tags.length > 0 ? task.tags.join(", ") : tr("task.selectTags")}
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{tr("task.estimateMinutes")}</Text>
        <TextInput
          style={styles.inputInline}
          keyboardType="number-pad"
          value={estimateText}
          onFocus={handleEstimateFocus}
          onBlur={() => { estimateFocused.current = false; setEstimateText(String(task.estimateMinutes)); }}
          onChangeText={handleEstimateChange}
        />
      </View>
      {children ?? null}
    </View>
  );
};

export default TaskDetailView;
