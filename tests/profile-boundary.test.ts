import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const profile = { userId: 'alice', username: 'alice', displayName: 'Alice', usernameChangedAt: 1 };
const render = (collaboration: any, cloud: any) => {
  const exports: any = {};
  const react = { Fragment: 'Fragment', createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }), useState: (v: any) => [v, () => {}] };
  const code = ts.transpileModule(readFileSync('src/screens/ProfileSetupScreen.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'react') return react;
    if (name === 'react-native') return { KeyboardAvoidingView: 'KeyboardAvoidingView', ScrollView: 'ScrollView', View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'ios' }, StyleSheet: { create: (s: any) => s } };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name.endsWith('CollaborationContext')) return { useCollaboration: () => collaboration };
    if (name.endsWith('CloudSyncContext')) return { useCloudSyncContext: () => cloud };
    if (name.endsWith('ProfilePhotoEditor')) return {};
    throw new Error(name);
  } });
  return exports.default({ children: 'normal-app' });
};
test('auth restoration, signed-in pending profile and account switching never render normal app', () => {
  const states = [
    [{ profileSetupStatus: 'signed_out', profile: null, accountUserId: null }, { authStatus: 'restoring', user: null }],
    [{ profileSetupStatus: 'signed_out', profile: null, accountUserId: null }, { authStatus: 'signedIn', user: { id: 'alice' } }],
    [{ profileSetupStatus: 'checking', profile: null, accountUserId: 'alice' }, { authStatus: 'signedIn' }],
    [{ profileSetupStatus: 'checking', profile, accountUserId: 'bob' }, { authStatus: 'signedIn' }],
    [{ profileSetupStatus: 'required', profile: { ...profile, usernameChangedAt: null }, accountUserId: 'alice' }, { authStatus: 'signedIn' }],
  ];
  for (const [collaboration, cloud] of states) assert.equal(render(collaboration, cloud).type, 'KeyboardAvoidingView');
});
test('signed-out use and completed profiles pass through; foreground loading retains complete app', () => {
  assert.equal(render({ profileSetupStatus: 'signed_out', profile: null, accountUserId: null }, { authStatus: 'signedOut', user: null }).type, 'Fragment');
  for (const status of ['ready', 'loading', 'error']) assert.equal(render({ status, profileSetupStatus: 'complete', profile, accountUserId: 'alice' }, { authStatus: 'signedIn' }).type, 'Fragment');
});
