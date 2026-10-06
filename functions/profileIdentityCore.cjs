const PHOTO_PREFIX = 'profilePhotos/';
const DAY_MS = 24 * 60 * 60 * 1000;
const ownedPhotoPath = (uid, path) => typeof path === 'string' && path.startsWith(`${PHOTO_PREFIX}${uid}/`) && /^profilePhotos\/[^/]+\/[a-zA-Z0-9-]+\.jpg$/.test(path);
const identityPatch = (kind, uid, profile, document) => {
  if (!profile) return null;
  const identity = { displayName: profile.displayName || 'Temisユーザー', photoUrl: profile.photoUrl || null };
  if (kind === 'dm') {
    if (!document.userIds?.includes(uid) || document.deletedUserIds?.includes(uid) || document.closed) return null;
    return { [`memberProfiles.${uid}`]: require('./directMessagesCore.cjs').identity(profile) };
  }
  if (document.authorUserId !== uid || document.authorAnonymizedAt || document.deletedAt) return null;
  return { authorDisplayName: identity.displayName, authorPhotoUrl: identity.photoUrl };
};

/** Read the latest profile inside each destination transaction; old/retried events cannot restore old identities. */
const syncGuildAuthor = async (db, uid) => db.runTransaction(async tx => {
  const profile = await tx.get(db.doc(`profiles/${uid}`));
  const existing = await tx.get(db.doc(`guildAuthors/${uid}`));
  const author = profile.exists && !existing.data()?.deleted ? { displayName: profile.data().displayName || 'Temisユーザー', photoUrl: profile.data().photoUrl || null, deleted: false } : { displayName: '匿名ユーザー', photoUrl: null, deleted: true };
  tx.set(db.doc(`guildAuthors/${uid}`), author);
});
const syncProfileIdentity = async (db, uid) => {
  await syncGuildAuthor(db, uid);
  const { FieldPath } = require('firebase-admin/firestore');
  for (const [collection, field, operator, kind] of [
    ['guildPosts', 'authorUserId', '==', 'guild'], ['dmConversations', 'userIds', 'array-contains', 'dm'],
  ]) {
    let cursor;
    for (;;) {
      let query = db.collection(collection).where(field, operator, uid).orderBy(FieldPath.documentId()).limit(100);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      // Bound concurrent transactions while making partial runs safe to retry.
      for (let offset = 0; offset < page.docs.length; offset += 10) {
        await Promise.all(page.docs.slice(offset, offset + 10).map((item) => db.runTransaction(async (tx) => {
          const profile = await tx.get(db.doc(`profiles/${uid}`));
          const destination = await tx.get(item.ref);
          if (!destination.exists) return;
          const patch = identityPatch(kind, uid, profile.exists ? profile.data() : null, destination.data());
          if (patch) tx.update(item.ref, patch);
        })));
      }
      cursor = page.docs[page.docs.length - 1];
      if (page.size < 100) break;
    }
  }
};
const deleteUnusedPreviousPhoto = async (db, bucket, uid, previousPath) => {
  if (!ownedPhotoPath(uid, previousPath)) return;
  const latest = await db.doc(`profiles/${uid}`).get();
  if (latest.exists && latest.data().photoStoragePath === previousPath) return;
  await bucket.file(previousPath).delete({ ignoreNotFound: true });
};
const deleteAccountPhotos = async (bucket, uid) => {
  await bucket.deleteFiles({ prefix: `${PHOTO_PREFIX}${uid}/` });
};
// Interrupted clients may leave uploads behind. Never touch a recent upload or a referenced object.
const cleanupOrphanPhotos = async (db, bucket, timestamp = Date.now()) => {
  let pageToken;
  do {
    const [files, next] = await bucket.getFiles({ prefix: PHOTO_PREFIX, maxResults: 100, autoPaginate: false, pageToken });
    for (const file of files) {
      const uid = file.name.split('/')[1];
      if (!ownedPhotoPath(uid, file.name)) continue;
      const created = Date.parse(file.metadata?.timeCreated || '');
      if (!Number.isFinite(created) || timestamp - created < DAY_MS) continue;
      const profile = await db.doc(`profiles/${uid}`).get();
      if (!profile.exists || profile.data().photoStoragePath !== file.name) await file.delete({ ignoreNotFound: true });
    }
    pageToken = next?.pageToken;
  } while (pageToken);
};
module.exports = { syncGuildAuthor, ownedPhotoPath, identityPatch, syncProfileIdentity, deleteUnusedPreviousPhoto, deleteAccountPhotos, cleanupOrphanPhotos };
