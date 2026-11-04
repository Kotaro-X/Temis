const core = require('./googleCalendarCore.cjs');
const DELETED = { deleted: true };
class CalendarHold extends Error {
  constructor(reason) { super(reason); this.calendarReason = reason; }
}
// Google may reorder RRULE properties and EXDATE values on write.
const recurrenceOf = event => (event.recurrence ?? []).map(line => {
  if (line.startsWith('RRULE:')) return 'RRULE:' + line.slice(6).split(';').sort().join(';');
  const i = line.indexOf(':');
  return line.slice(0, i + 1) + line.slice(i + 1).split(',').sort().join(',');
}).sort();
const projection = event => {
  if (!event || event.status === 'cancelled') return DELETED;
  const title = event.summary;
  if (typeof title !== 'string' || !title.trim() || title.length > 2000) throw new CalendarHold('unsupported_title');
  let time;
  if (event.start?.date && event.end?.date && core.validDate(event.start.date) && core.validDate(event.end.date)) {
    const length = Date.parse(event.end.date) - Date.parse(event.start.date);
    if (length !== 86400000) throw new CalendarHold('unsupported_all_day_range');
    time = { date: event.start.date };
  } else {
    const start = Date.parse(event.start?.dateTime), end = Date.parse(event.end?.dateTime);
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end - start < 300000 || end - start > 100000 * 60000) throw new CalendarHold('unsupported_time');
    time = { start, end };
  }
  return { title, time, recurrence: recurrenceOf(event), zone: event.recurrence?.length ? event.start?.timeZone ?? null : null };
};
const bodyOf = (value, timeZone) => ({
  ...core.eventBody(value.title, value.time.date, value.time.start, value.time.end, timeZone),
  ...(value.recurrence.length ? { recurrence: value.recurrence } : {}),
});
// Baselines are independently acknowledged projections; unrelated fields never
// participate in conflict resolution. A tombstone from Temis always wins.
const merge = (task, event, baseTask, baseEvent) => {
  if (task.deleted) return DELETED;
  if (!baseTask || !baseEvent) return task; // Unacknowledged/legacy links bootstrap outward only.
  if (event.deleted) return core.same(task, baseTask) ? DELETED : task;
  const result = { ...task };
  for (const field of ['title', 'time']) {
    const localChanged = !core.same(task[field], baseTask[field]);
    const remoteChanged = !core.same(event[field], baseEvent[field]);
    if (!localChanged && remoteChanged) result[field] = event[field];
  }
  return result;
};
const validateRemoteStructure = (event, baseEvent) => {
  if (event.deleted || !baseEvent || baseEvent.deleted) return;
  if (!core.same(event.recurrence, baseEvent.recurrence) || (!event.time.date && !baseEvent.time.date && event.zone !== baseEvent.zone)) throw new CalendarHold('unsupported_recurrence');
};
const slotFor = (value, zone) => {
  if (value.time.date) return 'morning';
  const hour = Number(core.clockAt(value.time.start, zone).slice(0, 2));
  return hour < 4 || hour >= 18 ? 'night' : hour < 8 ? 'morning' : hour < 12 ? 'forenoon' : 'afternoon';
};
const patchFor = (document, kind, occurrenceKey, value, zone) => {
  const task = kind === 'project' ? document : document.record.task;
  const repeating = task.repeat && task.repeat !== 'none';
  if (value.deleted && occurrenceKey === 'root') return { deleteTask: true };
  let day = occurrenceKey;
  // A nonrepeating task can still carry an override created by its planner.
  if (day === 'root' && !repeating) {
    const date = kind === 'project' ? task.privateDate : document.record.date;
    if (task.occurrenceOverrides?.[date]) day = date;
  }
  if (value.deleted) {
    if (day === 'root') return { deleteTask: true };
    if (!task.occurrenceOverrides?.[day] && Object.keys(task.occurrenceOverrides ?? {}).length >= 1000) throw new CalendarHold('too_many_exceptions');
    const old = task.occurrenceOverrides?.[day] ?? {};
    return { patch: { occurrenceOverrides: { [day]: { date: day, slot: 'morning', plannedStartAt: null, plannedEndAt: null, estimateMinutes: task.estimateMinutes ?? 25, ...old, deleted: true } } } };
  }
  const date = value.time.date ?? core.dateAt(value.time.start, zone);
  const planning = { plannedStartAt: value.time.start ?? null, plannedEndAt: value.time.end ?? null };
  if (day !== 'root') {
    if (!task.occurrenceOverrides?.[day] && Object.keys(task.occurrenceOverrides ?? {}).length >= 1000) throw new CalendarHold('too_many_exceptions');
    const old = task.occurrenceOverrides?.[day] ?? {};
    return { patch: { occurrenceOverrides: { [day]: { estimateMinutes: old.estimateMinutes ?? task.estimateMinutes ?? 25, ...old, ...planning, date, slot: slotFor(value, zone), title: value.title, deleted: false } } } };
  }
  const anchor = task.repeatAnchorDate ?? (kind === 'project' ? task.privateDate : document.record.date);
  if (repeating && anchor !== date && Object.keys(task.occurrenceOverrides ?? {}).length) throw new CalendarHold('series_move_with_exceptions');
  return { date, slot: slotFor(value, zone), patch: { ...planning, ...(repeating ? { repeatAnchorDate: date } : {}),
    ...(kind === 'project' ? { title: value.title, privateDate: date, privateSlotKey: slotFor(value, zone) } : { taskName: value.title }) } };
};
const occurrenceProjection = (master, day, zone) => {
  if (master.time.date) return { ...master, time: { date: day }, recurrence: [], zone: null };
  const start = core.onDate(day, core.clockAt(master.time.start, zone), zone);
  return { ...master, time: { start, end: start + master.time.end - master.time.start }, recurrence: [], zone: null };
};
module.exports = { CalendarHold, DELETED, projection, bodyOf, merge, validateRemoteStructure, patchFor, occurrenceProjection };
