const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('./environmentRuntime.cjs');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const core = require('./reviewSafetyCore.cjs');
const options = { region: 'asia-northeast1', timeoutSeconds: 300, maxInstances: 3, serviceAccount: require('./environmentRuntime.cjs').runtimeServiceAccount };
const uid = request => { if (!request.auth) throw new HttpsError('unauthenticated', 'ログインしてください。'); return request.auth.uid; };
exports.updateAIConsent = onCall(options, request => core.updateConsent(getFirestore(), uid(request), request.data));
exports.setUserBlocked = onCall(options, request => core.setBlock(getFirestore(), uid(request), request.data));
exports.reportDirectMessage = onCall(options, request => core.reportMessage(getFirestore(), uid(request), request.data));
exports.cleanupRevokedAIConsent = onDocumentWritten({ ...options, document: 'aiConsents/{userId}', retry: true }, event => {
  if (!core.activeConsent(event.data?.after.data())) return core.hideRevokedPosts(getFirestore(), event.params.userId);
});
