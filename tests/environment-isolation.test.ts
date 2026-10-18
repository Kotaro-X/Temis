import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createAccountWorkspaceStore } from '../src/services/account/accountWorkspaceCore.ts';
import { updateEnvironmentRuntime, captureEnvironmentIdentity, assertEnvironmentIdentity, assertEnvironmentReady } from '../src/services/environment/runtimeEnvironment.ts';
import { registerEnvironmentSaveHandler, saveEnvironmentDrafts } from '../src/services/environment/switchLifecycle.ts';
const fixture = () => {
  const values = new Map<string,string>([['simpleTodos', 'production guest'], ['cloudSyncEnabled', 'false']]);
  let environment = 'production'; let epoch = 0;
  const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key,value); }, getAllKeys: async () => [...values.keys()], multiRemove: async (keys: string[]) => { keys.forEach(key=>values.delete(key)); } };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/services/account/accountWorkspace.ts','utf8'),{ compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, { exports, require: (name: string) => {
    if (name === '@react-native-async-storage/async-storage') return storage;
    if (name === './accountWorkspaceCore') return { createAccountWorkspaceStore };
    if (name === './workspaceEpoch') return { advanceWorkspaceEpoch: () => {} };
    if (name === '../environment/runtimeEnvironment') return { isTestEnvironment: () => environment === 'test', getEnvironmentEpoch: () => epoch };
    throw Error(name);
  } });
  return { values, workspace: exports.accountWorkspace, storage: exports.default, switch: (next: string) => { environment = next; epoch++; } };
};
test('same UID across environments cannot share guest data, queues, drafts, settings, or DB scope', async () => {
  const f=fixture(); await f.workspace.initialize(); await f.workspace.bind('same-uid');
  await f.storage.setItem('syncQueue','production queue'); await f.storage.setItem('environment-draft:memo','production draft');
  const productionScope=f.workspace.scope();
  f.switch('test'); await f.workspace.initialize(); await f.workspace.bind('same-uid');
  assert.notEqual(f.workspace.scope(),productionScope);
  for(const key of ['simpleTodos','syncQueue','environment-draft:memo','cloudSyncEnabled']) assert.equal(await f.storage.getItem(key),null);
  await f.storage.setItem('syncQueue','test queue'); await f.storage.setItem('cloudSyncEnabled','true');
  f.switch('production');
  assert.equal(await f.storage.getItem('simpleTodos'),'production guest');
  assert.equal(await f.storage.getItem('syncQueue'),'production queue');
  assert.equal(await f.storage.getItem('environment-draft:memo'),'production draft');
  assert.equal(await f.storage.getItem('cloudSyncEnabled'),'false');
});
test('storage call started before a switch cannot resume into the destination', async()=>{
  const f=fixture(); const write=f.storage.setItem('syncQueue','stale'); f.switch('test');
  await assert.rejects(write,/接続環境/);
  assert.equal([...f.values.values()].includes('stale'),false);
});
test('identity epoch rejects stale results even with the same UID; expired or blocked lease fails closed',()=>{
  updateEnvironmentRuntime('production'); const identity=captureEnvironmentIdentity('same');
  updateEnvironmentRuntime('test',Date.now()+900000); assert.throws(()=>assertEnvironmentIdentity(identity));
  updateEnvironmentRuntime('test',Date.now()-1); assert.throws(assertEnvironmentReady);
  updateEnvironmentRuntime('test',Date.now()+900000,true); assert.throws(assertEnvironmentReady);
  updateEnvironmentRuntime('production'); assert.doesNotThrow(assertEnvironmentReady);
});
test('returning offline is allowed only after a durable draft checkpoint',async()=>{
  const events:string[]=[];
  const unregister=registerEnvironmentSaveHandler(async()=>{events.push('flush'); throw Error('offline');},async()=>{events.push('checkpoint');});
  try { await saveEnvironmentDrafts(true); assert.deepEqual(events,['checkpoint','flush']); await assert.rejects(saveEnvironmentDrafts(false),/offline/); } finally { unregister(); }
});
test('failed local draft save prevents switching even when returning to production',async()=>{
  let flushed=false; const unregister=registerEnvironmentSaveHandler(async()=>{flushed=true;},async()=>{throw Error('disk');});
  try { await assert.rejects(saveEnvironmentDrafts(true),/disk/); assert.equal(flushed,false); } finally { unregister(); }
});
