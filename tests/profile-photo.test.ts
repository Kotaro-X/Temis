import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { base64ByteLength, profilePhotoCrop } from '../src/services/collaboration/profilePolicy.ts';
function fixture(failure?: string) {
  const events: any[] = [];
  const nativeLoads: string[] = [];
  const auth = { currentUser: { uid: 'alice', getIdToken: async () => 'test-token' } };
  const exports: any = {};
  const profile = { userId: 'alice', photoUrl: 'new.jpg' };
  const code = ts.transpileModule(readFileSync('src/services/collaboration/profilePhotoService.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'expo-image-picker' || name === 'expo-image-manipulator') {
      nativeLoads.push(name);
      if (failure === `missing-${name}`) throw new Error(`Cannot find native module '${name === 'expo-image-picker' ? 'ExponentImagePicker' : 'ExpoImageManipulator'}'`);
    }
    if (name === 'expo-image-picker') return { launchImageLibraryAsync: async () => {
      if (failure === 'cancel') return { canceled: true };
      if (failure === 'switch') auth.currentUser = { uid: 'bob', getIdToken: async () => 'bob-token' };
      return { canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 1000, height: 800 }] };
    } };
    if (name === 'expo-image-manipulator') return { SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: async (_uri: string, actions: any, options: any) => { events.push(['image', actions, options]); return { uri: 'file:///processed.jpg' }; } };
    if (name === 'expo-file-system/legacy') return {
      getInfoAsync: async () => ({ exists: true, isDirectory: false, size: failure === 'large' ? 1500000 : 12000 }),
      deleteAsync: async (uri: string) => { events.push(['cleanup', uri]); },
    };
    if (name.endsWith('profilePhotoUpload')) return { uploadProfilePhotoFile: async (input: any) => {
      events.push(['upload', input]);
      if (failure === 'upload') throw new Error('upload failed');
      if (failure === 'switch-after-upload') auth.currentUser = { uid: 'bob', getIdToken: async () => 'bob-token' };
    } };
    if (name === 'expo-crypto') return { randomUUID: () => 'unique' };
    if (name === 'firebase/storage') return {
      getStorage: () => ({}), ref: (_storage: any, path: string) => ({ path, bucket: 'demo-wememo' }),
      getDownloadURL: async () => 'new.jpg',
    };
    if (name.endsWith('firebaseApp')) return { getFirebaseApp: () => ({}), getFirebaseAuth: () => auth };
    if (name.endsWith('collaborationService')) return { updateProfilePhoto: async (...args: any[]) => { events.push(['commit', ...args]); if (failure === 'commit') throw new Error('commit failed'); return profile; } };
    if (name.endsWith('profilePolicy')) return { base64ByteLength, profilePhotoCrop };
    throw new Error(name);
  } });
  return { service: exports, events, nativeLoads };
}
test('photo upload uses square 512px JPEG and commits only after upload succeeds', async () => {
  const f = fixture();
  await f.service.selectAndSaveProfilePhoto();
  assert.equal(f.events[0][1][1].resize.width, 512);
  assert.equal(f.events[0][1][1].resize.height, 512);
  assert.equal(f.events[0][2].format, 'jpeg');
  assert.equal(f.events[1][0], 'upload');
  assert.equal(f.events[0][2].base64, undefined);
  assert.equal(f.events[1][1].path, 'profilePhotos/alice/unique.jpg');
  assert.equal(f.events[1][1].uri, 'file:///processed.jpg');
  assert.equal(f.events[1][1].token, 'test-token');
  assert.equal(f.events[2][0], 'commit');
  assert.equal(f.events[2][1], 'alice');
  assert.equal(f.events[3][0], 'cleanup');
});
test('cancel, oversized photos and account switch make no writes; upload failure preserves previous profile', async () => {
  const canceled = fixture('cancel');
  assert.equal(await canceled.service.selectAndSaveProfilePhoto(), null);
  assert.equal(canceled.events.length, 0);
  for (const reason of ['large', 'switch', 'upload', 'switch-after-upload']) {
    const f = fixture(reason);
    await assert.rejects(f.service.selectAndSaveProfilePhoto());
    assert.equal(f.events.some((e) => e[0] === 'commit'), false);
    if (reason === 'large' || reason === 'switch') assert.equal(f.events.some((e) => e[0] === 'upload'), false);
    assert.equal(f.events.at(-1)[0], 'cleanup');
  }
  const f = fixture('commit');
  await assert.rejects(f.service.selectAndSaveProfilePhoto(), /commit failed/);
});
test('photo removal clears URL and owned object path together', async () => {
  const f = fixture();
  await f.service.removeProfilePhoto();
  assert.deepEqual(f.events, [['commit', 'alice', null, null]]);
});


test('missing native photo modules do not break startup or photo removal and selection gives an actionable error', async () => {
  for (const missing of ['expo-image-picker', 'expo-image-manipulator']) {
    const f = fixture(`missing-${missing}`);
    assert.equal(f.nativeLoads.length, 0);
    await f.service.removeProfilePhoto();
    await assert.rejects(f.service.selectAndSaveProfilePhoto(), /新しいアプリビルド/);
    assert.equal(f.events.some((e) => e[0] === 'upload'), false);
  }
});
