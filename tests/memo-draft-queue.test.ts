import test from "node:test";
import assert from "node:assert/strict";
import { MemoDraftQueue } from "../src/services/collaboration/memoDraftQueue.ts";
const draft = (body: string) => ({ title: "", body });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }

test("new empty and unchanged existing memos do not write", async () => {
  let calls = 0;
  await new MemoDraftQueue(draft(""), async () => { calls++; }, () => true, true).flush();
  await new MemoDraftQueue(draft("saved"), async () => { calls++; }, () => true).flush();
  assert.equal(calls, 0);
});
test("overlapping saves serialize and flush awaits the latest input", async () => {
  const gate = deferred(); const writes: string[] = []; let concurrent = 0; let max = 0;
  const queue = new MemoDraftQueue(draft(""), async current => { concurrent++; max = Math.max(max, concurrent); writes.push(current.body); if (writes.length === 1) await gate.promise; concurrent--; }, () => true, true);
  queue.update(draft("first")); const first = queue.flush();
  queue.update(draft("second")); queue.update(draft("latest")); const second = queue.flush();
  assert.equal(first, second); gate.resolve(); await second;
  assert.deepEqual(writes, ["first", "latest"]); assert.equal(max, 1);
});
test("failed saves keep the latest draft and retry without changing session", async () => {
  let fail = true; const writes: string[] = [];
  const queue = new MemoDraftQueue(draft("old"), async current => { if (fail) throw new Error("offline"); writes.push(current.body); }, () => true);
  queue.update(draft("edited")); await assert.rejects(queue.flush(), /offline/);
  fail = false; await queue.flush(); await queue.flush(); assert.deepEqual(writes, ["edited"]);
});
test("account switch or deletion prevents the next async save stage", async () => {
  for (const invalidation of ["account", "delete"]) {
    const gate = deferred(); let valid = true; let mirrored = false;
    const queue = new MemoDraftQueue(draft(""), async (_current, assertActive) => { await gate.promise; assertActive(); mirrored = true; }, () => valid, true);
    queue.update(draft("first")); const pending = queue.flush();
    if (invalidation === "account") valid = false; else queue.invalidate();
    queue.update(draft("late")); gate.resolve(); await assert.rejects(pending); assert.equal(mirrored, false);
  }
});

test("resuming after a rejected delete cannot revive an old in-flight generation", async () => {
  const gate = deferred(); let stages = 0;
  const queue = new MemoDraftQueue(draft(""), async (_current, assertActive) => { await gate.promise; assertActive(); stages++; }, () => true, true);
  queue.update(draft("edited")); const pending = queue.flush(); queue.invalidate(); queue.resume(); gate.resolve();
  await assert.rejects(pending); assert.equal(stages, 0); await queue.flush(); assert.equal(stages, 1);
});
