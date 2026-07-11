import React, { useCallback } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  Text,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import MenuButton from "../components/common/MenuButton";
import {
  TodoComposerModal,
  TodoItemsList,
  TodoWorkspaceContent,
} from "../components/todos";
import { useTodoWorkspace } from "../context/TodoWorkspaceContext";
import styles from "../styles/workspaceSharedStyles";
import { type TodoListEntry } from "../hooks/todos/todoWorkspaceUtils";

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

  const handleOpenMenu = useCallback(() => {
    Keyboard.dismiss();
    setOpenSwipeTodoId(null);
    onOpenMenu();
  }, [onOpenMenu, setOpenSwipeTodoId]);

  const handleSaveTodo = useCallback(() => {
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
  }, [addSimpleTodo, applyTodoEdit, todoEditingContext, tr]);

  const confirmDeleteSimpleTodo = useCallback((entry: TodoListEntry) => {
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
  }, [deleteSimpleTodo, tr]);

  const renderTodoListItems = useCallback(
    (items: TodoListEntry[], emptyLabel: string) => (
      <TodoItemsList
        items={items}
        emptyLabel={emptyLabel}
        styles={styles}
        tr={tr}
        openSwipeTodoId={openSwipeTodoId}
        setOpenSwipeTodoId={setOpenSwipeTodoId}
        onToggleSimpleTodoDone={toggleSimpleTodoDone}
        onOpenTodoEdit={openTodoEdit}
        onConfirmDeleteSimpleTodo={confirmDeleteSimpleTodo}
      />
    ),
    [
      confirmDeleteSimpleTodo,
      openSwipeTodoId,
      openTodoEdit,
      setOpenSwipeTodoId,
      toggleSimpleTodoDone,
      tr,
    ],
  );

  if (!visible) {
    return null;
  }

  return (
    <>
      <TodoWorkspaceContent
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
        setTodoCalendarMonth={setTodoCalendarMonth}
        calendarWeekdayLabels={calendarWeekdayLabels}
        todoScreenCalendarCells={todoScreenCalendarCells}
        todoCalendarSelectedDate={todoCalendarSelectedDate}
        onSelectCalendarDate={selectTodoCalendarCell}
        todoCountsByDate={todoCountsByDate}
        selectedDateTodos={selectedDateTodos}
        unscheduledTodos={unscheduledTodos}
      />
      <TodoComposerModal
        visible={todoCreateOpen}
        styles={styles}
        tr={tr}
        todoEditingContext={todoEditingContext}
        todoDraft={todoDraft}
        setTodoDraft={setTodoDraft}
        tagOptions={tagOptions}
        calendarWeekdayLabels={calendarWeekdayLabels}
        todoDatePickerOpen={todoDatePickerOpen}
        todoDateDraft={todoDateDraft}
        setTodoDateDraft={setTodoDateDraft}
        todoDateError={todoDateError}
        todoCalendarMonthLabel={todoCalendarMonthLabel}
        todoCalendarCells={todoCalendarCells}
        todoTimePickerOpen={todoTimePickerOpen}
        todoHourDraft={todoHourDraft}
        todoMinuteDraft={todoMinuteDraft}
        hourOptions={hourOptions}
        minuteOptions={minuteOptions}
        onClose={closeTodoCreate}
        onSave={handleSaveTodo}
        onToggleTodoDraftTag={toggleTodoDraftTag}
        onSetTodoDraftRepeat={setTodoDraftRepeat}
        onOpenTodoDatePicker={openTodoDatePicker}
        onCloseTodoDatePicker={closeTodoDatePicker}
        onShiftTodoDateDraft={shiftTodoDateDraft}
        onShiftTodoDatePickerMonth={shiftTodoDatePickerMonth}
        onSelectTodoDateFromCalendar={selectTodoDateFromCalendar}
        onApplyTodoDateDraft={applyTodoDateDraft}
        onOpenTodoTimePicker={openTodoTimePicker}
        onCloseTodoTimePicker={closeTodoTimePicker}
        onApplyTodoTimeDraft={applyTodoTimeDraft}
        onHandleHourPickerScrollEnd={handleHourPickerScrollEnd}
        onHandleMinutePickerScrollEnd={handleMinutePickerScrollEnd}
      />
    </>
  );
};

export default TodoWorkspaceScreen;
