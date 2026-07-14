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
import { createSyncRunDiagnosticContext } from "./syncTelemetry";

let inflightSync: Promise<SyncResult> | null = null;

export const runCloudSync = async (): Promise<SyncResult> => {
  if (inflightSync) {
    return inflightSync;
  }
  inflightSync = (async () => {
    try {
      await maybeRefreshWeeklyPrompts();
      const identity = await getSyncIdentity();
      const diagnosticContext = await createSyncRunDiagnosticContext(
        identity.userId,
      );
      if (!isFirebaseConfigured()) {
        throw new Error(createFirebaseConfigErrorMessage(process.env));
      }
      const syncJobs = [
        ["tag", syncTagRecords],
        ["todo", syncTodoRecords],
        ["task", syncTaskRecords],
        ["memo", syncMemoRecords],
      ] as const;
      const summaries: string[] = [];
      const errors: unknown[] = [];
      for (const [entityType, syncEntity] of syncJobs) {
        try {
          const result = await syncEntity(identity, diagnosticContext);
          summaries.push(
            `${entityType} pushed=${result.pushed} pulled=${result.pulled}`,
          );
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        return mapSyncError(errors[0]);
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
