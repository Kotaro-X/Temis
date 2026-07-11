import React from "react";
import { Pressable, Text, View } from "react-native";

import SwipeableRow from "../common/SwipeableRow";
import {
  getRepeatBadgeLabel,
  type TodoListEntry,
} from "../../hooks/todos/todoWorkspaceUtils";

type Props = {
  items: TodoListEntry[];
  emptyLabel: string;
  styles: Record<string, any>;
  tr: (key: string) => string;
  openSwipeTodoId: string | null;
  setOpenSwipeTodoId: React.Dispatch<React.SetStateAction<string | null>>;
  onToggleSimpleTodoDone: (entry: TodoListEntry) => void;
  onOpenTodoEdit: (entry: TodoListEntry) => void;
  onConfirmDeleteSimpleTodo: (entry: TodoListEntry) => void;
};

const TodoItemsList = ({
  items,
  emptyLabel,
  styles,
  tr,
  openSwipeTodoId,
  setOpenSwipeTodoId,
  onToggleSimpleTodoDone,
  onOpenTodoEdit,
  onConfirmDeleteSimpleTodo,
}: Props) => {
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
            onConfirmDeleteSimpleTodo(todo);
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
            style={[styles.todoToggle, todo.todo.isDone && styles.todoToggleDone]}
            onPress={() => onToggleSimpleTodoDone(todo)}
          >
            <Text style={styles.todoToggleText}>{todo.todo.isDone ? "✓" : ""}</Text>
          </Pressable>
          <Pressable
            style={styles.todoTextPressable}
            onPress={() => onOpenTodoEdit(todo)}
          >
            <Text style={[styles.todoText, todo.todo.isDone && styles.todoTextDone]}>
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
};

export default TodoItemsList;
