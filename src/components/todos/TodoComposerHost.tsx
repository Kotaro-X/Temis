import React, { useCallback } from "react";
import { Alert, Keyboard } from "react-native";

import { useTodoWorkspace } from "../../context/TodoWorkspaceContext";
import styles from "../../styles/workspaceSharedStyles";
import TodoComposerModal from "./TodoComposerModal";

type Props = {
  source: "todo" | "memo";
  tr: (key: string) => string;
};

export default function TodoComposerHost({ source, tr }: Props) {
  const workspace = useTodoWorkspace();
  const handleSave = useCallback(() => {
    Keyboard.dismiss();
    if (!workspace.todoEditingContext) {
      workspace.addSimpleTodo();
      return;
    }
    if (workspace.todoEditingContext.isRecurringSeries && workspace.todoEditingContext.occurrenceDate) {
      Alert.alert(tr("todo.editScopeTitle"), tr("todo.editScopeBody"), [
        { text: tr("common.cancel"), style: "cancel" },
        { text: tr("todo.editScope.single"), onPress: () => workspace.applyTodoEdit("single") },
        { text: tr("todo.editScope.all"), onPress: () => workspace.applyTodoEdit("series") },
      ]);
      return;
    }
    workspace.applyTodoEdit("series");
  }, [tr, workspace]);

  return (
    <TodoComposerModal
      visible={workspace.todoCreateOpen && workspace.todoComposerSource === source}
      styles={styles}
      tr={tr}
      todoEditingContext={workspace.todoEditingContext}
      todoDraft={workspace.todoDraft}
      setTodoDraft={workspace.setTodoDraft}
      tagOptions={workspace.tagOptions}
      calendarWeekdayLabels={workspace.calendarWeekdayLabels}
      todoDatePickerOpen={workspace.todoDatePickerOpen}
      todoDateDraft={workspace.todoDateDraft}
      setTodoDateDraft={workspace.setTodoDateDraft}
      todoDateError={workspace.todoDateError}
      todoCalendarMonthLabel={workspace.todoCalendarMonthLabel}
      todoCalendarCells={workspace.todoCalendarCells}
      todoTimePickerOpen={workspace.todoTimePickerOpen}
      todoHourDraft={workspace.todoHourDraft}
      todoMinuteDraft={workspace.todoMinuteDraft}
      hourOptions={workspace.hourOptions}
      minuteOptions={workspace.minuteOptions}
      onClose={workspace.closeTodoCreate}
      onSave={handleSave}
      onToggleTodoDraftTag={workspace.toggleTodoDraftTag}
      onSetTodoDraftRepeat={workspace.setTodoDraftRepeat}
      onOpenTodoDatePicker={workspace.openTodoDatePicker}
      onCloseTodoDatePicker={workspace.closeTodoDatePicker}
      onShiftTodoDateDraft={workspace.shiftTodoDateDraft}
      onShiftTodoDatePickerMonth={workspace.shiftTodoDatePickerMonth}
      onSelectTodoDateFromCalendar={workspace.selectTodoDateFromCalendar}
      onApplyTodoDateDraft={workspace.applyTodoDateDraft}
      onOpenTodoTimePicker={workspace.openTodoTimePicker}
      onCloseTodoTimePicker={workspace.closeTodoTimePicker}
      onApplyTodoTimeDraft={workspace.applyTodoTimeDraft}
      onHandleHourPickerScrollEnd={workspace.handleHourPickerScrollEnd}
      onHandleMinutePickerScrollEnd={workspace.handleMinutePickerScrollEnd}
    />
  );
}
