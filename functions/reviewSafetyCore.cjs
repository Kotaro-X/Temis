const { createHash, randomUUID } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const CONSENT_VERSION = 1;
const MODERATION_VERSION = 1;
const activeConsent = value => value?.granted === true && value?.version === CONSENT_VERSION && typeof value.revision === 'string';
const consentRef = (db, uid) => db.doc(`aiConsents/${uid}`);
const requireConsent = async (db, uid, expectedRevision) => {
  const consent = (await consentRef(db, uid).get()).data();
  if (!activeConsent(consent) || consent.userId !== uid || expectedRevision && consent.revision !== expectedRevision) {
    throw new HttpsError('failed-precondition', 'AIへのデータ送信に同意してください。', { reason: 'ai-consent-required' });
  }
  return consent.revision;
};
const contentHash = input => createHash('sha256').update(JSON.stringify([input.title?.trim() || null, input.body])).digest('hex');
const moderateText = async (apiKey, input, fetcher = fetch) => {
  const response = await fetcher('https://api.openai.com/v1/moderations', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'omni-moderation-latest', input: [input.title, input.body].filter(Boolean).join('\n') }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new HttpsError('unavailable', '公開内容の確認に失敗しました。再試行してください。');
  const result = await response.json();
  if (!Array.isArray(result?.results) || result.results.length !== 1 || typeof result.results[0]?.flagged !== 'boolean') {
    throw new HttpsError('unavailable', '公開内容を確認できませんでした。再試行してください。');
  }
  return !result.results[0].flagged;
};
const blockOwners = connection => [...new Set([
  ...(Array.isArray(connection?.blockedByUserIds) ? connection.blockedByUserIds : []),
  ...(connection?.status === 'blocked' && connection.blockedByUserId ? [connection.blockedByUserId] : []),
])];
const validTarget = (uid, other) => typeof other === 'string' && other.length > 0 && other.length <= 128 && !other.includes('/') && other !== uid;
const setBlock = async (db, uid, input) => {
  if (input?.userId !== undefined && input.userId !== uid) throw new HttpsError('permission-denied', 'アカウントが切り替わりました。');
  const other = input?.otherUserId;
  if (!validTarget(uid, other) || typeof input?.blocked !== 'boolean') throw new HttpsError('invalid-argument', '対象ユーザーが不正です。');
  const userIds = [uid, other].sort(); const ref = db.doc(`connections/${userIds.join('__')}`);
  await db.runTransaction(async tx => {
    const account = await tx.get(db.doc(`dmAccounts/${uid}`));
    if (account.data()?.deleting) throw new HttpsError('failed-precondition', '退会処理中です。');
    const snap = await tx.get(ref); const prior = snap.data(); const owners = blockOwners(prior).filter(id => id !== uid);
    if (input.blocked) owners.push(uid);
    if (!owners.length) { if (snap.exists && prior.status === 'blocked') tx.delete(ref); return; }
    const now = Date.now();
    tx.set(ref, { ...(prior || { id: ref.id, userIds, requesterUserId: uid, recipientUserId: other, createdAt: now }),
      status: 'blocked', blockedByUserId: owners[0], blockedByUserIds: owners.sort(), updatedAt: now });
  });
  return { blocked: input.blocked };
};
const reportMessage = async (db, uid, input) => {
  if (input?.userId !== undefined && input.userId !== uid) throw new HttpsError('permission-denied', 'アカウントが切り替わりました。');
  const { conversationId, messageId, reason } = input || {};
  if (![conversationId, messageId].every(x => typeof x === 'string' && x.length > 0 && x.length <= 256 && !x.includes('/')) ||
    typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new HttpsError('invalid-argument', '通報内容を確認してください。');
  const id = createHash('sha256').update(JSON.stringify([uid, conversationId, messageId])).digest('hex');
  const ref = db.doc(`dmReports/${id}`);
  await db.runTransaction(async tx => {
    const account = await tx.get(db.doc(`dmAccounts/${uid}`));
    if (account.data()?.deleting) throw new HttpsError('failed-precondition', '退会処理中です。');
    const thread = await tx.get(db.doc(`dmConversations/${conversationId}`));
    if (!thread.exists || !thread.data().userIds?.includes(uid)) throw new HttpsError('permission-denied', 'この会話を通報できません。');
    const message = await tx.get(db.doc(`dmConversations/${conversationId}/messages/${messageId}`));
    if (!message.exists || message.data().deleted || message.data().senderUserId === uid) throw new HttpsError('failed-precondition', 'このメッセージは通報できません。');
    const previous = await tx.get(ref); if (previous.exists) return;
    const now = Date.now(); const data = message.data();
    tx.create(ref, { id, conversationId, messageId, reporterUserId: uid, reportedUserId: data.senderUserId,
      reason: reason.trim(), evidence: { text: data.text, senderUserId: data.senderUserId, createdAt: data.createdAt },
      status: 'pending', createdAt: now, updatedAt: now });
  });
  return { id };
};
const updateConsent = async (db, uid, input) => {
  if (input?.userId !== undefined && input.userId !== uid) throw new HttpsError('permission-denied', 'アカウントが切り替わりました。');
  if (input?.version !== CONSENT_VERSION || typeof input?.granted !== 'boolean') throw new HttpsError('invalid-argument', '同意内容を確認してください。');
  const now = Date.now(); const value = { userId: uid, version: CONSENT_VERSION, granted: input.granted, revision: randomUUID(),
    updatedAt: now, grantedAt: input.granted ? now : null, revokedAt: input.granted ? null : now };
  if (input.granted) await hideRevokedPosts(db, uid);
  const saved = await db.runTransaction(async tx => {
    const account = await tx.get(db.doc(`dmAccounts/${uid}`));
    const author = await tx.get(db.doc(`guildAuthors/${uid}`));
    if (account.data()?.deleting || author.data()?.deleted) throw new HttpsError('failed-precondition', '退会処理中です。');
    const ref = consentRef(db, uid); const current = await tx.get(ref);
    if (input.granted && activeConsent(current.data())) return current.data();
    tx.set(ref, value); return value;
  });
  // Revocation is effective at the consent write, even if cleanup fails. Retry is safe.
  if (!input.granted) await hideRevokedPosts(db, uid);
  return saved;
};
const hideRevokedPosts = async (db, uid) => {
  const [own, dependent] = await Promise.all([db.collection('guildPosts').where('authorUserId', '==', uid).get(), db.collection('guildPosts').where('safety.sourceUserIds', 'array-contains', uid).get()]);
  const posts = [...new Map([...own.docs, ...dependent.docs].map(post => [post.id, post])).values()];
  for (const post of posts) await db.runTransaction(async tx => {
    const consent = await tx.get(consentRef(db, uid)); const current = await tx.get(post.ref);
    if (activeConsent(consent.data()) || !current.exists) return;
    tx.update(post.ref, { status: current.data().status === 'deleted' ? 'deleted' : 'unpublished', publishedAt: null,
      safety: { ...(current.data().safety || {}), status: 'consent_required' }, updatedAt: Date.now() });
    tx.delete(db.doc(`guildPostAIIndex/${post.id}`));
  });
};
const requirePublicationConsent = async (db, post) => {
  if (post?.status !== 'published' || post?.moderation?.visibility !== 'visible' || post?.safety?.status !== 'approved' || post?.safety?.version !== MODERATION_VERSION || !post?.safety?.consentRevision || post.safety.contentHash !== contentHash(post)) throw new HttpsError('failed-precondition', '公開内容を確認できません。');
  await requireConsent(db, post.authorUserId, post.safety?.consentRevision);
  for (const source of post.safety?.sourceConsents || []) await requireConsent(db, source.userId, source.revision);
};
module.exports = { requirePublicationConsent, CONSENT_VERSION, MODERATION_VERSION, activeConsent, requireConsent, contentHash, moderateText, blockOwners, setBlock, reportMessage, updateConsent, hideRevokedPosts };
