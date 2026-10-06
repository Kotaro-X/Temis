const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const core = require('./profileIdentityCore.cjs');
const runtime = { region: 'asia-northeast1', timeoutSeconds: 540, maxInstances: 3, serviceAccount: 'temis-embeddings@temis-c05aa.iam.gserviceaccount.com' };

exports.syncProfileIdentity = onDocumentWritten({ ...runtime, document: 'profiles/{uid}', retry: true }, async (event) => {
  const uid = event.params.uid;
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  const db = getFirestore();
  if (!after) {
    // The account deletion pipeline also removes these objects synchronously.
    const latest = await db.doc(`profiles/${uid}`).get();
    if (!latest.exists) { await core.syncGuildAuthor(db, uid); await core.deleteAccountPhotos(getStorage().bucket(), uid); }
    return;
  }
  if (before && before.displayName === after.displayName && before.photoUrl === after.photoUrl && before.photoStoragePath === after.photoStoragePath && before.profileVisibility === after.profileVisibility) return;
  await core.syncProfileIdentity(db, uid);
  await core.deleteUnusedPreviousPhoto(db, getStorage().bucket(), uid, before?.photoStoragePath);
});
exports.cleanupProfilePhotos = onSchedule({ ...runtime, schedule: 'every 24 hours', retryCount: 3 }, async () => {
  await core.cleanupOrphanPhotos(getFirestore(), getStorage().bucket());
});
