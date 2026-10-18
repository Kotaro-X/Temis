import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { publicationContent } from '../src/services/guild/guildPublicationPolicy.ts';
function fixture() {
  const values = new Map<string, string>(); let uid: string | null = 'alice';
  let send: (data: any) => Promise<any> = async data => ({ data: { posts: [{ id: 'post', authorUserId: uid, body: data.body, title: data.title, status: 'published' }], revision: 1 } });
  const sent: any[] = [];
  const modules: Record<string, any> = {
    '../ai/aiConsent': { requireAIConsent: async () => ({ uid, revision: 'consent-1' }), validateConsentReceipt: async () => {} },
    '../account/accountWorkspace': { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); } },
    '../environment/runtimeEnvironment': { getEnvironmentEpoch: () => 0 },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'firebase/functions': { getFunctions: () => ({}), httpsCallable: () => async (data: any) => { sent.push(data); return send(data); } },
    'firebase/firestore': {},
    '../sync/firebaseApp': { isFirebaseConfigured: () => true, getFirebaseAuth: () => ({ currentUser: uid ? { uid } : null }), getFirebaseApp: () => ({}) },
    './guildPublicationPolicy': { publicationContent },
    '../../../storage': { loadSyncDeviceId: async () => 'device' },
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/services/guild/guildPublicationQueue.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, { exports, Error, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; }, setInterval, clearInterval, console });
  return { queue: exports, values, sent, switch: (next: string | null) => { uid = next; }, send: (handler: typeof send) => { send = handler; } };
}
const content = (body: string, updatedAt = 1) => ({ sourceId: 'note:one', title: null, body, updatedAt, deviceId: 'device', deleted: false });
const bind = (f: ReturnType<typeof fixture>) => f.queue.registerPublicationPosts('alice', 'note:one', [{ id: 'post', body: 'old', title: null, status: 'published' }]);
test('local-only memos never enter the public queue; bound changes persist without paid sync', async () => {
  const f = fixture(); await f.queue.enqueuePublicationContent(content('private')); assert.equal(f.values.size, 0);
  await bind(f); await f.queue.enqueuePublicationContent(content('new'));
  assert.equal((await f.queue.getPublicationState('alice', 'note:one')).pending.body, 'new');
});
test('failed requests retain changes and retry without claiming success', async () => {
  const f = fixture(); await bind(f); await f.queue.enqueuePublicationContent(content('new'));
  f.send(async () => { throw new Error('offline'); }); await f.queue.flushPublications();
  const state = await f.queue.getPublicationState('alice', 'note:one'); assert.equal(state.pending.body, 'new'); assert.equal(state.error, 'offline');
  f.send(async data => ({ data: { posts: [{ id: 'post', body: data.body }], revision: 1 } })); await f.queue.flushPublications(true);
  assert.equal((await f.queue.getPublicationState('alice', 'note:one')).pending, undefined);
});
test('a later local edit survives an acknowledgement of an in-flight older save', async () => {
  const f = fixture(); await bind(f); await f.queue.enqueuePublicationContent(content('first'));
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  f.send(async data => { await wait; return { data: { posts: [{ id: 'post', body: data.body }] } }; });
  const processing = f.queue.flushPublications();
  while (!f.sent.length) await new Promise(resolve => setImmediate(resolve));
  await f.queue.enqueuePublicationContent(content('second', 2)); release(); await processing;
  assert.equal((await f.queue.getPublicationState('alice', 'note:one')).pending.body, 'second');
});
test('account switch does not send old drafts or acknowledge them into the new account', async () => {
  const f = fixture(); await bind(f); await f.queue.enqueuePublicationContent(content('alice-only'));
  f.switch('bob'); await f.queue.flushPublications(); assert.equal(f.sent.length, 0);
  f.switch('alice');
  f.send(async data => { f.switch('bob'); return { data: { posts: [{ id: 'post', body: data.body }] } }; });
  await f.queue.flushPublications();
  assert.equal(f.sent[0].userId, 'alice'); assert.ok((await f.queue.getPublicationState('alice', 'note:one')).pending);
  assert.equal(await f.queue.getPublicationState('bob', 'note:one'), null);
});
test('deletion supersedes queued edits and remains persisted while offline', async () => {
  const f = fixture(); await bind(f); await f.queue.enqueuePublicationContent(content('new', 10));
  await f.queue.enqueuePublicationContent({ ...content('new', 11), deleted: true });
  assert.equal((await f.queue.getPublicationState('alice', 'note:one')).pending.operation, 'delete');
});

test('edits within the same millisecond receive different generations and stale source reads are ignored', async () => {
  const f = fixture(); await bind(f); await f.queue.enqueuePublicationContent(content('first', 10));
  const first = (await f.queue.getPublicationState('alice', 'note:one')).pending.version.updatedAt;
  await f.queue.enqueuePublicationContent(content('second', 10));
  assert.ok((await f.queue.getPublicationState('alice', 'note:one')).pending.version.updatedAt > first);
  await f.queue.enqueuePublicationContent(content('stale bootstrap', 9));
  assert.equal((await f.queue.getPublicationState('alice', 'note:one')).pending.body, 'second');
});
test('an async bootstrap cannot enqueue content after its originating account changed', async () => {
  const f = fixture(); await bind(f); f.switch('bob');
  await f.queue.enqueuePublicationContent(content('private alice'), 'publish', undefined, 'alice');
  assert.equal(await f.queue.getPublicationState('bob', 'note:one'), null);
});

test('edits preserve pending initial publication metadata and pending unpublish intent', async () => {
  const f = fixture();
  await f.queue.enqueuePublicationContent(content('initial', 10), 'publish', { scope: 'personal', type: 'personal', projectId: null });
  await f.queue.enqueuePublicationContent(content('edited', 11));
  let pending = (await f.queue.getPublicationState('alice', 'note:one')).pending;
  assert.equal(pending.operation, 'publish'); assert.equal(pending.type, 'personal'); assert.equal(pending.body, 'edited');
  await f.queue.enqueuePublicationContent(content('edited', 11), 'unpublish');
  await f.queue.enqueuePublicationContent(content('private next draft', 12));
  pending = (await f.queue.getPublicationState('alice', 'note:one')).pending;
  assert.equal(pending.operation, 'unpublish');
});
test('explicit publication queued during a background flush gets its own completed pass', async () => {
  const f = fixture(); await bind(f); await f.queue.enqueuePublicationContent(content('first'));
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  f.send(async data => { if (data.sourceId === 'note:one') await wait; return { data: { posts: [{ id: data.sourceId, body: data.body, status: 'published' }], revision: 1 } }; });
  const background = f.queue.flushPublications();
  while (!f.sent.length) await new Promise(resolve => setImmediate(resolve));
  await f.queue.enqueuePublicationContent({ ...content('second'), sourceId: 'note:two' }, 'publish', { scope: 'personal', type: 'personal', projectId: null });
  const publishing = f.queue.flushPublications(true); release(); await background; await publishing;
  assert.equal(f.sent.length, 2); assert.equal(f.sent[1].sourceId, 'note:two');
  assert.equal((await f.queue.getPublicationState('alice', 'note:two')).pending, undefined);
});
test('a new account can flush its queue after the previous account finishes without sharing drafts', async () => {
  const f = fixture(); await bind(f); await f.queue.enqueuePublicationContent(content('alice-body'));
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  f.send(async data => { if (data.userId === 'alice') await wait; return { data: { posts: [{ id: 'post', body: data.body }], revision: 1 } }; });
  const alice = f.queue.flushPublications(); while (!f.sent.length) await new Promise(resolve => setImmediate(resolve));
  f.switch('bob'); await f.queue.enqueuePublicationContent(content('bob-body'), 'publish', { scope: 'personal', type: 'personal', projectId: null }, 'bob');
  const bob = f.queue.flushPublications(); release(); await alice; await bob;
  assert.equal(f.sent.length, 2); assert.equal(f.sent[1].userId, 'bob'); assert.equal(f.sent[1].body, 'bob-body');
  assert.ok((await f.queue.getPublicationState('alice', 'note:one')).pending);
  assert.equal((await f.queue.getPublicationState('bob', 'note:one')).pending, undefined);
});
