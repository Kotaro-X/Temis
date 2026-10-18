import { addDays, localDate, occurrencesForDates, reminderTime, repeatsOn, type PlanningItem } from './planningCore.ts';
export type ReminderRequest = { key: string; id: string; title: string; projectId: string | null; at: number; repeat?: { frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; hour: number; minute: number; day: number; month: number; weekday: number } };
export function buildReminderRequests(items: PlanningItem[], now: number): ReminderRequest[] {
  const dates = Array.from({ length: 61 }, (_, i) => addDays(localDate(now), i));
  const dated = occurrencesForDates(items.filter(item => !item.completed || (item.repeat && item.repeat !== 'none')), dates);
  const undated = items.filter(item => (item.date === 'undated' || ((!item.repeat || item.repeat === 'none') && !dated.some(occurrence => occurrence.id === item.id))) && !item.archived && !item.completed).map(item => ({ ...item, key: item.id, occurrenceDate: '' }));
  const requests: ReminderRequest[] = [...dated, ...undated].flatMap(item => {
    if (item.completed || item.archived || !item.reminder?.enabled) return [];
    let at = reminderTime(item);
    if (at != null && item.reminder.mode === 'custom' && item.repeat && item.repeat !== 'none') {
      const source = items.find(source => source.id === item.id)!;
      const sourceDate = source.repeatAnchorDate ?? source.date;
      const days = Math.round((new Date(`${item.occurrenceDate}T12:00:00`).getTime() - new Date(`${sourceDate}T12:00:00`).getTime()) / 86400000);
      const shifted = new Date(at); shifted.setDate(shifted.getDate() + days); at = shifted.getTime();
    }
    return at != null && Number.isFinite(at) && at > now ? [{ key: item.key, id: item.id, title: item.title, projectId: item.projectId ?? null, at }] : [];
  });
  for (const item of items) {
    if (!item.repeat || item.repeat === 'none' || item.archived || !item.reminder?.enabled || item.date === 'undated') continue;
    const anchor = item.repeatAnchorDate ?? item.date;
    if (anchor > localDate(now)) continue;
    // A future exception needs individual notifications, including a cancelled occurrence.
    if (Object.entries(item.occurrenceOverrides ?? {}).some(([day, value]) => day >= localDate(now) || value.date >= localDate(now))) continue;
    const referenceAt = reminderTime(item); if (referenceAt == null || !Number.isFinite(referenceAt)) continue;
    if (item.reminder.mode === 'custom' && localDate(referenceAt) !== anchor) continue;
    if ((item.repeat === 'monthly' || item.repeat === 'yearly') && item.plannedStartAt != null && localDate(referenceAt) !== localDate(item.plannedStartAt)) continue;
    const reference = new Date(referenceAt), candidate = new Date(now);
    candidate.setHours(reference.getHours(), reference.getMinutes(), 0, 0);
    let next: number | null = null;
    // At most eight years covers Feb 29, without reserving thousands of one-shot notifications.
    for (let day = 0; day < 366 * 8; day++) {
      if (candidate.getTime() > now && repeatsOn({ repeat: item.repeat }, localDate(reference), localDate(candidate))) { next = candidate.getTime(); break; }
      candidate.setDate(candidate.getDate() + 1);
    }
    if (next == null || item.completed && localDate(next) === item.date) continue;
    for (let i = requests.length - 1; i >= 0; i--) if (requests[i].id === item.id) requests.splice(i, 1);
    requests.push({ key: `${item.id}@repeat`, id: item.id, title: item.title, projectId: item.projectId ?? null, at: next,
      repeat: { frequency: item.repeat, hour: reference.getHours(), minute: reference.getMinutes(), day: reference.getDate(), month: reference.getMonth(), weekday: reference.getDay() + 1 } });
  }
  return requests.sort((a, b) => a.at - b.at).slice(0, 60);
}
