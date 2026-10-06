const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const sourceAliases = (id) => id.startsWith('note:') ? [id, id.slice(5)] : [id];
const sourceKey = (uid, id) => createHash('sha256').update(`${uid}\0${id}`).digest('hex');
const compareVersion = (a, b) => a.updatedAt - b.updatedAt || String(a.deviceId).localeCompare(String(b.deviceId));
const validateRequest = (data, ErrorType) => {
  const fail = (message) => { throw new ErrorType('invalid-argument', message); };
  if (!data || typeof data.sourceId !== 'string' || !data.sourceId || data.sourceId.length > 256 || data.sourceId.includes('/')) fail('元メモの識別情報が不正です。');
  if (!['sync', 'publish', 'unpublish', 'delete'].includes(data.operation)) fail('公開操作が不正です。');
  if (!Number.isSafeInteger(data.version?.updatedAt) || data.version.updatedAt < 0 || typeof data.version.deviceId !== 'string' || data.version.deviceId.length > 128) fail('編集の世代情報が不正です。');
  if (typeof data.body !== 'string' || !(data.title === null || typeof data.title === 'string') || (!['delete', 'unpublish'].includes(data.operation) && (data.title?.trim().length || 0) > 200)) fail('タイトルまたは本文が不正です。');
  if (!['delete', 'unpublish'].includes(data.operation) && Buffer.byteLength(JSON.stringify({ title: data.title, body: data.body }), 'utf8') > 900000) fail('投稿データが保存可能な上限を超えています。');
  if (!['delete', 'unpublish'].includes(data.operation) && !data.body.trim()) fail('公開する本文を入力してください。');
  return data;
};
const contentPatch = (post, input, timestamp) => ['delete', 'unpublish'].includes(input.operation) ? { status: 'unpublished', publishedAt: null, updatedAt: timestamp } : ({
  title: input.title?.trim() || null, body: input.body, tags: [...new Set(Array.from(input.body.matchAll(/(?:^|\s)[#＃]([^\s#＃()（）\[\]{}<>、。！？!?,，．:：;；]+)/gu), x => x[1].normalize('NFKC').trim().toLocaleLowerCase()))].slice(0, 5),
  updatedAt: timestamp,
  ...(input.operation === 'delete' || input.operation === 'unpublish' ? { status: 'unpublished', publishedAt: null } : {}),
  ...(input.operation === 'publish' ? { status: 'published', publishedAt: post.status === 'published' ? post.publishedAt : timestamp } : {}),
});
module.exports = { sourceAliases, sourceKey, compareVersion, validateRequest, contentPatch };
