export type StaffAccessGrant = {
  active: boolean;
  grantType: string;
  expiresAt: number | null;
} | null | undefined;

export const hasStaffFreeAccess = (
  grant: StaffAccessGrant,
  now = Date.now(),
): boolean =>
  grant?.active === true &&
  grant.grantType === "staff_free" &&
  (grant.expiresAt === null || grant.expiresAt > now);
