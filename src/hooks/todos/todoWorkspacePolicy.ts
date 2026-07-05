import {
  createEmptyTodoDraft,
  type TodoDraft,
  type TodoEditContext,
} from "./todoWorkspaceUtils.ts";

export type TodoComposerState = {
  todoCreateOpen: boolean;
  todoEditingContext: TodoEditContext | null;
  todoDraft: TodoDraft;
  todoDatePickerOpen: boolean;
  todoTimePickerOpen: boolean;
  todoDateError: string | null;
};

export type TodoWorkspaceDeactivationState = TodoComposerState & {
  openSwipeTodoId: string | null;
};

export const createClosedTodoComposerState = (): TodoComposerState => ({
  todoCreateOpen: false,
  todoEditingContext: null,
  todoDraft: createEmptyTodoDraft(),
  todoDatePickerOpen: false,
  todoTimePickerOpen: false,
  todoDateError: null,
});

export const isTodoDraftEmpty = (draft: TodoDraft): boolean =>
  draft.text.length === 0 &&
  draft.memo.length === 0 &&
  draft.reminderDate.length === 0 &&
  draft.reminderTime.length === 0 &&
  draft.repeat === "none" &&
  draft.tags.length === 0;

export const isTodoComposerClosed = (state: TodoComposerState): boolean =>
  !state.todoCreateOpen &&
  state.todoEditingContext === null &&
  !state.todoDatePickerOpen &&
  !state.todoTimePickerOpen &&
  state.todoDateError === null &&
  isTodoDraftEmpty(state.todoDraft);

export const applyTodoWorkspaceDeactivationPolicy = <
  T extends TodoWorkspaceDeactivationState,
>(
  state: T,
): T => ({
  ...state,
  ...createClosedTodoComposerState(),
  openSwipeTodoId: null,
});
