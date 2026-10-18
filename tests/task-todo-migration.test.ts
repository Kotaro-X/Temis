import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as core from '../src/features/taskPlanning/planningCore.ts';
import type { SimpleTodoItem } from '../src/types/todo.ts';
const todo = (patch: Partial<SimpleTodoItem> = {}): SimpleTodoItem => ({ id:'old', text:'Title', memo:'Body', tags:['tag'], isDone:false, createdAt:1, doneAt:null, reminderDate:null, reminderTime:null, repeat:'none', notificationId:null, notificationIds:[], seriesId:null, seriesAnchorDate:null, occurrenceDate:null, isDeleted:false, ...patch });
function fixture(todos: SimpleTodoItem[]) {
  const tasks = new Map<string, any>(), memos = new Map<string, string>(), data = new Map<string,string>(), cancelled: string[] = [];
  let epoch = 0, failMemo = false, failCancel = false; const deleted = new Set<string>(); const receipts: Record<string, boolean> = {};
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/features/taskPlanning/todoMigration.ts','utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (name: string) => {
      if (name === 'expo-notifications') return { cancelScheduledNotificationAsync: async (id: string) => { if (failCancel) throw new Error('cancel failed'); cancelled.push(id); } };
      if (name.endsWith('planningCore')) return core;
      if (name.endsWith('migrationReceipts')) return { loadTodoMigrationReceipts: async () => receipts, saveTodoMigrationReceipts: async (ids: Record<string, boolean>) => { Object.assign(receipts,ids); } };
      if (name.endsWith('workspaceEpoch')) return { getWorkspaceEpoch: () => epoch };
      if (name.endsWith('accountWorkspace')) return { default:{ getItem:async (key: string) => data.get(key) ?? null, setItem:async (key:string,value:string) => data.set(key,value) }, __esModule:true };
      if (name.endsWith('todoRepository')) return { loadTodos:async () => todos };
      if (name.endsWith('taskRepository')) return {
        loadAllTaskStates:async () => [{ slots:{ morning:{ tasks:[...tasks.values()].map(entry => entry.task) } } }],
        writePlannedTask:async (task:any,date:string,slotKey:string) => tasks.set(task.id,{ task,date,slotKey }),
        mutatePlannedTask:async (id:string,update:any) => { if (!tasks.has(id)) throw new Error('missing'); tasks.set(id,update(tasks.get(id))); },
      };
      if (name.endsWith('memoRepository')) return { loadMemoByTaskId:async (id:string) => memos.has(id) ? { body:memos.get(id) } : null, updateMemo:async (id:string,body:string) => { if (failMemo) throw new Error('disk full'); memos.set(id,body); } };
      if (name.endsWith('storage')) return { loadSyncEntityRecords:async () => [...deleted].map(entityId => ({ entityId,deletedAt:1 })) };
      return {};
    },
  });
  return { migrate:exports.migrateLegacyTodos as () => Promise<void>, tasks,memos,data,cancelled,deleted,receipts, setFailMemo:(value:boolean) => { failMemo=value; }, setFailCancel:(value:boolean) => { failCancel=value; }, switchAccount:() => { epoch++; tasks.clear(); memos.clear(); data.clear(); Object.keys(receipts).forEach(key => delete receipts[key]); } };
}
test('migration is idempotent and preserves memo, tags and completion without dating an undated task', async () => {
  const f=fixture([todo({ isDone:true,doneAt:2 })]); await f.migrate(); await f.migrate();
  assert.equal(f.tasks.size,1); assert.equal(f.tasks.get('todo-task:old').date,'undated'); assert.equal(f.tasks.get('todo-task:old').task.status,'DONE'); assert.equal(f.memos.get('todo-task:old'),'Body');
});
test('partial memo failure retries without duplicating task or cancelling old notification early', async () => {
  const f=fixture([todo({ notificationId:'old-notification' })]); f.setFailMemo(true);
  await assert.rejects(f.migrate()); assert.equal(f.tasks.size,1); assert.equal(f.cancelled.length,0);
  f.setFailMemo(false); await f.migrate(); assert.equal(f.tasks.size,1); assert.equal(f.cancelled[0],'old-notification'); assert.equal(f.memos.size,1);
});
test('failed notification cancellation is retried after durable conversion', async () => {
  const f=fixture([todo({ notificationIds:['n'] })]); f.setFailCancel(true); await assert.rejects(f.migrate());
  f.setFailCancel(false); await f.migrate(); assert.equal(f.tasks.size,1); assert.deepEqual(f.cancelled,['n']);
});
test('late legacy sync imports only the new ToDo and preserves edits to migrated tasks', async () => {
  const values=[todo()]; const f=fixture(values); await f.migrate(); f.tasks.get('todo-task:old').task.taskName='Edited';
  values.push(todo({ id:'later',memo:'Later' })); await f.migrate(); assert.equal(f.tasks.size,2); assert.equal(f.tasks.get('todo-task:old').task.taskName,'Edited');
});
test('a deleted migrated task does not resurrect on a new device', async () => {
  const f=fixture([todo()]); f.deleted.add('task:todo-task:old'); await f.migrate(); assert.equal(f.tasks.size,0);
});
test('recurring completion and deleted overrides preserve occurrence identity', async () => {
  const f=fixture([todo({ repeat:'daily', reminderDate:'2026-10-19',seriesId:'old',seriesAnchorDate:'2026-10-19' }),todo({ id:'override',memo:'Body',repeat:'daily',seriesId:'old',occurrenceDate:'2026-10-20',isDone:true }),todo({ id:'deleted',repeat:'daily',seriesId:'old',occurrenceDate:'2026-10-21',isDeleted:true })]);
  await f.migrate(); await f.migrate(); const overrides=f.tasks.get('todo-task:old').task.occurrenceOverrides;
  assert.equal(overrides['2026-10-20'].completed,true); assert.equal(overrides['2026-10-21'].deleted,true); assert.equal(f.tasks.size,1);
});
test('account-local progress does not suppress migration in a different account workspace', async () => {
  const values=[todo()]; const f=fixture(values); await f.migrate(); f.switchAccount(); values.splice(0,1,todo({ id:'other-account' })); await f.migrate();
  assert.equal(f.tasks.has('todo-task:old'),false); assert.equal(f.tasks.has('todo-task:other-account'),true);
});

test('cloud migration receipts prevent resurrection on a fresh device even after task tombstones expire', async () => {
  const f=fixture([todo()]); f.receipts.old=true; await f.migrate(); assert.equal(f.tasks.size,0); assert.equal(f.memos.size,0);
});
