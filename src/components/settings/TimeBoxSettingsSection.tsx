import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  SlotKey,
  SLOT_KEYS,
  TimeBoxSchedule,
} from "../../../types";
import type { TimeBoxTaskPreviewItem } from "../../hooks/tasks/taskSelectors";

type Props = {
  draft: TimeBoxSchedule;
  error: string | null;
  expanded: Record<SlotKey, boolean>;
  onToggleExpand: (slotKey: SlotKey) => void;
  onChangeDraft: (slotKey: SlotKey, field: "start" | "end", value: string) => void;
  onSave: () => void;
  onReset: () => void;
  slotTaskPreviews?: Record<SlotKey, TimeBoxTaskPreviewItem[]>;
  onOpenTask?: (taskId: string) => void;
  slotLabels?: Record<SlotKey, string>;
  labels?: {
    reset: string;
    save: string;
    noTasks: string;
    untitled: string;
    timePlaceholder: string;
  };
};

const TimeBoxSettingsSection = ({
  draft,
  error,
  expanded,
  onToggleExpand,
  onChangeDraft,
  onSave,
  onReset,
  slotTaskPreviews,
  onOpenTask,
  slotLabels,
  labels,
}: Props) => {
  const text = {
    reset: labels?.reset ?? "リセット",
    save: labels?.save ?? "保存",
    noTasks: labels?.noTasks ?? "タスクはありません",
    untitled: labels?.untitled ?? "未設定",
    timePlaceholder: labels?.timePlaceholder ?? "HH:MM",
  };
  return (
    <View>
      <View style={styles.actionRow}>
        <Pressable style={styles.resetButton} onPress={onReset}>
          <Text style={styles.resetButtonText}>{text.reset}</Text>
        </Pressable>
        <Pressable style={styles.saveButton} onPress={onSave}>
          <Text style={styles.saveButtonText}>{text.save}</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.timeBoxList}>
        {SLOT_KEYS.map((key) => {
          const isExpanded = expanded[key];
          const slotTasks = slotTaskPreviews?.[key] ?? [];
          return (
            <View key={key} style={styles.timeBoxSection}>
              <Pressable
                style={styles.timeBoxHeader}
                onPress={() => onToggleExpand(key)}
              >
                <Text style={styles.timeBoxChevron}>
                  {isExpanded ? "▼" : "▶︎"}
                </Text>
                <View style={styles.timeBoxHeaderBody}>
                  <Text style={styles.timeBoxTitle}>
                    {slotLabels?.[key] ?? key}
                  </Text>
                  <Text style={styles.timeBoxTime}>
                    {`${draft[key].start} - ${draft[key].end}`}
                  </Text>
                </View>
              </Pressable>
              <View style={styles.scheduleRow}>
                <Text style={styles.scheduleLabel}>{slotLabels?.[key] ?? key}</Text>
                <View style={styles.scheduleInputs}>
                  <TextInput
                    style={styles.scheduleInput}
                    value={draft[key].start}
                    onChangeText={(text) => onChangeDraft(key, "start", text)}
                    placeholder={text.timePlaceholder}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                  <Text style={styles.scheduleSeparator}>-</Text>
                  <TextInput
                    style={styles.scheduleInput}
                    value={draft[key].end}
                    onChangeText={(text) => onChangeDraft(key, "end", text)}
                    placeholder={text.timePlaceholder}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
              </View>
              {isExpanded && (
                <View style={styles.timeBoxTasks}>
                  {slotTasks.length === 0 ? (
                    <Text style={styles.timeBoxEmpty}>{text.noTasks}</Text>
                  ) : (
                    slotTasks.map((task) => (
                      <Pressable
                        key={task.id}
                        style={styles.timeBoxTaskRow}
                        onPress={() => onOpenTask?.(task.id)}
                      >
                        <Text style={styles.timeBoxTaskText}>
                          {task.title || text.untitled}
                        </Text>
                      </Pressable>
                    ))
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  saveButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#111827",
    marginLeft: 8,
  },
  saveButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ffffff",
  },
  resetButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  resetButtonText: {
    fontSize: 12,
    color: "#111827",
  },
  errorText: {
    fontSize: 12,
    color: "#dc2626",
    marginBottom: 8,
  },
  timeBoxList: {
    marginBottom: 4,
  },
  timeBoxSection: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  timeBoxHeader: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
  },
  timeBoxChevron: {
    width: 20,
    textAlign: "center",
    fontSize: 12,
    color: "#6b7280",
  },
  timeBoxHeaderBody: {
    flex: 1,
  },
  timeBoxTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  timeBoxTime: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  timeBoxTasks: {
    marginTop: 8,
    borderTopWidth: 1,
    borderColor: "#f3f4f6",
    paddingTop: 6,
  },
  timeBoxTaskRow: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 6,
  },
  timeBoxTaskText: {
    fontSize: 13,
    color: "#111827",
  },
  timeBoxEmpty: {
    fontSize: 12,
    color: "#6b7280",
    paddingVertical: 6,
  },
  scheduleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  scheduleLabel: {
    width: 60,
    fontSize: 12,
    color: "#111827",
  },
  scheduleInputs: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  scheduleInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 12,
  },
  scheduleSeparator: {
    marginHorizontal: 6,
    fontSize: 12,
    color: "#6b7280",
  },
});

export type { Props as TimeBoxSettingsSectionProps };
export default TimeBoxSettingsSection;
