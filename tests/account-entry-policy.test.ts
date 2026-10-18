import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadAccountEntryState, saveAccountEntryState } from "../src/services/auth/accountEntryPolicy.ts";

function fixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  let failedKey: string | null = null;
  const storage = { getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { if (key === failedKey) throw new Error("disk"); values.set(key, value); } };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("src/services/auth/accountEntry.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if ((name === "@react-native-async-storage/async-storage" || name === "../account/accountWorkspace")) return storage;
    if (name === "./accountEntryPolicy") return { loadAccountEntryState, saveAccountEntryState };
    throw new Error(name);
  } });
  return { values, entry: exports, failWrite: (key: string | null) => { failedKey = key; } };
}

test("fresh install offers sign-in; skipping retains automatic restore for later login", async () => {
  const { values, entry } = fixture();
  const state = await entry.readAccountEntry();
  assert.equal(state.completed, false);
  assert.equal(state.autoEnableSync, true);
  await entry.updateAccountEntry((current: any) => ({ ...current, completed: true }));
  values.set("appLanguage", "ja");
  assert.equal(await entry.completeAccountLogin(), true);
  assert.equal(values.get("cloudSyncEnabled"), "true");
  assert.equal((await entry.readAccountEntry()).autoEnableSync, false);
});

test("explicit sync OFF survives login and repeated account restoration", async () => {
  const { values, entry } = fixture();
  await entry.readAccountEntry();
  values.set("cloudSyncEnabled", "false");
  assert.equal(await entry.completeAccountLogin(), false);
  assert.equal(await entry.completeAccountLogin(), false);
  assert.equal(values.get("cloudSyncEnabled"), "false");
});

test("existing installations preserve their current entry and sync preferences", async () => {
  const installations: Record<string, string>[] = [{ appLanguage: "ja" }, { cloudSyncEnabled: "false" }, { cloudSyncEnabled: "true" }];
  for (const initial of installations) {
    const { values, entry } = fixture(initial);
    const state = await entry.readAccountEntry();
    assert.equal(state.completed, true);
    assert.equal(state.autoEnableSync, false);
    await entry.completeAccountLogin();
    assert.equal(values.get("cloudSyncEnabled"), initial.cloudSyncEnabled);
  }
});

test("failed completion leaves automatic restore retryable", async () => {
  const f = fixture();
  await f.entry.readAccountEntry();
  f.failWrite("cloudSyncEnabled");
  await assert.rejects(f.entry.completeAccountLogin(), /disk/);
  assert.equal((await f.entry.readAccountEntry()).autoEnableSync, true);
  // Retry after a restart with the previously committed entry state.
  const restarted = fixture(Object.fromEntries(f.values));
  assert.equal((await restarted.entry.readAccountEntry()).autoEnableSync, true);
  await restarted.entry.completeAccountLogin();
  assert.equal(restarted.values.get("cloudSyncEnabled"), "true");
});
