import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function fixture() {
  let uid: string | undefined = 'alice'; let value: any = null; let sendCount = 0;
  let read = async () => ({ exists: () => Boolean(value), data: () => value });
  const exports: any = {};
  const modules: Record<string, any> = {
    'firebase/firestore': { doc: (_db: any, _collection: string, userId: string) => userId, getDocFromServer: () => read() },
    'firebase/functions': { getFunctions: () => ({}), httpsCallable: () => async (input: any) => { value = { ...input, userId: uid, revision: 'updated' }; return { data: value }; } },
    '../sync/firebaseApp': { isFirebaseConfigured: () => true, getFirebaseAuth: () => ({ currentUser: uid ? { uid } : null }), getFirebaseFirestore: () => ({}), getFirebaseApp: () => ({}) },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('src/services/ai/aiConsent.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Error, Set, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  return { api: exports, allow: () => { value = { userId: uid, granted: true, version: 1, revision: 'original' }; }, revoke: () => { value = { granted: false, version: 1, revision: 'revoked' }; }, switch: (userId: string | undefined) => { uid = userId; }, setRead: (handler: typeof read) => { read = handler; }, send: async () => { const receipt = await exports.requireAIConsent(); sendCount++; return receipt; }, sent: () => sendCount };
}
test('background work never prompts or sends before consent; declining remains unsent', async () => {
  const f = fixture(); let prompts = 0; f.api.registerConsentPrompt(async () => { prompts++; return false; });
  await assert.rejects(f.send()); assert.equal(f.sent(), 0); assert.equal(prompts, 0);
  await assert.rejects(f.api.requireAIConsent(true)); assert.equal(prompts, 1); assert.equal(f.sent(), 0);
});
test('agreement must be saved on server and an old description version is not accepted', async () => {
  const f = fixture(); f.api.registerConsentPrompt(async () => true);
  await assert.rejects(f.api.requireAIConsent(true)); // saying yes locally cannot authorize transmission
  await f.api.updateAIConsent(true); const receipt = await f.send(); assert.equal(receipt.uid, 'alice'); assert.equal(f.sent(), 1);
  f.setRead(async () => ({ exists: () => true, data: () => ({ userId: 'alice', granted: true, version: 0, revision: 'old' }) }));
  await assert.rejects(f.send()); assert.equal(f.sent(), 1);
});
test('revocation, re-agreement, and account switching invalidate in-flight responses', async () => {
  const f = fixture(); f.allow(); const receipt = await f.send(); f.revoke(); await assert.rejects(f.api.validateConsentReceipt(receipt));
  await f.api.updateAIConsent(true); await assert.rejects(f.api.validateConsentReceipt(receipt));
  f.switch('bob'); await assert.rejects(f.api.validateConsentReceipt(receipt));
});
test('switching accounts during server consent lookup cannot authorize the new account', async () => {
  const f = fixture(); f.allow(); let release!: () => void;
  f.setRead(async () => { await new Promise<void>(done => { release = done; }); return { exists: () => true, data: () => ({ userId: 'alice', granted: true, version: 1, revision: '1' }) }; });
  const pending = f.send(); f.switch('bob'); release(); await assert.rejects(pending); assert.equal(f.sent(), 0);
});
test('a saved refusal is not prompted again; settings can explicitly review it', async () => {
  const f = fixture(); let prompts = 0;
  f.api.registerConsentPrompt(async () => { prompts++; return false; });
  await f.api.updateAIConsent(false);
  await assert.rejects(f.api.requireAIConsent(true));
  await assert.rejects(f.api.requireAIConsent(true));
  assert.equal(prompts, 0); assert.equal(f.sent(), 0);
  await f.api.reviewAIConsent(); assert.equal(prompts, 1);
});
test('saved agreement supports repeated posts without prompting; wrong-account decisions are rejected', async () => {
  const f = fixture(); let prompts = 0;
  f.api.registerConsentPrompt(async () => { prompts++; return false; }); f.allow();
  await f.api.requireAIConsent(true); await f.api.requireAIConsent(true); assert.equal(prompts, 0);
  assert.equal(f.api.hasAIConsentDecision({ userId: 'bob', granted: true, version: 1, revision: 'x' }, 'alice'), false);
  assert.equal(f.api.hasAIConsentDecision({ userId: 'alice', granted: false, version: 0, revision: 'x' }, 'alice'), false);
  f.switch('bob'); await assert.rejects(f.api.updateAIConsent(true, 'alice'));
});
test('a pipeline started by one account cannot adopt another account permission', async () => {
  const f = fixture(); f.switch('bob'); f.allow();
  await assert.rejects(f.api.requireAIConsent(false, 'alice'));
  const bob = await f.api.requireAIConsent(false, 'bob'); assert.equal(bob.uid, 'bob');
});
