const { HttpsError } = require('firebase-functions/v2/https');
const { requireConsent, contentHash } = require('./reviewSafetyCore.cjs');
const loadConsentedProjectNote = async (db, uid, projectId, noteId, assertAccess) => {
  if (![projectId, noteId].every(id => typeof id === 'string' && id && id.length <= 256 && !id.includes('/'))) throw new HttpsError('invalid-argument', '参照先が不正です。');
  const [member, note] = await Promise.all([db.doc(`projects/${projectId}/members/${uid}`).get(), db.doc(`projectNotes/${noteId}`).get()]);
  if (!member.exists || !note.exists || note.data().projectId !== projectId || note.data().deletedAt) throw new HttpsError('permission-denied', 'この共有メモを参照できません。');
  await assertAccess(uid, projectId);
  const data = note.data(); const author = data.creatorUserId || data.ownerUserId;
  if (!author || data.anonymizedReason) throw new HttpsError('failed-precondition', '作成者のAI送信許可を確認できません。');
  await requireConsent(db, author);
  return { ...data, serverRevision: note.updateTime ? `${note.updateTime.seconds}:${note.updateTime.nanoseconds}` : contentHash(data) };
};
module.exports = { loadConsentedProjectNote };
