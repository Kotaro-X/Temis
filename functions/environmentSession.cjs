const { Buffer } = require("node:buffer");
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { createEnvironmentSessionService, SIGNER, ISSUER, AUDIENCE, PRODUCTION_PROJECT, TEST_PROJECT } = require('./environmentSessionCore.cjs');
if (!getApps().length) initializeApp();
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
const service = createEnvironmentSessionService({
  projectId, auth: getAuth(), db: getFirestore(), error: (code, message) => new HttpsError(code, message),
  sign: async payload => {
    // Application Default Credentials use IAM signBlob; no private key file is provisioned.
    const { applicationDefault } = require('firebase-admin/app');
    const { access_token } = await applicationDefault().getAccessToken();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const input = `${header}.${body}`;
    const response = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SIGNER}:signBlob`, {
      method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: Buffer.from(input).toString('base64') }),
    });
    if (!response.ok) throw new HttpsError('unavailable', 'Ticket signing unavailable.');
    const signed = await response.json();
    return `${input}.${Buffer.from(signed.signedBlob, 'base64').toString('base64url')}`;
  },
  verify: async ticket => {
    const { jwtVerify, importX509 } = await import('jose');
    const response = await fetch(`https://www.googleapis.com/service_accounts/v1/metadata/x509/${encodeURIComponent(SIGNER)}`);
    if (!response.ok) throw new Error('Signing certificates unavailable.');
    const certificates = await response.json();
    // IAM key rotation can leave several valid Google-managed certificates. Pin the account and algorithm.
    for (const certificate of Object.values(certificates)) {
      try { return (await jwtVerify(ticket, await importX509(certificate, 'RS256'), { algorithms: ['RS256'], issuer: ISSUER, audience: AUDIENCE, maxTokenAge: '60s' })).payload; } catch { /* Try the next active Google certificate. */ }
    }
    throw new Error('Invalid signature.');
  },
});
const options = { region: 'asia-northeast1', serviceAccount: `temis-embeddings@${projectId}.iam.gserviceaccount.com` };
if (projectId === PRODUCTION_PROJECT) {
  exports.getEnvironmentSwitchCapability = onCall(options, request => service.capability(request));
  exports.issueTestSessionTicket = onCall(options, request => service.issue(request));
} else if (projectId === TEST_PROJECT) {
  exports.exchangeTestSessionTicket = onCall(options, request => service.exchange(request));
} else if (!process.env.FUNCTIONS_EMULATOR) {
  throw new Error('Unknown Firebase environment.');
}
