const { randomUUID, randomBytes } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { hash } = require('./googleCalendarCore.cjs');
const { assigneesOf } = require('./projectTaskMutationCore.cjs');

const activeCalendars = value => value?.enabled && value.refreshToken && !value.deleting
  ? [...new Set([value, ...Object.values(value.projects ?? {})].filter(target => target.direction === 'linked' && target.calendarId).map(target => target.calendarId))] : [];
const configuration = value => value && ({ enabled: value.enabled, deleting: value.deleting, googleSub: value.googleSub,
  refreshToken: value.refreshToken, calendarId: value.calendarId, direction: value.direction, timeZone: value.timeZone, projects: value.projects });
const taskContent = (value, project) => {
  if (!value) return null;
  const task = project ? value : value.record?.task;
  const fields = ['taskName', 'title', 'privateDate', 'dueAt', 'createdAt', 'plannedStartAt', 'plannedEndAt', 'repeat', 'repeatAnchorDate', 'occurrenceOverrides', 'isArchived'];
  return { schemaVersion: value.schemaVersion, kind: project ? value.kind : value.record?.kind, projectId: value.projectId,
    deletedAt: value.deletedAt, isDeleted: value.isDeleted, date: value.record?.date,
    assignees: project ? assigneesOf(value).slice().sort() : [], task: task ? Object.fromEntries(fields.map(key => [key, task[key]])) : null };
};
const taskChanged = (before, after, project = false) => !isDeepStrictEqual(taskContent(before, project), taskContent(after, project));
const configurationChanged = (before, after) => !isDeepStrictEqual(configuration(before), configuration(after));
const permanent = error => ['auth/user-not-found', 'permission-denied', 'failed-precondition', 'not-found'].includes(error.code)
  || error.reason === 'invalid_grant' || [400, 401, 403, 404].includes(error.status);

// Queue only as a consequence of a change, a retry, or watch renewal. No polling worker.
const createCalendarEvents = ({ db, enqueue, withLease, apiFor, requirePlus, runSync, safeCode, now = Date.now }) => {
  const connection = uid => db.doc(`users/${uid}/calendarConnections/google`);
  const channels = () => db.collection('googleCalendarChannels');
  const request = async (uid, kind = 'sync') => {
    const value = (await connection(uid).get()).data();
    if (!value || value.deleting || (!activeCalendars(value).length && kind !== 'configure')) return;
    await enqueue({ uid, kind });
  };
  const maintain = uid => withLease(uid, async lease => {
    const value = (await connection(uid).get()).data();
    const calendars = activeCalendars(value);
    const existing = (await channels().where('uid', '==', uid).get()).docs;
    let api;
    const getApi = async () => api ??= await apiFor(uid, value);
    if (calendars.length) await requirePlus(uid);
    // Create replacements before stopping old channels. Google may notify before watch returns.
    for (const calendarId of calendars) {
      if (existing.some(doc => { const c = doc.data(); return c.googleSub === value.googleSub && c.calendarId === calendarId && c.resourceId && c.expiration > now() + 86400000; })) continue;
      const id = randomUUID(), token = randomBytes(32).toString('hex'), ref = channels().doc(id);
      await lease.check();
      await lease.write(ref, { uid, calendarId, googleSub: value.googleSub, tokenHash: hash(token), resourceId: null, expiration: now() + 600000 });
      // Keep an uncertain watch briefly if Google accepted it but the response was lost.
      const watched = await (await getApi()).request(`/calendars/${encodeURIComponent(calendarId)}/events/watch`, 'POST', {
        id, type: 'web_hook', address: 'https://asia-northeast1-temis-c05aa.cloudfunctions.net/googleCalendarWebhook', token, expiration: String(now() + 604800000),
      });
      if (watched.id !== id || typeof watched.resourceId !== 'string' || !Number.isFinite(Number(watched.expiration)) || Number(watched.expiration) <= now()) throw new Error('Invalid watch response');
      // Transactional lease validation prevents account deletion from resurrecting a channel.
      await lease.write(ref, { resourceId: watched.resourceId, expiration: Number(watched.expiration) }, { merge: true });
    }
    for (const document of existing) {
      const c = document.data();
      const replacement = calendars.includes(c.calendarId) && c.googleSub === value.googleSub;
      if (replacement && c.resourceId && c.expiration > now() + 86400000) continue;
      // Invalidate locally even if Google's best-effort stop fails (e.g. disconnected account).
      await document.ref.delete();
      if (c.resourceId && c.expiration > now() && value?.refreshToken && c.googleSub === value.googleSub) {
        try { await (await getApi()).request('/channels/stop', 'POST', { id: document.id, resourceId: c.resourceId }); } catch { /* Expiry also stops delivery. */ }
      }
    }
  });
  const work = async ({ uid, kind }) => {
    if (typeof uid !== 'string' || !uid || uid.includes('/') || !['sync', 'configure', 'renew'].includes(kind)) return;
    const value = (await connection(uid).get()).data();
    if (!value || value.deleting) return;
    try {
      if (kind !== 'sync') await maintain(uid);
      if (kind !== 'renew' && activeCalendars((await connection(uid).get()).data()).length) {
        const result = await runSync(uid);
        // Reuse this task's bounded backoff rather than starting an unlimited retry chain.
        if (result.continuation) throw new Error('Calendar change processing is incomplete');
      }
    } catch (error) {
      // Never recreate a deleted connection just to record an error.
      await db.runTransaction(async tx => {
        const ref = connection(uid), current = (await tx.get(ref)).data();
        if (current && !current.deleting) tx.update(ref, { error: safeCode(error) });
      });
      if (!permanent(error)) throw new Error('Calendar change processing requires retry');
    }
  };
  const notify = async headers => {
    const id = headers['x-goog-channel-id'], token = headers['x-goog-channel-token'], resourceId = headers['x-goog-resource-id'], state = headers['x-goog-resource-state'];
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || typeof token !== 'string' || token.length > 256 || !['sync', 'exists', 'not_exists'].includes(state)) return 403;
    const channel = (await channels().doc(id).get()).data();
    if (!channel || channel.expiration <= now() || channel.tokenHash !== hash(token)) return 403;
    if (state === 'sync') return 204; // Initialization is covered by the configuration run.
    if (!channel.resourceId) return 503; // Watch response is still in flight; don't acknowledge a real change.
    if (channel.resourceId !== resourceId) return 403;
    const value = (await connection(channel.uid).get()).data();
    if (value?.googleSub !== channel.googleSub || !activeCalendars(value).includes(channel.calendarId)) return 204;
    // Acknowledge only after durable enqueue succeeds. Duplicate/out-of-order messages are safe.
    await enqueue({ uid: channel.uid, kind: 'sync' });
    return 204;
  };
  return { request, maintain, work, notify };
};
module.exports = { createCalendarEvents, activeCalendars, taskChanged, configurationChanged, permanent };
