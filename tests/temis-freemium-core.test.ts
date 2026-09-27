import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const accessCore = require("../functions/temisAccessCore.cjs") as {
  AI_WEEKLY_LIMIT: number;
  getJstWeek: (now: number) => { weekKey: string; weekStartsAt: number; resetsAt: number };
  isActiveUnlimitedGrant: (grant: unknown, now: number) => boolean;
};
const projectCore = require("../functions/projectAccessCore.cjs") as {
  membershipStateFor: (input: {
    uid: string;
    memberships: { projectId: string }[];
    access: { tier: "free" | "plus" };
    previous: { pendingFreeProjectId?: string | null } | null;
    now: number;
  }) => {
    status: "ready" | "selection_required";
    membershipCount: number;
    freeProjectId: string | null;
    pendingFreeProjectId: string | null;
  };
};

test("Temis AI uses one shared ten-use week beginning Monday 00:00 JST", () => {
  assert.equal(accessCore.AI_WEEKLY_LIMIT, 10);
  const sunday = accessCore.getJstWeek(Date.parse("2026-09-27T14:59:59.999Z"));
  const monday = accessCore.getJstWeek(Date.parse("2026-09-27T15:00:00.000Z"));
  assert.equal(sunday.weekKey, "2026-09-21");
  assert.equal(monday.weekKey, "2026-09-28");
  assert.equal(monday.weekStartsAt, Date.parse("2026-09-27T15:00:00.000Z"));
  assert.equal(monday.resetsAt, Date.parse("2026-10-04T15:00:00.000Z"));
});

test("only active staff_free and invite_free grants are unlimited", () => {
  const now = Date.parse("2026-09-26T00:00:00.000Z");
  assert.equal(accessCore.isActiveUnlimitedGrant({ active: true, grantType: "staff_free", expiresAt: null }, now), true);
  assert.equal(accessCore.isActiveUnlimitedGrant({ active: true, grantType: "invite_free", expiresAt: now + 1 }, now), true);
  assert.equal(accessCore.isActiveUnlimitedGrant({ active: true, grantType: "invite_discount", expiresAt: null }, now), false);
  assert.equal(accessCore.isActiveUnlimitedGrant({ active: true, grantType: "staff_free", expiresAt: now }, now), false);
});

test("free project state auto-selects zero or one membership and requires selection above one", () => {
  const base = { uid: "user", access: { tier: "free" as const }, previous: null, now: 1 };
  assert.deepEqual(projectCore.membershipStateFor({ ...base, memberships: [] }), {
    userId: "user", status: "ready", membershipCount: 0, freeProjectId: null, pendingFreeProjectId: null, updatedAt: 1,
  });
  assert.equal(projectCore.membershipStateFor({ ...base, memberships: [{ projectId: "p1" }] }).freeProjectId, "p1");
  const overflow = projectCore.membershipStateFor({ ...base, memberships: [{ projectId: "p1" }, { projectId: "p2" }] });
  assert.equal(overflow.status, "selection_required");
  assert.equal(overflow.freeProjectId, null);
});

test("Plus project state remains ready with unlimited memberships", () => {
  const state = projectCore.membershipStateFor({
    uid: "plus",
    memberships: [{ projectId: "p1" }, { projectId: "p2" }],
    access: { tier: "plus" },
    previous: null,
    now: 2,
  });
  assert.equal(state.status, "ready");
  assert.equal(state.membershipCount, 2);
  assert.equal(state.freeProjectId, null);
});
