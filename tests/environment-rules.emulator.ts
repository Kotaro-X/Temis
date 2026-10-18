import { createMockUserToken } from '@firebase/util';
import test from 'node:test';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Firestore and Storage Emulators are required.');
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-wememo', firestore: { host: firestoreHost[0], port: Number(firestoreHost[1]), rules: readFileSync(new URL('../firestore.test.rules', import.meta.url), 'utf8') }, storage: { host: storageHost[0], port: Number(storageHost[1]), rules: readFileSync(new URL('../storage.test.rules', import.meta.url), 'utf8') } });
test.after(async () => env.cleanup());
const claims = { testOperator: true, testOperatorExpiresAt: Math.floor(Date.now() / 1000) + 900 };
for (const [name, lease, succeeds] of [
  ['custom_valid', claims, true],
  ['custom_ordinary', {}, false],
  ['custom_expired', { testOperator: true, testOperatorExpiresAt: 1 }, false],
] as const) {
  test(`${name}: custom-token profile and username creation is atomic and lease gated`, async () => {
    const db = env.authenticatedContext(name, { ...lease, firebase: { sign_in_provider: 'custom' } }).firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'profiles', name), {
      userId: name, username: name, displayName: 'Test', photoUrl: null,
      bio: null, interestTags: [], skillTags: [], affiliation: null,
      profileVisibility: 'public', connectionRequestPolicy: 'everyone',
      createdAt: 1, updatedAt: 1, usernameChangedAt: null,
      profileCompletedAt: null, photoStoragePath: null,
    });
    batch.set(doc(db, 'usernames', name), { userId: name, username: name, reservedUntil: null, updatedAt: 1 });
    await (succeeds ? assertSucceeds(batch.commit()) : assertFails(batch.commit()));
    await assertFails(setDoc(doc(db, 'profiles', 'another_owner'), { userId: name }));
  });
}
const file = (context: any, uid = 'operator_rules') => ref(context.storage(), `profilePhotos/${uid}/photo.jpg`);
const upload = (context: any, uid?: string) => uploadBytes(file(context, uid), new Uint8Array([255,216,255,217]), { contentType: 'image/jpeg' });
test('valid test lease retains owner access; other owners remain denied', async () => {
  const user = env.authenticatedContext('operator_rules', claims);
  await assertSucceeds(upload(user));
  await assertSucceeds(getBytes(file(user)));
  await assertFails(upload(user, 'other_operator'));
  await assertFails(setDoc(doc(user.firestore(), 'operatorTestPlans/operator_rules'), { plan: 'plus' }));
});
for (const [name, token] of Object.entries({ ordinary: {}, staff: { staff_free: true }, expired: { testOperator: true, testOperatorExpiresAt: 1 }, missingExpiry: { testOperator: true }, invalidExpiry: { testOperator: true, testOperatorExpiresAt: '999999999999' } })) {
  test(`${name} cannot read Firestore or public test photos`, async () => {
    const user = env.authenticatedContext('operator_rules', token);
    await assertFails(getDoc(doc(user.firestore(), 'temisAccessStates/operator_rules')));
    await assertFails(getBytes(file(user)));
    await assertFails(upload(user));
  });
}
test('anonymous cannot read test avatars even though production avatars are public', async () => {
  await assertFails(getBytes(file(env.unauthenticatedContext())));
});
test('valid lease can read own access state and cannot read another account state', async () => {
  const user = env.authenticatedContext('operator_rules', claims);
  await assertSucceeds(getDoc(doc(user.firestore(), 'temisAccessStates/operator_rules')));
  await assertFails(getDoc(doc(user.firestore(), 'temisAccessStates/other')));
});

test('test avatar HTTP reads require a valid lease and no permanent bearer URL is necessary', async () => {
  const user = env.authenticatedContext('operator_http', claims);
  await assertSucceeds(upload(user, 'operator_http'));
  const object = file(user, 'operator_http');
  const url = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${encodeURIComponent(object.bucket)}/o/${encodeURIComponent(object.fullPath)}?alt=media`;
  if ((await fetch(url)).ok) throw Error('Anonymous test photo read succeeded.');
  const token = createMockUserToken({ sub: 'operator_http', user_id: 'operator_http', ...claims }, 'demo-wememo');
  const authenticated = await fetch(url, { headers: { Authorization: `Firebase ${token}` } });
  if (!authenticated.ok) throw Error(`Authenticated photo read failed: ${authenticated.status}`);
});
