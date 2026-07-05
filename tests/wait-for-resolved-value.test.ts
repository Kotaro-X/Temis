import test from "node:test";
import assert from "node:assert/strict";

import { waitForResolvedValue } from "../src/services/auth/waitForResolvedValue.ts";

test("waitForResolvedValue returns the first non-null value from retries", async () => {
  let attempts = 0;

  const resolved = await waitForResolvedValue(
    async () => {
      attempts += 1;
      return attempts >= 3 ? "signed-in-user" : null;
    },
    {
      attempts: 4,
      delayMs: 1,
      sleep: async () => {},
    },
  );

  assert.equal(resolved, "signed-in-user");
  assert.equal(attempts, 3);
});

test("waitForResolvedValue rethrows the last error after retries are exhausted", async () => {
  const expected = new Error("temporary auth failure");
  let attempts = 0;

  await assert.rejects(
    waitForResolvedValue(
      async () => {
        attempts += 1;
        throw expected;
      },
      {
        attempts: 3,
        delayMs: 1,
        sleep: async () => {},
      },
    ),
    expected,
  );

  assert.equal(attempts, 3);
});
