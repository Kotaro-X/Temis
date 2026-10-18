import { DEFAULT_TIMEBOX_SCHEDULE } from '../src/types/timer.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as core from '../src/features/taskPlanning/planningCore.ts';
import type { TaskState } from '../src/types/task.ts';
const base: TaskState = { id:'task',taskName:'Task',tags:['tag'],estimateMinutes:30,elapsedMinutes:0,status:'TODO',isArchived:false,startAt:null };
function fixture(task: TaskState) {
  let current = { task,date:'2026-10-19',slotKey:'forenoon' }; const logs:any[] = [], shared:any[] = []; let deleted=false;
  const exports:any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/features/taskPlanning/taskOperations.ts','utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText, { exports, require:(name:string) => {
    if (name.endsWith('planningCore')) return core;
    if (name.endsWith('taskRepository')) return { mutatePlannedTask:async (_id:string,update:any) => { current=update(current); },writePlannedTask:async (_task:any,_date:string,_slot:string,remove:boolean) => { deleted=remove; },loadTaskLogs:async () => logs,saveTaskLogs:async (next:any[]) => { logs.splice(0,logs.length,...next); } };
    if (name.endsWith('memoRepository')) return { loadMemoByTaskId:async () => null };
    if (name.endsWith('collaborationService')) return { updateProjectTask:async (_id:string,patch:any) => { shared.push(typeof patch === 'function' ? patch(current.task) : patch); },deleteProjectTask:async () => { deleted=true; } };
    return {};
  } });
  return { action:exports.performPlanningAction as (item:any,action:string) => Promise<void>,move:exports.movePlanningOccurrence as (item:any,date:string,slot:string,schedule:any) => Promise<void>,get current() { return current; },logs,shared,get deleted() { return deleted; } };
}
const occurrence = { ...core.normalizePlanning(base), id:'task',title:'Task',date:'2026-10-19',slot:'forenoon',estimateMinutes:30,completed:false,key:'task@2026-10-19',occurrenceDate:'2026-10-19' };
test('task completion accounts for the running timer once and records its actual duration',async () => {
  const f=fixture({ ...base,status:'IN_PROGRESS',startAt:Date.now()-60000 }); await f.action(occurrence,'done'); await f.action(occurrence,'done');
  assert.equal(f.current.task.status,'DONE'); assert.equal(f.current.task.startAt,null); assert.equal(f.logs.length,1); assert.ok(f.logs[0].actualMinutes >= 1);
});
test('recurring completion changes one occurrence without completing its series',async () => {
  const f=fixture({ ...base,repeat:'daily',repeatAnchorDate:'2026-10-19' }); const repeated={ ...occurrence,repeat:'daily' };
  await f.action(repeated,'done'); await f.action(repeated,'done');
  assert.equal(f.current.task.status,'TODO'); assert.equal(f.current.task.occurrenceOverrides?.['2026-10-19'].completed,true); assert.equal(f.logs.length,1);
});
test('recurring timer pauses without changing a different occurrence or losing its memo',async () => {
  const existing={ date:'2026-10-19',slot:'forenoon' as const,plannedStartAt:null,plannedEndAt:null,estimateMinutes:30,executionStatus:'IN_PROGRESS' as const,startAt:Date.now()-60000,elapsedMinutes:2,memo:'Keep' };
  const f=fixture({ ...base,repeat:'daily',occurrenceOverrides:{ '2026-10-19':existing,'2026-10-20':{ ...existing,executionStatus:'TODO',startAt:null } } });
  await f.action({ ...occurrence,repeat:'daily' },'pause');
  const saved=f.current.task.occurrenceOverrides!; assert.equal(saved['2026-10-19'].executionStatus,'PAUSED'); assert.ok(saved['2026-10-19'].elapsedMinutes! >= 3); assert.equal(saved['2026-10-19'].memo,'Keep'); assert.equal(saved['2026-10-20'].executionStatus,'TODO');
});
test('viewers cannot dispatch shared edits, while occurrence updates contain only that occurrence',async () => {
  const f=fixture(base); await assert.rejects(f.action({ ...occurrence,editable:false,projectId:'project' },'done'));
  await f.action({ ...occurrence,id:'project:task',projectId:'project',repeat:'daily' },'done');
  assert.deepEqual(Object.keys(f.shared[0].occurrenceOverrides),['2026-10-19']);
});

test('moving an undated task assigns a date and box without inventing a time',async () => {
  const f=fixture(base); await f.move({ ...occurrence,date:'undated' },'2026-10-21','night',DEFAULT_TIMEBOX_SCHEDULE); assert.equal(f.current.date,'2026-10-21'); assert.equal(f.current.slotKey,'night'); assert.equal(f.current.task.plannedStartAt,null);
});

test('moving a scheduled recurring occurrence preserves clock time and the other occurrences',async () => {
  const f=fixture({ ...base,repeat:'daily',repeatAnchorDate:'2026-10-19' }); const start=new Date('2026-10-19T14:00:00').getTime();
  await f.move({ ...occurrence,repeat:'daily',plannedStartAt:start,plannedEndAt:start+1800000 },'2026-10-21','morning',DEFAULT_TIMEBOX_SCHEDULE);
  assert.equal(f.current.date,'2026-10-19'); const exception=f.current.task.occurrenceOverrides!['2026-10-19']; assert.equal(exception.date,'2026-10-21'); assert.equal(exception.slot,'afternoon'); assert.equal(new Date(exception.plannedStartAt!).getHours(),14);
  await assert.rejects(f.move(occurrence,'bad','morning',DEFAULT_TIMEBOX_SCHEDULE));
});
