import type { SyncQueueItem } from "../../types/sync";

/** A network response may acknowledge an old revision, not a new local edit. */
export const reconcileProcessedQueue = (before: SyncQueueItem[], processed: SyncQueueItem[], current: SyncQueueItem[]) => {
  const original = new Map(before.map((item) => [item.id, JSON.stringify(item)]));
  const remaining = new Map(processed.map((item) => [item.id, item]));
  return current.flatMap((item) => {
    if (original.get(item.id) !== JSON.stringify(item)) return [item];
    const retry = remaining.get(item.id);
    return retry ? [retry] : [];
  });
};
