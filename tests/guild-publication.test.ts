import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { publicationContent } from '../src/services/guild/guildPublicationPolicy.ts';
import { extractGuildTags } from '../src/types/guild.ts';
const require = createRequire(import.meta.url);
const { compareVersion, contentPatch, validateRequest, sourceAliases, sourceKey } = require('../functions/guildPublicationCore.cjs');
class ErrorType extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
const input = { sourceId: 'note:one', operation: 'sync', title: ' title ', body: '新しい本文 #React ＃デザイン C# https://site/#anchor', version: { updatedAt: 2, deviceId: 'a' } };
test('canonical source aliases and source state are isolated per account', () => {
  assert.deepEqual(sourceAliases('note:one'), ['note:one', 'one']);
  assert.deepEqual(sourceAliases('tankyu:one'), ['tankyu:one']);
  assert.notEqual(sourceKey('alice', 'note:one'), sourceKey('bob', 'note:one'));
});
test('source content updates preserve publication timestamps, visibility and moderation', () => {
  const post = { status: 'unpublished', publishedAt: null, moderation: { visibility: 'hidden' } };
  const patch = contentPatch(post, input, 10);
  assert.equal(patch.title, 'title'); assert.equal(patch.body, input.body);
  assert.deepEqual(patch.tags, extractGuildTags(input.body));
  assert.equal('status' in patch, false); assert.equal('publishedAt' in patch, false); assert.equal('moderation' in patch, false);
  assert.equal(contentPatch({ status: 'published', publishedAt: 1 }, { ...input, operation: 'publish' }, 10).publishedAt, 1);
});
test('deleting or unpublishing a source does not expose the changed private draft', () => {
  assert.deepEqual(contentPatch({}, { ...input, operation: 'delete' }, 10), { status: 'unpublished', publishedAt: null, updatedAt: 10 });
  assert.equal(validateRequest({ ...input, body: '', operation: 'unpublish' }, ErrorType).operation, 'unpublish');
});
test('invalid public content and versions cannot enter publication state', () => {
  for (const bad of [{ body: '' }, { title: 'a'.repeat(201) }, { body: 'a'.repeat(900001) }, { sourceId: 'wrong/path' }, { version: { updatedAt: -1, deviceId: 'a' } }, { operation: 'unknown' }]) {
    assert.throws(() => validateRequest({ ...input, ...bad }, ErrorType));
  }
  assert.ok(compareVersion({ updatedAt: 1, deviceId: 'z' }, { updatedAt: 2, deviceId: 'a' }) < 0);
  assert.equal(compareVersion(input.version, input.version), 0);
});
test('local envelopes address notes, research, task memos and deletion independently', () => {
  const envelope: any = { record: { kind: 'note', data: { id: 'one', title: 'memo', body: 'body' } }, updatedAt: 10, deletedAt: null, isDeleted: false, deviceId: 'device' };
  assert.equal(publicationContent(envelope).sourceId, 'note:one');
  assert.equal(publicationContent({ ...envelope, record: { ...envelope.record, kind: 'research' } }).sourceId, 'tankyu:one');
  const deletion = publicationContent({ ...envelope, deletedAt: 20, isDeleted: true });
  assert.equal(deletion.updatedAt, 20); assert.equal(deletion.deleted, true);
  assert.equal(publicationContent({ ...envelope, record: { kind: 'taskMemo', data: { id: 'one', body: 'task' } } }).title, null);
});
