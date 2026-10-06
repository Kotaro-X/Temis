import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
function render(user: any, accountUserId: string | null, authStatus: string, visible = true) {
  const exports: any = {};
  const code = ts.transpileModule(readFileSync('src/components/CommunityAccessBoundary.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'react') return { Fragment: 'Fragment', createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) };
    if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator' };
    if (name.endsWith('CloudSyncContext')) return { useCloudSyncContext: () => ({ user, authStatus }) };
    if (name.endsWith('CollaborationContext')) return { useCollaboration: () => ({ accountUserId }) };
    if (name.endsWith('AppUIContext')) return { useAppUI: () => ({ openSettingsAccount() {}, openMenu() {} }) };
    throw new Error(name);
  } });
  return exports.default({ visible, title: 'Commons', contentPaddingTop: 0, children: 'community-content' });
}
test('anonymous, logout, restoration and account mismatch never mount community content', () => {
  for (const [user, uid, status] of [[null, null, 'signedOut'], [null, 'alice', 'signedOut'], [{ id: 'alice' }, 'alice', 'restoring'], [{ id: 'alice' }, 'bob', 'signedIn']]) {
    const result = render(user, uid as string | null, status as string);
    assert.equal(result.type, 'View');
    assert.doesNotMatch(JSON.stringify(result), /community-content/);
  }
  assert.equal(render({ id: 'alice' }, 'alice', 'signedIn').type, 'Fragment');
  assert.equal(render({ id: 'alice' }, 'alice', 'signedIn', false).type, 'Fragment');
  assert.equal(render(null, null, 'signedOut', false), null);
});
