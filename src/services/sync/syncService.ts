import { maybeRefreshWeeklyPrompts } from "../weeklyPromptsSync";
import type { SyncResult } from "../../types";
import { mapSyncError, mapSyncSuccess } from "./syncMapper";
import { isFirebaseConfigured } from "./firebaseApp";
import { createFirebaseConfigErrorMessage } from "./firebaseConfig";
import { getSyncIdentity } from "./syncIdentity";
import { syncMemoRecords } from "./memoSync";
import { syncTagRecords } from "./tagSync";
import { syncTaskRecords } from "./taskSync";
import { syncTodoRecords } from "./todoSync";

let inflightSync: Promise<SyncResult> | null = null;

export const runCloudSync = async (): Promise<SyncResult> => {
  if (inflightSync) {
    return inflightSync;
  }
  inflightSync = (async () => {
    try {
      await maybeRefreshWeeklyPrompts();
      if (!isFirebaseConfigured()) {
        throw new Error(createFirebaseConfigErrorMessage(process.env));
      }
      const identity = await getSyncIdentity();
      const tagResult = await syncTagRecords(identity);
      const todoResult = await syncTodoRecords(identity);
      const taskResult = await syncTaskRecords(identity);
      const memoResult = await syncMemoRecords(identity);
      return mapSyncSuccess(
        [
          `tag pushed=${tagResult.pushed} pulled=${tagResult.pulled}`,
          `todo pushed=${todoResult.pushed} pulled=${todoResult.pulled}`,
          `task pushed=${taskResult.pushed} pulled=${taskResult.pulled}`,
          `memo pushed=${memoResult.pushed} pulled=${memoResult.pulled}`,
        ].join(" | "),
      );
    } catch (error) {
      return mapSyncError(error);
    } finally {
      inflightSync = null;
    }
  })();
  return inflightSync;
};
