export type EditorSelection = {
  start: number;
  end: number;
};

export type PendingSelectionRequest = {
  expectedValue: string;
  selection: EditorSelection;
};

export const clampEditorSelection = (
  selection: EditorSelection,
  textLength: number,
): EditorSelection => {
  const safeLength = Math.max(0, textLength);
  const start = Math.max(
    0,
    Math.min(selection.start, selection.end, safeLength),
  );
  const end = Math.max(
    start,
    Math.min(Math.max(selection.start, selection.end), safeLength),
  );

  return { start, end };
};

export const selectionsMatch = (
  left: EditorSelection,
  right: EditorSelection,
) => left.start === right.start && left.end === right.end;

export const shouldAcceptNativeSelection = (
  next: EditorSelection,
  pending: PendingSelectionRequest | null,
) => !pending || selectionsMatch(next, pending.selection);
