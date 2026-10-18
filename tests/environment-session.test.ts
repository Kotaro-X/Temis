import test from 'node:test';
import { safetyDb } from './helpers/reviewSafetyDb.ts';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createEnvironmentSessionService, resolveTestIdentity, testUid, PRODUCTION_PROJECT, TEST_PROJECT } = require('../functions/environmentSessionCore.cjs');
const now = 1800000000000;
const request = { auth: { uid: 'production-user', token: { auth_time: now / 1000, firebase: { sign_in_provider: 'google.com' } } } };
const fixture = (options: any = {}) => {
  let payload: any;
  const state = safetyDb();
  const used = new Set();
  const auth = { getUser: async () => ({ uid: request.auth.uid, customClaims: { environmentSwitcher: true }, tokensValidAfterTime: new Date(0).toISOString(), ...options.user }), createCustomToken: async (uid: string, claims: any) => JSON.stringify({ uid, claims }) };
  const common = { auth, now: () => now, nonce: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', error: (code: string, message: string) => Object.assign(new Error(message), { code }), sign: async (value: any) => { payload = value; return 'signed'; }, verify: async () => { if (options.badSignature) throw Error('bad'); return { ...payload, ...options.payload }; }, db: { ...state, collection: () => ({ doc: (id: string) => ({ create: async () => { if (used.has(id)) throw Object.assign(Error('exists'), { code: 6 }); used.add(id); } }) }) } };
  return { production: createEnvironmentSessionService({ ...common, projectId: PRODUCTION_PROJECT }), test: createEnvironmentSessionService({ ...common, projectId: TEST_PROJECT }) };
};
test('test identity is deterministic and distinct from the production UID', () => {
  assert.equal(testUid('same'), testUid('same')); assert.notEqual(testUid('same'), 'same'); assert.notEqual(testUid('same'), testUid('other'));
});
test('valid ticket grants only its derived test account for fifteen minutes', async () => {
  const f = fixture(); const ticket = await f.production.issue(request); const result = await f.test.exchange({ data: ticket });
  assert.equal(result.uid, testUid(request.auth.uid)); assert.equal(result.expiresAt, now + 900000);
  assert.deepEqual(JSON.parse(result.token).claims, { testOperator: true, testOperatorExpiresAt: now / 1000 + 900 });
});
test('ticket can be consumed once, including concurrent exchange', async () => {
  const f = fixture(); const ticket = await f.production.issue(request);
  const results = await Promise.allSettled([f.test.exchange({ data: ticket }), f.test.exchange({ data: ticket })]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
});
for (const [name, user] of Object.entries({ ordinary: { customClaims: {} }, staff: { customClaims: { staff_free: true } }, disabled: { disabled: true }, revoked: { tokensValidAfterTime: new Date(now + 1000).toISOString() } })) {
  test(`${name} operator cannot issue or query capability`, async () => { const f = fixture({ user }); await assert.rejects(f.production.issue(request), { code: 'permission-denied' }); await assert.rejects(f.production.capability(request), { code: 'permission-denied' }); });
}
test('anonymous and signed-out callers cannot issue', async () => {
  const f = fixture(); await assert.rejects(f.production.issue({})); await assert.rejects(f.production.issue({ auth: { ...request.auth, token: { ...request.auth.token, firebase: { sign_in_provider: 'anonymous' } } } }));
});
for (const [name, payload] of Object.entries({ expired: { exp: now / 1000 }, audience: { aud: 'other' }, issuer: { iss: 'other' }, future: { iat: now / 1000 + 1 }, duration: { exp: now / 1000 + 61 }, subject: { sub: '' } })) {
  test(`rejects ${name} ticket`, async () => { const f = fixture({ payload }); const ticket = await f.production.issue(request); await assert.rejects(f.test.exchange({ data: ticket }), { code: 'permission-denied' }); });
}
test('signature failure and wrong deployment environment fail closed', async () => { const f = fixture({ badSignature: true }); const ticket = await f.production.issue(request); await assert.rejects(f.test.exchange({ data: ticket })); await assert.rejects(f.production.exchange({ data: ticket })); await assert.rejects(f.test.issue(request)); });

test('test plan fixtures are server-controlled and do not retain a production-style access cache', async () => {
  const { safetyDb } = await import('./helpers/reviewSafetyDb.ts');
  const { createTemisAccessService } = require('../functions/temisAccessCore.cjs');
  const db = safetyDb(); let externalCalls = 0;
  const service = createTemisAccessService({ db, HttpsError: Error, verifyRevenueCat: async () => { externalCalls++; return true; }, resolveTestPlan: async (uid: string) => (await db.doc(`operatorTestPlans/${uid}`).get()).data()?.plan });
  assert.equal((await service.getAccess('operator')).tier, 'free');
  await db.doc('operatorTestPlans/operator').set({ plan: 'plus' });
  assert.equal((await service.getAccess('operator')).tier, 'plus');
  await db.doc('operatorTestPlans/operator').set({ plan: 'free' });
  assert.equal((await service.getAccess('operator')).tier, 'free');
  assert.equal(externalCalls, 0);
});

for (const tombstone of ['account', 'author']) {
  test(`deleted test ${tombstone} gets a fresh stable identity without clearing tombstones`, async () => {
    const db = safetyDb(); const original = testUid('production');
    assert.equal(await resolveTestIdentity(db, 'production'), original);
    const path = tombstone === 'account' ? `dmAccounts/${original}` : `guildAuthors/${original}`;
    const marker = tombstone === 'account' ? { deleting: true } : { deleted: true };
    await db.doc(path).set(marker);
    const identities = await Promise.all([resolveTestIdentity(db, 'production'), resolveTestIdentity(db, 'production')]);
    assert.notEqual(identities[0], original);
    assert.equal(identities[0], identities[1]);
    assert.deepEqual((await db.doc(path).get()).data(), marker);
    assert.equal((await db.doc(`aiConsents/${identities[0]}`).get()).exists, false);
    await db.doc(`dmAccounts/${identities[0]}`).set({ deleting: true });
    const next = await resolveTestIdentity(db, 'production');
    assert.notEqual(next, identities[0]);
    assert.equal(await resolveTestIdentity(db, 'other'), testUid('other'));
  });
}

test('re-entry after deletion can persist a fresh consent decision and preserves the old deletion guards', async () => {
  const db = safetyDb(); const old = testUid('returning');
  await db.doc(`dmAccounts/${old}`).set({ deleting: true });
  await db.doc(`guildAuthors/${old}`).set({ deleted: true });
  const { updateConsent } = require('../functions/reviewSafetyCore.cjs');
  await assert.rejects(updateConsent(db, old, { userId: old, version: 1, granted: true }), { code: 'failed-precondition' });
  const uid = await resolveTestIdentity(db, 'returning');
  const consent = await updateConsent(db, uid, { userId: uid, version: 1, granted: true });
  assert.equal(consent.userId, uid); assert.equal(consent.granted, true);
  assert.equal((await db.doc(`aiConsents/${old}`).get()).exists, false);
  assert.equal((await db.doc(`dmAccounts/${old}`).get()).data().deleting, true);
  assert.equal((await db.doc(`guildAuthors/${old}`).get()).data().deleted, true);
  assert.equal((await db.doc(`aiConsents/${uid}`).get()).data().revision, consent.revision);
});
