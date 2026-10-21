// Isolated workerd regression: all outbound traffic is replaced with mocks.
// Usage: node scripts/test-pumb-runtime.mjs /absolute/path/to/miniflare/dist/src/index.js
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';

if(!process.argv[2] || !isAbsolute(process.argv[2]))throw new Error('Supply an absolute installed Miniflare module path');
const {Miniflare}=await import(pathToFileURL(process.argv[2]).href);
const diagnostics=await readFile(new URL('../functions/_lib/bank-diagnostics.js',import.meta.url),'utf8');
const adapter=await readFile(new URL('../functions/_lib/pumb-api.js',import.meta.url),'utf8');
const dependency="import { safeBankCode, safeBankDiagnostic } from './bank-diagnostics.js';";
assert.ok(adapter.includes(dependency));
const entry=`export default {async fetch() {
  try {
    const api=await pumbSession({client_id:'runtime-test-client',client_secret:'runtime-test-secret',username:'runtime-test-user',password:'runtime-test-password'});
    await api('/account');await api('/multi-account-transactions',{accountIds:[1]});
    return Response.json({ok:true});
  } catch(e) {return Response.json({code:e.bankCode,stage:e.stage,status:e.upstream_status});}
}};`;

for(const scenario of ['old-redirect-error','auth-refusal','redirect-blocked','read-success']) {
  const calls=[];
  const source=scenario==='old-redirect-error'?adapter.replaceAll("redirect:'manual'","redirect:'error'"):adapter;
  const mf=new Miniflare({modules:true,compatibilityDate:'2025-08-01',
    script:diagnostics+'\n'+source.replace(dependency,'')+'\n'+entry,
    outboundService:request=>{
      calls.push({url:request.url,method:request.method});
      if(scenario==='redirect-blocked')return new Response(null,{status:302,headers:{Location:'https://must-not-be-followed.invalid/'}});
      if(scenario==='auth-refusal')return Response.json({error:'invalid_grant'},{status:400});
      return Response.json(request.url.includes('/token')?{access_token:'runtime-test-token'}:[]);
    }});
  try {
    const result=await (await mf.dispatchFetch('http://localhost/')).json();
    if(scenario==='old-redirect-error') {assert.equal(calls.length,0);assert.equal(result.code,'bank_network');}
    if(scenario==='auth-refusal') {assert.equal(calls.length,1);assert.equal(result.code,'bank_login_rejected');assert.equal(result.status,400);}
    if(scenario==='redirect-blocked') {assert.equal(calls.length,1);assert.equal(result.code,'bank_redirect');assert.equal(result.status,302);}
    if(scenario==='read-success') {
      assert.equal(result.ok,true);assert.equal(calls.length,3);
      assert.deepEqual(calls.map(c=>c.method),['POST','GET','POST']);
      assert.equal(calls[1].url,'https://service.fuib.com:4103/war_veganet_api/account');
    }
    console.log(JSON.stringify({scenario,outbound_calls:calls.length,result}));
  } finally {await mf.dispose();}
}
