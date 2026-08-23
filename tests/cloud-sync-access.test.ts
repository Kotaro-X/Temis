import assert from "node:assert/strict";
import test from "node:test";

import {
  hasStaffFreeAccess,
  type StaffAccessGrant,
} from "../src/services/subscription/staffAccess.ts";
import {
  retainActiveCloudSyncGrantOnRefreshFailure,
} from "../src/services/subscription/cloudSyncAccessState.ts";

const staffGrant = (overrides: Partial<Exclude<StaffAccessGrant, null | undefined>> = {}): Exclude<StaffAccessGrant, null | undefined> => ({
  active: true,
  grantType: "staff_free",
  expiresAt: null,
  ...overrides,
});

test("only active staff_free grants unlock the Guild operations screen", () => {
  assert.equal(hasStaffFreeAccess(staffGrant()), true);
  assert.equal(hasStaffFreeAccess(staffGrant({ active: false })), false);
  assert.equal(hasStaffFreeAccess(staffGrant({ expiresAt: Date.now() - 1 })), false);
  assert.equal(hasStaffFreeAccess(staffGrant({ grantType: "invite_free" })), false);
});

test("a temporary access-grant refresh failure keeps only an active grant", () => {
  const now = 1_786_000_000_000;
  const grant = {
    active: true,
    expiresAt: now + 60_000,
  };

  assert.equal(retainActiveCloudSyncGrantOnRefreshFailure(grant, now), grant);
  assert.equal(
    retainActiveCloudSyncGrantOnRefreshFailure({ ...grant, expiresAt: now }, now),
    null,
  );
  assert.equal(retainActiveCloudSyncGrantOnRefreshFailure(null, now), null);
});
