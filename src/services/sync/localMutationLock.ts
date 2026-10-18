import type { SyncEntityType } from "../../types/sync";
import { getWorkspaceEpoch } from "../account/workspaceEpoch.ts";

/** Only local reads/writes are serialized. Never hold this during network I/O. */
const tails = new Map<SyncEntityType, Promise<unknown>>();
export const withLocalEntityMutation = <T>(entity: SyncEntityType, operation: () => Promise<T>): Promise<T> => {
  const generation = getWorkspaceEpoch();
  const guarded = () => {
    if (generation !== getWorkspaceEpoch()) throw new Error("アカウントが切り替わりました。もう一度お試しください。");
    return operation();
  };
  const result = (tails.get(entity) ?? Promise.resolve()).then(guarded, guarded);
  tails.set(entity, result.catch(() => {}));
  return result;
};

/** Switching stores waits for all local writes, including queued offline edits. */
export const withAllLocalEntityMutations = <T>(operation: () => Promise<T>): Promise<T> =>
  withLocalEntityMutation("tag", () => withLocalEntityMutation("task", () =>
    withLocalEntityMutation("todo", () => withLocalEntityMutation("memo", () =>
      withSyncStoreMutation(operation)))));

let queueTail: Promise<unknown> = Promise.resolve();
export const withSyncStoreMutation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = queueTail.then(operation, operation);
  queueTail = result.catch(() => {});
  return result;
};
