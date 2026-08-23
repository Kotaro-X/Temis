export type CloudSyncGrantState = {
  active: boolean;
  expiresAt: number | null;
};

export const isCloudSyncGrantStateActive = (
  grant: CloudSyncGrantState | null | undefined,
  now = Date.now(),
): boolean => grant?.active === true && (grant.expiresAt === null || grant.expiresAt > now);

/** Keep an already valid grant during a transient entitlement refresh failure. */
export const retainActiveCloudSyncGrantOnRefreshFailure = <
  Grant extends CloudSyncGrantState,
>(
  grant: Grant | null | undefined,
  now = Date.now(),
): Grant | null => isCloudSyncGrantStateActive(grant, now) ? grant ?? null : null;
