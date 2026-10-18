import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function fixture() {
  const records=new Set<string>(), writes:any[]=[]; let epoch=0; const exports:any={};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/features/taskPlanning/migrationReceipts.ts','utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText, { exports,require:(name:string) => {
    if (name === 'firebase/firestore') return { doc:(_db:any,...parts:string[]) => parts.join('/'),getDoc:async () => ({ data:() => ({ ids:{} }) }),getDocFromServer:async (path:string) => ({ exists:() => records.has(path) }),setDoc:async (path:string,value:any) => { writes.push({ path,value }); } };
    if (name.endsWith('firebaseApp')) return { getFirebaseFirestore:() => ({}),getFirebaseAuth:() => ({ currentUser:{ uid:'alice' },authStateReady:async () => {} }) };
    if (name.endsWith('workspaceEpoch')) return { getWorkspaceEpoch:() => epoch };
    return {};
  } });
  return { api:exports,records,writes,switchAccount:() => { epoch++; } };
}
test('migration receipts wait until both the target task and its memo exist remotely',async () => {
  const f=fixture(); await f.api.saveTodoMigrationReceipts({ old:true },{ old:['todo-task:old'] },{ old:['todo-task:old'] }); assert.equal(f.writes.length,0);
  f.records.add('users/alice/tasks/task:todo-task:old'); await f.api.saveTodoMigrationReceipts({ old:true },{ old:['todo-task:old'] },{ old:['todo-task:old'] }); assert.equal(f.writes.length,0);
  f.records.add('users/alice/memos/task-memo:todo-task:old'); await f.api.saveTodoMigrationReceipts({ old:true },{ old:['todo-task:old'] },{ old:['todo-task:old'] }); assert.equal(f.writes.length,1); assert.equal(f.writes[0].value.ids.old,true);
});
test('account change after a pending auth readiness check cannot write migration receipts',async () => {
  const f=fixture(); f.records.add('users/alice/tasks/task:todo-task:old'); const pending=f.api.saveTodoMigrationReceipts({ old:true }); f.switchAccount(); await pending; assert.equal(f.writes.length,0);
});
