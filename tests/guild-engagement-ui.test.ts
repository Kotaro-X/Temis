import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

type Element = { type: any; props: any; children: any[] };
const createElement = (type: any, props: any, ...children: any[]): Element => ({ type, props: props ?? {}, children });
const collect = (node: any): Element[] => Array.isArray(node) ? node.flatMap(collect) : node?.children ? [node, ...node.children.flatMap(collect)] : [];
const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ActivityIndicator', 'ScrollView', 'TextInput', 'FlatList', 'SafeAreaView', 'KeyboardAvoidingView', 'RefreshControl'].map(name => [name, name]));
const load = (path: string, modules: Record<string, any>) => {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name];
  } });
  return module.exports.default;
};
const base = { postId: 'post', likeCount: 2, liked: false, saved: false, available: true };

test('engagement controls remain visible while loading or failed, with safe retry and selected icons', () => {
  const Bar = load('src/components/guild/GuildEngagementBar.tsx', {
    react: { createElement }, 'react-native': { ...native, StyleSheet: { create: (s: any) => s } },
    '@expo/vector-icons': { Ionicons: 'Icon', MaterialCommunityIcons: 'Icon' },
  });
  let likes = 0; let saves = 0; let retries = 0; let stopped = 0;
  const props = { busy: false, error: false, onRetry: () => retries++, onLike: () => likes++, onSave: () => saves++, onShowLikes: () => {} };
  for (const error of [false, true]) {
    const nodes = collect(Bar({ ...props, error }));
    assert.deepEqual(nodes.filter(n => n.type === 'Icon').map(n => n.props.name), ['heart-outline', 'bookmark-outline']);
    assert.ok(nodes.filter(n => n.type === 'Pressable').slice(0, 3).every(n => n.props.disabled));
    assert.equal(nodes.some(n => n.type === 'ActivityIndicator'), !error);
    if (error) nodes.find(n => n.props.accessibilityLabel === 'いいね・保存を再読み込み')!.props.onPress({ stopPropagation: () => stopped++ });
  }
  const selected = collect(Bar({ ...props, state: { ...base, liked: true, saved: true } }));
  const icons = selected.filter(n => n.type === 'Icon');
  assert.equal(icons[0].props.name, 'heart'); assert.equal(icons[0].props.color, '#ef4444');
  assert.equal(icons[1].props.name, 'bookmark'); assert.equal(icons[1].props.color, '#111827');
  for (const label of ['いいねを解除', '保存を解除']) selected.find(n => n.props.accessibilityLabel === label)!.props.onPress({ stopPropagation: () => stopped++ });
  assert.equal(likes, 1); assert.equal(saves, 1); assert.equal(retries, 1); assert.equal(stopped, 3);
  const busy = collect(Bar({ ...props, busy: true, state: base }));
  assert.equal(busy.find(n => n.props.accessibilityLabel === '投稿を保存')!.props.disabled, true);
});

const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>(yes => { resolve = yes; });
  return { promise, resolve };
};
const post = (id: string) => ({ id, authorUserId: 'author', authorDisplayName: 'Author', title: id, body: 'body', tags: [], publishedAt: 1 });
function screenFixture() {
  const slots: any[] = []; let position = 0; const pendingEffects: (() => void)[] = [];
  const memoSlot = (fn: () => any, deps: any[]) => {
    const i = position++; const old = slots[i];
    if (!old || deps.some((v, j) => v !== old.deps[j])) slots[i] = { deps, value: fn() };
    return slots[i].value;
  };
  const react = {
    createElement,
    useState: (value: any) => { const i = position++; if (!(i in slots)) slots[i] = value; return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef: (value: any) => { const i = position++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
    useMemo: memoSlot, useCallback: (fn: any, deps: any[]) => memoSlot(() => fn, deps),
    useEffect: (effect: () => any, deps: any[]) => {
      const i = position++; const old = slots[i];
      if (!old || deps.some((v, j) => v !== old.deps[j])) {
        pendingEffects.push(() => { old?.cleanup?.(); slots[i].cleanup = effect(); }); slots[i] = { deps };
      }
    },
  };
  const requests: { kind: string; input: any; task: ReturnType<typeof deferred> }[] = [];
  const request = (kind: string, input: any) => { const task = deferred(); requests.push({ kind, input, task }); return task.promise; };
  const engagement = { states: {}, busy: {}, errors: {}, load: async () => {}, toggle: async () => ({ ...base, saved: false }) };
  const profile = { userId: 'alice' }; const connections: any[] = [];
  const modules: Record<string, any> = {
    react, 'react-native': { ...native, StyleSheet: { create: (s: any) => s }, Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width: 375 }), Alert: { alert: () => {} } },
    '@expo/vector-icons': { Ionicons: 'Icon', MaterialCommunityIcons: 'Icon' },
    '../components/guild/useGuildEngagement': { __esModule: true, default: () => engagement },
    '../services/guild/guildEngagementService': { listSavedGuildPosts: (uid: string, cursor: any) => request('saved', { uid, cursor }) },
    '../services/sync/firebaseApp': { getFirebaseAuth: () => ({ currentUser: { uid: 'alice' } }) },
    '../context/DirectMessagesContext': { useDirectMessages: () => ({ connections }) },
    '../services/ai/aiConsent': { subscribeAIInvalidation: () => () => {} },
    '../services/guild/guildAuthorService': { resolveGuildAuthors: async (p: any) => p },
    '../context/CollaborationContext': { useCollaboration: () => ({ profile, status: 'ready', inviteableProjects: [] }) },
    '../context/TemisAIUsageContext': { useTemisAIUsage: () => ({ refresh: async () => {} }), formatTemisAIUsageLabel: () => '' },
    '../context/AppUIContext': { useAppUI: () => ({}) },
    '../services/guild/guildService': { listGuildPosts: (input: any) => request('feed', input) },
    '../services/guild/guildAISearch': { searchGuildPostsWithAI: () => request('ai', {}) },
    '../services/guild/guildSourceReader': {}, '../services/collaboration/collaborationService': {}, '../types/collaboration': {},
    '../types/guild': { extractGuildTags: (s: string) => s.startsWith('#') ? [s.slice(1)] : [] },
    '../utils/wikiLink': { extractTokens: () => [], normalizeParens: (s: string) => s },
    '../services/freemium/temisFreemiumService': { createAIRequestId: () => 'request' },
  };
  for (const name of ['app-shell/WorkspaceScopeTrigger', 'common/ReportReasonModal', 'common/KeyboardAwareModal', 'UserAvatar', 'guild/GuildEngagementBar', 'guild/GuildLikesModal', 'guild/CommonsRequestsButton', 'guild/GuildPostComposerModal', 'ai/AIAnswerEvidencePanel', 'ai/TemisAIDock', 'TokenChips']) modules[`../components/${name}`] = { __esModule: true, default: name.split('/').at(-1) };
  const Screen = load('src/screens/GuildScreen.tsx', modules);
  const props = { visible: true, contentPaddingTop: 0, onOpenMenu: () => {} };
  const Content = Screen(props).type;
  const render = () => { position = 0; const tree = Content(props); pendingEffects.splice(0).forEach(fn => fn()); return collect(tree); };
  return { render, requests, props };
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

test('saved tab clears text/tags and AI, ignores late AI/feed responses and pages saved posts', async () => {
  const f = screenFixture(); let nodes = f.render();
  f.requests[0].task.resolve({ posts: [post('public')], cursor: null }); await flush(); nodes = f.render();
  nodes.find(n => n.type === 'TextInput')!.props.onChangeText('#old'); nodes = f.render();
  const oldFeed = f.requests.at(-1)!;
  nodes.find(n => n.type === 'TemisAIDock')!.props.onChangeQuery('old question'); nodes = f.render();
  const dock = nodes.find(n => n.type === 'TemisAIDock')!; dock.props.onToggle(); dock.props.onSearch(); nodes = f.render();
  const ai = f.requests.find(r => r.kind === 'ai')!;
  const savedTab = nodes.find(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === '保存済み');
  assert.ok(savedTab, 'saved feed is available as an accessible tab');
  assert.equal(savedTab.props.accessibilityState.selected, false);
  assert.equal(collect(savedTab).find(n => n.type === 'Icon')!.props.name, 'bookmark-outline');
  savedTab.props.onPress(); nodes = f.render();
  const selectedSavedTab = nodes.find(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === '保存済み')!;
  assert.equal(selectedSavedTab.props.accessibilityState.selected, true);
  assert.equal(collect(selectedSavedTab).find(n => n.type === 'Icon')!.props.name, 'bookmark');
  assert.equal(nodes.find(n => n.type === 'TextInput')!.props.value, '');
  const closed = nodes.find(n => n.type === 'TemisAIDock')!;
  assert.equal(closed.props.query, ''); assert.equal(closed.props.expanded, false); assert.equal(closed.props.searchDisabled, false);
  const saved = f.requests.at(-1)!; assert.equal(saved.kind, 'saved');
  assert.equal(saved.input.uid, 'alice');
  const requestCount = f.requests.length;
  selectedSavedTab.props.onPress(); nodes = f.render();
  assert.equal(f.requests.length, requestCount, 'reselecting the active tab keeps the pending request valid');
  saved.task.resolve({ posts: [post('saved')], cursor: { createdAt: 2, id: 'saved' } });
  oldFeed.task.resolve({ posts: [post('stale')], cursor: null });
  ai.task.resolve({ answer: 'old answer', evidencePosts: [], citations: [] }); await flush(); nodes = f.render();
  let list = nodes.find(n => n.type === 'FlatList')!;
  assert.deepEqual(list.props.data.map((p: any) => p.id), ['saved']);
  assert.equal(nodes.some(n => n.type === 'AIAnswerEvidencePanel'), false);
  list.props.onEndReached(); const more = f.requests.at(-1)!;
  assert.equal(more.input.cursor.id, 'saved');
  more.task.resolve({ posts: [post('saved'), post('second')], cursor: null }); await flush(); nodes = f.render();
  list = nodes.find(n => n.type === 'FlatList')!;
  assert.deepEqual(Array.from(list.props.data, (p: any) => p.id), ['saved', 'second']);
  const bar = collect(list.props.renderItem({ item: list.props.data[0] })).find(n => n.type === 'GuildEngagementBar')!;
  bar.props.onSave(); await flush(); nodes = f.render();
  assert.deepEqual(Array.from(nodes.find(n => n.type === 'FlatList')!.props.data, (p: any) => p.id), ['second']);
});

test('hiding Commons rejects pending feed response across a later reopening', async () => {
  const f = screenFixture(); f.render(); const old = f.requests[0];
  f.props.visible = false; f.render(); f.props.visible = true; f.render();
  const fresh = f.requests.at(-1)!;
  fresh.task.resolve({ posts: [post('fresh')], cursor: null }); await flush();
  old.task.resolve({ posts: [post('old')], cursor: null }); await flush();
  assert.deepEqual(f.render().find(n => n.type === 'FlatList')!.props.data.map((p: any) => p.id), ['fresh']);
});
