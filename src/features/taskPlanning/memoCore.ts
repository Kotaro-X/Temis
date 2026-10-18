export const occurrenceMemoTaskId = (taskId: string, occurrenceDate: string) => `${taskId}@${occurrenceDate}`;
export function taskMemoBody(specific: { body: string } | null, legacyOverride: string | undefined, master: { body: string } | null) {
  // Empty text is an intentional edit, not a reason to restore an older memo.
  return specific?.body ?? legacyOverride ?? master?.body ?? '';
}
