import { maybeRefreshWeeklyPrompts } from "../weeklyPromptsSync";
import type { SyncEntityType, SyncResult } from "../../types";
import { runSyncEntityJobs } from "./syncEntityJobs";
import { mapSyncError, mapSyncSuccess } from "./syncMapper";
import { isFirebaseConfigured } from "./firebaseApp";
import {
  createFirebaseConfigErrorMessage,
  getFirebaseRuntimeEnv,
} from "./firebaseConfig";
import { getSyncIdentity } from "./syncIdentity";
import { syncMemoRecords } from "./memoSync";
import { syncTagRecords } from "./tagSync";
import { syncTaskRecords } from "./taskSync";
import { syncTodoRecords } from "./todoSync";
import { createSyncRunDiagnosticContext } from "./syncTelemetry";

let inflightSync: Promise<SyncResult> | null = null;

export const runCloudSync = async (
  onEntitySynced?: (entity: SyncEntityType) => Promise<void> | void,
): Promise<SyncResult> => {
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
        throw new Error(
          createFirebaseConfigErrorMessage(getFirebaseRuntimeEnv()),
        );
      }
      const syncJobs = [
        ["tag", syncTagRecords],
        ["todo", syncTodoRecords],
        ["task", syncTaskRecords],
        ["memo", syncMemoRecords],
      ] as const;
      const { summaries, errors } = await runSyncEntityJobs(
        syncJobs.map(([entity, syncEntity]) => [entity, () => syncEntity(identity, diagnosticContext)] as const),
        onEntitySynced,
      );
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
