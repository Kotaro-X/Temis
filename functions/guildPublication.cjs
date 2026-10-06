const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { randomUUID } = require('node:crypto');
const core = require('./guildPublicationCore.cjs');
const runtime = { region: 'asia-northeast1', timeoutSeconds: 60, maxInstances: 3, serviceAccount: 'temis-embeddings@temis-c05aa.iam.gserviceaccount.com' };
const updatePublication = async (db, uid, raw) => {
  if (raw?.userId !== uid) throw new HttpsError('permission-denied', 'アカウントが切り替わりました。');
  const input = core.validateRequest(raw, HttpsError);
  const stateRef = db.doc(`guildPublicationStates/${core.sourceKey(uid, input.sourceId)}`);
  return db.runTransaction(async tx => {
    const state = await tx.get(stateRef);
    const profile = await tx.get(db.doc(`profiles/${uid}`));
    if (!profile.exists) throw new HttpsError('failed-precondition', 'プロフィールを設定してください。');
    const author = await tx.get(db.doc(`guildAuthors/${uid}`));
    if (author.data()?.deleted) throw new HttpsError('failed-precondition', '退会処理中のアカウントは公開内容を更新できません。');
    const candidates = await tx.get(db.collection('guildPosts').where('source.memoId', 'in', core.sourceAliases(input.sourceId)));
    const posts = candidates.docs.filter(doc => doc.data().authorUserId === uid && doc.data().status !== 'deleted');
    if (posts.length > 400) throw new HttpsError('resource-exhausted', '関連する投稿が多すぎます。運営へお問い合わせください。');
    if (state.exists && core.compareVersion(input.version, state.data().version) < 0) throw new HttpsError('aborted', '別の端末の新しい編集が反映されています。元メモを同期してから再試行してください。');
    if (!posts.length && input.operation !== 'publish') return { posts: [], revision: state.exists ? state.data().revision : 0 };
    const projects = new Set(posts.map(doc => doc.data().projectId).filter(Boolean));
    if (input.projectId) projects.add(input.projectId);
    if (input.scope === 'project' && !projects.size) throw new HttpsError('invalid-argument', '元メモのプロジェクトを指定してください。');
    for (const id of ['delete', 'unpublish'].includes(input.operation) ? [] : projects) {
      if (typeof id !== 'string' || id.includes('/')) throw new HttpsError('invalid-argument', 'プロジェクトの識別情報が不正です。');
      const member = await tx.get(db.doc(`projects/${id}/members/${uid}`));
      const project = await tx.get(db.doc(`projects/${id}`));
      const access = await tx.get(db.doc(`projectAccessStates/${uid}`));
      const plus = await tx.get(db.doc(`temisAccessStates/${uid}`));
      const entitled = plus.exists && plus.data().tier === 'plus' && plus.data().verifiedUntil > Date.now() || access.exists && access.data().status === 'ready' && access.data().freeProjectId === id;
      if (!project.exists || !member.exists || !['owner', 'member'].includes(member.data().role) || !entitled) throw new HttpsError('permission-denied', 'このプロジェクトのメモを公開・更新する権限がありません。');
    }
    const timestamp = Date.now();
    const identity = profile.data();
    if (input.operation === 'publish' && identity.profileVisibility !== 'public') throw new HttpsError('failed-precondition', 'プロフィールを公開してから投稿してください。');
    const revision = (state.exists ? state.data().revision : 0) + 1;
    const result = posts.map(doc => {
      const patch = core.contentPatch(doc.data(), input, timestamp);
      if (identity.profileVisibility !== 'public') { patch.status = 'unpublished'; patch.publishedAt = null; }
      const post = { ...doc.data(), ...patch };
      if (input.operation === 'publish' && identity.profileVisibility !== 'public') throw new HttpsError('failed-precondition', 'プロフィールを公開してください。');
      tx.update(doc.ref, patch);
      return post;
    });
    if (!posts.length) {
      if (!['personal', 'project_activity', 'project_recruiting'].includes(input.type) || !['personal', 'project'].includes(input.scope)) throw new HttpsError('invalid-argument', '投稿種別が不正です。');
      if (input.type !== 'personal' && !input.projectId) throw new HttpsError('invalid-argument', 'プロジェクトを選択してください。');
      const id = randomUUID();
      const post = { id, authorUserId: uid, authorDisplayName: identity.displayName, authorPhotoUrl: identity.photoUrl || null, title: input.title?.trim() || null, body: input.body, tags: core.contentPatch({}, input, timestamp).tags, type: input.type, projectId: input.projectId || null, source: { scope: input.scope, memoId: input.sourceId }, status: 'published', moderation: { visibility: 'visible', hiddenByUserId: null, hiddenAt: null, reason: null }, createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp };
      tx.create(db.doc(`guildPosts/${id}`), post); result.push(post);
    }
    tx.set(stateRef, { userId: uid, sourceId: input.sourceId, version: input.version, revision, deleted: input.operation === 'delete', updatedAt: timestamp });
    return { posts: result, revision };
  });
};
exports.updateGuildPublication = onCall(runtime, request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインしてください。');
  return updatePublication(getFirestore(), request.auth.uid, request.data);
});
exports.updatePublication = updatePublication;
