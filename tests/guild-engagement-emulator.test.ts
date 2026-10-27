import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app');
const { getFirestore } = requireFunctions('firebase-admin/firestore');
const { createGuildEngagementService } = requireFunctions('./guildEngagementCore.cjs');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('guild engagement integration requires Firestore emulator', { skip: true }, () => {});
} else {
  let env: RulesTestEnvironment;
  let admin: any;
  let db: any;
  let service: any;
  const projectId = 'demo-guild-engagement';
  const post = (patch = {}) => ({ id: 'post', authorUserId: 'author', authorDisplayName: 'Old name', authorPhotoUrl: 'old',
    title: 'Title', body: 'Body', tags: [], type: 'personal', projectId: null, source: { scope: 'personal', memoId: 'private-source' },
    status: 'published', safety: { status: 'approved', version: 1, sourceUserIds: ['private-uid'], contentHash: 'private-hash' },
    moderation: { visibility: 'visible', reason: null }, createdAt: 1, updatedAt: 2, publishedAt: 2, ...patch });
  const input = (uid: string, extra = {}) => ({ userId: uid, postId: 'post', ...extra });
  const seed = async () => {
    for (const uid of ['alice', 'bob', 'author']) {
      await db.doc(`profiles/${uid}`).set({ displayName: uid });
      await db.doc(`guildAuthors/${uid}`).set({ displayName: `${uid} current`, photoUrl: null, deleted: false });
    }
    await db.doc('guildPosts/post').set(post());
  };
  test.before(async () => {
    env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync(process.env.FIRESTORE_RULES_PATH ?? new URL('../firestore.rules', import.meta.url), 'utf8') } });
    admin = initializeApp({ projectId }, 'guild-engagement-tests'); db = getFirestore(admin); service = createGuildEngagementService(db);
  });
  test.beforeEach(async () => { await env.clearFirestore(); await seed(); });
  test.after(async () => { await deleteApp(admin); await env.cleanup(); });

  test('new records default to zero; repeated requests and concurrent likes remain exact', async () => {
    const initial = await service.getStates('alice', { userId: 'alice', postIds: ['post'] });
    assert.deepEqual(initial.states[0], { postId: 'post', liked: false, saved: false, likeCount: 0, available: true });
    await Promise.all(['alice', 'alice', 'bob'].map(uid => service.setState(uid, input(uid, { kind: 'like', enabled: true }))));
    assert.equal((await db.doc('guildPostEngagement/post').get()).data().likeCount, 2);
    await Promise.all(['alice', 'alice'].map(uid => service.setState(uid, input(uid, { kind: 'like', enabled: false }))));
    assert.equal((await db.doc('guildPostEngagement/post').get()).data().likeCount, 1);
    assert.deepEqual((await db.doc('guildPosts/post').get()).data(), post());
    assert.equal((await db.doc('guildUserEngagement/alice/likedPosts/post').get()).exists, false);
  });

  test('saving is idempotent, private and source-free; likes use current public identities', async () => {
    for (let i = 0; i < 2; i++) await service.setState('alice', input('alice', { kind: 'save', enabled: true }));
    assert.equal((await db.collection('users/alice/guildSavedPosts').get()).size, 1);
    assert.equal((await service.listSaved('bob', { userId: 'bob' })).posts.length, 0);
    await assert.rejects(service.listSaved('bob', { userId: 'alice' }), { code: 'permission-denied' });
    const saved = (await service.listSaved('alice', { userId: 'alice' })).posts[0];
    assert.equal(saved.source, undefined); assert.equal(saved.safety.sourceUserIds, undefined); assert.equal(saved.safety.contentHash, undefined);
    assert.equal(saved.authorDisplayName, 'author current');
    await service.setState('bob', input('bob', { kind: 'like', enabled: true }));
    const likes = await service.listLikes('alice', input('alice'));
    assert.deepEqual(likes.users, [{ userId: 'bob', displayName: 'bob current', photoUrl: null }]);
    await service.setState('alice', input('alice', { kind: 'save', enabled: false }));
    assert.equal((await service.listSaved('alice', { userId: 'alice' })).posts.length, 0);
  });

  test('non-public, hidden and unapproved posts cannot be newly liked or saved; removals remain possible', async () => {
    for (const patch of [{ status: 'unpublished' }, { status: 'deleted' }, { moderation: { visibility: 'hidden' } }, { safety: { status: 'pending', version: 1 } }, { safety: { status: 'approved', version: 0 } }]) {
      await db.doc('guildPosts/post').set(post());
      await service.setState('alice', input('alice', { kind: 'save', enabled: true }));
      await service.setState('alice', input('alice', { kind: 'like', enabled: true }));
      await db.doc('guildPosts/post').set(post(patch));
      assert.equal((await service.listSaved('alice', { userId: 'alice' })).posts.length, 0);
      assert.equal((await service.getStates('alice', { userId: 'alice', postIds: ['post'] })).states[0].available, false);
      await assert.rejects(service.listLikes('alice', input('alice')), { code: 'permission-denied' });
      for (const kind of ['like', 'save']) {
        await assert.rejects(service.setState('alice', input('alice', { kind, enabled: true })), { code: 'permission-denied' });
        await service.setState('alice', input('alice', { kind, enabled: false }));
      }
    }
    await db.doc('guildPosts/post').delete();
    await assert.rejects(service.setState('alice', input('alice', { kind: 'save', enabled: true })), { code: 'permission-denied' });
  });

  test('blocked authors disappear and blocked likers are filtered without changing total counts', async () => {
    await service.setState('alice', input('alice', { kind: 'save', enabled: true }));
    await service.setState('bob', input('bob', { kind: 'like', enabled: true }));
    await db.doc('connections/alice__bob').set({ status: 'blocked', userIds: ['alice', 'bob'] });
    assert.equal((await service.listLikes('alice', input('alice'))).users.length, 0);
    assert.equal((await service.getStates('alice', { userId: 'alice', postIds: ['post'] })).states[0].likeCount, 1);
    await db.doc('connections/alice__author').set({ status: 'blocked', userIds: ['alice', 'author'] });
    assert.equal((await service.listSaved('alice', { userId: 'alice' })).posts.length, 0);
    await assert.rejects(service.setState('alice', input('alice', { kind: 'like', enabled: true })), { code: 'permission-denied' });
  });

  test('saved and like pagination advances through filtered pages and stable timestamp ties', async () => {
    for (let i = 0; i < 27; i++) {
      const id = `p${String(i).padStart(2, '0')}`;
      await db.doc(`guildPosts/${id}`).set(post({ id, status: i < 24 ? 'published' : 'unpublished' }));
      await db.doc(`users/alice/guildSavedPosts/${id}`).set({ postId: id, createdAt: 100 });
      const uid = `liker${String(i).padStart(2, '0')}`;
      await db.doc(`guildPostEngagement/post/guildPostLikes/${uid}`).set({ userId: uid, createdAt: 100 });
      await db.doc(`guildAuthors/${uid}`).set({ displayName: uid, deleted: false });
    }
    const first = await service.listSaved('alice', { userId: 'alice' });
    assert.equal(first.posts.length, 21); assert.ok(first.cursor);
    const second = await service.listSaved('alice', { userId: 'alice', cursor: first.cursor });
    assert.equal(second.posts.length, 3); assert.equal(second.cursor, null);
    assert.equal(new Set([...first.posts, ...second.posts].map(p => p.id)).size, 24);
    // A whole raw page can be invisible and still supply a valid continuation.
    for (let i = 3; i < 27; i++) await db.doc(`guildPosts/p${String(i).padStart(2, '0')}`).update({ status: 'unpublished' });
    const empty = await service.listSaved('alice', { userId: 'alice' });
    assert.equal(empty.posts.length, 0); assert.ok(empty.cursor);
    assert.equal((await service.listSaved('alice', { userId: 'alice', cursor: empty.cursor })).posts.length, 3);
    const likes = await service.listLikes('alice', input('alice'));
    assert.equal(likes.users.length, 24);
    const more = await service.listLikes('alice', input('alice', { cursor: likes.cursor }));
    assert.equal(more.users.length, 3);
    assert.equal(new Set([...likes.users, ...more.users].map(p => p.userId)).size, 27);
  });

  test('account deletion is retryable, updates counts and blocks in-flight/new operations', async () => {
    await service.setState('alice', input('alice', { kind: 'like', enabled: true }));
    await service.setState('bob', input('bob', { kind: 'like', enabled: true }));
    await service.setState('alice', input('alice', { kind: 'save', enabled: true }));
    // Existing account cleanup may remove users/{uid} before the profile-delete trigger runs.
    await db.recursiveDelete(db.doc('users/alice'));
    await Promise.allSettled([service.deleteAccountEngagement('alice'), service.setState('alice', input('alice', { kind: 'like', enabled: true }))]);
    await service.deleteAccountEngagement('alice');
    assert.equal((await db.doc('guildPostEngagement/post').get()).data().likeCount, 1);
    assert.equal((await db.doc('guildPostEngagement/post/guildPostLikes/alice').get()).exists, false);
    assert.equal((await db.collection('users/alice/guildSavedPosts').get()).empty, true);
    assert.equal((await db.collection('guildUserEngagement/alice/likedPosts').get()).empty, true);
    await assert.rejects(service.setState('alice', input('alice', { kind: 'like', enabled: true })), { code: 'failed-precondition' });
  });

  test('malformed input and all direct client engagement access are rejected', async () => {
    for (const extra of [{ postId: '../x' }, { kind: 'invalid' }, { enabled: 1 }, { userId: 'bob' }]) {
      await assert.rejects(service.setState('alice', input('alice', { kind: 'like', enabled: true, ...extra })));
    }
    await assert.rejects(service.listSaved('alice', { userId: 'alice', cursor: { createdAt: -1, id: 'x' } }));
    await assert.rejects(service.getStates('alice', { userId: 'alice', postIds: Array(25).fill('post') }));
    const client = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'google.com' }, testOperator: true, testOperatorExpiresAt: Date.now() / 1000 + 3600 }).firestore();
    for (const path of ['guildPostEngagement/post', 'guildPostEngagement/post/guildPostLikes/alice', 'guildUserEngagement/alice/likedPosts/post', 'users/alice/guildSavedPosts/post', 'users/bob/guildSavedPosts/post']) {
      await db.doc(path).set({ likeCount: 5, postId: 'post', userId: 'alice', createdAt: 1 });
      await assertFails(client.doc(path).get());
      await assertFails(client.doc(path).set({ likeCount: 999 }));
      await assertFails(client.doc(path).update({ likeCount: 999 }));
      await assertFails(client.doc(path).delete());
    }
  });
}
