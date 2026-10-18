import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = (path: string, modules: Record<string, any>) => {
 const exports:any={};
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Error,require:(name:string)=>{if(!(name in modules))throw Error(name);return modules[name];}});
 return exports;
};
const fixture = () => {
 const runtime=compile('src/services/environment/runtimeEnvironment.ts',{});
 const values=new Map<string,string>(); const events:string[]=[];
 const expiresAt=Math.floor(Date.now()/1000)+900;
 let allowed=true; let failedCommit=false; let checkpointFailure=false;
 let release:(()=>void)|undefined; let issuedWait:Promise<void>|undefined;
 const auth:any={production:{currentUser:{uid:'production',isAnonymous:false},authStateReady:async()=>{}},test:{currentUser:null,authStateReady:async()=>{}}};
 const workspace:any={production:'production',test:null};
 const app=(selected?:string)=>{if(!selected)runtime.assertEnvironmentReady();return {environment:selected??runtime.getAppEnvironment()};};
 const service=compile('src/services/environment/environmentSession.ts',{
  './runtimeEnvironment':runtime,
  './environmentDiagnostics':{setEnvironmentDiagnostics:async(env:string)=>{events.push('diagnostics:'+env);}},
  './switchLifecycle':{saveEnvironmentDrafts:async()=>{events.push('save');if(checkpointFailure)throw Error('disk');},checkpointEnvironmentDrafts:async()=>{}},
  '../auth/accountEntry':{resetAccountEntry:()=>{}},
  '../notifications/notificationService':{unregisterEnvironmentReminders:async()=>{},unregisterDMNotificationsBeforeSignOut:async()=>{runtime.assertEnvironmentReady();events.push('unregister');}},
  '@react-native-async-storage/async-storage':{getItem:async(key:string)=>values.get(key)??null,setItem:async(key:string,value:string)=>{if(failedCommit&&value==='test')throw Error('disk');values.set(key,value);}},
  'firebase/auth':{signInWithCustomToken:async(a:any)=>{events.push('test-signin');a.currentUser={uid:'operator_fixed',getIdTokenResult:async()=>({claims:{testOperator:true,testOperatorExpiresAt:expiresAt}})};return {user:a.currentUser};},signOut:async(a:any)=>{a.currentUser=null;events.push('signout');}},
  'firebase/functions':{getFunctions:(value:any)=>value,httpsCallable:(_app:any,name:string)=>async()=>{
   events.push(name);
   if(name==='getEnvironmentSwitchCapability')return {data:{allowed}};
   if(name==='issueTestSessionTicket'){if(issuedWait)await issuedWait;if(!allowed)throw Error('revoked');return {data:{ticket:'signed'}};}
   return {data:{token:'custom',uid:'operator_fixed',expiresAt:expiresAt*1000}};
  }},
  'firebase/firestore':{disableNetwork:async(value:any)=>{events.push('disable:'+value.environment);},enableNetwork:async(value:any)=>{events.push('enable:'+value.environment);}},
  '../sync/firebaseApp':{getFirebaseApp:app,getFirebaseAuth:(selected?:string)=>auth[app(selected).environment],getFirebaseFirestore:app},
  '../account/accountWorkspace':{accountWorkspace:{initialize:async()=>{},bind:async(uid:string)=>{workspace[runtime.getAppEnvironment()]=uid;}}},
  '../account/workspaceEpoch':{advanceWorkspaceEpoch:()=>{}},
  '../sync/localMutationLock':{withAllLocalEntityMutations:(operation:()=>Promise<unknown>)=>operation()},
 });
 return {service,runtime,values,auth,events,workspace,deny:()=>{allowed=false;},failCommit:()=>{failedCommit=true;},failCheckpoint:()=>{checkpointFailure=true;},holdIssue:()=>{issuedWait=new Promise<void>(resolve=>{release=resolve;});return ()=>{release?.();issuedWait=undefined;};}};
};
const until = async (predicate:()=>boolean) => {for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}throw Error('Operation did not reach expected state');};
test('operator round trip preserves production auth and commits the matching workspace',async()=>{
 const f=fixture(); await f.service.switchAppEnvironment('test');
 assert.equal(f.runtime.getAppEnvironment(),'test');assert.equal(f.workspace.test,'operator_fixed');assert.equal(f.auth.production.currentUser.uid,'production');
 await f.service.switchAppEnvironment('production');assert.equal(f.runtime.getAppEnvironment(),'production');assert.equal(f.workspace.production,'production');assert.equal(f.values.get('@temis/committed-environment:v1'),'production');
});
test('failed durable commit returns to the last confirmed environment',async()=>{
 const f=fixture();f.failCommit();await assert.rejects(f.service.switchAppEnvironment('test'),/disk/);
 assert.equal(f.runtime.getAppEnvironment(),'production');assert.notEqual(f.values.get('@temis/committed-environment:v1'),'test');assert.doesNotThrow(f.runtime.assertEnvironmentReady);
});
test('failed local checkpoint does not start a test login or discard the source',async()=>{
 const f=fixture();f.failCheckpoint();await assert.rejects(f.service.switchAppEnvironment('test'),/disk/);assert.equal(f.events.includes('test-signin'),false);assert.equal(f.runtime.getAppEnvironment(),'production');
});
test('reboot with revoked test authorization blocks test and still allows production return',async()=>{
 const f=fixture();f.values.set('@temis/committed-environment:v1','test');f.deny();await assert.rejects(f.service.initializeEnvironment());assert.throws(f.runtime.assertEnvironmentReady);
 await f.service.switchAppEnvironment('production');assert.doesNotThrow(f.runtime.assertEnvironmentReady);assert.equal(f.runtime.getAppEnvironment(),'production');
});
test('logout cancels an in-flight ticket; late completion cannot restore test auth',async()=>{
 const f=fixture();const release=f.holdIssue();const switching=f.service.switchAppEnvironment('test');const rejected=assert.rejects(switching,/取り消され/);
 await until(()=>f.events.includes('issueTestSessionTicket'));await f.service.signOutAllEnvironments();release();await rejected;
 assert.equal(f.auth.production.currentUser,null);assert.equal(f.auth.test.currentUser,null);assert.equal(f.runtime.getAppEnvironment(),'production');assert.equal(f.events.includes('test-signin'),false);
});
test('late renewal cannot switch back after the operator returns to production',async()=>{
 const f=fixture();await f.service.switchAppEnvironment('test');const release=f.holdIssue();const count=f.events.filter(e=>e==='issueTestSessionTicket').length;const renewal=f.service.renewTestSession();
 await until(()=>f.events.filter(e=>e==='issueTestSessionTicket').length>count);await f.service.switchAppEnvironment('production');release();await renewal;assert.equal(f.runtime.getAppEnvironment(),'production');
});
