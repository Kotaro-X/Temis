import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { isProfileComplete } from '../src/services/collaboration/profilePolicy.ts';
const profile = { userId: 'alice', username: 'alice', displayName: 'Alice', usernameChangedAt: 1 };
function fixture(fail = false) {
  const data = new Map<string, string>(); const exports: any = {};
  const storage = {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { await new Promise((resolve) => setImmediate(resolve)); if (fail) throw new Error('disk full'); data.set(key, value); },
    removeItem: async (key: string) => { data.delete(key); },
  };
  const code = ts.transpileModule(readFileSync('src/services/collaboration/profileCompletionCache.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name.includes('async-storage') ? storage : { isProfileComplete } });
  return { cache: exports, data };
}
test('completion cache validates UID, policy version and required fields; never shares accounts', async () => {
  const { cache, data } = fixture(); await cache.cacheCompletedProfile(profile);
  assert.equal((await cache.readCompletedProfile('alice')).username, 'alice');
  assert.equal(await cache.readCompletedProfile('bob'), null);
  for (const invalid of ['not-json', JSON.stringify({ version: 2, profile }), JSON.stringify({ version: 1, profile: { ...profile, userId: 'bob' } }), JSON.stringify({ version: 1, profile: { ...profile, displayName: '' } })]) {
    data.set('profile-completion:v1:alice', invalid);
    assert.equal(await cache.readCompletedProfile('alice'), null);
  }
});
test('logout removal waits for pending writes and storage failures never reject profile completion', async () => {
  const { cache } = fixture();
  const write = cache.cacheCompletedProfile(profile); const remove = cache.clearCompletedProfile('alice');
  await Promise.all([write, remove]); assert.equal(await cache.readCompletedProfile('alice'), null);
  const failed = fixture(true).cache; await failed.cacheCompletedProfile(profile);
  assert.equal(await failed.readCompletedProfile('alice'), null);
});
test('an older background response cannot overwrite a newer saved photo in the startup cache', async () => {
  const { cache } = fixture();
  await cache.cacheCompletedProfile({ ...profile, updatedAt: 20, photoUrl: 'new.jpg' });
  await cache.cacheCompletedProfile({ ...profile, updatedAt: 10, photoUrl: 'old.jpg' });
  assert.equal((await cache.readCompletedProfile('alice')).photoUrl, 'new.jpg');
});
