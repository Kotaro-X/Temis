const { Buffer } = require('node:buffer');
const { createHash, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const DIRECTIONS = ['off', 'linked'];
const hash = value => createHash('sha256').update(value).digest('hex');
const outbound = direction => direction === 'linked';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const nextDay = day => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const partsAt = (timestamp, timeZone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(timestamp).map(part => [part.type, part.value]));
const dateAt = (timestamp, timeZone) => { const p = partsAt(timestamp, timeZone); return `${p.year}-${p.month}-${p.day}`; };
const clockAt = (timestamp, timeZone) => { const p = partsAt(timestamp, timeZone); return `${p.hour}:${p.minute}:${p.second}`; };
const onDate = (date, clock, timeZone) => {
  const desired = Date.parse(`${date}T${clock}Z`); let value = desired;
  for (let n = 0; n < 4; n++) {
    const local = Date.parse(`${dateAt(value, timeZone)}T${clockAt(value, timeZone)}Z`);
    const next = value + desired - local;
    if (value === next) return value;
    value = next;
  }
  return value;
};
const repeatsOn = (repeat, anchor, date) => {
  if (!validDate(date) || date < anchor) return false;
  if (date === anchor || repeat === 'daily') return true;
  if (repeat === 'weekly') return new Date(`${date}T12:00:00Z`).getUTCDay() === new Date(`${anchor}T12:00:00Z`).getUTCDay();
  if (repeat === 'monthly') return date.slice(8) === anchor.slice(8);
  if (repeat === 'yearly') return date.slice(5) === anchor.slice(5);
  return false;
};
const eventBody = (title, date, start, end, timeZone) => ({
  summary: title,
  start: Number.isFinite(start) ? { dateTime: new Date(start).toISOString(), timeZone } : { date },
  end: Number.isFinite(start) ? { dateTime: new Date(end).toISOString(), timeZone } : { date: nextDay(date) },
});
// Emit a recurring master and standalone exception events. EXDATE keeps moved,
// renamed and deleted occurrences out of the master without touching Google instances.
const taskEvents = (document, kind, timeZone) => {
  if (!document || document.deletedAt != null || document.isDeleted) return [];
  const task = kind === 'project' ? document : document.record?.kind === 'state' ? document.record.task : null;
  if (!task || task.isArchived) return [];
  const date = kind === 'project' ? (task.privateDate === null ? 'undated' : task.privateDate ?? (Number.isFinite(task.dueAt ?? task.createdAt) ? dateAt(task.dueAt ?? task.createdAt, timeZone) : null)) : document.record.date;
  if (!validDate(date)) return [];
  const title = kind === 'project' ? task.title : task.taskName;
  const timed = Number.isFinite(task.plannedStartAt) && Number.isFinite(task.plannedEndAt) && task.plannedEndAt - task.plannedStartAt >= 300000;
  const repeating = ['daily', 'weekly', 'monthly', 'yearly'].includes(task.repeat);
  const anchor = repeating && validDate(task.repeatAnchorDate) ? task.repeatAnchorDate : date;
  const clock = timed ? clockAt(task.plannedStartAt, timeZone) : null;
  const start = timed ? onDate(anchor, clock, timeZone) : null;
  const end = timed ? start + task.plannedEndAt - task.plannedStartAt : null;
  const overrides = Object.entries(task.occurrenceOverrides ?? {}).filter(([day]) => repeatsOn(repeating ? task.repeat : 'none', anchor, day));
  if (!repeating) {
    const override = task.occurrenceOverrides?.[date];
    if (override?.deleted || override?.date === 'undated') return [];
    return [{ key: 'root', body: override
      ? eventBody(override.title ?? title, override.date ?? date, override.plannedStartAt, override.plannedEndAt, timeZone)
      : eventBody(title, date, start, end, timeZone) }];
  }
  const body = { ...eventBody(title, anchor, start, end, timeZone), recurrence: [`RRULE:FREQ=${task.repeat.toUpperCase()}`] };
  if (overrides.length) body.recurrence.push(timed
    ? `EXDATE;TZID=${timeZone}:${overrides.map(([day]) => day.replaceAll('-', '') + 'T' + clock.replaceAll(':', '')).sort().join(',')}`
    : `EXDATE;VALUE=DATE:${overrides.map(([day]) => day.replaceAll('-', '')).sort().join(',')}`);
  return [{ key: 'root', body }, ...overrides.flatMap(([day, override]) => override.deleted || !validDate(override.date) ? [] : [{ key: day, body: eventBody(override.title ?? title, override.date, override.plannedStartAt, override.plannedEndAt, timeZone) }])];
};
const eventMatches = (actual, desired) => actual.status !== 'cancelled' && actual.summary === desired.summary
  && (actual.start?.dateTime ? Date.parse(actual.start.dateTime) === Date.parse(desired.start.dateTime) : actual.start?.date === desired.start.date)
  && (actual.end?.dateTime ? Date.parse(actual.end.dateTime) === Date.parse(desired.end.dateTime) : actual.end?.date === desired.end.date)
  && same([...(actual.recurrence ?? [])].sort(), [...(desired.recurrence ?? [])].sort());
const encryptToken = (token, secret, uid) => {
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32) throw new Error('Calendar encryption key must be 32 bytes.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(uid));
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
};
const decryptToken = (value, secret, uid) => {
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'base64'), Buffer.from(value.iv, 'base64'));
  decipher.setAAD(Buffer.from(uid)); decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
};
module.exports = { dateAt, clockAt, repeatsOn, eventBody, DIRECTIONS, hash, same, outbound, taskEvents, eventMatches, encryptToken, decryptToken, onDate, validDate };
