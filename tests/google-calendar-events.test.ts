import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCalendarEvents, taskChanged, configurationChanged } = require('../functions/googleCalendarEvents.cjs');

function fixture() {
  const time = 1800000000000;
  const path = 'users/alice/calendarConnections/google';
  const settings = { enabled: true, refreshToken: 'encrypted', googleSub: 'google-a', calendarId: 'cal', direction: 'linked', projects: {} };
  const records = new Map<string, any>([[path, structuredClone(settings)]]);
  const jobs: any[] = [], apiCalls: any[] = [];
  let runs = 0, failEnqueue = false, failSync: any = null, busy = false, continuation = false;
  let beforeResponse: ((body: any) => Promise<void>) | undefined;
  let duringRun: (() => Promise<void>) | undefined;
  const doc = (path: string): any => ({ path, id: path.split('/').at(-1),
    get: async () => ({ data: () => structuredClone(records.get(path)), exists: records.has(path) }),
    set: async (value: any, options?: any) => records.set(path, options?.merge ? { ...records.get(path), ...structuredClone(value) } : structuredClone(value)),
    update: async (value: any) => records.set(path, { ...records.get(path), ...structuredClone(value) }),
    delete: async () => records.delete(path),
  });
  const collection = (path: string, predicate = (_value: any) => true): any => ({
    doc: (id: string) => doc(path + '/' + id),
    where: (field: string, _op: string, value: any) => collection(path, item => predicate(item) && item[field] === value),
    get: async () => ({ docs: [...records].filter(([key, value]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/') && predicate(value)).map(([key]) => ({ id: doc(key).id, ref: doc(key), data: () => structuredClone(records.get(key)) })) }),
  });
  const db = { doc, collection, runTransaction: async (fn: any) => fn({ get: (ref: any) => ref.get(), update: (ref: any, value: any) => ref.update(value) }) };
  const service = createCalendarEvents({ db, now: () => time,
    enqueue: async (job: any) => { if (failEnqueue) throw Error('enqueue failed'); jobs.push(job); },
    requirePlus: async () => {},
    withLease: async (_uid: string, fn: any) => {
      if (busy) throw { code: 'aborted' };
      return fn({ check: async () => {}, write: async (ref: any, data: any, options: any) => {
        if (!records.get(path) || records.get(path).deleting) throw { code: 'aborted' };
        await ref.set(data, options);
      } });
    },
    apiFor: async () => ({ request: async (url: string, method: string, body: any) => {
      apiCalls.push({ url, method, body });
      if (url === '/channels/stop') return {};
      if (beforeResponse) await beforeResponse(body);
      return { id: body.id, resourceId: 'resource', expiration: String(time + 604800000) };
    } }),
    runSync: async () => { runs++; if (duringRun) await duringRun(); if (failSync) throw failSync; return { continuation }; },
    safeCode: () => 'sync_failed',
  });
  const headers = (body: any, state = 'exists') => ({ 'x-goog-channel-id': body.id, 'x-goog-channel-token': body.token, 'x-goog-resource-id': 'resource', 'x-goog-resource-state': state });
  return { service, records, path, settings, jobs, apiCalls, time, headers, runs: () => runs,
    failQueue: (value = true) => { failEnqueue = value; }, failRun: (value: any) => { failSync = value; },
    busy: (value: boolean) => { busy = value; }, continuation: () => { continuation = true; },
    beforeResponse: (fn: typeof beforeResponse) => { beforeResponse = fn; }, duringRun: (fn: typeof duringRun) => { duringRun = fn; } };
}

test('configuration creates one watch per calendar, then syncs; renewal never syncs', async () => {
  const f = fixture();
  f.records.get(f.path).projects = { p: { calendarId: 'cal', direction: 'linked' }, q: { calendarId: 'second', direction: 'linked' } };
  await f.service.work({ uid: 'alice', kind: 'configure' });
  assert.equal(f.apiCalls.length, 2); assert.equal(f.runs(), 1);
  assert.ok(f.apiCalls.every(call => call.url.endsWith('/events/watch')));
  assert.ok([...f.records].filter(([key]) => key.startsWith('googleCalendarChannels/')).every(([, value]) => value.tokenHash && !value.token));
  await f.service.work({ uid: 'alice', kind: 'renew' });
  assert.equal(f.apiCalls.length, 2); assert.equal(f.runs(), 1); assert.equal(f.jobs.length, 0);
});
test('watch is registered before Google initial notification and real changes wait for resource identity', async () => {
  const f = fixture();
  f.beforeResponse(async body => {
    assert.equal(await f.service.notify(f.headers(body, 'sync')), 204);
    assert.equal(await f.service.notify(f.headers(body)), 503);
  });
  await f.service.maintain('alice');
  assert.equal(f.jobs.length, 0);
  assert.equal(await f.service.notify(f.headers(f.apiCalls[0].body)), 204);
  assert.deepEqual(f.jobs, [{ uid: 'alice', kind: 'sync' }]);
});
test('forged, expired and mismatched channel notifications cannot enqueue work', async () => {
  const f = fixture(); await f.service.maintain('alice');
  const body = f.apiCalls[0].body, valid = f.headers(body);
  for (const patch of [{ 'x-goog-channel-token': 'forged' }, { 'x-goog-resource-id': 'different' }, { 'x-goog-channel-id': '../bad' }, { 'x-goog-resource-state': 'invalid' }]) {
    assert.equal(await f.service.notify({ ...valid, ...patch }), 403);
  }
  f.records.get('googleCalendarChannels/' + body.id).expiration = f.time - 1;
  assert.equal(await f.service.notify(valid), 403); assert.equal(f.jobs.length, 0);
});
test('webhook retries queue failure; duplicate notifications remain safe to deliver', async () => {
  const f = fixture(); await f.service.maintain('alice'); const headers = f.headers(f.apiCalls[0].body);
  f.failQueue(); await assert.rejects(f.service.notify(headers)); assert.equal(f.jobs.length, 0);
  f.failQueue(false);
  assert.equal(await f.service.notify(headers), 204); assert.equal(await f.service.notify(headers), 204);
  assert.equal(f.jobs.length, 2);
});
test('paused, disconnected or switched accounts ignore old notifications and remove watches', async () => {
  for (const patch of [{ enabled: false }, { refreshToken: null }, { googleSub: 'other', direction: 'off' }, { deleting: true }]) {
    const f = fixture(); await f.service.maintain('alice'); const headers = f.headers(f.apiCalls[0].body);
    Object.assign(f.records.get(f.path), patch);
    assert.equal(await f.service.notify(headers), 204); assert.equal(f.jobs.length, 0);
    if (!patch.deleting) { await f.service.work({ uid: 'alice', kind: 'configure' }); assert.equal([...f.records.keys()].filter(key => key.startsWith('googleCalendarChannels/')).length, 0); }
    assert.equal(f.runs(), 0);
  }
});
test('expiring watches are replaced before old channels stop, without reconciliation', async () => {
  const f = fixture(); await f.service.maintain('alice'); const old = f.apiCalls[0].body;
  f.records.get('googleCalendarChannels/' + old.id).expiration = f.time + 10000;
  await f.service.work({ uid: 'alice', kind: 'renew' });
  assert.deepEqual(f.apiCalls.map(call => call.url.endsWith('/watch') ? 'watch' : 'stop'), ['watch', 'watch', 'stop']);
  assert.equal(f.records.has('googleCalendarChannels/' + old.id), false); assert.equal(f.runs(), 0);
});
test('account deletion during watch creation cannot resurrect channel metadata', async () => {
  const f = fixture();
  f.beforeResponse(async body => {
    f.records.delete(f.path); f.records.delete('googleCalendarChannels/' + body.id);
  });
  await assert.rejects(f.service.work({ uid: 'alice', kind: 'configure' }));
  assert.equal(f.records.has(f.path), false);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('googleCalendarChannels/')).length, 0);
  await f.service.work({ uid: 'alice', kind: 'configure' }); assert.equal(f.runs(), 0);
});
test('busy and transient runs retry; permanent errors stop; deletion never recreates settings', async () => {
  const f = fixture(); f.busy(true);
  await assert.rejects(f.service.work({ uid: 'alice', kind: 'configure' }));
  f.busy(false); await f.service.work({ uid: 'alice', kind: 'configure' }); assert.equal(f.runs(), 1);
  f.failRun({ status: 503 }); await assert.rejects(f.service.work({ uid: 'alice', kind: 'sync' }));
  f.failRun({ reason: 'invalid_grant' }); await f.service.work({ uid: 'alice', kind: 'sync' });
  assert.equal(f.records.get(f.path).error, 'sync_failed');
  f.records.delete(f.path); await f.service.work({ uid: 'alice', kind: 'sync' }); assert.equal(f.records.has(f.path), false);
});
test('remaining work uses bounded task retries rather than an unlimited chain or timer', async () => {
  const f = fixture(); f.continuation();
  await assert.rejects(f.service.work({ uid: 'alice', kind: 'sync' }));
  assert.equal(f.jobs.length, 0); assert.equal(f.runs(), 1);
});
test('notifications during a run and before/after assignment changes request work independently', async () => {
  const f = fixture(); await f.service.maintain('alice');
  f.duringRun(async () => {
    await f.service.notify(f.headers(f.apiCalls[0].body));
    await f.service.request('alice');
  });
  await f.service.work({ uid: 'alice', kind: 'sync' });
  assert.equal(f.jobs.length, 2); assert.equal(f.runs(), 1);
  const before = { title: 'task', projectId: 'p', assigneeUserIds: ['alice', 'bob'], updatedAt: 1 };
  assert.equal(taskChanged(before, { ...before, assigneeUserIds: ['bob'] }, true), true);
  assert.equal(taskChanged(before, { ...before, updatedAt: 2, description: 'memo' }, true), false);
  const privateTask = { schemaVersion: 3, record: { kind: 'state', date: '2026-11-05', task: { taskName: 'Title', status: 'TODO' } } };
  assert.equal(taskChanged(privateTask, { ...privateTask, updatedAt: 2, record: { ...privateTask.record, task: { ...privateTask.record.task, status: 'DONE' } } }), false);
  assert.equal(taskChanged(privateTask, { ...privateTask, isDeleted: true }), true);
  assert.equal(taskChanged(privateTask, { ...privateTask, record: { ...privateTask.record, date: '2026-11-06' } }), true);
});
test('status and lease writes never retrigger configuration, while target changes do', () => {
  const f = fixture();
  assert.equal(configurationChanged(f.settings, { ...f.settings, lease: 'worker', leaseUntil: 123, lastSyncedAt: 456, error: null }), false);
  assert.equal(configurationChanged(f.settings, { ...f.settings, enabled: false }), true);
  assert.equal(configurationChanged(f.settings, { ...f.settings, calendarId: 'other' }), true);
});
