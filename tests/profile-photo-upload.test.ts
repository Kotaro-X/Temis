import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

function fixture(failure?: string) {
  const calls: any[] = [];
  const exports: any = {};
  let current = true;
  const code = ts.transpileModule(readFileSync('src/services/collaboration/profilePhotoUpload.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    exports, URL, Blob: class { constructor() { throw new Error('ArrayBuffer Blob is unsupported'); } },
    fetch: async (url: string, options: any) => {
      calls.push(['start', url, options]);
      if (failure === 'network') throw new Error('offline');
      if (failure === 'switch') current = false;
      return { ok: !['401', '403', '404', '429', '500', 'api-disabled'].includes(failure!), status: failure === 'api-disabled' ? 403 : Number(failure) || 200,
        json: async () => failure === 'api-disabled' ? { error: { details: [{ reason: 'SERVICE_DISABLED' }] } } : { error: { message: 'Not Found.' } },
        headers: { get: () => failure === 'host' ? 'https://wrong.example/upload' : 'https://firebasestorage.googleapis.com/upload-session' } };
    },
    require: (name: string) => {
      if (name !== 'expo-file-system/legacy') throw new Error(name);
      return { FileSystemUploadType: { BINARY_CONTENT: 0 }, FileSystemSessionType: { FOREGROUND: 1 }, uploadAsync: async (...args: any[]) => {
        calls.push(['file', ...args]);
        if (failure === 'upload') throw new Error('native upload failed');
        if (failure === 'switch-final') current = false;
        return { status: failure === 'upload-403' ? 403 : 200, headers: { 'x-goog-upload-status': failure === 'unfinished' ? 'active' : 'final' } };
      } };
    },
  });
  const run = () => exports.uploadProfilePhotoFile({ uri: 'file:///avatar.jpg', size: 9226, bucket: 'demo-wememo', path: 'profilePhotos/alice/photo.jpg', token: 'test-token', isCurrentAccount: () => current });
  return { run, calls };
}
test('upload uses authenticated JSON metadata then native raw file bytes without any Blob', async () => {
  const f = fixture(); await f.run();
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0][1], /name=profilePhotos%2Falice%2Fphoto.jpg/);
  assert.equal(f.calls[0][2].headers.Authorization, 'Firebase test-token');
  assert.equal(JSON.parse(f.calls[0][2].body).contentType, 'image/jpeg');
  assert.equal(f.calls[1][2], 'file:///avatar.jpg');
  assert.equal(f.calls[1][3].uploadType, 0);
  assert.equal(f.calls[1][3].headers['X-Goog-Upload-Command'], 'upload, finalize');
});
test('missing production bucket and disabled API are configuration errors, not connection or login errors', async () => {
  for (const reason of ['404', 'api-disabled']) {
    const f = fixture(reason);
    await assert.rejects(f.run(), (error: any) => {
      assert.equal(error.code, 'PHOTO_STORAGE_NOT_READY');
      assert.equal(error.stage, 'start');
      assert.equal(error.httpStatus, reason === '404' ? 404 : 403);
      assert.match(error.message, /保存先.*準備/);
      assert.doesNotMatch(error.message, /再ログイン|通信状態/);
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
});
test('HTTP failures, network errors, unexpected hosts and account switching never report upload success', async () => {
  for (const failure of ['network', '403', '500', 'host', 'switch', 'upload', 'upload-403', 'unfinished', 'switch-final']) {
    const f = fixture(failure);
    await assert.rejects(f.run(), /写真|アカウント/);
    if (['network', '403', '500', 'host', 'switch'].includes(failure)) assert.equal(f.calls.length, 1);
  }
});
