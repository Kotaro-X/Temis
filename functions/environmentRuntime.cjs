const https = require('firebase-functions/v2/https');
const params = require('firebase-functions/params');
const { TEST_PROJECT, PRODUCTION_PROJECT, assertTestOperator } = require('./environmentSessionCore.cjs');
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
const isTest = projectId === TEST_PROJECT;
const runtimeServiceAccount = `temis-embeddings@${isTest ? TEST_PROJECT : PRODUCTION_PROJECT}.iam.gserviceaccount.com`;
const onCall = (options, handler) => https.onCall(isTest ? { ...options, secrets: secrets(options.secrets ?? []), serviceAccount: runtimeServiceAccount } : options, async request => {
  if (isTest) {
    try { assertTestOperator(request); } catch { throw new https.HttpsError('permission-denied', '有効な運営テストセッションが必要です。'); }
  }
  return handler(request);
});
// Test functions declare only the API they actually use. Unavailable production secrets cannot be read.
const defineSecret = name => isTest && name !== 'OPENAI_API_KEY'
  ? { value: () => { throw new Error('Production integration is disabled in test.'); } }
  : params.defineSecret(name);
const secrets = values => isTest ? values.filter(value => value.name === 'OPENAI_API_KEY') : values;
module.exports = { ...https, onCall, defineSecret, secrets, isTest, projectId, runtimeServiceAccount };
