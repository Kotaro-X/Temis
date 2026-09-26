import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mergeMessages, unreadMessages, type DMConversation, type DirectMessage } from '../src/types/directMessages.ts';
import { dmNotificationTarget } from '../src/services/notifications/dmNotificationPolicy.ts';
const require = createRequire(import.meta.url);
const { requireUser, readSendInput, pairId, isConnected, identity } = require('../functions/directMessagesCore.cjs');

test('DM requires supported authentication and validates recipients and text', () => {
  assert.throws(() => requireUser({}), { code: 'unauthenticated' });
  for (const provider of ['apple.com', 'google.com']) {
    assert.equal(requireUser({ auth: { uid: 'a', token: { firebase: { sign_in_provider: provider } } } }), 'a');
  }
  assert.throws(() => requireUser({ auth: { uid: 'a', token: { firebase: { sign_in_provider: 'anonymous' } } } }), { code: 'permission-denied' });
  for (const text of ['', ' \n ', 'a'.repeat(4001)]) {
    assert.throws(() => readSendInput('a', { recipientUserId: 'b', clientMessageId: 'm', text }), { code: 'invalid-argument' });
  }
  assert.throws(() => readSendInput('a', { recipientUserId: 'a', clientMessageId: 'm', text: 'hi' }));
  assert.throws(() => readSendInput('a', { recipientUserId: 'b/c', clientMessageId: 'm', text: 'hi' }));
  assert.equal(readSendInput('a', { recipientUserId: 'b', clientMessageId: 'm', text: ' hi ' }).text, 'hi');
});
test('conversation ID is symmetric and unambiguous; malformed connections cannot authorize sends', () => {
  assert.equal(pairId('a', 'b'), pairId('b', 'a'));
  assert.notEqual(pairId('a__b', 'c'), pairId('a', 'b__c'));
  const connection = { status: 'connected', userIds: ['a', 'b'], requesterUserId: 'a', recipientUserId: 'b' };
  assert.equal(isConnected(connection, 'a', 'b'), true);
  assert.equal(isConnected({ ...connection, recipientUserId: 'a' }, 'a', 'b'), false);
  assert.equal(isConnected({ ...connection, status: 'blocked' }, 'a', 'b'), false);
  assert.equal(isConnected({ ...connection, userIds: ['a', 'b', 'c'] }, 'a', 'b'), false);
  assert.equal(identity({ displayName: 'Private Name', profileVisibility: 'private' }).displayName, 'Temisユーザー');
});
test('unread count excludes sent messages and cannot become negative', () => {
  const thread = { receivedCounts: { a: 4 }, readCounts: { a: 2 } } as unknown as DMConversation;
  assert.equal(unreadMessages(thread, 'a'), 2);
  assert.equal(unreadMessages(thread, 'b'), 0);
  assert.equal(unreadMessages({ ...thread, readCounts: { a: 5 } }, 'a'), 0);
});
test('paging retains messages crossing the live window and updates deletion tombstones', () => {
  const old = { id: 'old', sequence: 1, text: 'old' } as DirectMessage;
  const current = { id: 'current', sequence: 2, text: 'secret' } as DirectMessage;
  const updated = { ...current, text: '', deleted: true };
  const merged = mergeMessages([old, current], [updated]);
  assert.deepEqual(merged.map((item) => item.id), ['current', 'old']);
  assert.equal(merged[0].text, '');
});
test('notification navigation rejects another account, invalid paths and non-DM notifications', () => {
  const data = { type: 'dm', recipientUserId: 'a', conversationId: 'a'.repeat(64) };
  assert.equal(dmNotificationTarget(data, 'a')?.conversationId, data.conversationId);
  assert.equal(dmNotificationTarget(data, 'b'), null);
  assert.equal(dmNotificationTarget(data, null), null);
  assert.equal(dmNotificationTarget({ ...data, conversationId: '../x' }, 'a'), null);
  assert.equal(dmNotificationTarget({ ...data, type: 'todo' }, 'a'), null);
});
