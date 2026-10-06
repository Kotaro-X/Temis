import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
function fixture(author: any, reject = false) {
  let reads = 0;
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/services/guild/guildAuthorService.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: (name: string) => {
    if (name === 'firebase/firestore') return { doc: (_db: any, collection: string) => { assert.equal(collection, 'guildAuthors'); }, getDocFromServer: async () => { reads++; if (reject) throw new Error('offline'); return { exists: () => !!author, data: () => author }; } };
    if (name.endsWith('firebaseApp')) return { getFirebaseFirestore: () => ({}) };
    throw new Error(name);
  } });
  return { resolve: exports.resolveGuildAuthors, reads: () => reads };
}
const post = { id: 'one', authorUserId: 'alice', authorDisplayName: 'Old name', authorPhotoUrl: 'old.jpg', body: 'memo' };
test('past posts refer to latest common identity and batch duplicate author lookups', async () => {
  const f = fixture({ displayName: 'Latest', photoUrl: 'new.jpg' });
  const posts = await f.resolve([post, { ...post, id: 'two' }]);
  assert.equal(f.reads(), 1); assert.ok(posts.every((p: any) => p.authorPhotoUrl === 'new.jpg' && p.authorDisplayName === 'Latest'));
  assert.equal(posts[0].body, 'memo');
});
test('missing identity, failed reads and deleted photos never reuse a stale post icon', async () => {
  for (const f of [fixture(null), fixture(null, true), fixture({ displayName: 'Latest', photoUrl: null })]) {
    assert.equal((await f.resolve([post]))[0].authorPhotoUrl, null);
  }
});
test('account deletion and post anonymization take precedence over a stale identity', async () => {
  const f = fixture({ displayName: 'Latest', photoUrl: 'new.jpg', deleted: true });
  assert.equal((await f.resolve([post]))[0].authorDisplayName, '匿名ユーザー');
  const other = fixture({ displayName: 'Latest', photoUrl: 'new.jpg' });
  const result = (await other.resolve([{ ...post, authorAnonymizedAt: 1 }]))[0];
  assert.equal(result.authorPhotoUrl, null); assert.equal(result.authorDisplayName, '匿名ユーザー');
});
