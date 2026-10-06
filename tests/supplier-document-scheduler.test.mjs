import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/tracking-cron/index.js';

async function run(t, { token='reminder-token', time='2026-10-06T09:00:00Z', fail='' }={}) {
  const calls=[], pending=[];
  t.mock.method(console,'log',()=>{});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const kind=String(url).endsWith('supplier-documents')?'reminders':'tracking';
    calls.push({kind,options});
    if(kind===fail) throw new Error('synthetic network failure');
    return Response.json({ok:true,sent:0,failed:0});
  });
  await worker.scheduled({scheduledTime:Date.parse(time)},{CRON_SYNC_TOKEN:'tracking-token',SUPPLIER_DOCS_CRON_TOKEN:token},{waitUntil:p=>pending.push(p)});
  const results=await Promise.allSettled(pending);
  return {calls,results};
}

test('existing tracking schedule dispatches independent reminders with separate credentials',async t=>{
  const {calls,results}=await run(t);
  assert.deepEqual(calls.map(c=>c.kind),['reminders','tracking']);
  assert.equal(calls[0].options.headers.authorization,'Bearer reminder-token');
  assert.equal(calls[0].options.redirect,'manual');
  assert.equal(calls[1].options.headers.authorization,'Bearer tracking-token');
  assert.ok(results.every(r=>r.status==='fulfilled'));
});
test('tracking still runs outside Kyiv business hours and before reminder setup',async t=>{
  for(const options of [{time:'2026-10-06T20:00:00Z'},{token:''}]) {
    const {calls}=await run(t,options);
    assert.deepEqual(calls.map(c=>c.kind),['tracking']);
    t.mock.restoreAll();
  }
});
test('failures in either scheduled task do not suppress the other',async t=>{
  for(const fail of ['reminders','tracking']) {
    const {calls,results}=await run(t,{fail});
    assert.equal(calls.length,2);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    t.mock.restoreAll();
  }
});
