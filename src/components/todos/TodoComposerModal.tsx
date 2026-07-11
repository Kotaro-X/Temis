import React, { useEffect, useRef } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  TIME_PICKER_ITEM_HEIGHT,
  TODO_REPEAT_OPTIONS,
  toDateString,
  type CalendarDayCell,
  type TodoDraft,
  type TodoEditContext,
} from "../../hooks/todos/todoWorkspaceUtils";
import type { SimpleTodoItem, Tag } from "../../types";

type Props = {
  visible: boolean;
  styles: Record<string, any>;
  tr: (key: string) => string;
  todoEditingContext: TodoEditContext | null;
  todoDraft: TodoDraft;
  setTodoDraft: React.Dispatch<React.SetStateAction<TodoDraft>>;
  tagOptions: Tag[];
  calendarWeekdayLabels: string[];
  todoDatePickerOpen: boolean;
  todoDateDraft: string;
  setTodoDateDraft: React.Dispatch<React.SetStateAction<string>>;
  todoDateError: string | null;
  todoCalendarMonthLabel: string;
  todoCalendarCells: CalendarDayCell[];
  todoTimePickerOpen: boolean;
  todoHourDraft: number;
  todoMinuteDraft: number;
  hourOptions: number[];
  minuteOptions: number[];
  onClose: () => void;
  onSave: () => void;
  onToggleTodoDraftTag: (tag: Tag) => void;
  onSetTodoDraftRepeat: (repeat: Exclude<SimpleTodoItem["repeat"], "none">) => void;
  onOpenTodoDatePicker: () => void;
  onCloseTodoDatePicker: () => void;
  onShiftTodoDateDraft: (delta: number) => void;
  onShiftTodoDatePickerMonth: (delta: number) => void;
  onSelectTodoDateFromCalendar: (isoDate: string) => void;
  onApplyTodoDateDraft: () => void;
  onOpenTodoTimePicker: () => void;
  onCloseTodoTimePicker: () => void;
  onApplyTodoTimeDraft: () => void;
  onHandleHourPickerScrollEnd: (offsetY: number, itemHeight: number) => void;
  onHandleMinutePickerScrollEnd: (offsetY: number, itemHeight: number) => void;
};

const TodoComposerModal = ({
  visible,
  styles,
  tr,
  todoEditingContext,
  todoDraft,
  setTodoDraft,
  tagOptions,
  calendarWeekdayLabels,
  todoDatePickerOpen,
  todoDateDraft,
  setTodoDateDraft,
  todoDateError,
  todoCalendarMonthLabel,
  todoCalendarCells,
  todoTimePickerOpen,
  todoHourDraft,
  todoMinuteDraft,
  hourOptions,
  minuteOptions,
  onClose,
  onSave,
  onToggleTodoDraftTag,
  onSetTodoDraftRepeat,
  onOpenTodoDatePicker,
  onCloseTodoDatePicker,
  onShiftTodoDateDraft,
  onShiftTodoDatePickerMonth,
  onSelectTodoDateFromCalendar,
  onApplyTodoDateDraft,
  onOpenTodoTimePicker,
  onCloseTodoTimePicker,
  onApplyTodoTimeDraft,
  onHandleHourPickerScrollEnd,
  onHandleMinutePickerScrollEnd,
}: Props) => {
  const todoHourScrollRef = useRef<ScrollView | null>(null);
  const todoMinuteScrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (!todoTimePickerOpen) {
      return;
    }
    requestAnimationFrame(() => {
      todoHourScrollRef.current?.scrollTo({
        y: todoHourDraft * TIME_PICKER_ITEM_HEIGHT,
        animated: false,
      });
      todoMinuteScrollRef.current?.scrollTo({
        y: todoMinuteDraft * TIME_PICKER_ITEM_HEIGHT,
        animated: false,
      });
    });
  }, [todoHourDraft, todoMinuteDraft, todoTimePickerOpen]);

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.todoDateOverlay}>
      <Pressable style={styles.dateBackdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.datePanel} onPress={Keyboard.dismiss}>
          <Text style={styles.dateTitle}>
            {todoEditingContext ? tr("todo.editTitle") : tr("todo.createTitle")}
          </Text>
          <View style={styles.row}>
            <Text style={styles.label}>{tr("todo.taskName")}</Text>
            <TextInput
              style={styles.inputInline}
              value={todoDraft.text}
              onChangeText={(text) => setTodoDraft((prev) => ({ ...prev, text }))}
              placeholder={tr("todo.addPlaceholder")}
            />
          </View>
          <View style={styles.todoTagSection}>
            <Text style={styles.label}>{tr("todo.tags")}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.todoTagChipRow}
            >
              {tagOptions.map((tag) => {
                const selected = todoDraft.tags.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    style={[
                      styles.todoTagChip,
                      selected && styles.todoTagChipSelected,
                    ]}
                    onPress={() => onToggleTodoDraftTag(tag)}
                  >
                    <Text
                      style={[
                        styles.todoTagChipText,
                        selected && styles.todoTagChipTextSelected,
                      ]}
                    >
                      {tag}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{tr("todo.reminderDate")}</Text>
            <Pressable style={styles.todoDateButton} onPress={onOpenTodoDatePicker}>
              <Text
                style={[
                  styles.todoDateButtonText,
                  !todoDraft.reminderDate && styles.todoDateButtonPlaceholder,
                ]}
              >
                {todoDraft.reminderDate || "YYYY-MM-DD"}
              </Text>
              <Ionicons name="calendar-outline" size={16} color="#6b7280" />
            </Pressable>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{tr("todo.reminderTime")}</Text>
            <Pressable style={styles.todoDateButton} onPress={onOpenTodoTimePicker}>
              <Text
                style={[
                  styles.todoDateButtonText,
                  !todoDraft.reminderTime && styles.todoDateButtonPlaceholder,
                ]}
              >
                {todoDraft.reminderTime || "HH:MM"}
              </Text>
              <Ionicons name="time-outline" size={16} color="#6b7280" />
            </Pressable>
          </View>
          <View style={styles.todoTagSection}>
            <Text style={styles.label}>{tr("todo.repeat")}</Text>
            <View style={styles.todoRepeatRow}>
              {TODO_REPEAT_OPTIONS.map((repeat) => {
                const selected = todoDraft.repeat === repeat;
                return (
                  <Pressable
                    key={repeat}
                    style={[
                      styles.todoRepeatChip,
                      selected && styles.todoRepeatChipSelected,
                    ]}
                    onPress={() => onSetTodoDraftRepeat(repeat)}
                  >
                    <Text
                      style={[
                        styles.todoRepeatChipText,
                        selected && styles.todoRepeatChipTextSelected,
                      ]}
                    >
                      {tr(`todo.repeat.${repeat}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.todoRepeatStateText}>
              {tr(`todo.repeat.${todoDraft.repeat}`)}
            </Text>
          </View>
          <Text style={styles.label}>{tr("todo.memo")}</Text>
          <TextInput
            style={styles.todoMemoInput}
            value={todoDraft.memo}
            onChangeText={(memo) => setTodoDraft((prev) => ({ ...prev, memo }))}
            multiline
            placeholder={tr("todo.memo")}
            textAlignVertical="top"
          />
          <View style={styles.dateActionRow}>
            <Pressable style={styles.dateActionButton} onPress={onClose}>
              <Text style={styles.dateActionText}>{tr("common.cancel")}</Text>
            </Pressable>
            <Pressable
              style={[styles.dateActionButton, styles.dateActionPrimary]}
              onPress={onSave}
            >
              <Text style={[styles.dateActionText, styles.dateActionPrimaryText]}>
                {tr("todo.save")}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
      {todoDatePickerOpen ? (
        <View style={styles.todoDateOverlay}>
          <Pressable style={styles.dateBackdrop} onPress={onCloseTodoDatePicker} />
          <View style={styles.datePanel}>
            <Text style={styles.dateTitle}>{tr("date.select")}</Text>
            <View style={styles.dateShiftRow}>
              <Pressable
                style={styles.dateShiftButton}
                onPress={() => onShiftTodoDateDraft(-1)}
              >
                <Text style={styles.dateShiftText}>{tr("date.prev")}</Text>
              </Pressable>
              <Pressable
                style={styles.dateShiftButton}
                onPress={() => setTodoDateDraft(toDateString(new Date()))}
              >
                <Text style={styles.dateShiftText}>{tr("date.today")}</Text>
              </Pressable>
              <Pressable
                style={styles.dateShiftButton}
                onPress={() => onShiftTodoDateDraft(1)}
              >
                <Text style={styles.dateShiftText}>{tr("date.next")}</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.dateInput}
              value={todoDateDraft}
              onChangeText={setTodoDateDraft}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
            <View style={styles.calendarHeaderRow}>
              <Pressable
                style={styles.calendarMonthButton}
                onPress={() => onShiftTodoDatePickerMonth(-1)}
              >
                <Text style={styles.calendarMonthButtonText}>◀︎</Text>
              </Pressable>
              <Text style={styles.calendarMonthLabel}>{todoCalendarMonthLabel}</Text>
              <Pressable
                style={styles.calendarMonthButton}
                onPress={() => onShiftTodoDatePickerMonth(1)}
              >
                <Text style={styles.calendarMonthButtonText}>▶︎</Text>
              </Pressable>
            </View>
            <View style={styles.calendarWeekdayRow}>
              {calendarWeekdayLabels.map((label) => (
                <Text key={label} style={styles.calendarWeekdayText}>
                  {label}
                </Text>
              ))}
            </View>
            <View style={styles.calendarGrid}>
              {todoCalendarCells.map((cell) => {
                const isSelected = cell.iso === todoDateDraft;
                return (
                  <Pressable
                    key={cell.iso}
                    style={[styles.calendarCell, isSelected && styles.calendarCellSelected]}
                    onPress={() => onSelectTodoDateFromCalendar(cell.iso)}
                  >
                    <Text
                      style={[
                        styles.calendarCellText,
                        !cell.inCurrentMonth && styles.calendarCellTextMuted,
                        isSelected && styles.calendarCellTextSelected,
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {todoDateError ? <Text style={styles.errorText}>{todoDateError}</Text> : null}
            <View style={styles.dateActionRow}>
              <Pressable
                style={styles.dateActionButton}
                onPress={onCloseTodoDatePicker}
              >
                <Text style={styles.dateActionText}>{tr("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.dateActionButton, styles.dateActionPrimary]}
                onPress={onApplyTodoDateDraft}
              >
                <Text style={[styles.dateActionText, styles.dateActionPrimaryText]}>
                  {tr("date.confirm")}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      {todoTimePickerOpen ? (
        <View style={styles.todoDateOverlay}>
          <Pressable style={styles.dateBackdrop} onPress={onCloseTodoTimePicker} />
          <View style={styles.timePickerPanel}>
            <Text style={styles.dateTitle}>{tr("todo.reminderTime")}</Text>
            <View style={styles.timePickerColumns}>
              <View style={styles.timePickerColumn}>
                <ScrollView
                  ref={todoHourScrollRef}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={TIME_PICKER_ITEM_HEIGHT}
                  decelerationRate="fast"
                  contentContainerStyle={styles.timePickerContent}
                  onMomentumScrollEnd={(event) =>
                    onHandleHourPickerScrollEnd(
                      event.nativeEvent.contentOffset.y,
                      TIME_PICKER_ITEM_HEIGHT,
                    )
                  }
                  onScrollEndDrag={(event) =>
                    onHandleHourPickerScrollEnd(
                      event.nativeEvent.contentOffset.y,
                      TIME_PICKER_ITEM_HEIGHT,
                    )
                  }
                >
                  {hourOptions.map((hour) => {
                    const selected = hour === todoHourDraft;
                    return (
                      <View key={`hour-${hour}`} style={styles.timePickerItem}>
                        <Text
                          style={[
                            styles.timePickerItemText,
                            selected && styles.timePickerItemTextSelected,
                          ]}
                        >
                          {String(hour).padStart(2, "0")}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
              <Text style={styles.timePickerColon}>:</Text>
              <View style={styles.timePickerColumn}>
                <ScrollView
                  ref={todoMinuteScrollRef}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={TIME_PICKER_ITEM_HEIGHT}
                  decelerationRate="fast"
                  contentContainerStyle={styles.timePickerContent}
                  onMomentumScrollEnd={(event) =>
                    onHandleMinutePickerScrollEnd(
                      event.nativeEvent.contentOffset.y,
                      TIME_PICKER_ITEM_HEIGHT,
                    )
                  }
                  onScrollEndDrag={(event) =>
                    onHandleMinutePickerScrollEnd(
                      event.nativeEvent.contentOffset.y,
                      TIME_PICKER_ITEM_HEIGHT,
                    )
                  }
                >
                  {minuteOptions.map((minute) => {
                    const selected = minute === todoMinuteDraft;
                    return (
                      <View key={`minute-${minute}`} style={styles.timePickerItem}>
                        <Text
                          style={[
                            styles.timePickerItemText,
                            selected && styles.timePickerItemTextSelected,
                          ]}
                        >
                          {String(minute).padStart(2, "0")}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
            <View style={styles.dateActionRow}>
              <Pressable style={styles.dateActionButton} onPress={onCloseTodoTimePicker}>
                <Text style={styles.dateActionText}>{tr("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.dateActionButton, styles.dateActionPrimary]}
                onPress={onApplyTodoTimeDraft}
              >
                <Text style={[styles.dateActionText, styles.dateActionPrimaryText]}>
                  {tr("date.confirm")}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
};

export default TodoComposerModal;
