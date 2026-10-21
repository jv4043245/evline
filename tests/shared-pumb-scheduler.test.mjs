import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../workers/tracking-cron/index.js';

const env={CRON_SYNC_TOKEN:'tracking-test',SUPPLIER_DOCS_CRON_TOKEN:'reminder-test',PUMB_CRON_TOKEN:'bank-test'};
async function tick(time, bindings=env) {
  const pending=[];
  await worker.scheduled({scheduledTime:Date.parse(time)},bindings,{waitUntil:p=>pending.push(p)});
  return Promise.allSettled(pending);
}
function mock(t, fail='') {
  const calls=[];
  t.mock.method(console,'log',()=>{});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const kind=String(url).split('/').pop(); calls.push({kind,options});
    if(kind===fail) throw new Error('synthetic failure');
    return Response.json({ok:true,failed:0});
  });
  return calls;
}
test('96 daily ticks poll PUMB while preserving 12 legacy runs and Kyiv reminder window',async t=>{
  const calls=mock(t);
  for(let minutes=0;minutes<1440;minutes+=15) {
    const time=new Date(Date.UTC(2026,9,21,0,minutes));
    const before=calls.length;
    const results=await tick(time.toISOString());
    assert.ok(results.every(r=>r.status==='fulfilled'));
    const kinds=calls.slice(before).map(c=>c.kind);
    assert.equal(kinds.includes('tracking-sync'),minutes%120===0);
    assert.equal(kinds.includes('bank-incoming'),true);
  }
  assert.equal(calls.filter(c=>c.kind==='bank-incoming').length,96);
  assert.equal(calls.filter(c=>c.kind==='tracking-sync').length,12);
  assert.equal(calls.filter(c=>c.kind==='supplier-documents').length,5);
  for(const c of calls) {
    assert.equal(c.options.headers.authorization,`Bearer ${c.kind==='bank-incoming'?'bank-test':c.kind==='tracking-sync'?'tracking-test':'reminder-test'}`);
    if(c.kind==='bank-incoming') {assert.equal(c.options.redirect,'manual');assert.ok(c.options.signal);}
  }
});
test('failure of any task cannot suppress the other two',async t=>{
  for(const fail of ['bank-incoming','tracking-sync','supplier-documents']) {
    const calls=mock(t,fail);
    const results=await tick('2026-10-21T10:00:00Z');
    assert.deepEqual(calls.map(c=>c.kind).sort(),['bank-incoming','supplier-documents','tracking-sync']);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    t.mock.restoreAll();
  }
});
test('missing PUMB secret leaves original tasks usable and quarter-hour ticks idle',async t=>{
  const calls=mock(t);
  const bindings={...env,PUMB_CRON_TOKEN:''};
  await tick('2026-10-21T10:15:00Z',bindings);assert.equal(calls.length,0);
  await tick('2026-10-21T10:00:00Z',bindings);
  assert.deepEqual(calls.map(c=>c.kind),['supplier-documents','tracking-sync']);
});
test('manual tracking endpoint is still protected and never starts a bank sync',async t=>{
  const calls=mock(t);
  const denied=await worker.fetch(new Request('https://worker.test/run',{method:'POST'}),env);
  assert.equal(denied.status,401);assert.equal(calls.length,0);
  const allowed=await worker.fetch(new Request('https://worker.test/run',{method:'POST',headers:{authorization:'Bearer tracking-test'}}),env);
  assert.equal(allowed.status,200);assert.deepEqual(calls.map(c=>c.kind),['tracking-sync']);
  const health=await (await worker.fetch(new Request('https://worker.test/health'),env)).json();
  assert.equal(health.schedule_revision,'shared-pumb-15m-legacy-2h-v2');
  assert.equal(health.has_pumb_token,true);assert.doesNotMatch(JSON.stringify(health),/bank-test|tracking-test|reminder-test/);
});
test('only the existing shared worker owns a production cron trigger',async()=>{
  const base=new URL('../workers/',import.meta.url);
  assert.match(await readFile(new URL('tracking-cron/wrangler.toml',base),'utf8'),/crons = \["\*\/15 \* \* \* \*"\]/);
  assert.match(await readFile(new URL('pumb-incoming/wrangler.toml',base),'utf8'),/crons = \[\]/);
});
