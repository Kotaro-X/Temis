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
      const syncJobs = [
        ["tag", syncTagRecords],
        ["todo", syncTodoRecords],
        ["task", syncTaskRecords],
        ["memo", syncMemoRecords],
      ] as const;
      const summaries: string[] = [];
      const errors: string[] = [];
      for (const [entityType, syncEntity] of syncJobs) {
        try {
          const result = await syncEntity(identity);
          summaries.push(
            `${entityType} pushed=${result.pushed} pulled=${result.pulled}`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${entityType}: ${message}`);
        }
      }
      if (errors.length > 0) {
        throw new Error(errors.join(" | "));
      }
      return mapSyncSuccess(
        summaries.join(" | "),
      );
    } catch (error) {
      return mapSyncError(error);
    } finally {
      inflightSync = null;
    }
  })();
  return inflightSync;
};
