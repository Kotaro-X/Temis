import test from "node:test";
import assert from "node:assert/strict";
import { createTaskMemoAutosave } from "../src/hooks/tasks/taskMemoAutosave.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test("loading existing memo does not write it; input is gated until loaded", async () => {
  const gate = deferred();
  const writes: string[] = [];
  const draft = createTaskMemoAutosave({ taskId: "a", load: async () => {
    await gate.promise;
    return { body: "existing" };
  }, save: async (_, body) => { writes.push(body); }, onSaved() {} });
  const load = draft.load();
  draft.setBody("too early");
  gate.resolve();
  await load;
  await draft.flush();
  assert.equal(draft.getSnapshot().body, "existing");
  assert.deepEqual(writes, []);
});

test("800ms debounce writes only the latest input", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const writes: string[] = [];
  const draft = createTaskMemoAutosave({ taskId: "a", load: async () => null,
    save: async (_, body) => { writes.push(body); }, onSaved() {} });
  await draft.load();
  draft.setBody("first");
  t.mock.timers.tick(500);
  draft.setBody("latest");
  t.mock.timers.tick(799);
  assert.deepEqual(writes, []);
  t.mock.timers.tick(1);
  await draft.flush();
  assert.deepEqual(writes, ["latest"]);
});

test("edits during a pending write are drained serially, including on exit", async () => {
  const gate = deferred();
  const writes: string[] = [];
  let notifications = 0;
  const draft = createTaskMemoAutosave({ taskId: "a", load: async () => null,
    save: async (_, body) => { writes.push(body); if (writes.length === 1) await gate.promise; },
    onSaved() { notifications++; } });
  await draft.load();
  draft.setBody("first");
  const pending = draft.flush();
  draft.setBody("second");
  draft.setBody("latest");
  const exit = draft.flush();
  assert.deepEqual(writes, ["first"]);
  gate.resolve();
  await Promise.all([pending, exit]);
  assert.deepEqual(writes, ["first", "latest"]);
  assert.equal(notifications, 2);
});

test("immediate exit and task switch save drafts under their original IDs", async () => {
  const writes: [string, string][] = [];
  const make = (taskId: string) => createTaskMemoAutosave({ taskId, load: async () => null,
    save: async (id, body) => { writes.push([id, body]); }, onSaved() {} });
  const a = make("a"); const b = make("b");
  await a.load();
  a.setBody("memo A");
  const exitA = a.flush();
  await b.load();
  b.setBody("memo B");
  await Promise.all([exitA, b.flush()]);
  assert.deepEqual(writes, [["a", "memo A"], ["b", "memo B"]]);
});

test("clearing the whole memo persists an empty string", async () => {
  const writes: string[] = [];
  const draft = createTaskMemoAutosave({ taskId: "a", load: async () => ({ body: "existing" }),
    save: async (_, body) => { writes.push(body); }, onSaved() {} });
  await draft.load(); draft.setBody(""); await draft.flush();
  assert.deepEqual(writes, [""]);
});

test("returning to the original body while a write is pending still restores it", async () => {
  const gate = deferred();
  const writes: string[] = [];
  const draft = createTaskMemoAutosave({ taskId: "a", load: async () => ({ body: "original" }),
    save: async (_, body) => { writes.push(body); if (writes.length === 1) await gate.promise; }, onSaved() {} });
  await draft.load(); draft.setBody("temporary");
  const pending = draft.flush();
  draft.setBody("original");
  const exit = draft.flush(); gate.resolve();
  await Promise.all([pending, exit]);
  assert.deepEqual(writes, ["temporary", "original"]);
});

test("load failure cannot replace stored data with a blank memo; retry reloads", async () => {
  let fail = true; let writes = 0;
  const draft = createTaskMemoAutosave({ taskId: "a", load: async () => {
    if (fail) throw new Error("load failed"); return { body: "stored" };
  }, save: async () => { writes++; }, onSaved() {} });
  await draft.load(); draft.setBody("overwrite"); await draft.flush();
  assert.equal(draft.getSnapshot().error, "load"); assert.equal(writes, 0);
  fail = false; await draft.retry();
  assert.equal(draft.getSnapshot().body, "stored");
  assert.equal(draft.getSnapshot().error, null);
});

test("save failure retains newest draft across reload and retry", async () => {
  let fail = true; const writes: string[] = [];
  const draft = createTaskMemoAutosave({ taskId: "a", load: async () => ({ body: "old" }),
    save: async (_, body) => { if (fail) throw new Error("disk"); writes.push(body); }, onSaved() {} });
  await draft.load(); draft.setBody("latest"); await draft.flush();
  assert.equal(draft.getSnapshot().error, "save");
  await draft.load(); assert.equal(draft.getSnapshot().body, "latest");
  fail = false; await draft.retry();
  assert.deepEqual(writes, ["latest"]); assert.equal(draft.getSnapshot().error, null);
});

test("reopening a clean draft reads edits made through the memo tab", async () => {
  let stored = "original";
  const draft = createTaskMemoAutosave({ taskId: "a", load: async () => ({ body: stored }),
    save: async (_, body) => { stored = body; }, onSaved() {} });
  await draft.load(); draft.setBody("task edit"); await draft.flush();
  stored = "memo tab edit"; await draft.load();
  assert.equal(draft.getSnapshot().body, "memo tab edit");
});
