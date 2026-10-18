import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Render the real boundary with deterministic auth and server decisions.
function fixture() {
  const slots: any[] = []; let cursor = 0; const effects: (() => void)[] = [];
  let auth!: (user: { uid: string } | null) => void;
  let uid: string | null = null; let value: any = null; let failed = false;
  let save: (granted: boolean, expected: string) => Promise<any> = async (granted, expected) => {
    assert.equal(expected, uid); if (failed) throw new Error('offline');
    value = { userId: uid, granted, version: 1, revision: 'saved' }; return value;
  };
  const writes: any[] = [];
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef: (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect: (effect: () => void) => { const index = cursor++; if (!(index in slots)) { slots[index] = true; effects.push(effect); } },
  };
  const modules: Record<string, any> = {
    react, 'react-native': { ActivityIndicator: 'ActivityIndicator', Alert: {}, Linking: {}, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'firebase/firestore': { doc: () => ({}), onSnapshot: () => () => {} },
    'firebase/auth': { onAuthStateChanged: (_: any, listener: typeof auth) => { auth = listener; return () => {}; } },
    '../components/common/KeyboardAwareModal': { __esModule: true, default: 'Modal' },
    '../services/sync/firebaseApp': { isFirebaseConfigured: () => true, getFirebaseAuth: () => ({}), getFirebaseFirestore: () => ({}) },
    '../services/ai/aiConsent': {
      invalidateAIResults: () => {}, registerConsentPrompt: () => () => {}, readAIConsent: async () => value,
      hasAIConsentDecision: (decision: any, id: string) => Boolean(decision && decision.userId === id && decision.version === 1 && decision.revision && typeof decision.granted === 'boolean'),
      updateAIConsent: async (granted: boolean, expected: string) => { writes.push({ granted, expected }); return save(granted, expected); },
    },
    '../config/legalLinks': { PRIVACY_POLICY_URL: 'https://example.com' },
    './AppSettingsContext': { useAppSettings: () => ({ appLanguage: 'ja' }) },
    '../services/embeddingJobs': { resumeConsentedEmbeddingJobs: async () => {} },
    '../services/guild/guildPublicationQueue': { flushPublications: async () => {} },
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/context/AIConsentContext.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, { exports, Error, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  const flatten = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(flatten) : !tree || typeof tree !== 'object' || tree.type === 'Modal' && !tree.props.visible ? [] : [tree, ...flatten(tree.props?.children)];
  const content = (tree: any): string => Array.isArray(tree) ? tree.map(content).join('') : typeof tree === 'string' ? tree : tree?.type === 'Modal' && !tree.props.visible ? '' : tree?.props ? content(tree.props.children) : '';
  const render = () => { cursor = 0; const tree = exports.default({ children: 'APP_CONTENT' }); return {
    text: content(tree),
    press: (label: string) => { const button = flatten(tree).find(node => node.type === 'Pressable' && content(node) === label); assert.ok(button, label); return button.props.onPress(); },
  }; };
  render(); effects.forEach(effect => effect());
  return { render, writes, login: (id: string, decision: any = null) => { uid = id; value = decision; auth({ uid: id }); }, logout: () => { uid = null; auth(null); }, failSave: () => { failed = true; }, saveWith: (handler: typeof save) => { save = handler; } };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
test('first login collects one persisted decision before showing app content', async () => {
  const f = fixture(); f.login('alice'); await settle();
  assert.match(f.render().text, /OpenAIへのデータ送信/); assert.doesNotMatch(f.render().text, /APP_CONTENT/);
  f.render().press('同意する'); await settle(); assert.match(f.render().text, /APP_CONTENT/);
  assert.deepEqual(f.writes, [{ granted: true, expected: 'alice' }]);
  f.logout(); f.login('alice', { userId: 'alice', granted: true, version: 1, revision: 'saved' }); await settle();
  assert.match(f.render().text, /APP_CONTENT/); assert.equal(f.writes.length, 1);
});
test('refusal is persisted and later sign-in does not ask again', async () => {
  const f = fixture(); f.login('alice'); await settle(); f.render().press('同意しない'); await settle();
  assert.deepEqual(f.writes, [{ granted: false, expected: 'alice' }]); assert.match(f.render().text, /APP_CONTENT/);
  f.logout(); f.login('alice', { userId: 'alice', granted: false, version: 1, revision: 'saved' }); await settle();
  assert.doesNotMatch(f.render().text, /OpenAIへのデータ送信/); assert.match(f.render().text, /APP_CONTENT/);
});
test('failed persistence leaves the decision screen available for retry', async () => {
  const f = fixture(); f.login('alice'); await settle(); f.failSave(); f.render().press('同意する'); await settle();
  assert.match(f.render().text, /同意を保存できませんでした/); assert.doesNotMatch(f.render().text, /APP_CONTENT/);
});
test('a delayed account decision cannot dismiss the new account consent screen', async () => {
  const f = fixture(); f.login('alice'); await settle();
  let release!: (value: any) => void; f.saveWith(() => new Promise(resolve => { release = resolve; }));
  f.render().press('同意する'); f.login('bob'); await settle();
  release({ userId: 'alice', granted: true, revision: 'saved' }); await settle();
  assert.match(f.render().text, /OpenAIへのデータ送信/); assert.doesNotMatch(f.render().text, /APP_CONTENT/);
});
