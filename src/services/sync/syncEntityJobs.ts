import type { SyncEntityType } from "../../types/sync";

/** Notify after each entity, even after a partial pull. Never remount the app. */
export const runSyncEntityJobs = async (
  jobs: readonly (readonly [SyncEntityType, () => Promise<{ pushed: number; pulled: number }>])[],
  onEntitySynced?: (entity: SyncEntityType) => Promise<void> | void,
) => {
  const summaries: string[] = [];
  const errors: unknown[] = [];
  for (const [entity, job] of jobs) {
    try {
      const result = await job();
      summaries.push(`${entity} pushed=${result.pushed} pulled=${result.pulled}`);
    } catch (error) {
      errors.push(error);
    }
    try {
      await onEntitySynced?.(entity);
    } catch (error) {
      // Refresh failure is visible as a sync error, without losing later jobs.
      errors.push(error);
    }
  }
  return { summaries, errors };
};
