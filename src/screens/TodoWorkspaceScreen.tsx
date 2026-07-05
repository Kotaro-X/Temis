import React, { useEffect, useMemo, useRef } from "react";
import {
  Alert,
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

import MenuButton from "../components/common/MenuButton";
import SwipeableRow from "../components/common/SwipeableRow";
import TodoScreen from "./TodoScreen";
import { useTodoWorkspace } from "../context/TodoWorkspaceContext";
import styles from "../styles/workspaceSharedStyles";
import {
  TIME_PICKER_ITEM_HEIGHT,
  TODO_REPEAT_OPTIONS,
  getRepeatBadgeLabel,
  toDateString,
  type TodoListEntry,
} from "../hooks/todos/todoWorkspaceUtils";

type Props = {
  visible: boolean;
  insetsTop: number;
  tr: (key: string) => string;
  onOpenMenu: () => void;
};

const TodoWorkspaceScreen = ({
  visible,
  insetsTop,
  tr,
  onOpenMenu,
}: Props) => {
  const {
    tagOptions,
    calendarWeekdayLabels,
    todoViewMode,
    setTodoViewMode,
    todoListRange,
    setTodoListRange,
    todoCalendarMonth,
    setTodoCalendarMonth,
    todoCalendarSelectedDate,
    todoCreateOpen,
    todoEditingContext,
    todoDraft,
    setTodoDraft,
    openSwipeTodoId,
    setOpenSwipeTodoId,
    todoDatePickerOpen,
    todoDateDraft,
    setTodoDateDraft,
    todoDateError,
    todoCalendarMonthLabel,
    todoCalendarCells,
    todoTimePickerOpen,
    todoHourDraft,
    todoMinuteDraft,
    todoScreenCalendarMonthLabel,
    todoScreenCalendarCells,
    todoListEntries,
    todoCountsByDate,
    selectedDateTodos,
    unscheduledTodos,
    hourOptions,
    minuteOptions,
    openTodoCreate,
    closeTodoCreate,
    openTodoEdit,
    addSimpleTodo,
    applyTodoEdit,
    toggleTodoDraftTag,
    setTodoDraftRepeat,
    toggleSimpleTodoDone,
    deleteSimpleTodo,
    openTodoDatePicker,
    closeTodoDatePicker,
    shiftTodoDateDraft,
    shiftTodoDatePickerMonth,
    selectTodoDateFromCalendar,
    applyTodoDateDraft,
    selectTodoCalendarCell,
    openTodoTimePicker,
    closeTodoTimePicker,
    applyTodoTimeDraft,
    handleHourPickerScrollEnd,
    handleMinutePickerScrollEnd,
  } = useTodoWorkspace();
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

  const handleOpenMenu = () => {
    Keyboard.dismiss();
    setOpenSwipeTodoId(null);
    onOpenMenu();
  };

  const handleSaveTodo = () => {
    Keyboard.dismiss();
    if (!todoEditingContext) {
      addSimpleTodo();
      return;
    }
    if (todoEditingContext.isRecurringSeries && todoEditingContext.occurrenceDate) {
      Alert.alert(
        tr("todo.editScopeTitle"),
        tr("todo.editScopeBody"),
        [
          { text: tr("common.cancel"), style: "cancel" },
          {
            text: tr("todo.editScope.single"),
            onPress: () => applyTodoEdit("single"),
          },
          {
            text: tr("todo.editScope.all"),
            onPress: () => applyTodoEdit("series"),
          },
        ],
      );
      return;
    }
    applyTodoEdit("series");
  };

  const confirmDeleteSimpleTodo = (entry: TodoListEntry) => {
    if (entry.isRecurringSeries && entry.occurrenceDate) {
      Alert.alert(tr("todo.deleteScopeTitle"), tr("todo.deleteScopeBody"), [
        { text: tr("common.cancel"), style: "cancel" },
        {
          text: tr("todo.deleteScope.single"),
          style: "destructive",
          onPress: () => deleteSimpleTodo(entry, "single"),
        },
        {
          text: tr("todo.deleteScope.all"),
          style: "destructive",
          onPress: () => deleteSimpleTodo(entry, "series"),
        },
      ]);
      return;
    }
    Alert.alert(tr("task.deleteConfirmTitle"), tr("task.deleteConfirmBody"), [
      { text: tr("common.cancel"), style: "cancel" },
      {
        text: tr("common.delete"),
        style: "destructive",
        onPress: () => deleteSimpleTodo(entry, "series"),
      },
    ]);
  };

  const renderTodoListItems = useMemo(
    () => (items: TodoListEntry[], emptyLabel: string) => {
      if (items.length === 0) {
        return <Text style={styles.mutedText}>{emptyLabel}</Text>;
      }
      return items.map((todo) => (
        <SwipeableRow
          key={todo.key}
          styles={styles}
          actions={[
            {
              label: tr("todo.delete"),
              onPress: () => {
                setOpenSwipeTodoId(null);
                confirmDeleteSimpleTodo(todo);
              },
              style: styles.swipeDeleteButton,
            },
          ]}
          isOpen={openSwipeTodoId === todo.todo.id}
          onOpen={() => setOpenSwipeTodoId(todo.todo.id)}
          onClose={() =>
            setOpenSwipeTodoId((prev) => (prev === todo.todo.id ? null : prev))
          }
          maxSwipe={100}
          openFromBothSides
        >
          <View style={styles.todoItem}>
            <View style={styles.todoItemHeader}>
              <Pressable
                style={[
                  styles.todoToggle,
                  todo.todo.isDone && styles.todoToggleDone,
                ]}
                onPress={() => toggleSimpleTodoDone(todo)}
              >
                <Text style={styles.todoToggleText}>
                  {todo.todo.isDone ? "✓" : ""}
                </Text>
              </Pressable>
              <Pressable
                style={styles.todoTextPressable}
                onPress={() => openTodoEdit(todo)}
              >
                <Text
                  style={[
                    styles.todoText,
                    todo.todo.isDone && styles.todoTextDone,
                  ]}
                >
                  {todo.todo.text || tr("common.untitled")}
                </Text>
              </Pressable>
            </View>
            {todo.todo.memo.trim() ? (
              <Text style={styles.todoMemoText}>{todo.todo.memo}</Text>
            ) : null}
            {todo.todo.tags.length > 0 ? (
              <Text style={styles.todoTagsText}>{todo.todo.tags.join(", ")}</Text>
            ) : null}
            {todo.displayDate && todo.displayTime ? (
              <View style={styles.todoMetaRow}>
                <Text style={styles.todoReminderText}>
                  {`${tr("todo.reminderDate")}: ${todo.displayDate} ${tr("todo.reminderTime")}: ${todo.displayTime}`}
                </Text>
                {todo.isRecurringSeries && todo.seriesMaster ? (
                  <View style={styles.todoRepeatBadge}>
                    <Text style={styles.todoRepeatBadgeText}>
                      {getRepeatBadgeLabel(todo.seriesMaster.repeat)}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : todo.displayDate ? (
              <View style={styles.todoMetaRow}>
                <Text style={styles.todoReminderText}>
                  {`${tr("todo.reminderDate")}: ${todo.displayDate}`}
                </Text>
                {todo.isRecurringSeries && todo.seriesMaster ? (
                  <View style={styles.todoRepeatBadge}>
                    <Text style={styles.todoRepeatBadgeText}>
                      {getRepeatBadgeLabel(todo.seriesMaster.repeat)}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </SwipeableRow>
      ));
    },
    [
      openSwipeTodoId,
      openTodoEdit,
      setOpenSwipeTodoId,
      styles,
      toggleSimpleTodoDone,
      tr,
      deleteSimpleTodo,
    ],
  );

  if (!visible) {
    return null;
  }

  return (
    <>
      <TodoScreen
        styles={styles}
        insetsTop={insetsTop}
        title={tr("todo.title")}
        headerLeft={<MenuButton styles={styles} onPress={handleOpenMenu} />}
        headerRight={
          <Pressable style={styles.todoTopAddButton} onPress={openTodoCreate}>
            <Ionicons name="add" size={18} color="#111827" />
            <Text style={styles.todoTopAddButtonText}>{tr("todo.add")}</Text>
          </Pressable>
        }
        tr={tr}
        todoViewMode={todoViewMode}
        setTodoViewMode={setTodoViewMode}
        todoListRange={todoListRange}
        setTodoListRange={setTodoListRange}
        renderTodoListItems={renderTodoListItems}
        todoListEntries={todoListEntries}
        todoCalendarMonthLabel={todoScreenCalendarMonthLabel}
        todoCalendarMonth={todoCalendarMonth}
        setTodoCalendarMonth={setTodoCalendarMonth}
        calendarWeekdayLabels={calendarWeekdayLabels}
        todoScreenCalendarCells={todoScreenCalendarCells}
        todoCalendarSelectedDate={todoCalendarSelectedDate}
        onSelectCalendarDate={selectTodoCalendarCell}
        todoCountsByDate={todoCountsByDate}
        selectedDateTodos={selectedDateTodos}
        unscheduledTodos={unscheduledTodos}
      />
      {todoCreateOpen ? (
        <View style={styles.todoDateOverlay}>
          <Pressable style={styles.dateBackdrop} onPress={closeTodoCreate} />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <Pressable style={styles.datePanel} onPress={Keyboard.dismiss}>
              <Text style={styles.dateTitle}>
                {todoEditingContext ? tr("todo.editTitle") : tr("todo.createTitle")}
              </Text>
              <View style={styles.row}>
                <Text style={styles.label}>{tr("todo.taskName")}</Text>
                <TextInput
                  style={styles.inputInline}
                  value={todoDraft.text}
                  onChangeText={(text) =>
                    setTodoDraft((prev) => ({ ...prev, text }))
                  }
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
                        onPress={() => toggleTodoDraftTag(tag)}
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
                <Pressable style={styles.todoDateButton} onPress={openTodoDatePicker}>
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
                <Pressable style={styles.todoDateButton} onPress={openTodoTimePicker}>
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
                        onPress={() => setTodoDraftRepeat(repeat)}
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
                onChangeText={(memo) =>
                  setTodoDraft((prev) => ({ ...prev, memo }))
                }
                multiline
                placeholder={tr("todo.memo")}
                textAlignVertical="top"
              />
              <View style={styles.dateActionRow}>
                <Pressable style={styles.dateActionButton} onPress={closeTodoCreate}>
                  <Text style={styles.dateActionText}>{tr("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  style={[styles.dateActionButton, styles.dateActionPrimary]}
                  onPress={handleSaveTodo}
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
              <Pressable style={styles.dateBackdrop} onPress={closeTodoDatePicker} />
              <View style={styles.datePanel}>
                <Text style={styles.dateTitle}>{tr("date.select")}</Text>
                <View style={styles.dateShiftRow}>
                  <Pressable
                    style={styles.dateShiftButton}
                    onPress={() => shiftTodoDateDraft(-1)}
                  >
                    <Text style={styles.dateShiftText}>{tr("date.prev")}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.dateShiftButton}
                    onPress={() => {
                      const today = toDateString(new Date());
                      setTodoDateDraft(today);
                    }}
                  >
                    <Text style={styles.dateShiftText}>{tr("date.today")}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.dateShiftButton}
                    onPress={() => shiftTodoDateDraft(1)}
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
                    onPress={() => shiftTodoDatePickerMonth(-1)}
                  >
                    <Text style={styles.calendarMonthButtonText}>◀︎</Text>
                  </Pressable>
                  <Text style={styles.calendarMonthLabel}>{todoCalendarMonthLabel}</Text>
                  <Pressable
                    style={styles.calendarMonthButton}
                    onPress={() => shiftTodoDatePickerMonth(1)}
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
                        style={[
                          styles.calendarCell,
                          isSelected && styles.calendarCellSelected,
                        ]}
                        onPress={() => selectTodoDateFromCalendar(cell.iso)}
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
                  <Pressable style={styles.dateActionButton} onPress={closeTodoDatePicker}>
                    <Text style={styles.dateActionText}>{tr("common.cancel")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.dateActionButton, styles.dateActionPrimary]}
                    onPress={applyTodoDateDraft}
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
              <Pressable style={styles.dateBackdrop} onPress={closeTodoTimePicker} />
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
                        handleHourPickerScrollEnd(
                          event.nativeEvent.contentOffset.y,
                          TIME_PICKER_ITEM_HEIGHT,
                        )
                      }
                      onScrollEndDrag={(event) =>
                        handleHourPickerScrollEnd(
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
                        handleMinutePickerScrollEnd(
                          event.nativeEvent.contentOffset.y,
                          TIME_PICKER_ITEM_HEIGHT,
                        )
                      }
                      onScrollEndDrag={(event) =>
                        handleMinutePickerScrollEnd(
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
                  <Pressable style={styles.dateActionButton} onPress={closeTodoTimePicker}>
                    <Text style={styles.dateActionText}>{tr("common.cancel")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.dateActionButton, styles.dateActionPrimary]}
                    onPress={applyTodoTimeDraft}
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
      ) : null}
    </>
  );
};

export default TodoWorkspaceScreen;
