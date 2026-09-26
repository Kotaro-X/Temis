const { getFirestore } = require('firebase-admin/firestore');
const { onCall } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { createDMService, requireUser } = require('./directMessagesCore.cjs');
const { processNotificationJob } = require('./directMessagesNotifications.cjs');
const options = {
  region: 'asia-northeast1', timeoutSeconds: 60, memory: '256MiB', maxInstances: 3,
  serviceAccount: 'temis-embeddings@temis-c05aa.iam.gserviceaccount.com',
};
exports.sendDirectMessage = onCall(options, (request) => createDMService(getFirestore()).send(requireUser(request), request.data));
exports.markDirectMessagesRead = onCall(options, (request) => createDMService(getFirestore()).markRead(requireUser(request), request.data));
exports.setDirectMessageDevice = onCall(options, (request) => createDMService(getFirestore()).setDevice(requireUser(request), request.data));
exports.notifyDirectMessage = onDocumentCreated({ ...options, document: 'dmNotificationJobs/{messageId}', retry: true },
  (event) => event.data ? processNotificationJob(getFirestore(), event.data.ref) : undefined);
exports.retryDirectMessageNotifications = onSchedule({ ...options, timeoutSeconds: 300, schedule: 'every 5 minutes' }, async () => {
  const db = getFirestore();
  const jobs = await db.collection('dmNotificationJobs').where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(100).get();
  for (let offset = 0; offset < jobs.docs.length; offset += 5) {
    await Promise.all(jobs.docs.slice(offset, offset + 5).map((doc) => processNotificationJob(db, doc.ref)));
  }
});
