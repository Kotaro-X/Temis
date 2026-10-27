import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

type Deferred = { promise: Promise<any>; resolve: (value: any) => void; reject: (value: any) => void };
const deferred = (): Deferred => {
  let resolve!: Deferred['resolve']; let reject!: Deferred['reject'];
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const base = { postId: 'post', likeCount: 2, liked: false, saved: false, available: true };
function fixture() {
  const slots: any[] = []; const cleanups: (() => void)[] = [];
  let index = 0; let first = true; let currentUid = 'alice'; let writes = 0;
  const reads: Deferred[] = []; const changes: { input: any[]; task: Deferred }[] = []; const alerts: any[] = [];
  const modules: Record<string, any> = {
    react: {
      useState: (initial: any) => {
        const position = index++; if (first) slots[position] = initial;
        return [slots[position], (value: any) => { writes++; slots[position] = typeof value === 'function' ? value(slots[position]) : value; }];
      },
      useRef: (value: any) => { const position = index++; if (first) slots[position] = { current: value }; return slots[position]; },
      useEffect: (effect: () => (() => void)) => { if (first) cleanups.push(effect()); },
      useCallback: (callback: any) => callback,
    },
    'react-native': { Alert: { alert: (...args: any[]) => alerts.push(args) } },
    '../../services/sync/firebaseApp': { getFirebaseAuth: () => ({ currentUser: { uid: currentUid } }) },
    '../../services/guild/guildEngagementService': {
      getGuildEngagement: () => { const task = deferred(); reads.push(task); return task.promise; },
      setGuildEngagement: (...input: any[]) => { const task = deferred(); changes.push({ input, task }); return task.promise; },
    },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/components/guild/useGuildEngagement.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(source, { module, exports: module.exports, require: (name: string) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
  } });
  const render = () => { index = 0; const result = module.exports.default('alice'); first = false; return result; };
  render();
  return { render, reads, changes, alerts, switchAccount: () => { currentUid = 'bob'; }, unmount: () => cleanups.forEach(fn => fn?.()), writes: () => writes,
    hydrate: async () => { const promise = render().load(['post']); reads.at(-1)!.resolve({ states: [base] }); await promise; } };
}

test('one shared hook applies optimistic state, prevents repeated presses, and uses server count', async () => {
  const f = fixture(); await f.hydrate();
  const action = f.render().toggle('post', 'like');
  assert.equal(f.render().states.post.liked, true); assert.equal(f.render().states.post.likeCount, 3);
  assert.equal(await f.render().toggle('post', 'like'), null); assert.equal(f.changes.length, 1);
  assert.deepEqual(f.changes[0].input, ['alice', 'post', 'like', true]);
  f.changes[0].task.resolve({ ...base, liked: true, likeCount: 4 }); await action;
  assert.equal(f.render().states.post.likeCount, 4); assert.equal(f.render().busy.post, false);
});

test('failed save restores the previous state and permits retry', async () => {
  const f = fixture(); await f.hydrate();
  const action = f.render().toggle('post', 'save'); assert.equal(f.render().states.post.saved, true);
  f.changes[0].task.reject(new Error('offline')); await action;
  assert.equal(f.render().states.post.saved, false); assert.equal(f.render().busy.post, false); assert.equal(f.alerts.length, 1);
  const retry = f.render().toggle('post', 'save');
  f.changes[1].task.resolve({ ...base, saved: true }); await retry;
  assert.equal(f.render().states.post.saved, true);
});

test('late hydration cannot overwrite a more recent mutation response', async () => {
  const f = fixture(); await f.hydrate();
  const oldRead = f.render().load(['post']);
  const action = f.render().toggle('post', 'like');
  f.changes[0].task.resolve({ ...base, liked: true, likeCount: 3 }); await action;
  f.reads[1].resolve({ states: [base] }); await oldRead;
  assert.equal(f.render().states.post.liked, true); assert.equal(f.render().states.post.likeCount, 3);
});

test('responses from an old account or unmounted screen do not update state or show alerts', async () => {
  const f = fixture(); await f.hydrate();
  const oldRead = f.render().load(['post']); const action = f.render().toggle('post', 'save');
  f.switchAccount(); f.unmount(); const writes = f.writes();
  f.reads[1].resolve({ states: [{ ...base, liked: true }] });
  f.changes[0].task.reject(new Error('old account')); await Promise.all([oldRead, action]);
  assert.equal(f.writes(), writes); assert.equal(f.alerts.length, 0);
});
