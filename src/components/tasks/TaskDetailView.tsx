import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { SlotKey, Tag, TaskState, TaskStatus } from "../../types";

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  task: TaskState;
  slotKey: SlotKey;
  untitledLabel: string;
  statusLabel: Record<TaskStatus, string>;
  statusPalette: Record<TaskStatus, { bar: string; badgeBg: string; badgeText: string }>;
  tagOptions: Tag[];
  tagDropdownOpen: boolean;
  onToggleTagDropdown: () => void;
  onCloseTagDropdown: () => void;
  onUpdateTaskName: (text: string) => void;
  onUpdateTaskEstimate: (text: string) => void;
  onToggleTaskTag: (tag: Tag) => void;
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
  tagOptions,
  tagDropdownOpen,
  onToggleTagDropdown,
  onCloseTagDropdown,
  onUpdateTaskName,
  onUpdateTaskEstimate,
  onToggleTaskTag,
  onStart,
  onPause,
  onDone,
  children,
}: Props) => {
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
              task.status === "DONE" && styles.startButtonDisabled,
            ]}
            onPress={onStart}
            disabled={task.status === "DONE"}
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
          <Pressable style={styles.tagDropdownButton} onPress={onToggleTagDropdown}>
            <Text style={styles.tagDropdownText}>
              {task.tags.length > 0 ? task.tags.join(", ") : tr("task.selectTags")}
            </Text>
          </Pressable>
          {tagDropdownOpen ? (
            <View style={styles.tagDropdownList}>
              {tagOptions.map((tag) => {
                const selected = task.tags.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    style={styles.tagDropdownItem}
                    onPress={() => {
                      onToggleTaskTag(tag);
                      onCloseTagDropdown();
                    }}
                  >
                    <Text
                      style={[
                        styles.tagDropdownItemText,
                        selected && styles.tagDropdownItemTextSelected,
                      ]}
                    >
                      {tag}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{tr("task.estimateMinutes")}</Text>
        <TextInput
          style={styles.inputInline}
          keyboardType="number-pad"
          value={String(task.estimateMinutes)}
          onChangeText={onUpdateTaskEstimate}
        />
      </View>
      {children ?? null}
    </View>
  );
};

export default TaskDetailView;
