import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, weekDates, initialDuration, slotAt, localDate, snapMinutes, scheduledPatch, occurrencesForDates, layoutIntervals, convertTodo, UNDATED_TASKS, type PlanningItem } from '../src/features/taskPlanning/planningCore.ts';
import { buildReminderRequests } from '../src/features/taskPlanning/reminderCore.ts';
import { DEFAULT_TIMEBOX_SCHEDULE } from '../src/types/timer.ts';
import type { SimpleTodoItem } from '../src/types/todo.ts';
const at = (date: string, time = '09:00') => new Date(`${date}T${time}:00`).getTime();
const item: PlanningItem = { id: 'task', title: 'Work', date: '2026-10-19', slot: 'forenoon', estimateMinutes: 30, completed: false, plannedStartAt: at('2026-10-19'), plannedEndAt: at('2026-10-19','09:30') };
test('five minute snapping and initial duration do not modify recorded actual time', () => {
  assert.equal(snapMinutes(12), 10); assert.equal(snapMinutes(13), 15);
  assert.equal(initialDuration(26), 30); assert.equal(initialDuration(0), 30);
  assert.throws(() => scheduledPatch(1000, 2000));
  assert.equal(scheduledPatch(at('2026-10-19'), at('2026-10-19','10:15')).estimateMinutes, 75);
});
test('week starts at the selected day and spans seven local dates across year boundaries', () => {
  assert.deepEqual(weekDates('2027-01-03'), ['2027-01-03','2027-01-04','2027-01-05','2027-01-06','2027-01-07','2027-01-08','2027-01-09']);
  assert.equal(addDays('2026-12-31',1), '2027-01-01');
});
test('slot follows start time and gaps use the preceding box including midnight', () => {
  assert.equal(slotAt(DEFAULT_TIMEBOX_SCHEDULE, at('2026-10-19','14:00')), 'afternoon');
  assert.equal(slotAt(DEFAULT_TIMEBOX_SCHEDULE, at('2026-10-19','01:00')), 'night');
  assert.equal(slotAt({ ...DEFAULT_TIMEBOX_SCHEDULE, forenoon: { start: '09:00', end: '12:00' } }, at('2026-10-19','08:30')), 'morning');
});
test('repeated drag changes only its occurrence and moved occurrences appear in their new week', () => {
  const repeated = { ...item, repeat: 'daily' as const, repeatAnchorDate: item.date, occurrenceOverrides: { '2026-10-20': { date: '2026-10-28', slot: 'afternoon' as const, ...scheduledPatch(at('2026-10-28','14:00'), at('2026-10-28','14:45')) } } };
  const next = occurrencesForDates([repeated], ['2026-10-20']); assert.equal(next.length,0);
  const moved = occurrencesForDates([repeated], ['2026-10-28']).find(item => item.occurrenceDate === '2026-10-20')!;
  assert.equal(moved.slot,'afternoon'); assert.equal(moved.estimateMinutes,45);
  assert.equal(occurrencesForDates([repeated], ['2026-10-21'])[0].estimateMinutes,30);
});
test('completed/deleted exceptions do not suppress later repetitions', () => {
  const source = { ...item, repeat: 'daily' as const, occurrenceOverrides: { '2026-10-20': { date:'2026-10-20', slot:item.slot, plannedStartAt:null, plannedEndAt:null, estimateMinutes:30, deleted:true }, '2026-10-21': { date:'2026-10-21', slot:item.slot, plannedStartAt:null, plannedEndAt:null, estimateMinutes:30, completed:true } } };
  const list = occurrencesForDates([source], ['2026-10-20','2026-10-21','2026-10-22']);
  assert.equal(list.length,2); assert.equal(list[0].completed,true); assert.equal(list[1].completed,false);
});
test('monthly and yearly recurrence skip nonexistent dates', () => {
  assert.equal(occurrencesForDates([{ ...item, date:'2026-01-31', repeat:'monthly' }], ['2026-02-28']).length,0);
  assert.equal(occurrencesForDates([{ ...item, date:'2024-02-29', repeat:'yearly' }], ['2025-02-28']).length,0);
});
test('overnight task is visible on both days with the same identity', () => {
  const overnight = { ...item, ...scheduledPatch(at(item.date,'23:30'), at('2026-10-20','00:30')) };
  assert.equal(occurrencesForDates([overnight], ['2026-10-20']).length,1);
  assert.equal(occurrencesForDates([overnight], ['2026-10-19','2026-10-20']).length,1);
});
test('overlapping intervals share columns, adjacent intervals reuse width', () => {
  const list = layoutIntervals([{ key:'a',start:0,end:60 },{ key:'b',start:30,end:90 },{ key:'c',start:60,end:80 },{ key:'d',start:90,end:120 }]);
  assert.deepEqual(list.map(item => [item.column,item.columns]), [[0,2],[1,2],[0,2],[0,1]]);
});
test('legacy ToDo conversion preserves state and notification without inventing a planned time', () => {
  const todo: SimpleTodoItem = { id:'old', text:'Title', memo:'Body', tags:['tag'], isDone:true, createdAt:1, doneAt:2, reminderDate:'2026-10-19', reminderTime:'09:00', repeat:'weekly', notificationId:'old-notification', notificationIds:[], seriesId:'old', seriesAnchorDate:'2026-10-19', occurrenceDate:null, isDeleted:false };
  const converted = convertTodo(todo);
  assert.equal(converted.id,convertTodo(todo).id); assert.equal(converted.status,'DONE'); assert.equal(converted.plannedStartAt,null); assert.equal(converted.startAt,null);
  assert.equal(converted.reminder?.at,at('2026-10-19')); assert.deepEqual(converted.tags,['tag']);
});
test('custom reminders work without a planned time or a date and ignore completed tasks', () => {
  const reminder = { enabled:true, mode:'custom' as const, offsetMinutes:0, at:at('2026-10-21') };
  const requests = buildReminderRequests([{ ...item, date:UNDATED_TASKS, plannedStartAt:null, plannedEndAt:null, reminder }],at('2026-10-20'));
  assert.equal(requests.length,1); assert.equal(requests[0].at,reminder.at);
  assert.equal(buildReminderRequests([{ ...item, completed:true, reminder }],at('2026-10-20')).length,0);
});
test('rescheduling moves start-based notification; completed occurrence cancels only itself', () => {
  const repeated = { ...item, repeat:'daily' as const, reminder:{ enabled:true,mode:'start' as const,offsetMinutes:5,at:null }, occurrenceOverrides:{ '2026-10-20':{ date:'2026-10-20',slot:item.slot,plannedStartAt:at('2026-10-20','11:00'),plannedEndAt:at('2026-10-20','12:00'),estimateMinutes:60 }, '2026-10-21':{ date:'2026-10-21',slot:item.slot,plannedStartAt:null,plannedEndAt:null,estimateMinutes:30,completed:true } } };
  const requests = buildReminderRequests([repeated],at('2026-10-20','00:00'));
  assert.equal(requests[0].at,at('2026-10-20','10:55')); assert.ok(!requests.some(item => localDate(item.at) === '2026-10-21'));
  assert.ok(requests.length <= 60);
});

test('ordinary recurring reminders use one native repeating reservation, including annual events outside the short horizon', () => {
  const daily = buildReminderRequests([{ ...item, repeat:'daily', reminder:{ enabled:true,mode:'start',offsetMinutes:5,at:null } }],at('2026-10-20'));
  assert.equal(daily.length,1); assert.equal(daily[0].repeat?.frequency,'daily'); assert.equal(daily[0].repeat?.minute,55);
  const annual = buildReminderRequests([{ ...item, date:'2025-03-01', repeatAnchorDate:'2025-03-01', plannedStartAt:at('2025-03-01'), plannedEndAt:at('2025-03-01','09:30'), repeat:'yearly',reminder:{ enabled:true,mode:'start',offsetMinutes:0,at:null } }],at('2026-10-20'));
  assert.equal(annual.length,1); assert.equal(localDate(annual[0].at),'2027-03-01'); assert.equal(annual[0].repeat?.month,2);
});

test('malformed shared occurrence fields are ignored instead of entering rendered task text', async () => {
  const { normalizePlanning } = await import('../src/features/taskPlanning/planningCore.ts');
  const value = normalizePlanning({ occurrenceOverrides:{ '2026-10-20':{ date:'2026-10-20',slot:'forenoon',estimateMinutes:30,plannedStartAt:null,plannedEndAt:null,title:{ forged:true } as unknown as string } } });
  assert.equal(value.occurrenceOverrides?.['2026-10-20'].title,undefined);
});

test('taking over the Private timer pauses other occurrences without losing their actual durations', async () => {
  const { pauseOtherTaskTimers } = await import('../src/features/taskPlanning/planningCore.ts');
  const task = { id:'timer',taskName:'Timer',tags:[],estimateMinutes:30,elapsedMinutes:1,status:'IN_PROGRESS' as const,isArchived:false,startAt:1000,occurrenceOverrides:{ '2026-10-19':{ date:'2026-10-19',slot:'forenoon' as const,plannedStartAt:null,plannedEndAt:null,estimateMinutes:30,executionStatus:'IN_PROGRESS' as const,elapsedMinutes:2,startAt:1000 } } };
  const paused = pauseOtherTaskTimers(task,61000); assert.equal(paused.elapsedMinutes,2); assert.equal(paused.status,'PAUSED'); assert.equal(paused.occurrenceOverrides?.['2026-10-19'].elapsedMinutes,3);
  assert.equal(pauseOtherTaskTimers(paused,121000),paused);
});
