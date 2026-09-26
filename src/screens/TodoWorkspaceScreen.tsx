import React, { useCallback } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  Text,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import MenuButton from "../components/common/MenuButton";
import ProjectOwnedTaskList from "../components/private-project/ProjectOwnedTaskList";
import {
  TodoComposerHost,
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
    calendarWeekdayLabels,
    todoViewMode,
    setTodoViewMode,
    todoListRange,
    setTodoListRange,
    setTodoCalendarMonth,
    todoCalendarSelectedDate,
    openSwipeTodoId,
    setOpenSwipeTodoId,
    todoScreenCalendarMonthLabel,
    todoScreenCalendarCells,
    todoListEntries,
    todoCountsByDate,
    selectedDateTodos,
    unscheduledTodos,
    openTodoCreate,
    openTodoEdit,
    toggleSimpleTodoDone,
    deleteSimpleTodo,
    selectTodoCalendarCell,
  } = useTodoWorkspace();

  const handleOpenMenu = useCallback(() => {
    Keyboard.dismiss();
    setOpenSwipeTodoId(null);
    onOpenMenu();
  }, [onOpenMenu, setOpenSwipeTodoId]);

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
        projectItemsFooter={<ProjectOwnedTaskList kind="todo" />}
      />
      <TodoComposerHost source="todo" tr={tr} />
    </>
  );
};

export default TodoWorkspaceScreen;
