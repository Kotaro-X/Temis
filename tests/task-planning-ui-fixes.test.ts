import test from 'node:test';
import assert from 'node:assert/strict';
import { edgePaging, emptyEdgeHold } from '../src/features/taskPlanning/edgePaging.ts';
import { taskMemoBody, occurrenceMemoTaskId } from '../src/features/taskPlanning/memoCore.ts';
import { suppressTaskNotification } from '../src/services/notifications/taskNotificationPolicy.ts';
import { weekDates } from '../src/features/taskPlanning/planningCore.ts';
import { emitMemoChanges, subscribeMemoChanges } from '../src/features/taskPlanning/memoEvents.ts';

test('seven-day range starts today/selected date including month and year boundaries', () => {
  assert.deepEqual(weekDates('2026-12-29'), ['2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-04']);
  assert.equal(weekDates('2028-02-27')[2], '2028-02-29');
});
test('edge hold waits 600ms, pages once, and rearms only after leaving the edge', () => {
  const first = edgePaging(emptyEdgeHold(), 1, true, 1000);
  assert.equal(first.page, 0);
  assert.equal(edgePaging(first.state, 1, true, 1599).page, 0);
  const next = edgePaging(first.state, 1, true, 1600);
  assert.equal(next.page, 1);
  assert.equal(edgePaging(next.state, 1, true, 5000).page, 0);
  const reset = edgePaging(next.state, 0, true, 5100);
  const previous = edgePaging(reset.state, -1, true, 5200);
  assert.equal(edgePaging(previous.state, -1, true, 5800).page, -1);
});
test('week scroll must reach boundary before hold duration starts', () => {
  let state = emptyEdgeHold();
  for (const now of [1000, 2000, 3000]) { const next = edgePaging(state, 1, false, now); assert.equal(next.page, 0); state = next.state; }
  assert.equal(edgePaging(state, 1, true, 3599).page, 0);
  assert.equal(edgePaging(state, 1, true, 3600).page, 1);
});
test('test task reminders are allowed only for the current environment and account', () => {
  const data = { taskPlanning: true, environment: 'test', scope: 'test:userA' };
  assert.equal(suppressTaskNotification(data, 'test', 'test:userA'), false);
  assert.equal(suppressTaskNotification(data, 'production', 'test:userA'), true);
  assert.equal(suppressTaskNotification(data, 'test', 'test:userB'), true);
  assert.equal(suppressTaskNotification({ scope: 'test:userA' }, 'test', 'test:userA'), true);
  assert.equal(suppressTaskNotification({ environment: 'production', scope: 'userA' }, 'production', 'userA'), false);
});
test('occurrence record wins over legacy override and preserves explicitly cleared memo', () => {
  assert.equal(occurrenceMemoTaskId('todo-task:old', '2026-10-18'), 'todo-task:old@2026-10-18');
  assert.equal(taskMemoBody({ body: 'edited in memo tab' }, 'old override', { body: 'series' }), 'edited in memo tab');
  assert.equal(taskMemoBody({ body: '' }, 'old override', { body: 'series' }), '');
  assert.equal(taskMemoBody(null, '', { body: 'series' }), '');
  assert.equal(taskMemoBody(null, undefined, { body: 'series edit' }), 'series edit');
});
test('memo updates identify the same master or occurrence across both entry points', () => {
  const seen: string[] = [];
  const stop = subscribeMemoChanges(change => seen.push(change.taskId));
  emitMemoChanges('task'); emitMemoChanges(occurrenceMemoTaskId('task', '2026-10-18')); stop(); emitMemoChanges('ignored');
  assert.deepEqual(seen, ['task','task@2026-10-18']);
});

test('schedule draft preserves legacy minute values, overnight duration and custom reminders', async () => {
  const { scheduleDraft, parseSchedule } = await import('../src/features/taskPlanning/scheduleDraft.ts');
  const { DEFAULT_TIMEBOX_SCHEDULE } = await import('../src/types/timer.ts');
  const start = new Date('2026-10-18T23:58:00').getTime();
  const end = new Date('2026-10-19T00:13:00').getTime();
  const notify = new Date('2026-10-18T23:53:00').getTime();
  const draft = scheduleDraft({ plannedStartAt: start, plannedEndAt: end, reminder: { enabled: true, mode: 'custom', at: notify, offsetMinutes: 0 } }, '2026-10-18', 'night');
  const parsed = parseSchedule(draft, DEFAULT_TIMEBOX_SCHEDULE);
  assert.equal(parsed.planning.plannedStartAt, start); assert.equal(parsed.planning.plannedEndAt, end);
  assert.equal(parsed.estimateMinutes, 15); assert.equal(parsed.planning.reminder.at, notify);
  assert.throws(() => parseSchedule({ ...draft, end: '23:59', endDate: draft.date }, DEFAULT_TIMEBOX_SCHEDULE));
  assert.throws(() => parseSchedule({ ...draft, end: '' }, DEFAULT_TIMEBOX_SCHEDULE));
});
test('undated schedule can save with custom reminder, and cannot save with relative reminder', async () => {
  const { scheduleDraft, parseSchedule } = await import('../src/features/taskPlanning/scheduleDraft.ts');
  const { DEFAULT_TIMEBOX_SCHEDULE } = await import('../src/types/timer.ts');
  const draft = scheduleDraft({}, 'undated', 'morning');
  assert.equal(draft.date, '');
  assert.equal(parseSchedule(draft, DEFAULT_TIMEBOX_SCHEDULE).date, 'undated');
  assert.throws(() => parseSchedule({ ...draft, reminder: { enabled: true, mode: 'start', at: null, offsetMinutes: 5 } }, DEFAULT_TIMEBOX_SCHEDULE));
  const custom = { ...draft, reminder: { enabled: true, mode: 'custom' as const, at: null, offsetMinutes: 0 }, reminderDate: '2026-10-19', reminderTime: '09:05' };
  assert.equal(parseSchedule(custom, DEFAULT_TIMEBOX_SCHEDULE).planning.reminder.at, new Date('2026-10-19T09:05:00').getTime());
});
