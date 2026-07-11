import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { nanoid } from "nanoid/non-secure";

import * as todoRepository from "../../repositories/todoRepository";
import type { SimpleTodoItem, Tag } from "../../types";
import {
  createClosedTodoComposerState,
  isTodoComposerClosed,
  isTodoDraftEmpty,
} from "./todoWorkspacePolicy";
import {
  createEmptyTodoDraft,
  getTodoNotificationIds,
  getTodoSeriesAnchorDate,
  getTodoSeriesId,
  isRecurringSeriesMaster,
  type TodoDraft,
  type TodoEditContext,
  type TodoEditScope,
  type TodoListEntry,
} from "./todoWorkspaceUtils";

type Props = {
  simpleTodos: SimpleTodoItem[];
  persistTodos: (next: SimpleTodoItem[]) => Promise<void>;
  todoCreateOpen: boolean;
  setTodoCreateOpen: Dispatch<SetStateAction<boolean>>;
  todoEditingContext: TodoEditContext | null;
  setTodoEditingContext: Dispatch<SetStateAction<TodoEditContext | null>>;
  todoDraft: TodoDraft;
  setTodoDraft: Dispatch<SetStateAction<TodoDraft>>;
  openSwipeTodoId: string | null;
  setOpenSwipeTodoId: Dispatch<SetStateAction<string | null>>;
  todoDatePickerOpen: boolean;
  setTodoDatePickerOpen: Dispatch<SetStateAction<boolean>>;
  todoTimePickerOpen: boolean;
  setTodoTimePickerOpen: Dispatch<SetStateAction<boolean>>;
  todoDateError: string | null;
  setTodoDateError: Dispatch<SetStateAction<string | null>>;
  cancelTodoNotifications: (notificationIds: string[]) => Promise<void>;
  rescheduleTodoNotification: (todo: SimpleTodoItem) => Promise<void>;
};

export const useTodoCrudActions = ({
  simpleTodos,
  persistTodos,
  todoCreateOpen,
  setTodoCreateOpen,
  todoEditingContext,
  setTodoEditingContext,
  todoDraft,
  setTodoDraft,
  openSwipeTodoId,
  setOpenSwipeTodoId,
  todoDatePickerOpen,
  setTodoDatePickerOpen,
  todoTimePickerOpen,
  setTodoTimePickerOpen,
  todoDateError,
  setTodoDateError,
  cancelTodoNotifications,
  rescheduleTodoNotification,
}: Props) => {
  const updateSimpleTodos = useCallback(
    (next: SimpleTodoItem[]) => {
      void persistTodos(next);
    },
    [persistTodos],
  );

  const closeTodoComposer = useCallback(() => {
    if (
      isTodoComposerClosed({
        todoCreateOpen,
        todoEditingContext,
        todoDraft,
        todoDatePickerOpen,
        todoTimePickerOpen,
        todoDateError,
      })
    ) {
      return;
    }
    const nextState = createClosedTodoComposerState();
    if (todoCreateOpen !== nextState.todoCreateOpen) {
      setTodoCreateOpen(nextState.todoCreateOpen);
    }
    if (todoEditingContext !== nextState.todoEditingContext) {
      setTodoEditingContext(nextState.todoEditingContext);
    }
    if (!isTodoDraftEmpty(todoDraft)) {
      setTodoDraft(nextState.todoDraft);
    }
    if (todoDatePickerOpen !== nextState.todoDatePickerOpen) {
      setTodoDatePickerOpen(nextState.todoDatePickerOpen);
    }
    if (todoTimePickerOpen !== nextState.todoTimePickerOpen) {
      setTodoTimePickerOpen(nextState.todoTimePickerOpen);
    }
    if (todoDateError !== nextState.todoDateError) {
      setTodoDateError(nextState.todoDateError);
    }
  }, [
    setTodoCreateOpen,
    setTodoDateError,
    setTodoDatePickerOpen,
    setTodoDraft,
    setTodoEditingContext,
    setTodoTimePickerOpen,
    todoCreateOpen,
    todoDateError,
    todoDatePickerOpen,
    todoDraft,
    todoEditingContext,
    todoTimePickerOpen,
  ]);

  const openTodoCreate = useCallback(() => {
    setOpenSwipeTodoId(null);
    setTodoEditingContext(null);
    setTodoDraft(createEmptyTodoDraft());
    setTodoCreateOpen(true);
  }, [setOpenSwipeTodoId, setTodoCreateOpen, setTodoDraft, setTodoEditingContext]);

  const closeTodoCreate = useCallback(() => {
    closeTodoComposer();
  }, [closeTodoComposer]);

  const openTodoEdit = useCallback(
    (entry: TodoListEntry) => {
      const target = simpleTodos.find((item) => item.id === entry.todo.id);
      if (!target) {
        return;
      }
      setOpenSwipeTodoId(null);
      setTodoEditingContext({
        todoId: target.id,
        seriesId: entry.seriesId,
        occurrenceDate: entry.occurrenceDate,
        isRecurringSeries: entry.isRecurringSeries,
      });
      setTodoDraft({
        text: target.text,
        memo: target.memo,
        reminderDate: entry.displayDate ?? target.reminderDate ?? "",
        reminderTime: target.reminderTime ?? "",
        repeat: entry.seriesMaster?.repeat ?? target.repeat,
        tags: [...target.tags],
      });
      setTodoCreateOpen(true);
    },
    [
      setOpenSwipeTodoId,
      setTodoCreateOpen,
      setTodoDraft,
      setTodoEditingContext,
      simpleTodos,
    ],
  );

  const addSimpleTodo = useCallback(() => {
    const text = todoDraft.text.trim();
    const item = todoRepository.createTodo({
      text,
      memo: todoDraft.memo.trim(),
      tags: [...todoDraft.tags],
      reminderDate: todoDraft.reminderDate.trim() || null,
      reminderTime: todoDraft.reminderTime.trim() || null,
      repeat: todoDraft.repeat,
    });
    updateSimpleTodos([item, ...simpleTodos]);
    closeTodoComposer();
    void rescheduleTodoNotification(item);
  }, [
    closeTodoComposer,
    rescheduleTodoNotification,
    simpleTodos,
    todoDraft,
    updateSimpleTodos,
  ]);

  const findRecurringSeriesMasterBySeriesId = useCallback(
    (seriesId: string | null) => {
      if (!seriesId) {
        return null;
      }
      return (
        simpleTodos.find(
          (item) => getTodoSeriesId(item) === seriesId && isRecurringSeriesMaster(item),
        ) ?? null
      );
    },
    [simpleTodos],
  );

  const applyTodoEdit = useCallback(
    (scope: TodoEditScope) => {
      if (!todoEditingContext) {
        return;
      }
      const target = simpleTodos.find((item) => item.id === todoEditingContext.todoId);
      if (!target) {
        return;
      }
      const nextText = todoDraft.text.trim();
      const nextMemo = todoDraft.memo.trim();
      const nextReminderDate = todoDraft.reminderDate.trim() || null;
      const nextReminderTime = todoDraft.reminderTime.trim() || null;

      if (
        scope === "single" &&
        todoEditingContext.isRecurringSeries &&
        todoEditingContext.occurrenceDate
      ) {
        if (target.occurrenceDate) {
          const nextItem: SimpleTodoItem = {
            ...target,
            text: nextText,
            memo: nextMemo,
            tags: [...todoDraft.tags],
            reminderDate: nextReminderDate,
            reminderTime: nextReminderTime,
            notificationId: null,
            notificationIds: [],
            isDeleted: false,
          };
          updateSimpleTodos(
            simpleTodos.map((item) => (item.id === target.id ? nextItem : item)),
          );
          closeTodoComposer();
          void rescheduleTodoNotification(nextItem);
          return;
        }

        const seriesId = todoEditingContext.seriesId ?? target.id;
        const overrideItem: SimpleTodoItem = {
          id: nanoid(),
          text: nextText,
          memo: nextMemo,
          tags: [...todoDraft.tags],
          isDone: false,
          createdAt: Date.now(),
          doneAt: null,
          reminderDate: nextReminderDate ?? todoEditingContext.occurrenceDate,
          reminderTime: nextReminderTime,
          repeat: "none",
          notificationId: null,
          notificationIds: [],
          seriesId,
          seriesAnchorDate: getTodoSeriesAnchorDate(target),
          occurrenceDate: todoEditingContext.occurrenceDate,
          isDeleted: false,
        };
        updateSimpleTodos([overrideItem, ...simpleTodos]);
        closeTodoComposer();
        void rescheduleTodoNotification(overrideItem);
        return;
      }

      const seriesMaster =
        findRecurringSeriesMasterBySeriesId(todoEditingContext.seriesId) ??
        (isRecurringSeriesMaster(target) ? target : null);
      const seriesId = getTodoSeriesId(seriesMaster ?? target);

      const nextMaster: SimpleTodoItem = {
        ...(seriesMaster ?? target),
        text: nextText,
        memo: nextMemo,
        tags: [...todoDraft.tags],
        reminderDate: nextReminderDate,
        reminderTime: nextReminderTime,
        repeat: todoDraft.repeat,
        notificationId: null,
        notificationIds: [],
        seriesId:
          todoDraft.repeat !== "none"
            ? seriesId ?? (seriesMaster ?? target).id
            : null,
        seriesAnchorDate: todoDraft.repeat !== "none" ? nextReminderDate : null,
        occurrenceDate: null,
        isDeleted: false,
        isDone: todoDraft.repeat !== "none" ? false : (seriesMaster ?? target).isDone,
        doneAt: todoDraft.repeat !== "none" ? null : (seriesMaster ?? target).doneAt,
      };

      const nextTodos = simpleTodos
        .filter((item) => {
          if (item.id === target.id && target.occurrenceDate) {
            return false;
          }
          if (
            todoDraft.repeat === "none" &&
            seriesId &&
            getTodoSeriesId(item) === seriesId &&
            item.id !== (seriesMaster ?? target).id
          ) {
            return false;
          }
          return true;
        })
        .map((item) => (item.id === nextMaster.id ? nextMaster : item));

      if (!nextTodos.some((item) => item.id === nextMaster.id)) {
        nextTodos.unshift(nextMaster);
      }

      updateSimpleTodos(nextTodos);
      closeTodoComposer();
      void rescheduleTodoNotification(nextMaster);
    },
    [
      closeTodoComposer,
      findRecurringSeriesMasterBySeriesId,
      rescheduleTodoNotification,
      simpleTodos,
      todoDraft,
      todoEditingContext,
      updateSimpleTodos,
    ],
  );

  const toggleTodoDraftTag = useCallback((tag: Tag) => {
    setTodoDraft((prev) => {
      const exists = prev.tags.includes(tag);
      return {
        ...prev,
        tags: exists
          ? prev.tags.filter((item) => item !== tag)
          : [...prev.tags, tag],
      };
    });
  }, [setTodoDraft]);

  const setTodoDraftRepeat = useCallback(
    (repeat: Exclude<SimpleTodoItem["repeat"], "none">) => {
      setTodoDraft((prev) => ({
        ...prev,
        repeat: prev.repeat === repeat ? "none" : repeat,
      }));
    },
    [setTodoDraft],
  );

  const updateSimpleTodo = useCallback(
    (todoId: string, updater: (item: SimpleTodoItem) => SimpleTodoItem) => {
      const target = simpleTodos.find((item) => item.id === todoId);
      if (!target) {
        return;
      }
      const nextItem = updater(target);
      updateSimpleTodos(
        simpleTodos.map((item) => (item.id === todoId ? nextItem : item)),
      );
      if (
        target.reminderDate !== nextItem.reminderDate ||
        target.reminderTime !== nextItem.reminderTime ||
        target.isDone !== nextItem.isDone ||
        target.repeat !== nextItem.repeat ||
        target.notificationIds.join(",") !== nextItem.notificationIds.join(",")
      ) {
        void rescheduleTodoNotification(nextItem);
      }
    },
    [rescheduleTodoNotification, simpleTodos, updateSimpleTodos],
  );

  const toggleSimpleTodoDone = useCallback(
    (entry: TodoListEntry) => {
      if (openSwipeTodoId === entry.todo.id) {
        setOpenSwipeTodoId(null);
        return;
      }
      if (entry.isRecurringSeries && entry.occurrenceDate) {
        if (entry.todo.occurrenceDate) {
          updateSimpleTodo(entry.todo.id, (item) => ({
            ...item,
            isDone: !item.isDone,
            doneAt: item.isDone ? null : Date.now(),
          }));
          return;
        }
        const overrideItem: SimpleTodoItem = {
          id: nanoid(),
          text: entry.todo.text,
          memo: entry.todo.memo,
          tags: [...entry.todo.tags],
          isDone: true,
          createdAt: Date.now(),
          doneAt: Date.now(),
          reminderDate: entry.displayDate,
          reminderTime: entry.displayTime,
          repeat: "none",
          notificationId: null,
          notificationIds: [],
          seriesId: entry.seriesId,
          seriesAnchorDate: getTodoSeriesAnchorDate(entry.todo),
          occurrenceDate: entry.occurrenceDate,
          isDeleted: false,
        };
        updateSimpleTodos([overrideItem, ...simpleTodos]);
        void rescheduleTodoNotification(overrideItem);
        return;
      }
      updateSimpleTodo(entry.todo.id, (item) => ({
        ...item,
        isDone: !item.isDone,
        doneAt: item.isDone ? null : Date.now(),
      }));
    },
    [
      openSwipeTodoId,
      rescheduleTodoNotification,
      setOpenSwipeTodoId,
      simpleTodos,
      updateSimpleTodo,
      updateSimpleTodos,
    ],
  );

  const deleteSimpleTodo = useCallback(
    (entry: TodoListEntry, scope: TodoEditScope = "series") => {
      const target = simpleTodos.find((item) => item.id === entry.todo.id);
      if (!target) {
        return;
      }
      if (scope === "single" && entry.isRecurringSeries && entry.occurrenceDate) {
        if (target.occurrenceDate) {
          void cancelTodoNotifications(getTodoNotificationIds(target));
          updateSimpleTodos(simpleTodos.filter((item) => item.id !== target.id));
          setOpenSwipeTodoId((prev) => (prev === target.id ? null : prev));
          return;
        }
        const deletedOverride: SimpleTodoItem = {
          id: nanoid(),
          text: target.text,
          memo: target.memo,
          tags: [...target.tags],
          isDone: false,
          createdAt: Date.now(),
          doneAt: null,
          reminderDate: entry.displayDate,
          reminderTime: entry.displayTime,
          repeat: "none",
          notificationId: null,
          notificationIds: [],
          seriesId: entry.seriesId,
          seriesAnchorDate: getTodoSeriesAnchorDate(target),
          occurrenceDate: entry.occurrenceDate,
          isDeleted: true,
        };
        updateSimpleTodos([deletedOverride, ...simpleTodos]);
        setOpenSwipeTodoId((prev) => (prev === target.id ? null : prev));
        return;
      }
      const seriesId = getTodoSeriesId(target);
      const removedItems = simpleTodos.filter((item) => {
        if (item.id === target.id) {
          return true;
        }
        return Boolean(
          seriesId &&
            isRecurringSeriesMaster(target) &&
            getTodoSeriesId(item) === seriesId,
        );
      });
      void Promise.all(
        removedItems.map((item) =>
          cancelTodoNotifications(getTodoNotificationIds(item)),
        ),
      );
      updateSimpleTodos(
        simpleTodos.filter(
          (item) => !removedItems.some((removed) => removed.id === item.id),
        ),
      );
      setOpenSwipeTodoId((prev) => (prev === target.id ? null : prev));
    },
    [cancelTodoNotifications, setOpenSwipeTodoId, simpleTodos, updateSimpleTodos],
  );

  return {
    openTodoCreate,
    closeTodoCreate,
    openTodoEdit,
    addSimpleTodo,
    applyTodoEdit,
    toggleTodoDraftTag,
    setTodoDraftRepeat,
    toggleSimpleTodoDone,
    deleteSimpleTodo,
  };
};
