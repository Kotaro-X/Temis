import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { identityPatch, ownedPhotoPath, deleteUnusedPreviousPhoto, deleteAccountPhotos, cleanupOrphanPhotos } = require('../functions/profileIdentityCore.cjs');
const profile = { displayName: 'New name', photoUrl: 'new.jpg', photoStoragePath: 'profilePhotos/alice/current.jpg', profileVisibility: 'public' };
test('identity updates preserve message content and never restore deleted identities', () => {
  assert.deepEqual(identityPatch('guild', 'alice', profile, { authorUserId: 'alice', body: 'retained' }), { authorDisplayName: 'New name', authorPhotoUrl: 'new.jpg' });
  assert.equal(identityPatch('guild', 'alice', null, { authorUserId: 'alice' }), null);
  assert.equal(identityPatch('guild', 'alice', profile, { authorUserId: 'bob' }), null);
  assert.equal(identityPatch('guild', 'alice', profile, { authorUserId: 'alice', authorAnonymizedAt: 1 }), null);
  assert.deepEqual(identityPatch('dm', 'alice', profile, { userIds: ['alice', 'bob'] }), { 'memberProfiles.alice': { displayName: 'New name', photoUrl: 'new.jpg' } });
  assert.equal(identityPatch('dm', 'alice', profile, { userIds: ['alice', 'bob'], deletedUserIds: ['alice'] }), null);
  assert.equal(identityPatch('dm', 'alice', profile, { userIds: ['alice', 'bob'], closed: true }), null);
  assert.deepEqual(identityPatch('dm', 'alice', { ...profile, profileVisibility: 'private' }, { userIds: ['alice', 'bob'] }), { 'memberProfiles.alice': { displayName: 'Temisユーザー', photoUrl: null } });
});
test('old photos are removed only if owned and no longer referenced, including retries', async () => {
  const removed: string[] = [];
  const db = { doc: () => ({ get: async () => ({ exists: true, data: () => profile }) }) };
  const bucket = { file: (path: string) => ({ delete: async () => removed.push(path) }) };
  assert.equal(ownedPhotoPath('alice', 'profilePhotos/bob/old.jpg'), false);
  await deleteUnusedPreviousPhoto(db, bucket, 'alice', profile.photoStoragePath);
  await deleteUnusedPreviousPhoto(db, bucket, 'alice', 'profilePhotos/bob/old.jpg');
  await deleteUnusedPreviousPhoto(db, bucket, 'alice', 'profilePhotos/alice/old.jpg');
  assert.deepEqual(removed, ['profilePhotos/alice/old.jpg']);
  let prefix = '';
  await deleteAccountPhotos({ deleteFiles: async (options: { prefix: string }) => { prefix = options.prefix; } }, 'alice');
  assert.equal(prefix, 'profilePhotos/alice/');
});
test('orphan cleanup paginates and retains current, recent, and unrecognized objects', async () => {
  const removed: string[] = [];
  const now = Date.now();
  const file = (name: string, age: number) => ({ name, metadata: { timeCreated: new Date(now - age).toISOString() }, delete: async () => removed.push(name) });
  const day = 86400000;
  const pages = [
    [file(profile.photoStoragePath, 2 * day), file('profilePhotos/alice/recent.jpg', 1), file('profilePhotos/alice/old.jpg', 2 * day)],
    [file('profilePhotos/deleted/old.jpg', 2 * day), file('profilePhotos/alice/not-an-avatar.txt', 2 * day)],
  ];
  const db = { doc: (path: string) => ({ get: async () => ({ exists: path === 'profiles/alice', data: () => profile }) }) };
  let calls = 0;
  const bucket = { getFiles: async (options: { pageToken?: string }) => { assert.equal(options.pageToken, calls ? 'next' : undefined); const index = calls++; return [pages[index], index ? null : { pageToken: 'next' }]; } };
  await cleanupOrphanPhotos(db, bucket, now);
  assert.equal(calls, 2);
  assert.deepEqual(removed, ['profilePhotos/alice/old.jpg', 'profilePhotos/deleted/old.jpg']);
});
