const core = require('./googleCalendarCore.cjs');
const mergeCore = require('./googleCalendarMerge.cjs');
const { assigneesOf } = require('./projectTaskMutationCore.cjs');
const { applyCalendarChange } = require('./googleCalendarImport.cjs');

// singleEvents=false returns recurring exceptions without expanding infinite series.
// Only exceptions of our persisted, acknowledged masters enter this private inbox.
const syncInstances = async ({ db, uid, settings, api, lease, bindingRef, links, calendarPath, bindingId, deadline, recordIssue }) => {
  const parents = new Map([...links.entries()].filter(([, link]) => !link.removed && link.baseEvent?.recurrence?.length && !link.outgoing?.deleted).map(([key, link]) => [link.eventId, { key, link }]));
  if (!parents.size) return false;
  const inbox = bindingRef.collection('incomingInstances');
  let state = (await bindingRef.get()).data() || {}, pending = false;
  for (let page = 0; page < 5 && Date.now() < deadline - 25000; page++) {
    const query = new URLSearchParams({ singleEvents: 'false', showDeleted: 'true', maxResults: '250',
      fields: 'nextPageToken,nextSyncToken,items(id,status,recurringEventId,originalStartTime,summary,start,end,recurrence,etag)',
      ...(state.syncToken ? { syncToken: state.syncToken } : {}), ...(state.pageToken ? { pageToken: state.pageToken } : {}),
    });
    let result;
    await lease.check();
    try { result = await api.request(`${calendarPath}?${query}`); }
    catch (error) {
      if (error.status === 410) { await lease.write(bindingRef, { syncToken: null, pageToken: null }, { merge: true }); return true; }
      throw error;
    }
    for (const event of result.items ?? []) {
      const parent = parents.get(event.recurringEventId);
      if (!parent || !event.id || event.id.includes('/')) continue;
      await lease.write(inbox.doc(event.id), { parentKey: parent.key, event }, { merge: true });
    }
    state = { ...state, pageToken: result.nextPageToken ?? null, ...(result.nextSyncToken ? { syncToken: result.nextSyncToken } : {}) };
    await lease.write(bindingRef, { pageToken: state.pageToken, syncToken: state.syncToken ?? null }, { merge: true });
    if (!state.pageToken) break;
    pending = true;
  }
  pending = Boolean(state.pageToken);
  const snapshot = await inbox.get();
  for (const document of snapshot.docs) {
    if (Date.now() > deadline - 22000) return true;
    const entry = document.data(), event = entry.event;
    if (entry.transferred || entry.handledEtag === event.etag) continue;
    const parent = parents.get(event.recurringEventId);
    if (!parent) continue;
    const { key, link } = parent;
    try {
      await lease.check();
      const master = await api.request(`${calendarPath}/${encodeURIComponent(link.eventId)}`);
      if (master.status === 'cancelled') continue; // The regular master reconciler owns series deletion.
      if (master.extendedProperties?.private?.temisSync !== `${bindingId}:${key}`) throw new mergeCore.CalendarHold('ownership_changed');
      mergeCore.validateRemoteStructure(mergeCore.projection(master), link.baseEvent);
      const original = event.originalStartTime;
      const day = original?.date ?? (Number.isFinite(Date.parse(original?.dateTime)) ? core.dateAt(Date.parse(original.dateTime), settings.timeZone) : null);
      if (!core.validDate(day)) throw new mergeCore.CalendarHold('unsupported_instance');
      const sourceRef = db.doc(link.sourcePath), source = (await sourceRef.get()).data();
      const kind = settings.projectId ? 'project' : 'private';
      if (!source || source.deletedAt != null || source.isDeleted) continue;
      const task = kind === 'project' ? source : source.record?.task;
      if (!task || task.isArchived || (kind === 'project' && !assigneesOf(task).includes(uid))) continue;
      if (kind === 'private' && source.schemaVersion !== 3) throw new mergeCore.CalendarHold('unsupported_task');
      const masterBody = core.taskEvents(source, kind, settings.timeZone).find(item => item.key === 'root')?.body;
      if (!masterBody?.recurrence) continue;
      const anchor = task.repeatAnchorDate ?? (kind === 'project' ? task.privateDate : source.record.date);
      if (!core.repeatsOn(task.repeat, anchor, day)) throw new mergeCore.CalendarHold('series_changed');
      // An EXDATE already acknowledged from Temis is an outgoing removal, not an incoming delete.
      const compactDay = day.replaceAll('-', '');
      if (link.baseEvent.recurrence.some(line => line.startsWith('EXDATE') && line.slice(line.indexOf(':') + 1).split(',').some(value => value.startsWith(compactDay)))) {
        await lease.write(document.ref, { transferred: true }, { merge: true }); continue;
      }
      const baseline = mergeCore.occurrenceProjection(link.baseEvent, day, settings.timeZone);
      const localBaseline = mergeCore.occurrenceProjection(link.baseTask, day, settings.timeZone);
      const oldOverride = task.occurrenceOverrides?.[day];
      const local = oldOverride?.deleted || oldOverride?.date === 'undated' ? mergeCore.DELETED : oldOverride
        ? mergeCore.projection(core.eventBody(oldOverride.title ?? (kind === 'project' ? task.title : task.taskName), oldOverride.date, oldOverride.plannedStartAt, oldOverride.plannedEndAt, settings.timeZone))
        : mergeCore.occurrenceProjection(mergeCore.projection(masterBody), day, settings.timeZone);
      const remote = mergeCore.projection(event);
      const merged = mergeCore.merge(local, remote, localBaseline, baseline);
      // Even a conflict won by Temis becomes an explicit exception so it is
      // represented by a standalone linked event, never recreated from an old cancellation.
      await applyCalendarChange({ db, uid, kind, sourceRef, source, occurrenceKey: day, value: merged, timeZone: settings.timeZone, lease, projectId: settings.projectId,
        receipt: { ref: document.ref, data: { transferred: true, handledEtag: event.etag ?? null } },
      });
    } catch (error) {
      if (error.calendarReason || ['permission-denied', 'aborted', 'failed-precondition', 'invalid-argument', 'not-found'].includes(error.code) || [400, 403, 404, 412].includes(error.status)) {
        recordIssue(error.calendarReason ?? (error.code === 'aborted' ? 'concurrent_edit' : 'permission_denied')); pending = true;
      } else throw error;
    }
  }
  return pending;
};
module.exports = { syncInstances };
