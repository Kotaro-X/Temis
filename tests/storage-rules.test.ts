import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, deleteObject, getBytes, listAll } from 'firebase/storage';
import { createMockUserToken } from '@firebase/util';
const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST;
if (!host) throw new Error('Storage Emulator is required for storage rules assertions.');
const [hostname, port] = host.split(':');
let env: RulesTestEnvironment;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-wememo', storage: { host: hostname, port: Number(port), rules: readFileSync(decodeURIComponent(new URL('../storage.rules', import.meta.url).pathname), 'utf8') } });
});
test.after(async () => { await env.cleanup(); });
test.afterEach(async () => { await env.clearStorage(); });
const jpeg = new Uint8Array([255, 216, 255, 217]);
test('owners upload public JPEG avatars; other users and anonymous writers are denied', async () => {
  const alice = env.authenticatedContext('alice').storage();
  const bob = env.authenticatedContext('bob').storage();
  const anon = env.unauthenticatedContext().storage();
  const path = 'profilePhotos/alice/avatar.jpg';
  await assertFails(uploadBytes(ref(bob, path), jpeg, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(anon, path), jpeg, { contentType: 'image/jpeg' }));
  await assertSucceeds(uploadBytes(ref(alice, path), jpeg, { contentType: 'image/jpeg' }));
  assert.equal((await assertSucceeds(getBytes(ref(anon, path)))).byteLength, jpeg.byteLength);
  await assertFails(listAll(ref(alice, 'profilePhotos/alice')));
  await assertFails(deleteObject(ref(bob, path)));
  await assertSucceeds(deleteObject(ref(alice, path)));
});
test('invalid content types, names, oversized data and overwrites are denied', async () => {
  const alice = env.authenticatedContext('alice').storage();
  await assertFails(uploadBytes(ref(alice, 'profilePhotos/alice/avatar.jpg'), jpeg, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(alice, 'profilePhotos/alice/avatar.txt'), jpeg, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(alice, 'profilePhotos/alice/large.jpg'), new Uint8Array(1024 * 1024 + 1), { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(alice, 'private/avatar.jpg'), jpeg, { contentType: 'image/jpeg' }));
  await assertSucceeds(uploadBytes(ref(alice, 'profilePhotos/alice/avatar.jpg'), jpeg, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(alice, 'profilePhotos/alice/avatar.jpg'), jpeg, { contentType: 'image/jpeg' }));
});

test('authenticated resumable JSON plus raw JPEG protocol respects owner Rules and public reads', async () => {
  const path = 'profilePhotos/alice/native-upload.jpg';
  const bucket = ref(env.authenticatedContext('alice').storage(), path).bucket;
  const base = `http://${host}/v0/b/${encodeURIComponent(bucket)}/o`;
  const start = async (uid: string, contentType = 'image/jpeg') => {
    const token = createMockUserToken({ sub: uid, user_id: uid }, 'demo-wememo');
    const headers = { Authorization: `Firebase ${token}`, 'Content-Type': 'application/json; charset=utf-8',
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(jpeg.byteLength), 'X-Goog-Upload-Header-Content-Type': contentType };
    const response = await fetch(`${base}?name=${encodeURIComponent(path)}`, { method: 'POST', headers,
      body: JSON.stringify({ name: path, contentType, cacheControl: 'public,max-age=86400' }) });
    if (!response.ok) return response;
    const url = response.headers.get('X-Goog-Upload-URL');
    assert.ok(url);
    return fetch(url, { method: 'POST', headers: { Authorization: `Firebase ${token}`, 'Content-Type': contentType,
      'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: jpeg });
  };
  assert.equal((await start('bob')).ok, false);
  assert.equal((await start('alice', 'image/png')).ok, false);
  const uploaded = await start('alice');
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.headers.get('X-Goog-Upload-Status'), 'final');
  assert.equal((await getBytes(ref(env.unauthenticatedContext().storage(), path))).byteLength, jpeg.byteLength);
});
