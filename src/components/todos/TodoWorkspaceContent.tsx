import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import Header from "../common/Header";
import type {
  CalendarDayCell,
  TodoListEntry,
  TodoListRange,
} from "../../hooks/todos/todoWorkspaceUtils";

type Props = {
  styles: Record<string, any>;
  insetsTop: number;
  title: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  tr: (key: string) => string;
  todoViewMode: "list" | "calendar";
  setTodoViewMode: (mode: "list" | "calendar") => void;
  todoListRange: TodoListRange;
  setTodoListRange: (range: TodoListRange) => void;
  renderTodoListItems: (
    items: TodoListEntry[],
    emptyLabel: string,
  ) => React.ReactNode;
  todoListEntries: TodoListEntry[];
  todoCalendarMonthLabel: string;
  setTodoCalendarMonth: React.Dispatch<React.SetStateAction<Date>>;
  calendarWeekdayLabels: string[];
  todoScreenCalendarCells: CalendarDayCell[];
  todoCalendarSelectedDate: string;
  onSelectCalendarDate: (cell: CalendarDayCell) => void;
  todoCountsByDate: Map<string, number>;
  selectedDateTodos: TodoListEntry[];
  unscheduledTodos: TodoListEntry[];
};

const TODO_LIST_RANGES: TodoListRange[] = ["today", "week", "month"];

const TodoWorkspaceContent = ({
  styles,
  insetsTop,
  title,
  headerLeft,
  headerRight,
  tr,
  todoViewMode,
  setTodoViewMode,
  todoListRange,
  setTodoListRange,
  renderTodoListItems,
  todoListEntries,
  todoCalendarMonthLabel,
  setTodoCalendarMonth,
  calendarWeekdayLabels,
  todoScreenCalendarCells,
  todoCalendarSelectedDate,
  onSelectCalendarDate,
  todoCountsByDate,
  selectedDateTodos,
  unscheduledTodos,
}: Props) => {
  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: insetsTop }]}
      keyboardShouldPersistTaps="handled"
    >
      <Header styles={styles} title={title} left={headerLeft} right={headerRight} />
      <View style={styles.todoViewSwitch}>
        <Pressable
          style={[
            styles.todoViewButton,
            todoViewMode === "list" && styles.todoViewButtonActive,
          ]}
          onPress={() => setTodoViewMode("list")}
        >
          <Text
            style={[
              styles.todoViewButtonText,
              todoViewMode === "list" && styles.todoViewButtonTextActive,
            ]}
          >
            {tr("todo.view.list")}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.todoViewButton,
            todoViewMode === "calendar" && styles.todoViewButtonActive,
          ]}
          onPress={() => setTodoViewMode("calendar")}
        >
          <Text
            style={[
              styles.todoViewButtonText,
              todoViewMode === "calendar" && styles.todoViewButtonTextActive,
            ]}
          >
            {tr("todo.view.calendar")}
          </Text>
        </Pressable>
      </View>
      <View style={styles.todoList}>
        {todoViewMode === "list" ? (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {TODO_LIST_RANGES.map((range) => (
                <Pressable
                  key={range}
                  style={[
                    styles.filterChip,
                    todoListRange === range && styles.filterChipActive,
                  ]}
                  onPress={() => setTodoListRange(range)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      todoListRange === range && styles.filterChipTextActive,
                    ]}
                  >
                    {tr(`todo.range.${range}`)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {renderTodoListItems(todoListEntries, tr("todo.empty"))}
          </>
        ) : (
          <>
            <View style={styles.todoCalendarCard}>
              <View style={styles.calendarHeaderRow}>
                <Pressable
                  style={styles.calendarMonthButton}
                  onPress={() =>
                    setTodoCalendarMonth(
                      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
                    )
                  }
                >
                  <Text style={styles.calendarMonthButtonText}>◀︎</Text>
                </Pressable>
                <Text style={styles.calendarMonthLabel}>{todoCalendarMonthLabel}</Text>
                <Pressable
                  style={styles.calendarMonthButton}
                  onPress={() =>
                    setTodoCalendarMonth(
                      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
                    )
                  }
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
                {todoScreenCalendarCells.map((cell) => {
                  const isSelected = cell.iso === todoCalendarSelectedDate;
                  const hasTodos = (todoCountsByDate.get(cell.iso) ?? 0) > 0;
                  return (
                    <Pressable
                      key={cell.iso}
                      style={[
                        styles.calendarCell,
                        styles.todoCalendarCell,
                        isSelected && styles.calendarCellSelected,
                      ]}
                      onPress={() => onSelectCalendarDate(cell)}
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
                      <View
                        style={[
                          styles.todoCalendarDot,
                          hasTodos && styles.todoCalendarDotActive,
                          isSelected && styles.todoCalendarDotSelected,
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.todoCalendarSection}>
              <Text style={styles.todoCalendarSectionTitle}>
                {todoCalendarSelectedDate}
              </Text>
              {renderTodoListItems(selectedDateTodos, tr("todo.calendar.emptyDay"))}
            </View>
            <View style={styles.todoCalendarSection}>
              <Text style={styles.todoCalendarSectionTitle}>
                {tr("todo.calendar.unscheduled")}
              </Text>
              {renderTodoListItems(
                unscheduledTodos,
                tr("todo.calendar.emptyUnscheduled"),
              )}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
};

export default TodoWorkspaceContent;
