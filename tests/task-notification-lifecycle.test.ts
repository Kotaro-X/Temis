import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
test('sign-out invalidates pending schedules and waits for local reminder cancellation', async () => {
  const cancelled:string[] = []; const exports:any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/features/taskPlanning/taskNotificationLifecycle.ts','utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText, { exports, require:(name:string) => name === 'react-native' ? { Platform:{ OS:'ios' } } : { getAllScheduledNotificationsAsync:async () => [{ identifier:'task',content:{ data:{ taskPlanning:true } } },{ identifier:'dm',content:{ data:{ type:'dm' } } }],cancelScheduledNotificationAsync:async (id:string) => { cancelled.push(id); } } });
  let resume!:() => void; const barrier = new Promise<void>(resolve => { resume=resolve; }); const generation = exports.taskNotificationGeneration(); let created=false;
  const pending = exports.queueTaskNotificationJob(async () => { await barrier; if (generation === exports.taskNotificationGeneration()) created=true; });
  const signOut = exports.cancelTaskReminderSchedules(); resume(); await pending; await signOut;
  assert.equal(created,false); assert.deepEqual(cancelled,['task']);
});
