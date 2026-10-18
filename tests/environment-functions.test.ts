import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('test entrypoint declares only OpenAI and every regular callable rejects absent or expired lease before side effects',()=>{
 const script=`
  globalThis.fetch=()=>{throw Error('Unexpected network side effect');};
  const m=await import('./functions/testEntry.js');
  const secrets=[...new Set(Object.values(m).flatMap(f=>f?.__endpoint?.secretEnvironmentVariables?.map(s=>s.key)||[]))];
  if(JSON.stringify(secrets)!==JSON.stringify(['OPENAI_API_KEY']))throw Error('Unexpected test secrets');
  if('issueTestSessionTicket' in m||'getEnvironmentSwitchCapability' in m)throw Error('Production endpoint exported in test');
  let count=0;
  for(const [name,f]of Object.entries(m)){
   if(!f.__endpoint?.callableTrigger||name==='exchangeTestSessionTicket')continue;
   for(const auth of [undefined,{uid:'ordinary',token:{}},{uid:'operator',token:{testOperator:true,testOperatorExpiresAt:1}}]){
    let denied=false;try{await f.run({auth,data:{}});}catch(e){denied=e.code==='permission-denied';}if(!denied)throw Error('Unprotected callable '+name);
   }count++;
   if(f.__endpoint.serviceAccountEmail!=='temis-embeddings@temis-test-c05aa.iam.gserviceaccount.com')throw Error('Wrong runtime identity '+name);
  }
  console.log(count);
 `;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,GCLOUD_PROJECT:'temis-test-c05aa'}});
 assert.equal(result.status,0,result.stderr); assert.ok(Number(result.stdout.trim())>=20);
});

for (const [project, entry] of [['temis-c05aa', 'index.js'], ['temis-test-c05aa', 'testEntry.js']]) {
  test(`${entry} preserves every shared deployable handler, including destructured DM exports`, () => {
    const script = `
      const entry = await import('./functions/${entry}');
      const shared = await import('./functions/commonHandlers.js');
      const expected = Object.entries(shared).filter(([,handler]) => typeof handler === 'function' && handler.__endpoint).map(([name]) => name).sort();
      const actual = Object.keys(entry).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Entrypoint omits shared handlers: ' + expected.filter(name => !actual.includes(name)).join(', '));
      for (const name of ['sendDirectMessage','markDirectMessagesRead','setDirectMessageDevice','notifyDirectMessage','retryDirectMessageNotifications']) {
        if (!entry[name]?.__endpoint) throw Error('Missing DM handler: ' + name);
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, GCLOUD_PROJECT: project } });
    assert.equal(result.status, 0, result.stderr);
  });
}
