import type { SyncResult } from "../../types";

export const mapSyncSuccess = (message?: string): SyncResult => ({
  status: "synced",
  syncedAt: Date.now(),
  message,
});

export const mapSyncError = (error: unknown): SyncResult => ({
  status: "error",
  syncedAt: Date.now(),
  message: error instanceof Error ? error.message : String(error),
});
