const { Buffer } = require('node:buffer');
const { randomBytes } = require('node:crypto');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const core = require('./googleCalendarCore.cjs');
const google = require('./googleCalendarApi.cjs');
if (!getApps().length) initializeApp();
const db = getFirestore();
const clientId = defineSecret('GOOGLE_CALENDAR_CLIENT_ID');
const clientSecret = defineSecret('GOOGLE_CALENDAR_CLIENT_SECRET');
const tokenKey = defineSecret('GOOGLE_CALENDAR_TOKEN_KEY');
const revenueCatProjectId = defineSecret('REVENUECAT_PROJECT_ID');
const revenueCatKey = defineSecret('REVENUECAT_V2_SECRET_API_KEY');
const revenueCatEntitlement = defineSecret('REVENUECAT_CLOUD_SYNC_ENTITLEMENT_ID');
const secrets = [clientId, clientSecret, tokenKey, revenueCatProjectId, revenueCatKey, revenueCatEntitlement];
const accessService = require('./temisAccessCore.cjs').createTemisAccessService({
  db, HttpsError,
  verifyRevenueCat: async uid => {
    const project = revenueCatProjectId.value().trim(), key = revenueCatKey.value().trim(), entitlement = revenueCatEntitlement.value().trim();
    if (!project || !key || !entitlement) throw new Error('Subscription verification is not configured.');
    const response = await fetch(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(project)}/customers/${encodeURIComponent(uid)}/active_entitlements`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error('Subscription verification failed.');
    const body = await response.json();
    if (!Array.isArray(body.items)) throw new Error('Invalid subscription response.');
    return body.items.some(item => item?.entitlement_id === entitlement);
  },
});
const options = { region: 'asia-northeast1', serviceAccount: require('./environmentRuntime.cjs').runtimeServiceAccount, secrets, timeoutSeconds: 120, maxInstances: 5 };
const config = () => ({ clientId: clientId.value().trim(), clientSecret: clientSecret.value().trim(), redirectUri: 'https://asia-northeast1-temis-c05aa.cloudfunctions.net/googleCalendarOAuthCallback' });
const connectionRef = uid => db.doc(`users/${uid}/calendarConnections/google`);
const requireUid = request => {
  if (!request.auth?.uid || request.auth.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Temisにログインしてください。');
  return request.auth.uid;
};
const requirePlus = async uid => {
  const access = await accessService.getAccess(uid);
  if (access?.userId !== uid || access.tier !== 'plus' || access.verifiedUntil <= Date.now()) throw new HttpsError('failed-precondition', '有効なTemis Plusのクラウド同期が必要です。');
};
const acquire = async uid => {
  const lease = randomBytes(16).toString('hex');
  await db.runTransaction(async tx => {
    const ref = connectionRef(uid), value = (await tx.get(ref)).data() || {};
    if (value.deleting) throw new HttpsError('failed-precondition', 'アカウント削除中です。');
    if (value.leaseUntil > Date.now()) throw new HttpsError('aborted', 'カレンダー同期中です。少し待って再度お試しください。');
    tx.set(ref, { lease, leaseUntil: Date.now() + 130000 }, { merge: true });
  });
  return {
    check: async () => {
      const value = (await connectionRef(uid).get()).data();
      if (value?.lease !== lease || value.leaseUntil <= Date.now() || value.deleting) throw new HttpsError('aborted', '同期設定が変更されました。');
    },
    validate: async tx => {
      const value = (await tx.get(connectionRef(uid))).data();
      if (value?.lease !== lease || value.leaseUntil <= Date.now() || value.deleting || !value.enabled) throw new HttpsError('aborted', '同期設定が変更されました。');
    },
    update: async patch => db.runTransaction(async tx => {
      const ref = connectionRef(uid), value = (await tx.get(ref)).data();
      if (value?.lease !== lease || value.leaseUntil <= Date.now() || value.deleting) throw new HttpsError('aborted', '同期設定が変更されました。');
      tx.update(ref, patch);
    }),
    write: async (target, patch, options) => db.runTransaction(async tx => {
      const value = (await tx.get(connectionRef(uid))).data();
      if (value?.lease !== lease || value.leaseUntil <= Date.now() || value.deleting) throw new HttpsError('aborted', '同期設定が変更されました。');
      if (options) tx.set(target, patch, options); else tx.set(target, patch);
    }),
    release: async () => db.runTransaction(async tx => {
      const ref = connectionRef(uid), value = (await tx.get(ref)).data();
      if (value?.lease === lease) tx.update(ref, { lease: null, leaseUntil: 0 });
    }),
  };
};
const withLease = async (uid, run) => {
  const lease = await acquire(uid);
  try { return await run(lease); } finally { await lease.release(); }
};
const apiFor = async (uid, value) => {
  if (!value?.refreshToken) throw new HttpsError('failed-precondition', 'Googleカレンダーに接続してください。');
  const token = core.decryptToken(value.refreshToken, tokenKey.value(), uid);
  const result = await google.tokenRequest(config(), { grant_type: 'refresh_token', refresh_token: token });
  return google.makeApi(result.access_token);
};
const publicTarget = value => ({ calendarId: value?.calendarId ?? null, calendarName: value?.calendarName ?? null, direction: value?.direction === 'linked' ? 'linked' : 'off' });
const publicSettings = value => ({
  connected: Boolean(value?.refreshToken), email: value?.email ?? null,
  ...publicTarget(value), projects: Object.fromEntries(Object.entries(value?.projects ?? {}).map(([id, target]) => [id, publicTarget(target)])),
  enabled: value?.enabled === true, lastSyncedAt: value?.lastSyncedAt ?? null,
  error: value?.error ?? null, skipped: value?.skipped ?? 0, blocked: value?.blocked ?? 0, pending: value?.pending === true, issues: value?.issues ?? {},
});
const safeCode = error => error.reason === 'invalid_grant' || error.status === 401 ? 'reconnect_required'
  : error.code === 'permission-denied' || error.status === 403 ? 'permission_denied'
  : error.code === 'failed-precondition' ? 'access_required'
  : error.status === 429 ? 'rate_limited' : 'sync_failed';
const callable = handler => onCall(options, async request => {
  const uid = requireUid(request);
  try {
    const user = await getAuth().getUser(uid);
    if (user.disabled) throw new HttpsError('permission-denied', 'このアカウントは利用できません。');
    return await handler(uid, request.data ?? {});
  }
  catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unavailable', `カレンダー処理を完了できませんでした (${safeCode(error)})。`);
  }
});
exports.getGoogleCalendarSettings = callable(async uid => publicSettings((await connectionRef(uid).get()).data()));
exports.beginGoogleCalendarConnection = callable(async uid => {
  await requirePlus(uid);
  return withLease(uid, async lease => {
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    const current = (await connectionRef(uid).get()).data();
    if (current?.oauthStartedAt > Date.now() - 10000) throw new HttpsError('resource-exhausted', '少し待ってから再度接続してください。');
    const digest = core.hash(state);
    await db.doc(`googleCalendarOAuthStates/${digest}`).set({ uid, verifier, expiresAt: Date.now() + 600000 });
    await lease.update({ oauthState: digest, oauthStartedAt: Date.now() });
    const query = new URLSearchParams({ client_id: config().clientId, redirect_uri: config().redirectUri, response_type: 'code', scope: google.SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account', state, code_challenge: Buffer.from(core.hash(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256' });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` };
  });
});
exports.googleCalendarOAuthCallback = onRequest({ ...options, invoker: 'public' }, async (req, res) => {
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  try {
    if (req.method !== 'GET' || typeof req.query.state !== 'string' || req.query.state.length > 100 || typeof req.query.code !== 'string') throw new Error('Invalid callback');
    const digest = core.hash(req.query.state), ref = db.doc(`googleCalendarOAuthStates/${digest}`);
    const state = (await ref.get()).data();
    if (!state || state.expiresAt < Date.now()) throw new Error('Expired authorization');
    await withLease(state.uid, async lease => {
      const value = (await connectionRef(state.uid).get()).data();
      if (value.oauthState !== digest) throw new Error('Superseded authorization');
      if ((await getAuth().getUser(state.uid)).disabled) throw new Error('Disabled account');
      await requirePlus(state.uid);
      // Consume before exchanging; an interrupted exchange is retried with a fresh consent flow.
      await ref.delete();
      await lease.update({ oauthState: null });
      const tokens = await google.tokenRequest(config(), { grant_type: 'authorization_code', code: req.query.code, redirect_uri: config().redirectUri, code_verifier: state.verifier });
      const granted = new Set((tokens.scope || '').split(' '));
      if (!tokens.refresh_token || !google.SCOPES.filter(scope => scope.startsWith('https://www.googleapis.com/auth/calendar')).every(scope => granted.has(scope))) throw new Error('Calendar permission missing');
      const identity = await google.jsonRequest('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (typeof identity.sub !== 'string' || !identity.sub || typeof identity.email !== 'string' || !identity.email || identity.email_verified !== true) throw new Error('Invalid identity');
      const sameAccount = value.googleSub === identity.sub;
      await lease.update({ refreshToken: core.encryptToken(tokens.refresh_token, tokenKey.value(), state.uid), googleSub: identity.sub, email: identity.email,
        enabled: false, error: null, ...(sameAccount ? {} : { calendarId: null, calendarName: null, direction: 'off', projects: {} }) });
    });
    res.status(200).type('text/plain').send('Googleカレンダーに接続しました。Temisに戻り、同期先カレンダーを選び、同期をオンにしてください。');
  } catch {
    res.status(400).type('text/plain').send('接続できませんでした。Temisに戻り、Googleカレンダーへの接続をやり直してください。');
  }
});
exports.listGoogleCalendars = callable(async uid => google.listCalendars(await apiFor(uid, (await connectionRef(uid).get()).data())));
exports.setGoogleCalendarSettings = callable(async (uid, data) => withLease(uid, async lease => {
  if (data.action === 'disconnect') {
    // Credentials are removed first. Existing tasks/events and mapping history remain.
    const value = (await connectionRef(uid).get()).data();
    await lease.update({ refreshToken: null, enabled: false, oauthState: null, error: null });
    if (value?.refreshToken) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: core.decryptToken(value.refreshToken, tokenKey.value(), uid) }), signal: AbortSignal.timeout(10000) });
      } catch { /* Removing the local credential stops synchronization even when Google is unavailable. */ }
    }
    return publicSettings((await connectionRef(uid).get()).data());
  }
  if (data.action === 'pause') { await lease.update({ enabled: false }); return publicSettings((await connectionRef(uid).get()).data()); }
  if (data.action === 'disable') {
    const value = (await connectionRef(uid).get()).data();
    if (data.projectId) {
      if (typeof data.projectId !== 'string' || !/^[^/]{1,128}$/.test(data.projectId)) throw new HttpsError('invalid-argument', 'Projectを確認してください。');
      const target = value.projects?.[data.projectId];
      if (target) await lease.update({ projects: { ...value.projects, [data.projectId]: { ...target, direction: 'off' } } });
    } else await lease.update({ direction: 'off' });
    return publicSettings((await connectionRef(uid).get()).data());
  }
  await requirePlus(uid);
  const value = (await connectionRef(uid).get()).data();
  if (data.action === 'resume') {
    if (!value.refreshToken) throw new HttpsError('failed-precondition', 'Googleカレンダーに接続してください。');
    await lease.update({ enabled: true, error: null });
    return publicSettings((await connectionRef(uid).get()).data());
  }
  if (!['project', 'save'].includes(data.action) || !core.DIRECTIONS.includes(data.direction) || typeof data.calendarId !== 'string') throw new HttpsError('invalid-argument', '同期設定を確認してください。');
  const projectId = data.action === 'project' ? data.projectId : null;
  if (projectId !== null) {
    if (typeof projectId !== 'string' || !/^[^/]{1,128}$/.test(projectId)) throw new HttpsError('invalid-argument', 'Project設定を確認してください。');
    const member = (await db.doc(`projects/${projectId}/members/${uid}`).get()).data();
    if (!member || member.leavingAt != null) throw new HttpsError('permission-denied', 'Projectメンバーのみ設定できます。');
  }
  if (!projectId && typeof data.enabled !== 'boolean') throw new HttpsError('invalid-argument', '同期設定を確認してください。');
  const calendars = await google.listCalendars(await apiFor(uid, value));
  const calendar = calendars.find(item => item.id === data.calendarId);
  if (!calendar) throw new HttpsError('permission-denied', 'カレンダーにアクセスできません。');
  if (core.outbound(data.direction) && !['writer', 'owner'].includes(calendar.accessRole)) throw new HttpsError('permission-denied', '書き込み可能なカレンダーを選択してください。');
  let timeZone = data.timeZone;
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { throw new HttpsError('invalid-argument', 'タイムゾーンを確認してください。'); }
  if (typeof timeZone !== 'string') throw new HttpsError('invalid-argument', 'タイムゾーンを確認してください。');
  const target = { calendarId: calendar.id, calendarName: calendar.name, timeZone, accessRole: calendar.accessRole, direction: data.direction };
  if (projectId) await lease.update({ projects: { ...value.projects, [projectId]: target }, error: null });
  else await lease.update({ ...target, enabled: data.enabled, error: null });
  return publicSettings((await connectionRef(uid).get()).data());
}));
const runSync = async uid => {
  if ((await getAuth().getUser(uid)).disabled) throw new HttpsError('permission-denied', 'Account disabled.');
  await requirePlus(uid);
  return withLease(uid, async lease => {
    const value = (await connectionRef(uid).get()).data();
    if (!value.enabled) return publicSettings(value);
    try {
      const api = await apiFor(uid, value);
      const { syncCalendar } = require('./googleCalendarSync.cjs');
      const targets = [ ...(value.calendarId ? [{ ...value, projectId: null }] : []), ...Object.entries(value.projects ?? {}).map(([projectId, target]) => ({ ...target, projectId })) ].filter(target => target.direction === 'linked');
      const deadline = Date.now() + 75000;
      let skipped = 0, blocked = 0, pending = false;
      const issues = {};
      const offset = (value.nextTarget ?? 0) % Math.max(1, targets.length);
      for (let n = 0; n < targets.length; n++) {
        const index = (offset + n) % targets.length;
        if (Date.now() > deadline - 10000) { pending = true; await lease.update({ nextTarget: index }); break; }
        try {
          const result = await syncCalendar({ db, uid, settings: { ...targets[index], googleSub: value.googleSub }, api, lease, deadline });
          skipped += result.skipped; blocked += result.blocked; pending ||= result.pending;
          for (const [reason, count] of Object.entries(result.issues)) issues[reason] = (issues[reason] ?? 0) + count;
        } finally { await lease.update({ nextTarget: (index + 1) % targets.length }); }
      }
      await lease.update({ skipped, blocked, pending, issues, error: null, lastSyncedAt: Date.now() });
    } catch (error) {
      await lease.update({ error: safeCode(error) });
      throw error;
    }
    return publicSettings((await connectionRef(uid).get()).data());
  });
};
exports.syncGoogleCalendarNow = callable(uid => runSync(uid));
exports.syncGoogleCalendars = onSchedule({ ...options, timeoutSeconds: 540, schedule: 'every 5 minutes', maxInstances: 1 }, async () => {
  const cursorRef = db.doc('googleCalendarJobs/scheduler'), cursor = (await cursorRef.get()).data()?.cursor;
  let query = db.collectionGroup('calendarConnections').where('enabled', '==', true).orderBy(FieldPath.documentId()).limit(50);
  if (cursor) query = query.startAfter(db.doc(cursor));
  const snapshot = await query.get(), deadline = Date.now() + 420000;
  let last = null;
  for (const document of snapshot.docs) {
    if (Date.now() > deadline) break;
    const uid = document.ref.parent.parent.id;
    try { await runSync(uid); } catch (error) {
      // Store only a bounded error code; never tokens, calendar titles, or API bodies.
      if (error.code !== 'aborted') await document.ref.update({ error: safeCode(error) }).catch(() => {});
    }
    last = document.ref.path;
  }
  await cursorRef.set({ cursor: last && (snapshot.size === 50 || last !== snapshot.docs.at(-1)?.ref.path) ? last : null });
  const expired = await db.collection('googleCalendarOAuthStates').where('expiresAt', '<', Date.now()).limit(100).get();
  const batch = db.batch(); expired.docs.forEach(document => batch.delete(document.ref)); await batch.commit();
});
