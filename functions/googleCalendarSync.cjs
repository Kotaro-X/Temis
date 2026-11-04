const { isDeepStrictEqual } = require('node:util');
const core = require('./googleCalendarCore.cjs');
const mergeCore = require('./googleCalendarMerge.cjs');
const { assigneesOf } = require('./projectTaskMutationCore.cjs');
const { applyCalendarChange } = require('./googleCalendarImport.cjs');
const { syncInstances } = require('./googleCalendarInstances.cjs');

const syncCalendar = async ({ db, uid, settings, api, lease, deadline }) => {
  const projectId = settings.projectId, kind = projectId ? 'project' : 'private';
  // Calendar access loss is not evidence that every mapped event was deleted.
  try {
    const calendar = await api.request(`/users/me/calendarList/${encodeURIComponent(settings.calendarId)}`);
    if (!['owner', 'writer'].includes(calendar.accessRole)) throw { status: 403 };
  } catch (error) {
    if (![403, 404].includes(error.status)) throw error;
    return { skipped: 0, blocked: 1, pending: true, issues: { permission_denied: 1 } };
  }
  const bindingId = core.hash(`${uid}:${settings.googleSub}:${settings.calendarId}:${projectId ?? 'private'}`);
  const bindingRef = db.doc(`users/${uid}/calendarBindings/${bindingId}`);
  const binding = (await bindingRef.get()).data() || {};
  const linksCollection = bindingRef.collection('links');
  const calendarPath = `/calendars/${encodeURIComponent(settings.calendarId)}/events`;
  const projectAccessible = async () => {
    if (!projectId) return true;
    const [project, member] = await Promise.all([db.doc(`projects/${projectId}`).get(), db.doc(`projects/${projectId}/members/${uid}`).get()]);
    return project.exists && !project.data().deletedAt && member.exists && member.data().leavingAt == null;
  };
  const eligible = data => data && (projectId ? (data.kind ?? 'task') === 'task' && data.projectId === projectId && assigneesOf(data).includes(uid) : data.record?.kind === 'state');
  let skipped = 0, blocked = 0, pending = false, continuation = false;
  const issues = {};
  const recordIssue = reason => { blocked++; issues[reason] = (issues[reason] ?? 0) + 1; if (reason === 'concurrent_edit') continuation = true; };
  const accessible = await projectAccessible();
  const links = new Map((await linksCollection.get()).docs.map(document => [document.id, document.data()]));
  if (accessible) pending = await syncInstances({ db, uid, settings, api, lease, bindingRef, links, calendarPath, bindingId, deadline, recordIssue, requestContinuation: () => { continuation = true; } });
  const sources = accessible ? await (projectId ? db.collection('projectTasks').where('projectId', '==', projectId) : db.collection(`users/${uid}/tasks`)).get() : { docs: [] };
  const desired = new Map(), preserve = new Set();
  for (const document of sources.docs) {
    const data = document.data();
    if (!projectId && data.schemaVersion !== 3) { preserve.add(document.ref.path); skipped++; continue; }
    if (!eligible(data)) continue;
    try {
      const events = core.taskEvents(data, kind, settings.timeZone);
      if (!events.length && !data.deletedAt && !data.isDeleted) skipped++;
      for (const event of events) desired.set(core.hash(document.ref.path + ':' + event.key), { sourcePath: document.ref.path, occurrenceKey: event.key });
    } catch { preserve.add(document.ref.path); recordIssue('unsupported_task'); }
  }
  const keys = [...new Set([...desired.keys(), ...links.keys()])].sort();
  const ordered = [...keys.filter(key => key > (binding.cursor ?? '')), ...keys.filter(key => key <= (binding.cursor ?? ''))];
  for (const key of ordered) {
    if (Date.now() > deadline - 22000) { pending = true; continuation = true; break; }
    await lease.check();
    const ref = linksCollection.doc(key);
    let link = links.get(key);
    const identity = desired.get(key) ?? link;
    if (!identity || preserve.has(identity.sourcePath)) continue;
    try {
      const sourceRef = db.doc(identity.sourcePath);
      let source = (await sourceRef.get()).data();
      const occurrenceKey = identity.occurrenceKey ?? (key === core.hash(identity.sourcePath + ':root') ? 'root' : null);
      if (!occurrenceKey) throw new mergeCore.CalendarHold('unsupported_link');
      if (source && !projectId && source.schemaVersion !== 3) throw new mergeCore.CalendarHold('unsupported_task');
      const mayExport = eligible(source) && await projectAccessible();
      const wantedBody = mayExport ? core.taskEvents(source, kind, settings.timeZone).find(item => item.key === occurrenceKey)?.body : null;
      let local = wantedBody ? mergeCore.projection(wantedBody) : mergeCore.DELETED;
      if (!link) {
        if (local.deleted) continue;
        link = { sourcePath: identity.sourcePath, occurrenceKey, eventId: core.hash(bindingId + key + ':0'), generation: 0, removed: false, version: 2 };
        await lease.write(ref, link);
      }
      if (local.deleted && link.removed) continue;
      const marker = `${bindingId}:${key}`;
      let actual = null;
      try { actual = await api.request(`${calendarPath}/${encodeURIComponent(link.eventId)}`); }
      catch (error) {
        if (![404, 410].includes(error.status)) throw error;
        // A hidden/deleted calendar must never be interpreted as task deletion.
        const calendar = await api.request(`/users/me/calendarList/${encodeURIComponent(settings.calendarId)}`);
        if (!['owner', 'writer'].includes(calendar.accessRole)) throw new mergeCore.CalendarHold('permission_denied');
      }
      if (actual && actual.status !== 'cancelled' && actual.extendedProperties?.private?.temisSync !== marker) throw new mergeCore.CalendarHold('ownership_changed');
      if (actual && actual.status !== 'cancelled' && (typeof actual.etag !== 'string' || !actual.etag)) throw new mergeCore.CalendarHold('missing_event_version');
      let remote = local.deleted && actual && actual.status !== 'cancelled' ? { deleted: false } : mergeCore.projection(actual);
      // A persisted outgoing intent disambiguates server-generated cancellations
      // and recovers writes whose API response or checkpoint was lost.
      if (link.outgoing && ((link.outgoing.operation === 'delete' && remote.deleted)
          || (link.outgoing.operation === 'create' && actual)
          || core.same(remote, link.outgoing.target))) {
        link = { ...link, baseTask: link.outgoing.source, baseEvent: link.outgoing.target, removed: link.outgoing.operation === 'delete', outgoing: null, etag: actual?.etag ?? null };
        await lease.write(ref, link);
      }
      if (!local.deleted && !link.removed) mergeCore.validateRemoteStructure(remote, link.baseEvent);
      let merged = link.removed ? local : mergeCore.merge(local, remote, link.baseTask, link.baseEvent);
      if (!local.deleted && !core.same(local, merged)) {
        source = await applyCalendarChange({ db, uid, kind, sourceRef, source, occurrenceKey, value: merged, timeZone: settings.timeZone, lease, projectId });
        // Recompute the actual app representation, including anchor and exception changes.
        const nextBody = core.taskEvents(source, kind, settings.timeZone).find(item => item.key === occurrenceKey)?.body;
        local = nextBody ? mergeCore.projection(nextBody) : mergeCore.DELETED;
        merged = local;
      }
      // Recheck source and membership immediately before an external side effect.
      const latest = (await sourceRef.get()).data();
      if (!isDeepStrictEqual(latest, source)) throw new mergeCore.CalendarHold('concurrent_edit');
      if (!merged.deleted && !(await projectAccessible())) throw new mergeCore.CalendarHold('permission_denied');
      if (merged.deleted) {
        link = { ...link, outgoing: { operation: 'delete', source: local, target: mergeCore.DELETED } };
        await lease.write(ref, link);
        if (!remote.deleted) {
          await lease.check();
          try { await api.request(`${calendarPath}/${encodeURIComponent(link.eventId)}`, 'DELETE', undefined, actual.etag); }
          catch (error) { if (![404, 410].includes(error.status)) throw error; }
        }
        await lease.write(ref, { ...link, removed: true, outgoing: null, baseTask: local, baseEvent: mergeCore.DELETED, etag: null, version: 2 });
      } else {
        const body = mergeCore.bodyOf(merged, settings.timeZone);
        if (remote.deleted) {
          if (actual?.status === 'cancelled' || link.removed || link.baseEvent || link.confirmed) {
            const generation = link.generation + 1;
            link = { ...link, generation, eventId: core.hash(bindingId + key + ':' + generation), removed: false };
          }
          link = { ...link, outgoing: { operation: 'create', source: local, target: merged } };
          await lease.write(ref, link);
          await lease.check();
          try { actual = await api.request(calendarPath, 'POST', { id: link.eventId, ...body, extendedProperties: { private: { temisSync: marker } } }); }
          catch (error) {
            if (error.status !== 409) throw error;
            actual = await api.request(`${calendarPath}/${encodeURIComponent(link.eventId)}`);
            if (actual.extendedProperties?.private?.temisSync !== marker) throw new mergeCore.CalendarHold('ownership_changed');
            // Existing event might have been edited after a lost response. Reconcile next run.
            await lease.write(ref, { ...link, baseTask: local, baseEvent: merged, outgoing: null });
            pending = true; continuation = true; continue;
          }
          remote = mergeCore.projection(actual);
        } else if (!core.same(remote, merged)) {
          link = { ...link, outgoing: { operation: 'patch', source: local, target: merged, priorEtag: actual.etag } };
          await lease.write(ref, link);
          await lease.check();
          actual = await api.request(`${calendarPath}/${encodeURIComponent(link.eventId)}`, 'PATCH', {
            ...body, start: { date: null, dateTime: null, timeZone: null, ...body.start }, end: { date: null, dateTime: null, timeZone: null, ...body.end }, recurrence: body.recurrence ?? [],
          }, actual.etag);
          remote = mergeCore.projection(actual);
        }
        await lease.write(ref, { ...link, removed: false, confirmed: true, outgoing: null, baseTask: local, baseEvent: remote, etag: actual.etag ?? null, version: 2 });
      }
      await lease.write(bindingRef, { cursor: key }, { merge: true });
    } catch (error) {
      if (!error.calendarReason && !['permission-denied', 'aborted', 'failed-precondition', 'invalid-argument', 'not-found'].includes(error.code) && ![400, 403, 404, 412].includes(error.status)) throw error;
      recordIssue(error.calendarReason ?? (error.code === 'aborted' || error.status === 412 ? 'concurrent_edit' : 'permission_denied'));
      pending = true;
      await lease.write(bindingRef, { cursor: key }, { merge: true });
    }
  }
  return { skipped, blocked, pending, issues, continuation };
};
module.exports = { syncCalendar };
