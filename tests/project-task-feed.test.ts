import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectTaskFeed } from '../src/features/taskPlanning/projectTaskFeed.ts';
import type { ProjectTask } from '../src/types/collaboration.ts';
const task = { id: 'task', projectId: 'project', title: 'Shared', assigneeUserId: 'member', status: 'todo', createdAt: 1, updatedAt: 1 } as ProjectTask;
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function fixture(load: (id: string) => Promise<ProjectTask[]> = async () => [task]) {
  let current = true; let stopped = 0;
  const values: Record<string, ProjectTask[]> = {};
  const errors: string[] = [];
  const listeners: { receive: (tasks: ProjectTask[]) => void; fail: (error: Error) => void }[] = [];
  const feed = createProjectTaskFeed({ projectIds: ['project'], current: () => current, load,
    subscribe: (_id, receive, fail) => { listeners.push({ receive, fail }); return () => { stopped++; }; },
    receive: (id, tasks) => { values[id] = tasks; }, fail: (_id, error) => errors.push(error.message) });
  feed.start();
  return { feed, values, errors, listeners, switchAccount: () => { current = false; }, stopped: () => stopped };
}
test('refresh fetches shared tasks and reconnects a failed listener', async () => {
  const f = fixture(); f.listeners[0].fail(new Error('permission denied'));
  await f.feed.refresh();
  assert.deepEqual(f.values.project, [task]);
  assert.equal(f.listeners.length, 2); assert.equal(f.stopped(), 1);
  f.listeners[1].receive([{ ...task, assigneeUserId: 'other' }]);
  assert.equal(f.values.project[0].assigneeUserId, 'other');
});
test('a failed refresh preserves confirmed tasks and exposes retry failure', async () => {
  const f = fixture(async () => { throw new Error('offline'); });
  f.listeners[0].receive([task]);
  await assert.rejects(f.feed.refresh(), /再取得/);
  assert.deepEqual(f.values.project, [task]); assert.ok(f.errors.includes('offline'));
});
test('account changes and disposal reject late responses and listener callbacks', async () => {
  const pending = deferred<ProjectTask[]>(); const f = fixture(() => pending.promise);
  const refresh = f.feed.refresh(); f.switchAccount(); pending.resolve([task]); await refresh;
  f.listeners[1].receive([task]); f.listeners[1].fail(new Error('late'));
  assert.deepEqual(f.values, {}); assert.deepEqual(f.errors, []);
  f.feed.dispose(); assert.equal(f.stopped(), 2);
});
test('newer subscriptions and requests cannot be overwritten by older reads', async () => {
  const pending = deferred<ProjectTask[]>(); const f = fixture(() => pending.promise);
  const refresh = f.feed.refresh(); const updated = { ...task, title: 'Updated', updatedAt: 2 };
  f.listeners[1].receive([updated]); f.listeners[0].receive([task]);
  pending.resolve([task]); await refresh;
  assert.deepEqual(f.values.project, [updated]);
});
test('concurrent refreshes only apply the latest result', async () => {
  const old = deferred<ProjectTask[]>(); let calls = 0;
  const f = fixture(() => ++calls === 1 ? old.promise : Promise.resolve([{ ...task, title: 'Latest' }]));
  const first = f.feed.refresh(); await f.feed.refresh(); old.resolve([task]); await first;
  assert.equal(f.values.project[0].title, 'Latest');
});
