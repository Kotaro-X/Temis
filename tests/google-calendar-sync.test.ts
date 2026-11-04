import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../functions/googleCalendarCore.cjs');
const mergeCore = require('../functions/googleCalendarMerge.cjs');
const { syncCalendar } = require('../functions/googleCalendarSync.cjs');
const start = Date.parse('2026-11-04T09:00:00+09:00');
const task = (overrides = {}) => ({ schemaVersion: 3, entityType: 'task', entityId: 'task:t', updatedAt: 1, deletedAt: null, isDeleted: false, deviceId: 'phone',
  record: { kind: 'state', date: '2026-11-04', slotKey: 'forenoon', task: { id: 't', taskName: 'Prepare', plannedStartAt: start, plannedEndAt: start + 3600000, repeat: 'none', repeatAnchorDate: null, occurrenceOverrides: {}, status: 'TODO', tags: ['Keep'], estimateMinutes: 25, elapsedMinutes: 12, startAt: null, isArchived: false, ...overrides } } });

function fixture(project = false) {
  const sourcePath = project ? 'projectTasks/t' : 'users/alice/tasks/task:t';
  const records = new Map<string, any>([[sourcePath, project ? { ...task().record.task, title: 'Prepare', description: 'Keep memo', projectId: 'p', kind: 'task', privateDate: '2026-11-04', assigneeUserIds: ['alice', 'bob'], ownerUserId: 'alice', creatorUserId: 'alice', status: 'todo', updatedAt: 1, deletedAt: null } : task()]]);
  records.set('temisAccessStates/alice', { userId: 'alice', tier: 'plus', verifiedUntil: Date.now() + 3600000 });
  records.set('temisAccessStates/bob', { userId: 'bob', tier: 'plus', verifiedUntil: Date.now() + 3600000 });
  if (project) { records.set('projects/p', { taskEnabled: true }); records.set('projects/p/members/alice', { role: 'member' }); records.set('projects/p/members/bob', { role: 'member' }); }
  const writes: string[] = [];
  const doc = (path: string): any => ({ path, id: path.split('/').at(-1),
    get: async () => ({ exists: records.has(path), data: () => structuredClone(records.get(path)), ref: doc(path), id: path.split('/').at(-1) }),
    set: async (value: any, options?: any) => { writes.push(path); records.set(path, options?.merge ? { ...records.get(path), ...structuredClone(value) } : structuredClone(value)); },
    collection: (name: string) => collection(path + '/' + name),
  });
  const collection = (path: string, predicate = (_value: any) => true): any => ({
    doc: (id: string) => doc(path + '/' + id),
    where: (field: string, _operator: string, value: any) => collection(path, item => item[field] === value),
    get: async () => ({ docs: [...records.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/') && predicate(records.get(key))).map(key => ({ id: key.split('/').at(-1), ref: doc(key), data: () => structuredClone(records.get(key)) })) }),
  });
  const runTransaction = async (fn: any) => {
    const pending: any[] = [], reads = new Map();
    const result = await fn({
      get: async (ref: any) => { reads.set(ref.path, JSON.stringify(records.get(ref.path))); return ref.get(); },
      set: (ref: any, value: any, options?: any) => pending.push([ref, value, options]),
    });
    if ([...reads].some(([path, value]) => JSON.stringify(records.get(path)) !== value)) throw { code: 'aborted' };
    for (const [ref, value, options] of pending) await ref.set(value, options);
    return result;
  };
  const events = new Map<string, any>(), operations: string[] = [];
  let failAfter: string | null = null, loseLease = false, staleEtag = false, calendarAccessible = true, invalidateToken = false;
  let beforeImport: (() => void) | null = null;
  const api = { request: async (path: string, method = 'GET', body?: any, etag?: string) => {
    const url = new URL('https://fake.test' + path), id = decodeURIComponent(url.pathname.split('/').at(-1)!);
    operations.push(method);
    if (url.pathname.includes('/calendarList/')) { if (!calendarAccessible) throw { status: 404 }; return { accessRole: 'owner' }; }
    if (method === 'GET' && id === 'events') {
      if (invalidateToken && url.searchParams.has('syncToken')) { invalidateToken = false; throw { status: 410 }; }
      return { items: [...events.values()].filter(event => event.recurringEventId).map(event => structuredClone(event)), nextSyncToken: 'sync-token' };
    }
    if (method === 'GET') { if (!events.has(id) || !calendarAccessible) throw { status: 404 }; return structuredClone(events.get(id)); }
    if (method === 'POST') {
      if (events.has(body.id)) throw { status: 409 };
      const value = { ...structuredClone(body), etag: '1', status: 'confirmed' }; events.set(body.id, value);
      if (failAfter === method) { failAfter = null; throw { status: 503 }; }
      return structuredClone(value);
    }
    if (staleEtag || etag !== events.get(id)?.etag) throw { status: 412 };
    if (method === 'DELETE') {
      events.set(id, { id, status: 'cancelled', etag: String(Number(etag) + 1) });
      if (failAfter === method) { failAfter = null; throw { status: 503 }; }
      return {};
    }
    if (method === 'PATCH') {
      const value = { ...events.get(id), ...structuredClone(body), etag: String(Number(etag) + 1) }; events.set(id, value);
      if (failAfter === method) { failAfter = null; throw { status: 503 }; }
      return structuredClone(value);
    }
  } };
  const settings = { googleSub: 'google-b', calendarId: 'calendar-b', timeZone: 'Asia/Tokyo', direction: 'linked', projectId: project ? 'p' : null };
  const run = (deadline = Date.now() + 75000, uid = 'alice') => syncCalendar({ db: { doc, collection, runTransaction }, uid, settings, api,
    lease: {
      check: async () => { if (loseLease) throw new Error('Lease revoked'); },
      validate: async () => { if (loseLease) throw { code: 'aborted' }; if (beforeImport) { const fn = beforeImport; beforeImport = null; fn(); } },
      write: async (ref: any, data: any, options: any) => { if (loseLease) throw new Error('Lease revoked'); await ref.set(data, options); },
    }, deadline });
  const localEdit = (patch: any, envelope: any = {}) => {
    const value = records.get(sourcePath);
    records.set(sourcePath, project ? { ...value, ...patch, updatedAt: value.updatedAt + 1, ...envelope } : { ...value, ...envelope, updatedAt: value.updatedAt + 1, record: { ...value.record, task: { ...value.record.task, ...patch } } });
  };
  const remoteEdit = (id: string, patch: any) => events.set(id, { ...events.get(id), ...patch, etag: String(Number(events.get(id)?.etag ?? 0) + 1) });
  return { run, records, events, operations, writes, sourcePath, settings, localEdit, remoteEdit,
    failAfter: (method: string) => { failAfter = method; }, revoke: () => { loseLease = true; }, stale: () => { staleEtag = true; },
    denyCalendar: () => { calendarAccessible = false; }, invalidateToken: () => { invalidateToken = true; }, beforeImport: (fn: () => void) => { beforeImport = fn; },
  };
}

test('exports name/time then updates/deletes without writing unrelated task fields', async () => {
  const f = fixture(); await f.run(); const id = [...f.events.keys()][0];
  assert.equal(f.events.get(id).summary, 'Prepare'); assert.equal(f.events.get(id).description, undefined);
  await f.run(); assert.equal(f.operations.filter(method => method === 'POST').length, 1);
  f.localEdit({ taskName: 'New title' }); await f.run(); assert.equal(f.events.get(id).summary, 'New title');
  f.localEdit({}, { deletedAt: 3, isDeleted: true }); await f.run(); assert.equal(f.events.get(id).status, 'cancelled');
  assert.ok(f.writes.every(path => path.startsWith('users/alice/calendarBindings/')));
});
test('imports edits and deletion only for linked events, preserving unrelated fields', async () => {
  const f = fixture(); f.events.set('unrelated', { summary: 'Google only' }); await f.run();
  const id = [...f.events.keys()].find(key => key !== 'unrelated')!;
  f.remoteEdit(id, { summary: 'Google edit', description: 'Never import this', start: { dateTime: new Date(start + 7200000).toISOString() }, end: { dateTime: new Date(start + 10800000).toISOString() } });
  await f.run(); const value = f.records.get(f.sourcePath);
  assert.equal(value.record.task.taskName, 'Google edit'); assert.equal(value.record.task.plannedStartAt, start + 7200000);
  assert.equal(value.record.task.elapsedMinutes, 12); assert.deepEqual(value.record.task.tags, ['Keep']); assert.equal(value.record.task.status, 'TODO');
  assert.equal([...f.records.keys()].filter(key => key.startsWith('users/alice/tasks/')).length, 1);
  const version = value.updatedAt; await f.run(); assert.equal(f.records.get(f.sourcePath).updatedAt, version);
  f.remoteEdit(id, { status: 'cancelled' }); await f.run(); assert.equal(f.records.get(f.sourcePath).isDeleted, true);
  assert.equal(f.events.size, 2); assert.equal(f.events.get('unrelated').summary, 'Google only');
});
test('field conflicts favor Temis while independent Google time edits survive', async () => {
  const f = fixture(); await f.run(); const id = [...f.events.keys()][0];
  f.localEdit({ taskName: 'Temis wins' });
  f.remoteEdit(id, { summary: 'Google loses', start: { dateTime: new Date(start + 7200000).toISOString() }, end: { dateTime: new Date(start + 10800000).toISOString() } });
  await f.run(); assert.equal(f.events.get(id).summary, 'Temis wins');
  assert.equal(f.records.get(f.sourcePath).record.task.taskName, 'Temis wins'); assert.equal(f.records.get(f.sourcePath).record.task.plannedStartAt, start + 7200000);
});
test('Temis edit beats Google deletion; Temis deletion beats Google edit', async () => {
  const f = fixture(); await f.run(); const id = [...f.events.keys()][0]; f.localEdit({ taskName: 'Keep' }); f.remoteEdit(id, { status: 'cancelled' });
  await f.run(); assert.equal(f.records.get(f.sourcePath).isDeleted, false); const next = [...f.events.keys()].find(key => key !== id)!;
  assert.equal(f.events.get(next).summary, 'Keep'); f.localEdit({}, { isDeleted: true, deletedAt: 10 }); f.remoteEdit(next, { summary: 'Remote change' });
  await f.run(); assert.equal(f.events.get(next).status, 'cancelled');
});
test('lost API responses for insert/patch/delete recover without duplicate or reverse deletion', async () => {
  const f = fixture(); f.failAfter('POST'); await assert.rejects(f.run()); await f.run(); assert.equal(f.events.size, 1);
  f.localEdit({ taskName: 'Changed' }); f.failAfter('PATCH'); await assert.rejects(f.run()); await f.run(); assert.equal(f.events.size, 1);
  f.localEdit({ isArchived: true }); f.failAfter('DELETE'); await assert.rejects(f.run());
  f.localEdit({ isArchived: false }); await f.run();
  assert.equal(f.records.get(f.sourcePath).isDeleted, false); assert.equal([...f.events.values()].filter(event => event.status !== 'cancelled').length, 1);
});
test('unknown ownership and inaccessible calendar do not change Temis', async () => {
  const f = fixture(); await f.run(); const id = [...f.events.keys()][0]; f.remoteEdit(id, { summary: 'Do not import', extendedProperties: {} });
  assert.equal((await f.run()).issues.ownership_changed, 1); assert.equal(f.records.get(f.sourcePath).record.task.taskName, 'Prepare');
  f.denyCalendar(); await f.run(); assert.equal(f.records.get(f.sourcePath).isDeleted, false);
});
test('Project changes use existing mutation permissions and preserve memo/assignees', async () => {
  const f = fixture(true); await f.run(); const id = [...f.events.keys()][0]; f.remoteEdit(id, { summary: 'Project rename' }); await f.run();
  const source = f.records.get(f.sourcePath); assert.equal(source.title, 'Project rename'); assert.equal(source.description, 'Keep memo'); assert.deepEqual(source.assigneeUserIds, ['alice', 'bob']);
  assert.equal(f.records.get('projectNotes/project-task-t').title, 'Project rename');
  f.records.set('projects/p/members/alice', { role: 'viewer' }); f.remoteEdit(id, { summary: 'Not allowed' });
  assert.equal((await f.run()).issues.permission_denied, 1); assert.equal(f.records.get(f.sourcePath).title, 'Project rename');
  f.records.set('projects/p/members/alice', { role: 'member' }); f.remoteEdit(id, { status: 'cancelled' }); await f.run();
  assert.ok(f.records.get(f.sourcePath).deletedAt); assert.ok(f.records.get('projectNotes/project-task-t').deletedAt);
});
test('multiple assignees propagate one change without an echo loop', async () => {
  const f = fixture(true); await f.run(); await f.run(Date.now() + 75000, 'bob');
  const [alice, bob] = [...f.events.keys()]; f.remoteEdit(alice, { summary: 'From Alice calendar' }); await f.run();
  await f.run(Date.now() + 75000, 'bob'); assert.equal(f.events.get(bob).summary, 'From Alice calendar');
  const version = f.records.get(f.sourcePath).updatedAt;
  await f.run(); await f.run(Date.now() + 75000, 'bob'); assert.equal(f.records.get(f.sourcePath).updatedAt, version);
  f.remoteEdit(bob, { status: 'cancelled' }); await f.run(Date.now() + 75000, 'bob'); await f.run(); assert.equal(f.events.get(alice).status, 'cancelled');
});
test('assignment removal and project exit delete exports, never shared tasks', async () => {
  const f = fixture(true); await f.run(); f.localEdit({ assigneeUserIds: ['bob'] }); await f.run();
  assert.equal([...f.events.values()][0].status, 'cancelled'); assert.equal(f.records.get(f.sourcePath).deletedAt, null);
  const g = fixture(true); await g.run(); g.records.delete('projects/p/members/alice'); await g.run(); assert.equal([...g.events.values()][0].status, 'cancelled'); assert.equal(g.records.get(g.sourcePath).deletedAt, null);
});
test('archiving/undating removes events, restoring creates exactly one replacement', async () => {
  const f = fixture(); await f.run(); f.localEdit({ isArchived: true }); await f.run(); assert.equal([...f.events.values()][0].status, 'cancelled');
  f.localEdit({ isArchived: false }); await f.run(); assert.equal([...f.events.values()].filter(event => event.status !== 'cancelled').length, 1);
  f.records.get(f.sourcePath).record.date = 'undated'; await f.run(); assert.equal([...f.events.values()].filter(event => event.status !== 'cancelled').length, 0);
  assert.equal(f.records.get(f.sourcePath).isDeleted, false);
});
test('CAS, permission expiry, deadline and etag conflicts defer safely', async () => {
  const f = fixture(); assert.equal((await f.run(Date.now())).pending, true); assert.equal(f.events.size, 0); await f.run(); const id = [...f.events.keys()][0];
  f.remoteEdit(id, { summary: 'Remote' }); f.beforeImport(() => f.localEdit({ taskName: 'Concurrent' }));
  assert.equal((await f.run()).issues.concurrent_edit, 1); assert.equal(f.records.get(f.sourcePath).record.task.taskName, 'Concurrent');
  f.stale(); const conflict = await f.run(); assert.equal(conflict.issues.concurrent_edit, 1);
  const g = fixture(); await g.run(); g.records.get('temisAccessStates/alice').verifiedUntil = 0; g.remoteEdit([...g.events.keys()][0], { summary: 'Not entitled' });
  assert.equal((await g.run()).issues.permission_denied, 1); assert.equal(g.records.get(g.sourcePath).record.task.taskName, 'Prepare');
});
test('future schemas, account switching and invalid remote values preserve source data', async () => {
  const f = fixture(); await f.run(); const id = [...f.events.keys()][0];
  f.records.get(f.sourcePath).schemaVersion = 99; assert.equal((await f.run()).skipped, 1); assert.equal(f.events.get(id).status, 'confirmed');
  f.records.get(f.sourcePath).schemaVersion = 3;
  f.remoteEdit(id, { start: { date: '2026-11-04' }, end: { date: '2026-11-06' } }); assert.equal((await f.run()).issues.unsupported_all_day_range, 1);
  f.settings.googleSub = 'different-google'; await f.run(); assert.equal(f.events.size, 2); assert.equal(f.records.get(f.sourcePath).record.task.plannedStartAt, start);
});
test('repeating master edits preserve rules; unsupported rule changes are held', async () => {
  const f = fixture(); f.localEdit({ repeat: 'weekly' }); await f.run(); const id = [...f.events.keys()][0];
  f.remoteEdit(id, { summary: 'Weekly edited', start: { dateTime: new Date(start + 3600000).toISOString(), timeZone: 'Asia/Tokyo' }, end: { dateTime: new Date(start + 7200000).toISOString(), timeZone: 'Asia/Tokyo' } });
  await f.run(); assert.equal(f.records.get(f.sourcePath).record.task.taskName, 'Weekly edited'); assert.equal(f.records.get(f.sourcePath).record.task.repeat, 'weekly');
  f.remoteEdit(id, { recurrence: ['RRULE:FREQ=DAILY'] }); assert.equal((await f.run()).issues.unsupported_recurrence, 1); assert.equal(f.records.get(f.sourcePath).record.task.repeat, 'weekly');
});
test('Google recurring instance edits transfer to linked exceptions without cancellation echo', async () => {
  const f = fixture(); f.localEdit({ repeat: 'weekly' }); await f.run(); const master = [...f.events.keys()][0];
  f.events.set('native-instance', { id: 'native-instance', etag: '1', recurringEventId: master, originalStartTime: { dateTime: new Date(start + 7 * 86400000).toISOString() }, summary: 'Moved instance', start: { dateTime: new Date(start + 8 * 86400000).toISOString() }, end: { dateTime: new Date(start + 8 * 86400000 + 3600000).toISOString() } });
  await f.run(); const override = f.records.get(f.sourcePath).record.task.occurrenceOverrides['2026-11-11'];
  assert.equal(override.title, 'Moved instance'); assert.equal(override.date, '2026-11-12');
  assert.ok(f.events.get(master).recurrence.some((line: string) => line.includes('EXDATE')));
  f.remoteEdit('native-instance', { status: 'cancelled' }); await f.run(); assert.equal(f.records.get(f.sourcePath).record.task.occurrenceOverrides['2026-11-11'].deleted, false);
  const standalone = [...f.events.keys()].find(key => ![master, 'native-instance'].includes(key))!;
  f.remoteEdit(standalone, { status: 'cancelled' }); await f.run(); assert.equal(f.records.get(f.sourcePath).record.task.occurrenceOverrides['2026-11-11'].deleted, true); assert.equal(f.records.get(f.sourcePath).isDeleted, false);
});
test('cancelled native instance deletes only that occurrence; expired sync tokens restart safely', async () => {
  const f = fixture(); f.localEdit({ repeat: 'weekly' }); await f.run(); const master = [...f.events.keys()][0];
  f.events.set('native-deleted', { id: 'native-deleted', etag: '1', status: 'cancelled', recurringEventId: master, originalStartTime: { dateTime: new Date(start + 7 * 86400000).toISOString() } });
  await f.run(); assert.equal(f.records.get(f.sourcePath).record.task.occurrenceOverrides['2026-11-11'].deleted, true);
  f.invalidateToken(); assert.equal((await f.run()).pending, true); await f.run(); assert.equal(f.records.get(f.sourcePath).isDeleted, false);
});
test('all-day, overnight, DST, monthly recurrence and token encryption', () => {
  const allDay = core.taskEvents(task({ plannedStartAt: null, plannedEndAt: null }), 'private', 'Asia/Tokyo');
  assert.deepEqual(allDay[0].body.start, { date: '2026-11-04' }); assert.deepEqual(allDay[0].body.end, { date: '2026-11-05' });
  const late = Date.parse('2026-11-04T23:00:00+09:00'); assert.equal(core.taskEvents(task({ plannedStartAt: late, plannedEndAt: late + 7200000 }), 'private', 'Asia/Tokyo')[0].body.end.dateTime, '2026-11-04T16:00:00.000Z');
  assert.equal(new Date(core.onDate('2026-03-07', '09:00:00', 'America/New_York')).toISOString(), '2026-03-07T14:00:00.000Z');
  assert.equal(new Date(core.onDate('2026-03-09', '09:00:00', 'America/New_York')).toISOString(), '2026-03-09T13:00:00.000Z');
  assert.equal(core.taskEvents(task({ repeat: 'monthly', repeatAnchorDate: '2026-01-31' }), 'private', 'Asia/Tokyo')[0].body.start.dateTime, '2026-01-31T00:00:00.000Z');
  const key = Buffer.alloc(32, 42).toString('base64'), value = core.encryptToken('secret-refresh-token', key, 'alice');
  assert.equal(core.decryptToken(value, key, 'alice'), 'secret-refresh-token'); assert.throws(() => core.decryptToken(value, key, 'bob'));
  assert.throws(() => core.decryptToken({ ...value, tag: Buffer.alloc(16).toString('base64') }, key, 'alice'));
  assert.throws(() => core.encryptToken('token', 'bad-key', 'alice')); assert.deepEqual(core.DIRECTIONS, ['off', 'linked']);
  assert.equal(core.validDate('2026-99-99'), false);
});
test('three-way merge ignores completion-only changes and normalizes timestamp offsets', () => {
  const baseline = mergeCore.projection({ summary: 'A', start: { dateTime: '2026-11-04T09:00:00+09:00' }, end: { dateTime: '2026-11-04T10:00:00+09:00' } });
  const same = mergeCore.projection({ summary: 'A', start: { dateTime: '2026-11-04T00:00:00Z' }, end: { dateTime: '2026-11-04T01:00:00Z' } });
  assert.deepEqual(same, baseline); assert.deepEqual(mergeCore.merge(same, { deleted: true }, baseline, baseline), { deleted: true });
});

test('archiving still deletes a linked Google event with unsupported remote fields', async () => {
  const f = fixture(); await f.run(); const id = [...f.events.keys()][0];
  f.remoteEdit(id, { summary: '', start: { date: '2026-11-04' }, end: { date: '2026-11-10' } });
  f.localEdit({ isArchived: true }); await f.run();
  assert.equal(f.events.get(id).status, 'cancelled'); assert.equal(f.records.get(f.sourcePath).isDeleted, false);
});
test('deleting a nonrecurring task with a local override deletes the original task', async () => {
  const f = fixture(); f.localEdit({ occurrenceOverrides: { '2026-11-04': { date: '2026-11-04', slot: 'morning', plannedStartAt: start, plannedEndAt: start + 3600000, estimateMinutes: 25, title: 'Override' } } });
  await f.run(); f.remoteEdit([...f.events.keys()][0], { status: 'cancelled' }); await f.run(); assert.equal(f.records.get(f.sourcePath).isDeleted, true);
});
test('all-day/time conversion works without importing a changed recurrence rule', async () => {
  const f = fixture(); await f.run(); const id = [...f.events.keys()][0];
  f.remoteEdit(id, { start: { date: '2026-11-06' }, end: { date: '2026-11-07' } });
  await f.run(); assert.equal(f.records.get(f.sourcePath).record.date, '2026-11-06'); assert.equal(f.records.get(f.sourcePath).record.task.plannedStartAt, null);
  f.remoteEdit(id, { start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(start + 3600000).toISOString() } });
  await f.run(); assert.equal(f.records.get(f.sourcePath).record.task.plannedStartAt, start);
});
