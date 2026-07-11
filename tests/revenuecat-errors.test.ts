import test from "node:test";
import assert from "node:assert/strict";

import {
  isRevenueCatPurchaseCancelledError,
  shouldSuppressRevenueCatLog,
} from "../src/services/subscription/revenueCatErrors.ts";

test("purchase cancelled error is treated as a non-error path", () => {
  assert.equal(
    isRevenueCatPurchaseCancelledError({
      code: "1",
      message: "Purchase was cancelled.",
      userCancelled: true,
    }),
    true,
  );
});

test("non-cancelled RevenueCat error stays actionable", () => {
  assert.equal(
    isRevenueCatPurchaseCancelledError({
      code: "2",
      message: "Network error.",
      userCancelled: false,
    }),
    false,
  );
});

test("cancelled RevenueCat error log is suppressed", () => {
  assert.equal(
    shouldSuppressRevenueCatLog("ERROR", "Purchase was cancelled."),
    true,
  );
  assert.equal(
    shouldSuppressRevenueCatLog("WARN", "Purchase was cancelled."),
    false,
  );
});
