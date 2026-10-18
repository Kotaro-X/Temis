import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { safetyDb } from './helpers/reviewSafetyDb.ts';
const require = createRequire(import.meta.url);
const core = require('../functions/reviewSafetyCore.cjs');
const { updatePublication } = require('../functions/guildPublication.cjs');
const consent = { userId: 'alice', granted: true, version: 1, revision: 'permission-1' };
const input = { userId: 'alice', consentRevision: consent.revision, sourceId: 'note:one', operation: 'publish', scope: 'personal', projectId: null, type: 'personal', title: 'Test', body: 'Public body', version: { updatedAt: 1, deviceId: 'phone' } };
async function fixture() {
  const db = safetyDb(); await db.doc('profiles/alice').set({ displayName: 'Alice', profileVisibility: 'public', photoUrl: null });
  await db.doc('aiConsents/alice').set(consent); return db;
}
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
test('no consent or stale permission invokes no external moderation', async () => {
  const db = await fixture(); let sends = 0; const moderate = async () => { sends++; return true; };
  await db.doc('aiConsents/alice').delete();
  await assert.rejects(updatePublication(db, 'alice', input, moderate), { code: 'failed-precondition' });
  await db.doc('aiConsents/alice').set({ ...consent, revision: 'new' });
  await assert.rejects(updatePublication(db, 'alice', input, moderate), { code: 'failed-precondition' });
  assert.equal(sends, 0); assert.equal((await db.collection('guildPosts').get()).size, 0);
});
test('moderation permits safe text, rejects flagged content and fails closed on upstream errors', async () => {
  const db = await fixture();
  const first = await updatePublication(db, 'alice', input, async () => true);
  assert.equal(first.posts[0].status, 'published'); assert.equal(first.posts[0].safety.status, 'approved');
  await assert.rejects(updatePublication(db, 'alice', { ...input, body: 'Rejected', operation: 'sync', version: { updatedAt: 2, deviceId: 'phone' } }, async () => false), { code: 'failed-precondition' });
  const post = (await db.doc(`guildPosts/${first.posts[0].id}`).get()).data(); assert.equal(post.status, 'unpublished'); assert.equal(post.safety.status, 'rejected');
  await assert.rejects(updatePublication(db, 'alice', { ...input, body: 'Retry', version: { updatedAt: 3, deviceId: 'phone' } }, async () => { throw new Error('upstream'); }), { code: 'unavailable' });
  assert.equal((await db.doc(`guildPosts/${post.id}`).get()).data().safety.status, 'failed');
});
test('unpublish during moderation prevents the late result from restoring publication', async () => {
  const db = await fixture(); const entered = gate(); const finish = gate();
  const pending = updatePublication(db, 'alice', input, async () => { entered.release(); await finish.promise; return true; });
  await entered.promise;
  const result = await updatePublication(db, 'alice', { ...input, operation: 'unpublish', body: '', version: { updatedAt: 2, deviceId: 'phone' } });
  assert.equal(result.posts[0].status, 'unpublished'); finish.release();
  await assert.rejects(pending, { code: 'aborted' });
  assert.equal((await db.doc(`guildPosts/${result.posts[0].id}`).get()).data().status, 'unpublished');
});
test('newer edit wins even if older moderation finishes later', async () => {
  const db = await fixture(); const entered = gate(); const finish = gate();
  const old = updatePublication(db, 'alice', input, async () => { entered.release(); await finish.promise; return true; });
  await entered.promise;
  const current = await updatePublication(db, 'alice', { ...input, operation: 'sync', body: 'Latest', version: { updatedAt: 2, deviceId: 'phone' } }, async () => true);
  finish.release(); await assert.rejects(old, { code: 'aborted' });
  assert.equal(current.posts[0].body, 'Latest'); assert.equal((await db.doc(`guildPosts/${current.posts[0].id}`).get()).data().body, 'Latest');
});
test('revocation cancels pending publication and re-agreement never republishes existing posts', async () => {
  const db = await fixture(); const entered = gate(); const finish = gate();
  const pending = updatePublication(db, 'alice', input, async () => { entered.release(); await finish.promise; return true; });
  await entered.promise; await core.updateConsent(db, 'alice', { version: 1, granted: false }); finish.release();
  await assert.rejects(pending, { code: 'aborted' });
  const value = await core.updateConsent(db, 'alice', { version: 1, granted: true });
  assert.notEqual(value.revision, consent.revision);
  const posts = await db.collection('guildPosts').get(); assert.ok(posts.docs.every((doc: any) => doc.data().status === 'unpublished'));
  assert.equal((await core.updateConsent(db, 'alice', { version: 1, granted: true })).revision, value.revision);
});
test('staff-hidden post stays hidden after successful recheck', async () => {
  const db = await fixture(); const entered = gate(); const finish = gate();
  const pending = updatePublication(db, 'alice', input, async () => { entered.release(); await finish.promise; return true; });
  await entered.promise; const post = (await db.collection('guildPosts').get()).docs[0]; await post.ref.update({ moderation: { visibility: 'hidden' } });
  finish.release(); const result = await pending; assert.equal(result.posts[0].status, 'unpublished');
});
test('two users can independently block and unblock without restoring connection', async () => {
  const db = safetyDb(); await core.setBlock(db, 'alice', { otherUserId: 'bob', blocked: true });
  await core.setBlock(db, 'bob', { otherUserId: 'alice', blocked: true });
  await core.setBlock(db, 'alice', { otherUserId: 'bob', blocked: false });
  const saved = (await db.doc('connections/alice__bob').get()).data(); assert.deepEqual(saved.blockedByUserIds, ['bob']); assert.equal(saved.status, 'blocked');
  await core.setBlock(db, 'bob', { otherUserId: 'alice', blocked: false }); assert.equal((await db.doc('connections/alice__bob').get()).exists, false);
  await assert.rejects(core.setBlock(db, 'alice', { otherUserId: 'alice', blocked: true }), { code: 'invalid-argument' });
});
test('legacy blocks are preserved when the other user adds or removes their own block', async () => {
  const db = safetyDb(); await db.doc('connections/alice__bob').set({ id: 'alice__bob', userIds: ['alice','bob'], status: 'blocked', blockedByUserId: 'alice' });
  await core.setBlock(db, 'bob', { otherUserId: 'alice', blocked: false }); assert.deepEqual((await db.doc('connections/alice__bob').get()).data().blockedByUserIds, ['alice']);
});
test('DM reports require membership, retain only the reported message, and deduplicate', async () => {
  const db = safetyDb(); await db.doc('dmConversations/thread').set({ userIds: ['alice','bob'] });
  await db.doc('dmConversations/thread/messages/message').set({ senderUserId: 'bob', text: 'Evidence', createdAt: 1, deleted: false });
  await db.doc('dmConversations/thread/messages/other').set({ senderUserId: 'bob', text: 'Unreported private message', createdAt: 2 });
  const request = { conversationId: 'thread', messageId: 'message', reason: 'Harassment' };
  await assert.rejects(core.reportMessage(db, 'mallory', request), { code: 'permission-denied' });
  const report = await core.reportMessage(db, 'alice', request); assert.deepEqual(await core.reportMessage(db, 'alice', request), report);
  const saved = (await db.doc(`dmReports/${report.id}`).get()).data(); assert.equal(saved.evidence.text, 'Evidence'); assert.equal(JSON.stringify(saved).includes('Unreported'), false);
  assert.equal((await db.collection('dmReports').get()).size, 1);
});
test('Moderation API sends exactly the disclosed text and refuses malformed or failed results', async () => {
  let payload: any; const fetcher = async (_url: string, options: any) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ results: [{ flagged: false }] }) }; };
  assert.equal(await core.moderateText('test', input, fetcher), true); assert.equal(payload.input, 'Test\nPublic body');
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ results: [] }) }, { ok: true, json: async () => ({ results: [{ flagged: 'false' }] }) }]) await assert.rejects(core.moderateText('test', input, async () => response), { code: 'unavailable' });
});
test('migration flags old, unconsented and mismatched-permission posts without sending to AI', () => {
  const { needsSafetyMigration } = require('../scripts/review-safety-migration-core.cjs');
  const approved = { status: 'published', title: input.title, body: input.body, safety: { status: 'approved', version: 1, consentRevision: consent.revision, contentHash: core.contentHash(input) } };
  assert.equal(needsSafetyMigration(approved, consent), false);
  assert.equal(needsSafetyMigration({ ...approved, body: 'changed after approval' }, consent), true);
  assert.equal(needsSafetyMigration({ ...approved, safety: { ...approved.safety, sourceConsents: [{ userId: 'bob', revision: 'bob-consent' }] } }, consent), true);
  assert.equal(needsSafetyMigration({ status: 'published' }, consent), true);
  assert.equal(needsSafetyMigration(approved, { ...consent, granted: false }), true);
  assert.equal(needsSafetyMigration(approved, { ...consent, revision: 'new' }), true);
  assert.equal(needsSafetyMigration({ ...approved, status: 'unpublished' }, null), false);
});
test('shared sources require the actual creator permission and revoke dependent publications', async () => {
  const db = await fixture(); await db.doc('projects/p').set({ id: 'p' }); await db.doc('projects/p/members/alice').set({ role: 'member' });
  await db.doc('projectAccessStates/alice').set({ status: 'ready', freeProjectId: 'p' });
  await db.doc('projectNotes/shared').set({ id: 'shared', sourceNoteId: 'shared', projectId: 'p', creatorUserId: 'bob', ownerUserId: 'alice', title: 'Shared', body: 'Canonical' });
  const shared = { ...input, sourceId: 'note:shared', scope: 'project', projectId: 'p' }; let sends = 0;
  const moderate = async () => { sends++; return true; };
  await assert.rejects(updatePublication(db, 'alice', shared, moderate), { code: 'failed-precondition' }); assert.equal(sends, 0);
  await db.doc('aiConsents/bob').set({ ...consent, userId: 'bob', revision: 'bob-consent' });
  const result = await updatePublication(db, 'alice', shared, moderate); assert.equal(result.posts[0].status, 'published');
  await core.updateConsent(db, 'bob', { granted: false, version: 1 });
  assert.equal((await db.doc(`guildPosts/${result.posts[0].id}`).get()).data().status, 'unpublished');
});
test('shared retrieval reads canonical text only for members and a consenting creator', async () => {
  const { loadConsentedProjectNote } = require('../functions/reviewSharedNotesCore.cjs');
  const db = await fixture(); await db.doc('projectNotes/shared').set({ id: 'shared', projectId: 'p', creatorUserId: 'bob', ownerUserId: 'alice', title: 'Shared', body: 'Canonical' });
  await assert.rejects(loadConsentedProjectNote(db, 'alice', 'p', 'shared', async () => {}), { code: 'permission-denied' });
  await db.doc('projects/p/members/alice').set({ role: 'viewer' });
  await assert.rejects(loadConsentedProjectNote(db, 'alice', 'p', 'shared', async () => {}), { code: 'failed-precondition' });
  await db.doc('aiConsents/bob').set({ ...consent, userId: 'bob' });
  const note = await loadConsentedProjectNote(db, 'alice', 'p', 'shared', async () => {}); assert.equal(note.body, 'Canonical');
  await assert.rejects(loadConsentedProjectNote(db, 'alice', 'p', 'shared', async () => { throw Object.assign(new Error('restricted'), { code: 'permission-denied' }); }), { code: 'permission-denied' });
  await db.doc('projectNotes/shared').update({ anonymizedReason: 'project_exit', creatorUserId: null });
  await assert.rejects(loadConsentedProjectNote(db, 'alice', 'p', 'shared', async () => {}), { code: 'failed-precondition' });
});
test('a cancellation saved before the first publish prevents a late creation', async () => {
  const db = await fixture();
  await updatePublication(db, 'alice', { ...input, operation: 'unpublish', body: '', version: { updatedAt: 2, deviceId: 'phone' } });
  await assert.rejects(updatePublication(db, 'alice', input, async () => true), { code: 'aborted' });
  assert.equal((await db.collection('guildPosts').get()).size, 0);
});
test('Commons index never sends unapproved or unconsented posts, and discards revoked responses', async () => {
  const { createGuildIndexWriter } = require('../functions/guildAIIndex.cjs');
  const db = await fixture(); let sends = 0;
  const post = { id: 'post', authorUserId: 'alice', title: 'Test', body: 'Public body', status: 'published', moderation: { visibility: 'visible' }, safety: { status: 'approved', version: 1, consentRevision: consent.revision, contentHash: core.contentHash(input) } };
  const writer = createGuildIndexWriter({ db, FieldValue: { vector: (vector: any) => vector }, embeddingModel: 'text-embedding-3-small', requireAuthorConsent: (value: any) => core.requirePublicationConsent(db, value), requestEmbeddings: async () => { sends++; return [[1,2]]; } });
  await db.doc('guildPosts/post').set({ ...post, safety: { ...post.safety, status: 'pending' } }); assert.equal(await writer('post'), false); assert.equal(sends, 0);
  await db.doc('guildPosts/post').set(post); await db.doc('aiConsents/alice').delete(); assert.equal(await writer('post'), false); assert.equal(sends, 0);
  await db.doc('aiConsents/alice').set(consent);
  const revokeDuringRequest = createGuildIndexWriter({ db, FieldValue: { vector: (vector: any) => vector }, embeddingModel: 'text-embedding-3-small', requireAuthorConsent: (value: any) => core.requirePublicationConsent(db, value), requestEmbeddings: async () => { sends++; await core.updateConsent(db, 'alice', { version: 1, granted: false }); return [[1,2]]; } });
  assert.equal(await revokeDuringRequest('post'), false); assert.equal(sends, 1); assert.equal((await db.doc('guildPostAIIndex/post').get()).exists, false);
});
test('authenticated account changes cannot grant permission, block or report for another account', async () => {
  const db = safetyDb();
  await assert.rejects(core.updateConsent(db, 'bob', { userId: 'alice', granted: true, version: 1 }), { code: 'permission-denied' });
  await assert.rejects(core.setBlock(db, 'bob', { userId: 'alice', otherUserId: 'mallory', blocked: true }), { code: 'permission-denied' });
  await assert.rejects(core.reportMessage(db, 'bob', { userId: 'alice', conversationId: 'thread', messageId: 'message', reason: 'test' }), { code: 'permission-denied' });
  assert.equal(db.values.size, 0);
});
