const { getFirestore } = require('firebase-admin/firestore');
const runtime = require('./environmentRuntime.cjs');
const { onCall } = runtime;
const { onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { createGuildEngagementService, requireGuildViewer } = require('./guildEngagementCore.cjs');
const options = { region: 'asia-northeast1', timeoutSeconds: 60, memory: '256MiB', maxInstances: 3,
  serviceAccount: runtime.runtimeServiceAccount };
const methods = { getGuildEngagement: 'getStates', setGuildEngagement: 'setState', listSavedGuildPosts: 'listSaved', listGuildPostLikes: 'listLikes' };
for (const [name, method] of Object.entries(methods)) exports[name] = onCall(options, request =>
  createGuildEngagementService(getFirestore())[method](requireGuildViewer(request, runtime.projectId), request.data));
// The reverse like index is outside users/{uid}; account recursive deletion cannot erase cleanup input.
exports.cleanupGuildEngagement = onDocumentDeleted({ ...options, timeoutSeconds: 540, retry: true, document: 'profiles/{uid}' },
  event => createGuildEngagementService(getFirestore()).deleteAccountEngagement(event.params.uid));
