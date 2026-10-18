const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('./environmentRuntime.cjs');
const { randomUUID } = require('node:crypto');
const core = require('./guildPublicationCore.cjs');
const safety = require('./reviewSafetyCore.cjs');
const { defineSecret } = require('firebase-functions/params');
const apiKey = defineSecret('OPENAI_API_KEY');
const runtime = { region: 'asia-northeast1', timeoutSeconds: 60, maxInstances: 3, serviceAccount: require('./environmentRuntime.cjs').runtimeServiceAccount };
const preparePublication = async (db, uid, raw) => {
  if (raw?.userId !== uid) throw new HttpsError('permission-denied', 'アカウントが切り替わりました。');
  const input = core.validateRequest(raw, HttpsError);
  const stateRef = db.doc(`guildPublicationStates/${core.sourceKey(uid, input.sourceId)}`);
  return db.runTransaction(async tx => {
    const state = await tx.get(stateRef);
    const profile = await tx.get(db.doc(`profiles/${uid}`));
    if (!profile.exists) throw new HttpsError('failed-precondition', 'プロフィールを設定してください。');
    const consent = await tx.get(db.doc(`aiConsents/${uid}`));
    const author = await tx.get(db.doc(`guildAuthors/${uid}`));
    if (author.data()?.deleted) throw new HttpsError('failed-precondition', '退会処理中のアカウントは公開内容を更新できません。');
    const candidates = await tx.get(db.collection('guildPosts').where('source.memoId', 'in', core.sourceAliases(input.sourceId)));
    const posts = candidates.docs.filter(doc => doc.data().authorUserId === uid && doc.data().status !== 'deleted');
    if (posts.length > 400) throw new HttpsError('resource-exhausted', '関連する投稿が多すぎます。運営へお問い合わせください。');
    if (state.exists && core.compareVersion(input.version, state.data().version) < 0) throw new HttpsError('aborted', '別の端末の新しい編集が反映されています。元メモを同期してから再試行してください。');
    if (!posts.length && input.operation !== 'publish') {
      const revision = (state.data()?.revision || 0) + 1;
      tx.set(stateRef, { userId: uid, sourceId: input.sourceId, version: input.version, revision, deleted: input.operation === 'delete', updatedAt: Date.now() });
      return { posts: [], revision };
    }
    if (input.operation === 'sync' && posts.length && posts.every(doc => doc.data().status !== 'published' && !['pending', 'failed', 'rejected'].includes(doc.data().safety?.status))) return { posts: posts.map(doc => doc.data()), revision: state.data()?.revision || 0 };
    if (!['delete', 'unpublish'].includes(input.operation) && (!safety.activeConsent(consent.data()) || consent.data().revision !== raw.consentRevision)) throw new HttpsError('failed-precondition', 'AIへのデータ送信に同意してください。', { reason: 'ai-consent-required' });
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
    const sourceConsents = [];
    const sourceReferences = [];
    if (!['delete', 'unpublish'].includes(input.operation) && (input.scope === 'project' || posts.some(doc => doc.data().source.scope === 'project'))) {
      for (const projectId of projects) {
        const sourceNotes = await tx.get(db.collection('projectNotes').where('projectId', '==', projectId).where('sourceNoteId', 'in', core.sourceAliases(input.sourceId)));
        if (sourceNotes.empty) throw new HttpsError('failed-precondition', '共有元メモの同期を完了してから公開してください。');
        for (const sourceNote of sourceNotes.docs) {
          const data = sourceNote.data();
          sourceReferences.push({ path: sourceNote.ref.path, revision: sourceNote.updateTime ? `${sourceNote.updateTime.seconds}:${sourceNote.updateTime.nanoseconds}` : safety.contentHash(data) });
          const sourceUid = data.creatorUserId || data.ownerUserId;
          if (!sourceUid || data.deletedAt || data.anonymizedReason) throw new HttpsError('failed-precondition', '元メモの作成者を確認できません。');
          const sourceConsent = await tx.get(db.doc(`aiConsents/${sourceUid}`));
          if (!safety.activeConsent(sourceConsent.data())) throw new HttpsError('failed-precondition', '元メモの作成者のAI送信許可を確認できません。');
          sourceConsents.push({ userId: sourceUid, revision: sourceConsent.data().revision });
        }
      }
    }
    const timestamp = Date.now();
    const identity = profile.data();
    if (!['delete', 'unpublish'].includes(input.operation) && identity.profileVisibility !== 'public') throw new HttpsError('failed-precondition', 'プロフィールを公開してから投稿してください。');
    const checking = !['delete', 'unpublish'].includes(input.operation);
    const ticket = checking ? randomUUID() : null;
    const revision = (state.exists ? state.data().revision : 0) + 1;
    const result = posts.map(doc => {
      const patch = core.contentPatch(doc.data(), input, timestamp);
      if (identity.profileVisibility !== 'public') { patch.status = 'unpublished'; patch.publishedAt = null; }
      if (checking) { patch.status = 'unpublished'; patch.publishedAt = null; patch.safety = { status: 'pending', version: safety.MODERATION_VERSION, contentHash: safety.contentHash(input), ticket, consentRevision: consent.data().revision, sourceConsents, sourceUserIds: [...new Set(sourceConsents.map(item => item.userId))] }; }
      const post = { ...doc.data(), ...patch };
      if (input.operation === 'publish' && identity.profileVisibility !== 'public') throw new HttpsError('failed-precondition', 'プロフィールを公開してください。');
      tx.update(doc.ref, patch);
      return post;
    });
    if (!posts.length) {
      if (!['personal', 'project_activity', 'project_recruiting'].includes(input.type) || !['personal', 'project'].includes(input.scope)) throw new HttpsError('invalid-argument', '投稿種別が不正です。');
      if (input.type !== 'personal' && !input.projectId) throw new HttpsError('invalid-argument', 'プロジェクトを選択してください。');
      const id = randomUUID();
      const post = { id, authorUserId: uid, authorDisplayName: identity.displayName, authorPhotoUrl: identity.photoUrl || null, title: input.title?.trim() || null, body: input.body, tags: core.contentPatch({}, input, timestamp).tags, type: input.type, projectId: input.projectId || null, source: { scope: input.scope, memoId: input.sourceId }, status: 'unpublished', safety: { status: 'pending', version: safety.MODERATION_VERSION, contentHash: safety.contentHash(input), ticket, consentRevision: consent.data().revision, sourceConsents, sourceUserIds: [...new Set(sourceConsents.map(item => item.userId))] }, moderation: { visibility: 'visible', hiddenByUserId: null, hiddenAt: null, reason: null }, createdAt: timestamp, updatedAt: timestamp, publishedAt: null };
      tx.create(db.doc(`guildPosts/${id}`), post); result.push(post);
    }
    tx.set(stateRef, { userId: uid, sourceId: input.sourceId, version: input.version, revision, deleted: input.operation === 'delete', updatedAt: timestamp });
    return { posts: result, revision, ticket, sourceConsents, sourceReferences };
  });
};
const updatePublication = async (db, uid, raw, moderator = input => safety.moderateText(apiKey.value(), input)) => {
  const prepared = await preparePublication(db, uid, raw);
  if (!prepared.ticket) return prepared;
  let allowed = false; let failure;
  try {
    await safety.requireConsent(db, uid, raw.consentRevision);
    for (const item of prepared.sourceConsents) await safety.requireConsent(db, item.userId, item.revision);
    allowed = await moderator(raw);
  } catch (error) { failure = error; }
  const result = await db.runTransaction(async tx => {
    const stateRef = db.doc(`guildPublicationStates/${core.sourceKey(uid, raw.sourceId)}`);
    const state = await tx.get(stateRef);
    const consent = await tx.get(db.doc(`aiConsents/${uid}`));
    const author = await tx.get(db.doc(`guildAuthors/${uid}`));
    const profile = await tx.get(db.doc(`profiles/${uid}`));
    const snapshots = await Promise.all(prepared.posts.map(post => tx.get(db.doc(`guildPosts/${post.id}`))));
    for (const projectId of [...new Set(prepared.posts.map(post => post.projectId).filter(Boolean))]) {
      const member = await tx.get(db.doc(`projects/${projectId}/members/${uid}`));
      const project = await tx.get(db.doc(`projects/${projectId}`));
      const access = await tx.get(db.doc(`projectAccessStates/${uid}`));
      const plus = await tx.get(db.doc(`temisAccessStates/${uid}`));
      const entitled = plus.data()?.tier === 'plus' && plus.data()?.verifiedUntil > Date.now() || access.data()?.status === 'ready' && access.data()?.freeProjectId === projectId;
      if (!project.exists || !['owner', 'member'].includes(member.data()?.role) || !entitled) throw new HttpsError('permission-denied', '公開権限が変更されました。');
    }
    for (const source of prepared.sourceReferences) {
      const currentSource = await tx.get(db.doc(source.path));
      if (!currentSource.exists || (currentSource.updateTime ? `${currentSource.updateTime.seconds}:${currentSource.updateTime.nanoseconds}` : safety.contentHash(currentSource.data())) !== source.revision) throw new HttpsError('aborted', '共有元メモが更新されました。');
    }
    for (const item of prepared.sourceConsents) {
      const sourceConsent = await tx.get(db.doc(`aiConsents/${item.userId}`));
      if (!safety.activeConsent(sourceConsent.data()) || sourceConsent.data().revision !== item.revision) throw new HttpsError('aborted', '元メモの送信許可が変更されました。');
    }
    if (state.data()?.revision !== prepared.revision || !safety.activeConsent(consent.data()) || consent.data().revision !== raw.consentRevision || author.data()?.deleted || profile.data()?.profileVisibility !== 'public') throw new HttpsError('aborted', '公開状態が変更されました。再試行してください。');
    if (snapshots.some(doc => !doc.exists || doc.data().safety?.ticket !== prepared.ticket || safety.contentHash(doc.data()) !== safety.contentHash(raw))) throw new HttpsError('aborted', '公開内容が変更されました。再試行してください。');
    const posts = snapshots.map(doc => {
      const post = doc.data(); const visible = allowed && !failure && post.moderation.visibility === 'visible';
      const patch = { status: visible ? 'published' : 'unpublished', publishedAt: visible ? Date.now() : null, updatedAt: Date.now(),
        safety: { ...post.safety, status: failure ? 'failed' : allowed ? 'approved' : 'rejected', checkedAt: Date.now() } };
      tx.update(doc.ref, patch); return { ...post, ...patch };
    });
    return { posts, revision: prepared.revision };
  });
  if (failure) throw new HttpsError('unavailable', '公開内容の確認に失敗しました。再試行してください。');
  if (!allowed) throw new HttpsError('failed-precondition', '公開できません。内容を見直して再試行してください。', { reason: 'content-rejected' });
  return result;
};
exports.updateGuildPublication = onCall({ ...runtime, timeoutSeconds: 120, secrets: [apiKey] }, request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインしてください。');
  return updatePublication(getFirestore(), request.auth.uid, request.data);
});
exports.updatePublication = updatePublication;
