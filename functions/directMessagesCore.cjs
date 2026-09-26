const { FieldValue } = require('firebase-admin/firestore');
const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');

const fail = (code, message) => { throw new HttpsError(code, message); };
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const pairId = (a, b) => hash(JSON.stringify([a, b].sort()));
const connectionId = (a, b) => [a, b].sort().join('__');
const requireUser = (request) => {
  if (!request.auth?.uid) fail('unauthenticated', 'ログインしてください。');
  if (!['apple.com', 'google.com'].includes(request.auth.token?.firebase?.sign_in_provider)) {
    fail('permission-denied', 'AppleまたはGoogleでログインしてください。');
  }
  return request.auth.uid;
};
const readSendInput = (uid, data) => {
  if (!id(data?.recipientUserId) || data.recipientUserId === uid || !id(data?.clientMessageId)) {
    fail('invalid-argument', '送信先またはメッセージIDが不正です。');
  }
  if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000) {
    fail('invalid-argument', '本文は1〜4,000文字で入力してください。');
  }
  return { ...data, text: data.text.trim() };
};
const isConnected = (value, a, b) => value?.status === 'connected'
  && value.userIds?.length === 2 && value.userIds.includes(a) && value.userIds.includes(b)
  && value.requesterUserId !== value.recipientUserId
  && value.userIds.includes(value.requesterUserId) && value.userIds.includes(value.recipientUserId);
const identity = (profile) => profile && ['public', 'connections_only'].includes(profile.profileVisibility)
  ? { displayName: profile.displayName || 'Temisユーザー', photoUrl: profile.photoUrl || null }
  : { displayName: 'Temisユーザー', photoUrl: null };

const createDMService = (db) => {
  const account = (uid) => db.doc(`dmAccounts/${uid}`);
  const conversation = (cid) => db.doc(`dmConversations/${cid}`);
  const send = async (uid, data) => {
    const input = readSendInput(uid, data);
    const other = input.recipientUserId;
    const cid = pairId(uid, other);
    const ref = conversation(cid);
    const mid = hash(`${uid}:${input.clientMessageId}`);
    const messageRef = ref.collection('messages').doc(mid);
    return db.runTransaction(async (tx) => {
      const [mine, theirs, connection, existing, prior, senderProfile, recipientProfile] = await Promise.all([
        tx.get(account(uid)), tx.get(account(other)),
        tx.get(db.doc(`connections/${connectionId(uid, other)}`)), tx.get(ref), tx.get(messageRef),
        tx.get(db.doc(`profiles/${uid}`)), tx.get(db.doc(`profiles/${other}`)),
      ]);
      if (mine.data()?.deleting || theirs.data()?.deleting || !senderProfile.exists || !recipientProfile.exists) {
        fail('failed-precondition', 'このアカウントとはメッセージを送受信できません。');
      }
      // Return an acknowledged previous send even when the connection was removed afterwards.
      if (prior.exists) {
        if (prior.data().text !== input.text) fail('already-exists', '再送する本文が一致しません。');
        return { conversationId: cid, messageId: mid, sequence: prior.data().sequence };
      }
      if (!isConnected(connection.data(), uid, other)) fail('permission-denied', '繋がりのある相手にのみ送信できます。');
      if (mine.data()?.lastSentAt > Date.now() - 1000) fail('resource-exhausted', '少し待ってから送信してください。');
      const current = existing.data();
      const sequence = (current?.sequence || 0) + 1;
      const now = Date.now();
      const memberProfiles = {
        [uid]: identity(senderProfile.data()), [other]: identity(recipientProfile.data()),
      };
      const receivedCounts = { ...(current?.receivedCounts || {}), [other]: (current?.receivedCounts?.[other] || 0) + 1 };
      const message = { id: mid, senderUserId: uid, text: input.text, sequence, createdAt: now, deleted: false, receivedCounts };
      tx.set(messageRef, message);
      tx.set(ref, {
        id: cid, userIds: [uid, other].sort(), memberProfiles, sequence, receivedCounts,
        createdAt: current?.createdAt || now, updatedAt: now,
        lastMessage: { text: input.text, senderUserId: uid, sequence },
        closed: false,
      }, { merge: true });
      tx.set(account(uid), { lastSentAt: now }, { merge: true });
      // No copied body/name in jobs: deletion cannot leave a second copy behind.
      tx.create(db.doc(`dmNotificationJobs/${mid}`), {
        conversationId: cid, messageId: mid, senderUserId: uid, recipientUserId: other,
        status: 'pending', attempts: 0, nextAttemptAt: now, createdAt: now,
      });
      return { conversationId: cid, messageId: mid, sequence };
    });
  };
  const markRead = async (uid, data) => {
    if (!id(data?.conversationId) || !Number.isSafeInteger(data.sequence) || data.sequence < 0) fail('invalid-argument', '既読位置が不正です。');
    const ref = conversation(data.conversationId);
    await db.runTransaction(async (tx) => {
      const [snapshot, own] = await Promise.all([tx.get(ref), tx.get(account(uid))]);
      const value = snapshot.data();
      if (!value?.userIds.includes(uid) || own.data()?.deleting) fail('permission-denied', 'この会話は開けません。');
      const lastRead = value.readSequences?.[uid] || 0;
      const sequence = Math.min(data.sequence, value.sequence);
      if (sequence <= lastRead) return;
      // Count only received messages actually displayed; a concurrently arriving message stays unread.
      const received = await tx.get(ref.collection('messages').where('sequence', '==', sequence).limit(1));
      if (received.empty) fail('invalid-argument', '既読位置が見つかりません。');
      const count = received.docs[0].data().receivedCounts?.[uid] || 0;
      tx.update(ref, {
        [`readSequences.${uid}`]: sequence,
        [`readCounts.${uid}`]: count,
      });
    });
    return { ok: true };
  };
  const setDevice = async (uid, data) => {
    if (!id(data?.installationId) || !['ios', 'android'].includes(data?.platform) || typeof data.enabled !== 'boolean') fail('invalid-argument', '端末情報が不正です。');
    if (data.enabled && (typeof data.token !== 'string' || !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(data.token))) fail('invalid-argument', '通知トークンが不正です。');
    const ref = db.doc(`dmDevices/${hash(data.installationId)}`);
    await db.runTransaction(async (tx) => {
      const [own, device] = await Promise.all([tx.get(account(uid)), tx.get(ref)]);
      if (own.data()?.deleting && data.enabled) fail('failed-precondition', 'アカウント削除中です。');
      const duplicates = data.enabled ? await tx.get(db.collection('dmDevices').where('token', '==', data.token)) : null;
      if (!data.enabled) {
        if (device.data()?.userId === uid || data.resetInstallation === true) tx.delete(ref);
      } else {
        // Reinstalling can preserve the Expo token while changing the installation ID.
        // A token has one current owner, so an old account cannot notify that device.
        duplicates.docs.forEach((snapshot) => { if (snapshot.id !== ref.id) tx.delete(snapshot.ref); });
        tx.set(ref, { userId: uid, token: data.token, platform: data.platform, updatedAt: Date.now() });
      }
    });
    return { ok: true };
  };
  const deleteAccountMessages = async (uid) => {
    // Persistent tombstone serializes with send/device transactions and survives Auth deletion.
    await account(uid).set({ deleting: true }, { merge: true });
    const threads = await db.collection('dmConversations').where('userIds', 'array-contains', uid).get();
    for (const thread of threads.docs) {
      await thread.ref.update({ closed: true, deletedUserIds: FieldValue.arrayUnion(uid), [`memberProfiles.${uid}`]: { displayName: '削除されたユーザー', photoUrl: null } });
      while (true) {
        const messages = await thread.ref.collection('messages').where('senderUserId', '==', uid).where('deleted', '==', false).limit(300).get();
        if (messages.empty) break;
        const batch = db.batch();
        messages.docs.forEach((doc) => batch.update(doc.ref, { text: '', deleted: true }));
        await batch.commit();
      }
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(thread.ref)).data();
        if (current.lastMessage?.senderUserId === uid) tx.update(thread.ref, { 'lastMessage.text': '削除されたメッセージ' });
      });
    }
    for (const [collection, field] of [['dmDevices', 'userId'], ['dmNotificationJobs', 'senderUserId'], ['dmNotificationJobs', 'recipientUserId']]) {
      while (true) {
        const items = await db.collection(collection).where(field, '==', uid).limit(300).get();
        if (items.empty) break;
        const batch = db.batch();
        items.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    }
    // Retain only the minimal deletion gate; never retain a name, token, or message body here.
    await account(uid).set({ deleting: true });
  };
  return { send, markRead, setDevice, deleteAccountMessages };
};
module.exports = { createDMService, requireUser, readSendInput, pairId, isConnected, identity, hash };
