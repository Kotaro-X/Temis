const { HttpsError } = require('firebase-functions/v2/https');
const { FieldPath } = require('firebase-admin/firestore');
const PAGE_SIZE = 24;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (code, message) => { throw new HttpsError(code, message); };
const visiblePost = post => post?.status === 'published' && post.moderation?.visibility === 'visible'
  && post.safety?.status === 'approved' && post.safety.version === 1;
const connectionPath = (a, b) => `connections/${[a, b].sort().join('__')}`;
const assertInput = (uid, input) => {
  if (!validId(uid) || input?.userId !== uid) fail('permission-denied', 'アカウントが切り替わりました。');
};
const requirePostId = input => {
  if (!validId(input?.postId)) fail('invalid-argument', '投稿IDが不正です。');
  return input.postId;
};
const readCursor = cursor => {
  if (cursor == null) return null;
  if (!Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0 || !validId(cursor.id)) fail('invalid-argument', 'ページ情報が不正です。');
  return { createdAt: cursor.createdAt, id: cursor.id };
};
const safePost = (post, id, author) => ({
  id, authorUserId: post.authorUserId,
  authorDisplayName: author?.deleted ? '匿名ユーザー' : author?.displayName || 'Temisユーザー',
  authorPhotoUrl: author?.deleted ? null : author?.photoUrl || null,
  title: post.title ?? null, body: post.body, tags: post.tags, type: post.type,
  projectId: post.projectId ?? null, status: post.status, moderation: post.moderation,
  safety: { status: post.safety.status, version: post.safety.version },
  createdAt: post.createdAt, updatedAt: post.updatedAt, publishedAt: post.publishedAt,
});
const requireGuildViewer = (request, projectId, now = Date.now()) => {
  const auth = request.auth;
  if (!validId(auth?.uid) || auth.token?.firebase?.sign_in_provider === 'anonymous') fail('unauthenticated', 'ログインしてください。');
  if (projectId === 'temis-test-c05aa' && (auth.token?.testOperator !== true || !Number.isFinite(auth.token.testOperatorExpiresAt) || auth.token.testOperatorExpiresAt * 1000 <= now)) {
    fail('permission-denied', '有効な運営テストセッションが必要です。');
  }
  return auth.uid;
};
const createGuildEngagementService = db => {
  const statsRef = postId => db.doc(`guildPostEngagement/${postId}`);
  const likeRef = (uid, postId) => statsRef(postId).collection('guildPostLikes').doc(uid);
  const ownLikeRef = (uid, postId) => db.doc(`guildUserEngagement/${uid}/likedPosts/${postId}`);
  const saveRef = (uid, postId) => db.doc(`users/${uid}/guildSavedPosts/${postId}`);
  const assertAccount = async (uid, read = ref => ref.get()) => {
    const account = await read(db.doc(`dmAccounts/${uid}`));
    const profile = await read(db.doc(`profiles/${uid}`));
    if (account.data()?.deleting || !profile.exists) fail('failed-precondition', 'このアカウントは現在利用できません。');
  };
  const canView = async (uid, post, read = ref => ref.get()) => {
    if (!visiblePost(post) || !validId(post.authorUserId)) return false;
    if (post.authorUserId === uid) return true;
    return (await read(db.doc(connectionPath(uid, post.authorUserId)))).data()?.status !== 'blocked';
  };
  const assertVisible = async (uid, postId, read = ref => ref.get()) => {
    const post = (await read(db.doc(`guildPosts/${postId}`))).data();
    if (!await canView(uid, post, read)) fail('permission-denied', 'この投稿は現在表示できません。');
    return post;
  };
  const state = async (uid, postId) => {
    const [stats, like, saved] = await Promise.all([statsRef(postId).get(), likeRef(uid, postId).get(), saveRef(uid, postId).get()]);
    return { postId, likeCount: Math.max(0, stats.data()?.likeCount || 0), liked: like.exists, saved: saved.exists, available: true };
  };
  const getStates = async (uid, input) => {
    assertInput(uid, input);
    if (!Array.isArray(input.postIds) || input.postIds.length > PAGE_SIZE || !input.postIds.every(validId)) fail('invalid-argument', '投稿の指定が不正です。');
    await assertAccount(uid);
    return { states: await Promise.all([...new Set(input.postIds)].map(async postId => {
      const post = (await db.doc(`guildPosts/${postId}`).get()).data();
      if (!await canView(uid, post)) return { postId, likeCount: 0, liked: false, saved: false, available: false };
      const result = await state(uid, postId);
      // Re-check after the reads so an unpublished or blocked post is not returned from an old snapshot.
      const latest = (await db.doc(`guildPosts/${postId}`).get()).data();
      return await canView(uid, latest) ? result : { postId, likeCount: 0, liked: false, saved: false, available: false };
    })) };
  };
  const setState = async (uid, input) => {
    assertInput(uid, input); const postId = requirePostId(input);
    if (!['like', 'save'].includes(input.kind) || typeof input.enabled !== 'boolean') fail('invalid-argument', '操作が不正です。');
    return db.runTransaction(async tx => {
      const read = ref => tx.get(ref);
      await assertAccount(uid, read);
      // Removal is also permitted when a post has become unavailable.
      const post = (await read(db.doc(`guildPosts/${postId}`))).data();
      const available = await canView(uid, post, read);
      if (input.enabled && !available) fail('permission-denied', 'この投稿は現在表示できません。');
      const [stats, like, saved] = await Promise.all([read(statsRef(postId)), read(likeRef(uid, postId)), read(saveRef(uid, postId))]);
      let likeCount = Math.max(0, stats.data()?.likeCount || 0);
      const timestamp = Date.now();
      if (input.kind === 'like' && input.enabled !== like.exists) {
        likeCount = Math.max(0, likeCount + (input.enabled ? 1 : -1));
        tx.set(statsRef(postId), { likeCount });
        if (input.enabled) {
          const record = { userId: uid, postId, createdAt: timestamp };
          tx.set(likeRef(uid, postId), record); tx.set(ownLikeRef(uid, postId), record);
        } else { tx.delete(likeRef(uid, postId)); tx.delete(ownLikeRef(uid, postId)); }
      }
      if (input.kind === 'save' && input.enabled !== saved.exists) {
        if (input.enabled) tx.set(saveRef(uid, postId), { postId, createdAt: timestamp });
        else tx.delete(saveRef(uid, postId));
      }
      return { postId, likeCount, liked: input.kind === 'like' ? input.enabled : like.exists,
        saved: input.kind === 'save' ? input.enabled : saved.exists, available };
    });
  };
  const page = async (collection, rawCursor) => {
    const cursor = readCursor(rawCursor);
    let query = collection.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (cursor) query = query.startAfter(cursor.createdAt, cursor.id);
    const snapshot = await query.limit(PAGE_SIZE).get(); const tail = snapshot.docs.at(-1);
    return { docs: snapshot.docs, cursor: snapshot.size === PAGE_SIZE ? { createdAt: tail.data().createdAt, id: tail.id } : null };
  };
  const listSaved = async (uid, input) => {
    assertInput(uid, input); await assertAccount(uid);
    const result = await page(db.collection(`users/${uid}/guildSavedPosts`), input.cursor);
    const posts = [];
    for (const record of result.docs) {
      const post = (await db.doc(`guildPosts/${record.id}`).get()).data();
      if (!await canView(uid, post)) continue;
      const author = (await db.doc(`guildAuthors/${post.authorUserId}`).get()).data();
      posts.push(safePost(post, record.id, author));
    }
    return { posts, cursor: result.cursor };
  };
  const listLikes = async (uid, input) => {
    assertInput(uid, input); const postId = requirePostId(input); await assertAccount(uid); await assertVisible(uid, postId);
    const result = await page(statsRef(postId).collection('guildPostLikes'), input.cursor);
    const users = [];
    for (const record of result.docs) {
      const other = record.id;
      if (other !== uid && (await db.doc(connectionPath(uid, other)).get()).data()?.status === 'blocked') continue;
      const [author, account] = await Promise.all([db.doc(`guildAuthors/${other}`).get(), db.doc(`dmAccounts/${other}`).get()]);
      if (!author.exists || author.data().deleted || account.data()?.deleting) continue;
      users.push({ userId: other, displayName: author.data().displayName || 'Temisユーザー', photoUrl: author.data().photoUrl || null });
    }
    await assertVisible(uid, postId);
    return { users, cursor: result.cursor };
  };
  const deleteAccountEngagement = async uid => {
    // This marker conflicts with in-flight mutation transactions and prevents recreation during cleanup.
    await db.doc(`dmAccounts/${uid}`).set({ deleting: true }, { merge: true });
    for (;;) {
      const snapshot = await db.collection(`guildUserEngagement/${uid}/likedPosts`).limit(100).get();
      if (snapshot.empty) break;
      for (const record of snapshot.docs) await db.runTransaction(async tx => {
        const postId = record.id;
        const [like, stats] = await Promise.all([tx.get(likeRef(uid, postId)), tx.get(statsRef(postId))]);
        if (like.exists) {
          tx.set(statsRef(postId), { likeCount: Math.max(0, (stats.data()?.likeCount || 0) - 1) });
          tx.delete(likeRef(uid, postId));
        }
        tx.delete(record.ref);
      });
    }
    await db.recursiveDelete(db.collection(`users/${uid}/guildSavedPosts`));
  };
  return { getStates, setState, listSaved, listLikes, deleteAccountEngagement };
};
module.exports = { createGuildEngagementService, visiblePost, validId, readCursor, requireGuildViewer };
