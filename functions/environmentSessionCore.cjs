const { createHash, randomUUID } = require('node:crypto');
const PRODUCTION_PROJECT = 'temis-c05aa';
const TEST_PROJECT = 'temis-test-c05aa';
const SIGNER = `temis-environment-signer@${PRODUCTION_PROJECT}.iam.gserviceaccount.com`;
const ISSUER = `https://temis.app/environment/${PRODUCTION_PROJECT}`;
const AUDIENCE = `https://temis.app/environment/${TEST_PROJECT}`;
const TICKET_SECONDS = 60;
const LEASE_SECONDS = 15 * 60;
const testUid = uid => `operator_${createHash('sha256').update(`${PRODUCTION_PROJECT}\0${uid}`).digest('hex')}`;

// Deleted identities remain tombstoned. Re-entry must never resurrect their
// publications, conversations or consent, or race cleanup on the old UID.
const resolveTestIdentity = (db, productionUid, generation = randomUUID) => {
  const base = testUid(productionUid);
  const mapping = db.doc(`environmentOperatorIdentities/${base}`);
  return db.runTransaction(async tx => {
    const saved = await tx.get(mapping);
    const uid = saved.data()?.uid || base;
    const account = await tx.get(db.doc(`dmAccounts/${uid}`));
    const author = await tx.get(db.doc(`guildAuthors/${uid}`));
    if (!account.data()?.deleting && !author.data()?.deleted) return uid;
    const next = testUid(`${productionUid}\0${generation()}`);
    tx.set(mapping, { uid: next });
    return next;
  });
};

/** Dependencies are injected so authorization, replay and failure paths can be tested without IAM. */
const createEnvironmentSessionService = ({ projectId, auth, db, sign, verify, error, now = () => Date.now(), nonce = randomUUID }) => {
  const fail = (code, message) => { throw error(code, message); };
  const requireProject = expected => { if (projectId !== expected) fail('failed-precondition', 'Wrong environment.'); };
  const requireOperator = async request => {
    requireProject(PRODUCTION_PROJECT);
    if (!request.auth?.uid || request.auth.token?.firebase?.sign_in_provider === 'anonymous') fail('permission-denied', 'Operator access required.');
    // Read live Auth state on every renewal. A stale token claim cannot retain revoked access.
    const user = await auth.getUser(request.auth.uid);
    const issued = Number(request.auth.token?.auth_time);
    if (user.disabled || user.customClaims?.environmentSwitcher !== true || !Number.isFinite(issued)
      || issued * 1000 < Date.parse(user.tokensValidAfterTime || '1970-01-01')) fail('permission-denied', 'Operator access required.');
    return user.uid;
  };
  return {
    capability: async request => { await requireOperator(request); return { allowed: true }; },
    issue: async request => {
      const uid = await requireOperator(request);
      const iat = Math.floor(now() / 1000);
      return { ticket: await sign({ iss: ISSUER, aud: AUDIENCE, sub: uid, iat, exp: iat + TICKET_SECONDS, jti: nonce() }), expiresAt: (iat + TICKET_SECONDS) * 1000 };
    },
    exchange: async request => {
      requireProject(TEST_PROJECT);
      const ticket = request.data?.ticket;
      if (typeof ticket !== 'string' || ticket.length > 8192) fail('invalid-argument', 'Invalid ticket.');
      let payload;
      try { payload = await verify(ticket); } catch { fail('permission-denied', 'Invalid ticket.'); }
      const seconds = Math.floor(now() / 1000);
      if (payload.iss !== ISSUER || payload.aud !== AUDIENCE || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128
        || typeof payload.jti !== 'string' || !/^[a-zA-Z0-9-]{16,128}$/.test(payload.jti)
        || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.iat > seconds
        || payload.exp <= seconds || payload.exp - payload.iat !== TICKET_SECONDS) fail('permission-denied', 'Invalid ticket.');
      const uid = await resolveTestIdentity(db, payload.sub);
      const expiresAt = seconds + LEASE_SECONDS;
      const claim = db.collection('environmentSessionTickets').doc(payload.jti);
      try {
        // Atomic create makes replay fail across concurrent instances. Never persist the ticket itself.
        await claim.create({ uid, expiresAt: new Date(payload.exp * 1000) });
      } catch (e) { if (e.code === 6 || e.code === 'already-exists') fail('permission-denied', 'Ticket already used.'); throw e; }
      const token = await auth.createCustomToken(uid, { testOperator: true, testOperatorExpiresAt: expiresAt });
      return { token, uid, expiresAt: expiresAt * 1000 };
    },
  };
};
const assertTestOperator = (request, now = Date.now()) => {
  const token = request.auth?.token;
  if (!request.auth?.uid || token?.testOperator !== true || typeof token.testOperatorExpiresAt !== 'number'
    || token.testOperatorExpiresAt * 1000 <= now) throw new Error('Active operator test session required.');
};
module.exports = { PRODUCTION_PROJECT, TEST_PROJECT, SIGNER, ISSUER, AUDIENCE, TICKET_SECONDS, LEASE_SECONDS, testUid, resolveTestIdentity, createEnvironmentSessionService, assertTestOperator };
