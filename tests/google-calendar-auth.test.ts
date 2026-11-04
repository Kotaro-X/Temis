import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { URL } from 'node:url';
const require = createRequire(import.meta.url);
const core = require('../functions/googleCalendarCore.cjs');
const api = require('../functions/googleCalendarApi.cjs');

function fixture() {
  const records = new Map<string, any>();
  for (const uid of ['alice', 'bob']) records.set(`temisAccessStates/${uid}`, { userId: uid, tier: 'plus', verifiedUntil: Date.now() + 3600000 });
  const users = new Map([['alice', { disabled: false }], ['bob', { disabled: false }]]);
  const secrets: Record<string, string> = { GOOGLE_CALENDAR_CLIENT_ID: 'calendar-client', GOOGLE_CALENDAR_CLIENT_SECRET: 'client-secret', GOOGLE_CALENDAR_TOKEN_KEY: Buffer.alloc(32, 25).toString('base64') };
  const clone = (value: any) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const doc = (path: string): any => ({ path,
    get: async () => ({ exists: records.has(path), data: () => clone(records.get(path)) }),
    set: async (value: any, options?: any) => records.set(path, options?.merge ? { ...records.get(path), ...clone(value) } : clone(value)),
    update: async (value: any) => records.set(path, { ...records.get(path), ...clone(value) }),
    delete: async () => records.delete(path),
  });
  const db = { doc, runTransaction: async (fn: any) => {
    const changes: any[] = [];
    const result = await fn({ get: (ref: any) => ref.get(), set: (ref: any, value: any, options: any) => changes.push(() => ref.set(value, options)), update: (ref: any, value: any) => changes.push(() => ref.update(value)) });
    for (const change of changes) await change(); return result;
  } };
  class HttpsError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
  let scopes = api.SCOPES.join(' '), identity = { sub: 'google-b', email: 'calendar-b@example.com', email_verified: true }, exchanges = 0;
  const exported: Record<string, any> = {}, http: unknown[] = [], jobs: any[] = [];
  const stubs: Record<string, any> = {
    'node:crypto': require('node:crypto'),
    'node:buffer': require('node:buffer'),
    'firebase-admin/app': { getApps: () => [{}], initializeApp() {} },
    'firebase-admin/auth': { getAuth: () => ({ getUser: async (uid: string) => { if (!users.has(uid)) throw { code: 'auth/user-not-found' }; return users.get(uid); } }) },
    'firebase-admin/firestore': { getFirestore: () => db, FieldPath: { documentId: () => '__name__' } },
    'firebase-functions/v2/scheduler': { onSchedule: (_options: any, handler: any) => handler },
    'firebase-functions/v2/firestore': { onDocumentWritten: (_options: any, handler: any) => handler },
    'firebase-functions/v2/tasks': { onTaskDispatched: (_options: any, handler: any) => handler },
    'firebase-admin/functions': { getFunctions: () => ({ taskQueue: () => ({ enqueue: async (job: any) => { jobs.push(job); } }) }) },
    'firebase-functions/params': { defineSecret: (name: string) => ({ name, value: () => secrets[name] ?? 'not-used' }) },
    'firebase-functions/v2/https': { HttpsError, onCall: (_options: any, handler: any) => handler, onRequest: (_options: any, handler: any) => handler },
    './environmentRuntime.cjs': { runtimeServiceAccount: 'test-only' },
    './temisAccessCore.cjs': require('../functions/temisAccessCore.cjs'),
    './googleCalendarCore.cjs': core,
    './googleCalendarEvents.cjs': require('../functions/googleCalendarEvents.cjs'),
    './projectTaskMutationCore.cjs': require('../functions/projectTaskMutationCore.cjs'),
    './googleCalendarApi.cjs': { ...api, tokenRequest: async (_config: any, values: any) => { exchanges++; http.push(values); return { refresh_token: 'refresh-secret', access_token: 'access-secret', scope: scopes }; },
      jsonRequest: async () => identity, makeApi: () => ({}), listCalendars: async () => [{ id: 'cal', name: 'Calendar B', timeZone: 'Asia/Tokyo', accessRole: 'owner' }],
    },
  };
  vm.runInNewContext(readFileSync(new URL('../functions/googleCalendar.cjs', import.meta.url), 'utf8'), {
    require: (name: string) => { if (!(name in stubs)) throw new Error('Unexpected dependency: ' + name); return stubs[name]; },
    exports: exported, URLSearchParams, Buffer, Intl, Date, AbortSignal,
    fetch: async (_url: string, options: any) => { http.push(options); return { ok: true, status: 200 }; },
  });
  const request = (uid = 'alice', data = {}) => ({ auth: { uid, token: { firebase: { sign_in_provider: 'google.com' } } }, data });
  const callback = async (state: string, code = 'code') => {
    const result: any = { headers: {}, status: 0, body: '' };
    const res = { set: (key: string, value: string) => { result.headers[key] = value; return res; }, status: (status: number) => { result.status = status; return res; }, type: () => res, send: (body: string) => { result.body = body; return res; } };
    await exported.googleCalendarOAuthCallback({ method: 'GET', query: { state, code } }, res); return result;
  };
  const begin = async (uid = 'alice') => new URL((await exported.beginGoogleCalendarConnection(request(uid))).url);
  return { records, users, exported, request, callback, begin, secrets, http, jobs, exchanges: () => exchanges,
    omitScopes: () => { scopes = 'openid email'; }, identity: (value: typeof identity) => { identity = value; } };
}

test('Firestore changes enqueue previous and current assignees and ignore worker bookkeeping', async () => {
  const f = fixture();
  for (const uid of ['alice', 'bob']) f.records.set(`users/${uid}/calendarConnections/google`, { enabled: true, refreshToken: 'encrypted', calendarId: 'cal', direction: 'linked' });
  const event = (before: any, after: any, params = {}) => ({ data: { before: { data: () => before }, after: { data: () => after } }, params });
  const task = { title: 'Task', projectId: 'p', assigneeUserIds: ['alice', 'bob'] };
  await f.exported.onProjectTaskCalendarChange(event(task, { ...task, assigneeUserIds: ['bob'] }));
  assert.deepEqual(f.jobs.map(job => job.uid).sort(), ['alice', 'bob']); f.jobs.length = 0;
  await f.exported.onProjectTaskCalendarChange(event(task, { ...task, updatedAt: 2, status: 'done' }));
  assert.equal(f.jobs.length, 0);
  const settings = f.records.get('users/alice/calendarConnections/google');
  await f.exported.onGoogleCalendarConfigurationChange(event(settings, { ...settings, lastSyncedAt: 1, lease: 'active', error: null }, { uid: 'alice' }));
  assert.equal(f.jobs.length, 0);
  await f.exported.onGoogleCalendarConfigurationChange(event(settings, { ...settings, calendarId: 'other' }, { uid: 'alice' }));
  assert.deepEqual(f.jobs, [{ uid: 'alice', kind: 'configure' }]); f.jobs.length = 0;
  await f.exported.onPrivateTaskCalendarChange(event(null, { schemaVersion: 3, record: { kind: 'state', date: '2026-11-05', task: { taskName: 'New' } } }, { uid: 'alice' }));
  await f.exported.onProjectMemberCalendarChange(event({ role: 'member' }, null, { uid: 'bob', projectId: 'p' }));
  assert.deepEqual(f.jobs, [{ uid: 'alice', kind: 'sync' }, { uid: 'bob', kind: 'sync' }]);
  f.jobs.length = 0;
  await f.exported.onProjectMemberCalendarChange(event({ role: 'member', lastSeenAt: 1 }, { role: 'member', lastSeenAt: 2 }, { uid: 'bob', projectId: 'p' }));
  assert.equal(f.jobs.length, 0);
});

test('a delayed worker/manual sync cannot recreate a removed calendar connection', async () => {
  const f = fixture();
  await assert.rejects(f.exported.syncGoogleCalendarNow(f.request()), (error: any) => error.code === 'not-found');
  assert.equal(f.records.has('users/alice/calendarConnections/google'), false);
  await f.exported.processGoogleCalendarChange({ data: { uid: 'alice', kind: 'configure' } });
  assert.equal(f.records.has('users/alice/calendarConnections/google'), false);
});

test('OAuth uses PKCE, single-use state and a separate selectable Google account', async () => {
  const f = fixture(), url = await f.begin();
  assert.equal(url.searchParams.get('prompt'), 'consent select_account'); assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const state = url.searchParams.get('state')!, stored = f.records.get('googleCalendarOAuthStates/' + core.hash(state));
  assert.equal(stored.uid, 'alice');
  assert.equal(url.searchParams.get('code_challenge'), Buffer.from(core.hash(stored.verifier), 'hex').toString('base64url'));
  const response = await f.callback(state); assert.equal(response.status, 200); assert.equal(response.headers['Cache-Control'], 'no-store');
  const connection = f.records.get('users/alice/calendarConnections/google');
  assert.equal(connection.email, 'calendar-b@example.com'); assert.equal(connection.enabled, false);
  assert.equal(core.decryptToken(connection.refreshToken, f.secrets.GOOGLE_CALENDAR_TOKEN_KEY, 'alice'), 'refresh-secret');
  const visible = await f.exported.getGoogleCalendarSettings(f.request());
  assert.equal(visible.connected, true); assert.doesNotMatch(JSON.stringify(visible), /refresh-secret|refreshToken|lease|oauthState|client-secret/);
  assert.equal((await f.callback(state)).status, 400); assert.equal(f.exchanges(), 1);
  assert.equal(f.records.has('users/bob/calendarConnections/google'), false);
});
test('expired, forged, superseded and partially granted OAuth attempts never install credentials', async () => {
  for (const mode of ['expired', 'forged', 'superseded', 'missing_scope', 'disabled']) {
    const f = fixture(), url = await f.begin(), state = url.searchParams.get('state')!;
    if (mode === 'expired') f.records.get('googleCalendarOAuthStates/' + core.hash(state)).expiresAt = 0;
    if (mode === 'superseded') f.records.get('users/alice/calendarConnections/google').oauthState = 'new-attempt';
    if (mode === 'missing_scope') f.omitScopes();
    if (mode === 'disabled') f.users.get('alice')!.disabled = true;
    assert.equal((await f.callback(mode === 'forged' ? 'wrong-state' : state)).status, 400, mode);
    assert.equal(f.records.get('users/alice/calendarConnections/google').refreshToken, undefined, mode);
  }
});
test('settings are scoped to caller, Project membership and linked-only direction', async () => {
  const f = fixture(); const url = await f.begin(); await f.callback(url.searchParams.get('state')!);
  f.records.set('projects/p/members/alice', { role: 'member' });
  await f.exported.setGoogleCalendarSettings(f.request('alice', { action: 'project', projectId: 'p', direction: 'linked', calendarId: 'cal', timeZone: 'Asia/Tokyo', uid: 'bob' }));
  assert.equal(f.records.get('users/alice/calendarConnections/google').projects.p.direction, 'linked');
  assert.equal(f.records.has('users/bob/calendarConnections/google'), false);
  await assert.rejects(f.exported.setGoogleCalendarSettings(f.request('bob', { action: 'project', projectId: 'p', direction: 'linked', calendarId: 'cal' })), (error: any) => error.code === 'permission-denied');
  for (const direction of ['both', 'import', 'export']) await assert.rejects(f.exported.setGoogleCalendarSettings(f.request('alice', { action: 'save', direction, calendarId: 'cal', enabled: true })), (error: any) => error.code === 'invalid-argument');
  await f.exported.setGoogleCalendarSettings(f.request('alice', { action: 'save', direction: 'linked', calendarId: 'cal', timeZone: 'Asia/Tokyo', enabled: true }));
  assert.equal(f.records.get('users/alice/calendarConnections/google').enabled, true);
  await f.exported.setGoogleCalendarSettings(f.request('alice', { action: 'pause' }));
  assert.equal(f.records.get('users/alice/calendarConnections/google').enabled, false);
  f.records.get('temisAccessStates/alice').tier = 'free';
  await f.exported.setGoogleCalendarSettings(f.request('alice', { action: 'disable', projectId: 'p' }));
  assert.equal(f.records.get('users/alice/calendarConnections/google').projects.p.direction, 'off');
  await f.exported.setGoogleCalendarSettings(f.request('alice', { action: 'disconnect' }));
  assert.equal(f.records.get('users/alice/calendarConnections/google').refreshToken, null);
});
test('anonymous callers and worker/deletion locks cannot change connection settings', async () => {
  const f = fixture(); const request = f.request(); request.auth.token.firebase.sign_in_provider = 'anonymous';
  await assert.rejects(f.exported.beginGoogleCalendarConnection(request), (error: any) => error.code === 'unauthenticated');
  f.records.set('users/alice/calendarConnections/google', { lease: 'worker', leaseUntil: Date.now() + 60000 });
  await assert.rejects(f.exported.setGoogleCalendarSettings(f.request('alice', { action: 'pause' })), (error: any) => error.code === 'aborted');
  f.records.set('users/alice/calendarConnections/google', { deleting: true });
  await assert.rejects(f.exported.beginGoogleCalendarConnection(f.request()), (error: any) => error.code === 'failed-precondition');
});
