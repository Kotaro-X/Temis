import type { SyncEntityType } from "../../types/sync";

/** Only local reads/writes are serialized. Never hold this during network I/O. */
const tails = new Map<SyncEntityType, Promise<unknown>>();
export const withLocalEntityMutation = <T>(entity: SyncEntityType, operation: () => Promise<T>): Promise<T> => {
  const result = (tails.get(entity) ?? Promise.resolve()).then(operation, operation);
  tails.set(entity, result.catch(() => {}));
  return result;
};

let queueTail: Promise<unknown> = Promise.resolve();
export const withSyncStoreMutation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = queueTail.then(operation, operation);
  queueTail = result.catch(() => {});
  return result;
};
