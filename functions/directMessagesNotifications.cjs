const { hash, isConnected } = require('./directMessagesCore.cjs');
const { randomUUID } = require('node:crypto');
const postExpo = async (endpoint, body) => {
  const response = await fetch(`https://exp.host/--/api/v2/push/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`expo-http-${response.status}`);
  const result = await response.json();
  if (result.errors?.length) throw new Error('expo-api-error');
  return result.data;
};

// A lease prevents trigger/scheduler overlap. Expo/APNs are at-least-once systems;
// the message itself is idempotent, but an ambiguous HTTP timeout can duplicate a push.
const processNotificationJob = async (db, ref, post = postExpo) => {
  const lease = randomUUID();
  const job = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const value = snapshot.data();
    if (!value || value.nextAttemptAt > Date.now()) return null;
    if (value.status === 'done') { tx.delete(ref); return null; }
    tx.update(ref, { lease, nextAttemptAt: Date.now() + 120000 });
    return value;
  });
  if (!job) return;
  const save = async (changes) => db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.data()?.lease !== lease) return false;
    tx.update(ref, changes);
    return true;
  });
  const finish = () => save({ status: 'done', deliveries: {}, nextAttemptAt: Date.now() + 86400000 });
  const deliveries = { ...(job.deliveries || {}) };
  try {
    const [thread, message, sender, recipient, connection] = await Promise.all([
      db.doc(`dmConversations/${job.conversationId}`).get(),
      db.doc(`dmConversations/${job.conversationId}/messages/${job.messageId}`).get(),
      db.doc(`dmAccounts/${job.senderUserId}`).get(), db.doc(`dmAccounts/${job.recipientUserId}`).get(),
      db.doc(`connections/${[job.senderUserId, job.recipientUserId].sort().join('__')}`).get(),
    ]);
    const data = message.data();
    if (!data || data.deleted || thread.data()?.closed || sender.data()?.deleting || recipient.data()?.deleting
      || !isConnected(connection.data(), job.senderUserId, job.recipientUserId)) { await finish(); return; }
    if (job.status === 'receipts') {
      const pending = Object.entries(deliveries).filter(([, item]) => item.ticket && !item.done);
      if (pending.length) {
        const receipts = await post('getReceipts', { ids: pending.map(([, item]) => item.ticket) });
        for (const [deviceId, item] of pending) {
          const result = receipts?.[item.ticket];
          if (!result) continue;
          if (result.details?.error === 'DeviceNotRegistered') {
            await removeInvalidDevice(db, deviceId, item.tokenHash);
          }
          item.done = true;
          item.result = result.status === 'ok' ? 'ok' : 'error';
        }
        if (pending.some(([, item]) => !item.done) && Date.now() - job.createdAt < 86400000) {
          await save({ deliveries, nextAttemptAt: Date.now() + 900000 }); return;
        }
      }
      await finish(); return;
    }
    if ((thread.data()?.readSequences?.[job.recipientUserId] || 0) >= data.sequence) { await finish(); return; }
    const devices = await db.collection('dmDevices').where('userId', '==', job.recipientUserId).get();
    for (const device of devices.docs) {
      if (deliveries[device.id]) continue;
      // Re-read ownership and deletion just before delivery; tokens may have moved to another account.
      const [current, senderState, recipientState, currentConnection] = await Promise.all([
        device.ref.get(), db.doc(`dmAccounts/${job.senderUserId}`).get(), db.doc(`dmAccounts/${job.recipientUserId}`).get(),
        connection.ref.get(),
      ]);
      if (senderState.data()?.deleting || recipientState.data()?.deleting
        || !isConnected(currentConnection.data(), job.senderUserId, job.recipientUserId)) { await finish(); return; }
      if (current.data()?.userId !== job.recipientUserId) continue;
      const token = current.data().token;
      const tickets = await post('send', [{
        to: token, title: thread.data()?.memberProfiles?.[job.senderUserId]?.displayName || 'Temisユーザー',
        body: data.text.slice(0, 100), sound: 'default', channelId: 'direct-messages',
        data: { type: 'dm', recipientUserId: job.recipientUserId, conversationId: job.conversationId, messageId: job.messageId },
      }]);
      const ticket = tickets?.[0];
      if (!ticket || (ticket.status !== 'ok' && !ticket.details?.error)) throw new Error('invalid-ticket');
      if (ticket.details?.error === 'DeviceNotRegistered') await removeInvalidDevice(db, device.id, hash(token));
      if (ticket.details?.error === 'MessageRateExceeded') throw new Error('expo-rate-limit');
      deliveries[device.id] = { ticket: ticket.id || null, tokenHash: hash(token), done: ticket.status !== 'ok' };
      if (!await save({ deliveries })) return;
    }
    await save({ status: 'receipts', deliveries, nextAttemptAt: Date.now() + 900000 });
  } catch {
    const attempts = (job.attempts || 0) + 1;
    await save({ attempts, deliveries, status: attempts >= 8 ? 'done' : job.status,
      nextAttemptAt: Date.now() + (attempts >= 8 ? 86400000 : Math.min(3600000, 30000 * 2 ** attempts)) });
    // No token, name, or message body in logs.
    console.warn('DM notification delivery deferred', { attempts });
  }
};
const removeInvalidDevice = async (db, deviceId, tokenHash) => db.runTransaction(async (tx) => {
  const ref = db.doc(`dmDevices/${deviceId}`);
  const snapshot = await tx.get(ref);
  if (snapshot.exists && hash(snapshot.data().token) === tokenHash) tx.delete(ref);
});
module.exports = { processNotificationJob };
