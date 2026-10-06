import test from 'node:test';
import assert from 'node:assert/strict';
import { isProfileComplete, isTemporaryUsername, validateDisplayName, validateProfileSetup, assertUsernameAvailable, assertUsernameChangeAllowed, base64ByteLength, profilePhotoCrop } from '../src/services/collaboration/profilePolicy.ts';
import { USERNAME_CHANGE_INTERVAL_MS, type UserProfile } from '../src/types/collaboration.ts';
const profile: UserProfile = {
  userId: 'abc123', username: 'user_abc123', displayName: '太郎', interestTags: [], skillTags: [],
  profileVisibility: 'public', connectionRequestPolicy: 'everyone', createdAt: 1, updatedAt: 1, usernameChangedAt: null,
};
test('generated ID is incomplete; valid legacy explicit ID is complete without migration', () => {
  assert.equal(isProfileComplete(null), false);
  assert.equal(isProfileComplete(profile), false);
  assert.equal(isTemporaryUsername({ ...profile, username: 'user_abc12319' }), true);
  const legacy = { ...profile, username: 'taro', usernameChangedAt: 10 };
  assert.equal(isProfileComplete(legacy), true);
  assert.equal(isProfileComplete({ ...legacy, displayName: '  ' }), false);
  assert.equal(isProfileComplete({ ...legacy, username: 'ab' }), false);
  assert.equal(isProfileComplete({ ...profile, username: 'taro', profileCompletedAt: 10 }), true);
  assert.equal(isProfileComplete({ ...profile, profileCompletedAt: 10 }), false);
});
test('setup requires valid trimmed names and an explicitly selected ID', () => {
  assert.equal(validateDisplayName('  太郎  '), null);
  assert.equal(validateDisplayName('a'.repeat(50)), null);
  assert.match(validateDisplayName('a'.repeat(51))!, /50/);
  assert.throws(() => validateProfileSetup(profile, ' ', 'taro'), /表示名/);
  assert.throws(() => validateProfileSetup(profile, '太郎', profile.username), /仮/);
  assert.throws(() => validateProfileSetup(profile, '太郎', 'admin'), /予約語/);
  assert.doesNotThrow(() => validateProfileSetup(profile, ' 太郎 ', '@TaRo'));
});
test('duplicate active and reserved IDs ask for another ID; own and expired claims are permitted', () => {
  for (const reservedUntil of [null, 101]) assert.throws(() => assertUsernameAvailable('abc123', { userId: 'other', reservedUntil }, 100), /すでに使用されています。別のユーザーIDを入力してください/);
  assert.doesNotThrow(() => assertUsernameAvailable('abc123', { userId: 'other', reservedUntil: 100 }, 100));
  assert.doesNotThrow(() => assertUsernameAvailable('abc123', { userId: 'abc123', reservedUntil: null }, 100));
  assert.doesNotThrow(() => assertUsernameAvailable('abc123', null, 100));
});
test('initial ID has no cooldown; subsequent changes retain 30 days', () => {
  assert.doesNotThrow(() => assertUsernameChangeAllowed(profile, 'taro', 100));
  const changed = { ...profile, username: 'taro', usernameChangedAt: 100 };
  assert.throws(() => assertUsernameChangeAllowed(changed, 'jiro', 101), /30日/);
  assert.doesNotThrow(() => assertUsernameChangeAllowed(changed, 'taro', 101));
  assert.doesNotThrow(() => assertUsernameChangeAllowed(changed, 'jiro', 100 + USERNAME_CHANGE_INTERVAL_MS));
});
test('square crop works in both orientations and byte checks account for base64 padding', () => {
  assert.deepEqual(profilePhotoCrop(1000, 800), { originX: 100, originY: 0, width: 800, height: 800 });
  assert.deepEqual(profilePhotoCrop(800, 1000), { originX: 0, originY: 100, width: 800, height: 800 });
  assert.throws(() => profilePhotoCrop(0, 100));
  assert.equal(base64ByteLength('YQ=='), 1);
  assert.equal(base64ByteLength('YWI='), 2);
  assert.equal(base64ByteLength('YWJj'), 3);
});

test('setup stages no writes on validation/claim failure and preserves photos on success', async () => {
  const { saveProfileSetupTransaction } = await import('../src/services/collaboration/profileSetupTransaction.ts');
  const writes: unknown[] = [];
  const tx = {
    readProfile: async () => ({ ...profile, photoUrl: 'existing.jpg' }),
    readClaim: async () => ({ userId: 'other', username: 'taken', reservedUntil: null, updatedAt: 1 }),
    writeProfile: (value: UserProfile) => { writes.push(value); },
    writeClaim: (value: unknown) => { writes.push(value); },
  };
  await assert.rejects(saveProfileSetupTransaction(tx, 'abc123', { displayName: '太郎', username: 'taken' }, 100), /別のユーザーID/);
  assert.equal(writes.length, 0);
  await assert.rejects(saveProfileSetupTransaction(tx, 'different-account', { displayName: '太郎', username: 'taro' }, 100), /見つかりません/);
  assert.equal(writes.length, 0);
  const updated = await saveProfileSetupTransaction({ ...tx, readClaim: async () => null }, 'abc123', { displayName: ' 太郎 ', username: '@TaRo' }, 100);
  assert.equal(writes.length, 3);
  assert.equal(updated.username, 'taro');
  assert.equal(updated.displayName, '太郎');
  assert.equal(updated.photoUrl, 'existing.jpg');
  assert.equal(updated.profileCompletedAt, 100);
  assert.equal(updated.usernameChangedAt, 100);
});
