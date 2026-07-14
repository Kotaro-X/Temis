import type { SyncResult } from "../../types";
import {
  classifySyncError,
  createUserFacingSyncError,
} from "./syncDiagnostics";

export const mapSyncSuccess = (message?: string): SyncResult => ({
  status: "synced",
  syncedAt: Date.now(),
  message,
  initialSyncCompleted: true,
});

export const mapSyncError = (error: unknown): SyncResult => {
  const classified = classifySyncError(error, "sync_failed");
  return {
    status: "error",
    syncedAt: Date.now(),
    message: createUserFacingSyncError(classified),
    errorCode: classified.errorCode,
    initialSyncCompleted: false,
  };
};
