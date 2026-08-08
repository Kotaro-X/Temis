import assert from "node:assert/strict";
import test from "node:test";

import { ensureSyncAuthToken } from "../src/services/sync/syncAuth.ts";

test("sync waits for a non-empty Firebase ID token", async () => {
  let requested = false;

  await ensureSyncAuthToken(async () => {
    requested = true;
    return "firebase-id-token";
  });

  assert.equal(requested, true);
});

test("sync treats an empty Firebase ID token as an authentication failure", async () => {
  await assert.rejects(
    () => ensureSyncAuthToken(async () => ""),
    /Authentication required before Cloud Sync/,
  );
});
