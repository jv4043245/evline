import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { googleAdsEventTypesForStatus, queueGoogleAdsConversionsForOrder, googleAdsFinanceReady } from '../functions/_lib/google-ads.js';
import { onRequest as offline } from '../functions/api/google-ads/offline-conversions.js';
import { onRequestPatch } from '../functions/api/admin/orders/[id].js';
import { onRequestPost as createOrder } from '../functions/api/admin/orders.js';
import { refreshOrderPaymentStatus } from '../functions/_lib/bank-payment-links.js';

const migrationDir=new URL('../migrations/',import.meta.url);
const schemas=await Promise.all((await readdir(migrationDir)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFile(new URL(f,migrationDir),'utf8')));
function setup(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());for(const sql of schemas)db.exec(sql);
  const env={GOOGLE_ADS_UPLOAD_TOKEN:'synthetic-test-token',DB:{prepare(sql){const stmt=db.prepare(sql);let args=[];return{bind(...a){args=a;return this;},async first(){return stmt.get(...args)||null;},async all(){return{results:stmt.all(...args)};},async run(){return{meta:{changes:Number(stmt.run(...args).changes)}};}};},async batch(statements){db.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}}};
  db.prepare("INSERT INTO orders(id,created_at,updated_at,type,status,payment_status,revenue_uah,purchase_cost_uah,gclid) VALUES('test-order','2026-11-01T10:00:00Z','2026-11-01T10:00:00Z','parts','new','unknown',1000,600,'synthetic-click')").run();
  const order=()=>db.prepare("SELECT * FROM orders WHERE id='test-order'").get();
  const event=()=>db.prepare("SELECT * FROM google_ads_conversion_events WHERE event_type='paid'").get();
  const feed=async()=>await(await offline({env,request:new Request('https://evline.test/api/google-ads/offline-conversions?range=all',{headers:{authorization:'Basic '+btoa('test:synthetic-test-token')}})})).text();
  return{db,env,order,event,feed};
}
test('supplier workflow is not customer payment; new-stage customer settlement is eligible',()=>{
  assert.deepEqual(googleAdsEventTypesForStatus('paid',{payment_status:'unknown'}),['lead']);
  assert.deepEqual(googleAdsEventTypesForStatus('completed',{payment_status:'unpaid'}),['lead']);
  assert.deepEqual(googleAdsEventTypesForStatus('new',{payment_status:'paid'}),['lead','paid']);
  assert.deepEqual(googleAdsEventTypesForStatus('canceled',{payment_status:'paid'}),['lead']);
});
test('paid queue fails closed for supplier-only status and legacy unknown payment date',async t=>{
  const f=setup(t);await queueGoogleAdsConversionsForOrder(f.env,{...f.order(),status:'paid',paid_at:'2026-11-01T12:00:00Z'},['paid']);assert.equal(f.event(),undefined);
  const result=await queueGoogleAdsConversionsForOrder(f.env,{...f.order(),payment_status:'paid'},['paid']);assert.equal(result[0].status,'skipped');assert.equal(f.event(),undefined);
});
test('minimum finance readiness does not mistake revenue-only or supplier-cost-only for ready profit',()=>{
  assert.equal(googleAdsFinanceReady({revenue_uah:1000}),false);
  assert.equal(googleAdsFinanceReady({purchase_cost_uah:600}),false);
  assert.equal(googleAdsFinanceReady({revenue_uah:1000,purchase_cost_uah:600}),true);
  assert.equal(googleAdsFinanceReady({revenue_uah:1000},'revenue'),true);
});
test('lead export remains independent of customer payment and economics',async t=>{
  const f=setup(t);f.db.exec('UPDATE orders SET revenue_uah=0,purchase_cost_uah=0');
  await queueGoogleAdsConversionsForOrder(f.env,f.order(),['lead']);
  assert.match(await f.feed(),/EVLine Lead/);assert.doesNotMatch(await f.feed(),/EVLine Paid Order/);
});
test('confirmed timestamp stays stable through finance completion and backfill; uploaded history is immutable',async t=>{
  const f=setup(t);f.db.exec("UPDATE orders SET payment_status='paid',purchase_cost_uah=0");
  await queueGoogleAdsConversionsForOrder(f.env,{...f.order(),customer_paid_at:'2026-11-02T10:00:00Z'},['paid']);
  const held=f.event();assert.equal(held.status,'skipped');assert.equal(held.crm_status,'customer_paid');assert.doesNotMatch(await f.feed(),/EVLine Paid Order/);
  f.db.exec('UPDATE orders SET purchase_cost_uah=600');await queueGoogleAdsConversionsForOrder(f.env,f.order(),['paid']);
  assert.equal(f.event().conversion_time,held.conversion_time);assert.equal(f.event().conversion_value,400);assert.equal(f.event().status,'queued');assert.match(await f.feed(),/EVLine Paid Order/);
  f.db.exec("UPDATE google_ads_conversion_events SET status='uploaded'");const uploaded={...f.event()};
  await queueGoogleAdsConversionsForOrder(f.env,{...f.order(),revenue_uah:2000,customer_paid_at:'2026-11-04T12:00:00Z'},['paid']);assert.deepEqual({...f.event()},uploaded);
});
test('scheduled feed rejects legacy supplier-paid, refunds and canceled orders',async t=>{
  const f=setup(t);f.db.exec("UPDATE orders SET payment_status='paid'");await queueGoogleAdsConversionsForOrder(f.env,{...f.order(),customer_paid_at:'2026-11-02T10:00:00Z'},['paid']);
  f.db.exec("UPDATE google_ads_conversion_events SET crm_status='paid'");assert.doesNotMatch(await f.feed(),/EVLine Paid Order/);
  f.db.exec("UPDATE google_ads_conversion_events SET crm_status='customer_paid';UPDATE orders SET payment_status='refunded'");assert.doesNotMatch(await f.feed(),/EVLine Paid Order/);
  f.db.exec("UPDATE orders SET payment_status='paid',status='canceled'");assert.doesNotMatch(await f.feed(),/EVLine Paid Order/);
});
test('concurrent confirmation attempts cannot replace the first customer-paid timestamp',async t=>{
  const f=setup(t);f.db.exec("UPDATE orders SET payment_status='paid'");
  await Promise.all([
    queueGoogleAdsConversionsForOrder(f.env,{...f.order(),customer_paid_at:'2026-11-02T10:00:00Z'},['paid']),
    queueGoogleAdsConversionsForOrder(f.env,{...f.order(),customer_paid_at:'2026-11-03T10:00:00Z'},['paid']),
  ]);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM google_ads_conversion_events WHERE event_type='paid'").get().n,1);
  assert.equal(f.event().conversion_time,'2026-11-02 10:00:00+00:00');
});
test('manual customer payment confirmation queues without moving workflow',async t=>{
  const f=setup(t);const response=await onRequestPatch({env:f.env,params:{id:'test-order'},request:new Request('https://evline.test/api/admin/orders/test-order',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({payment_status:'paid',notify_customer:false})})});assert.equal(response.status,200);assert.equal(f.order().status,'new');assert.equal(f.event().status,'queued');assert.equal(f.event().crm_status,'customer_paid');
  const at=f.event().conversion_time;await queueGoogleAdsConversionsForOrder(f.env,f.order(),['paid']);assert.equal(f.event().conversion_time,at);
});
test('a manually created customer-paid order records its first confirmation independently of stage',async t=>{
  const f=setup(t);const response=await createOrder({env:f.env,request:new Request('https://evline.test/api/admin/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customer_phone:'+380000000001',item_name:'Synthetic part',status:'new',payment_status:'paid',revenue_uah:1000,purchase_cost_uah:600,gclid:'synthetic-manual-click'})})});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.order.status,'new');
  const event=f.db.prepare("SELECT * FROM google_ads_conversion_events WHERE order_id=? AND event_type='paid'").get(data.order.id);assert.equal(event.status,'queued');assert.equal(event.crm_status,'customer_paid');
});
test('bank full customer settlement queues once; partial payment does not',async t=>{
  const f=setup(t);f.db.prepare("INSERT INTO bank_incoming(id,bank,account_id,account_iban,transaction_id,fingerprint,booked_at,amount_minor,currency,direction,payer_name,purpose,first_seen_at,order_id,ignored) VALUES('receipt','pumb','account','synthetic-iban','transaction','fingerprint','2026-11-02T12:00:00',50000,'UAH','INBOUND','','','2026-11-02T12:00:00Z','test-order',0)").run();
  await refreshOrderPaymentStatus(f.env,'test-order');assert.equal(f.order().payment_status,'partial');assert.equal(f.event(),undefined);
  f.db.exec('UPDATE bank_incoming SET amount_minor=100000');await refreshOrderPaymentStatus(f.env,'test-order');assert.equal(f.order().payment_status,'paid');assert.equal(f.order().status,'new');assert.equal(f.event().status,'queued');
  const at=f.event().conversion_time;await refreshOrderPaymentStatus(f.env,'test-order');assert.equal(f.event().conversion_time,at);
});
