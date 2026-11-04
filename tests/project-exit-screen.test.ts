import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(nodes)
  : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = (tree: any): string => Array.isArray(tree) ? tree.map(text).join('')
  : typeof tree === 'string' ? tree : tree?.props ? text(tree.props.children) : '';

async function fixture(role: string, candidates: any[] = []) {
  const slots: any[] = [];
  let cursor = 0;
  let activeProjectId: string | null = null;
  const alerts: any[][] = [];
  const calls: any[][] = [];
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const project = { id: 'p', name: 'Test', taskEnabled: true };
  const context = { profile: { userId: 'alice' }, projects: [project], projectStatus: 'ready',
    overflowProjects: [{ project, role, transferCandidates: candidates }],
    leaveProject: (...args: any[]) => { calls.push(args); return pending; } };
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = value; }];
    },
    useRef: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (fn: any) => fn, useEffect: () => {},
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync('src/screens/ProjectsScreen.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'react') return react;
    if (name === 'react-native') return { ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Pressable', 'RefreshControl', 'ScrollView', 'Text', 'TextInput', 'View'].map(value => [value, value])),
      Alert: { alert: (...args: any[]) => alerts.push(args) }, StyleSheet: { create: (value: any) => value } };
    if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
    if (name.endsWith('CollaborationContext')) return { useCollaboration: () => context };
    if (name.endsWith('WorkspaceScopeTrigger') || name.endsWith('ProjectCreateModal') || name.endsWith('GoogleCalendarSettings')) return { __esModule: true, default: 'Stub' };
    if (name.endsWith('guildService')) return { listProjectJoinRequests: async () => [] };
    if (name.endsWith('collaborationService')) return {
      listProjectMembers: async () => [], listProjectSharedNotes: async () => [], listProjectTasks: async () => [],
      getProjectMember: async () => ({ role }),
    };
    throw new Error(name);
  } });
  const render = () => {
    cursor = 0;
    return exports.default({ visible: true, contentPaddingTop: 0, activeProjectId,
      onSelectProject: (id: string | null) => { activeProjectId = id; } });
  };
  const list = nodes(render()).find(node => node.type === 'FlatList');
  list.props.renderItem({ item: project }).props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  const button = (label: string) => nodes(render()).find(node => node.type === 'Pressable' && text(node) === label);
  return { alerts, calls, render, button, finish, active: () => activeProjectId };
}

test('project exit requires confirmation, prevents duplicate requests and clears the active project', async () => {
  const f = await fixture('member');
  f.button('プロジェクトから退出').props.onPress();
  assert.equal(f.calls.length, 0);
  assert.match(f.alerts[0][1], /匿名ユーザー/);
  const confirm = f.alerts[0][2].find((button: any) => button.style === 'destructive');
  confirm.onPress(); confirm.onPress();
  assert.equal(f.calls.length, 1);
  assert.equal(nodes(f.render()).find(node => node.props?.accessibilityState?.busy).props.disabled, true);
  f.finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.active(), null);
});

test('owner exit requires another member and submits the selected ownership transfer', async () => {
  const alone = await fixture('owner');
  assert.equal(alone.button('所有権を移譲して退出').props.disabled, true);
  const f = await fixture('owner', [{ userId: 'bob', label: 'Bob' }]);
  assert.equal(f.button('所有権を移譲して退出').props.disabled, true);
  nodes(f.render()).find(node => node.props?.accessibilityRole === 'radio').props.onPress();
  assert.equal(f.button('所有権を移譲して退出').props.disabled, false);
  f.button('所有権を移譲して退出').props.onPress();
  f.alerts[0][2].find((button: any) => button.style === 'destructive').onPress();
  assert.equal(f.calls[0][0], 'p'); assert.equal(f.calls[0][1], 'bob');
  f.finish();
  await new Promise(resolve => setImmediate(resolve));
});
