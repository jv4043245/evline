import test from 'node:test';
import assert from 'node:assert/strict';
import{DatabaseSync}from'node:sqlite';
import{readFile,readdir}from'node:fs/promises';
import{dispatchBankReceiptAlerts}from'../functions/_lib/bank-telegram-alerts.js';
const folder=new URL('../migrations/',import.meta.url),files=(await readdir(folder)).filter(f=>f.endsWith('.sql')).sort();
const schemas=await Promise.all(files.map(f=>readFile(new URL(f,folder),'utf8')));
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());for(const s of schemas)db.exec(s);
  const env={EVLINE_BANK_ALERT_SECRET:'s'.repeat(43),DB:{prepare(sql){const st=db.prepare(sql);let args=[];return{bind(...v){args=v;return this;},async first(){return st.get(...args);},async all(){return{results:st.all(...args)};},async run(){return{meta:{changes:Number(st.run(...args).changes)}};}};}}};
  db.exec("INSERT INTO orders(id,created_at,updated_at,type,status,order_number) VALUES('test-order','2026-10-22','2026-10-22','parts','new','O-123')");
  const add=(id='a',extra={})=>{
    const row={id:id.repeat(64),bank:'pumb',transaction_id:id,account_id:'test',account_iban:'TEST',currency:'UAH',amount_minor:10000,direction:'INBOUND',booked_at:'2026-10-22T11:00:00',payer_name:'Тест',purpose:'Рахунок 1',fingerprint:'test',first_seen_at:new Date().toISOString(),order_id:'test-order',...extra};
    db.prepare(`INSERT INTO bank_incoming(${Object.keys(row).join(',')})VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));return row.id;
  };return{db,env,add};
}
test('sends only new positive UAH incoming facts with exact linked order; deduplicates polls',async t=>{
  const{db,env,add}=fixture(t);add();add('b',{direction:'OUTBOUND'});add('c',{ignored:1});add('d',{currency:'USD'});
  const calls=[];const fetcher=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({state:'sent',message_id:42});};
  assert.equal((await dispatchBankReceiptAlerts(env,{fetcher})).sent,1);await dispatchBankReceiptAlerts(env,{fetcher});assert.equal(calls.length,1);
  assert.equal(calls[0].body.order_number,'O-123');assert.equal(calls[0].body.order_id,'test-order');assert.equal(db.prepare('SELECT status FROM bank_telegram_alerts').get().status,'sent');
});
test('activation baseline suppresses historical receipts and missing linkage stays explicit',async t=>{
  const{db,env,add}=fixture(t);const old=add();db.prepare("INSERT INTO bank_telegram_alerts(payment_id,status,created_at,updated_at) VALUES(?,'suppressed','now','now')").run(old);add('b',{order_id:null});
  const bodies=[];await dispatchBankReceiptAlerts(env,{fetcher:async(u,o)=>{bodies.push(JSON.parse(o.body));return Response.json({state:'sent',message_id:42});}});
  assert.equal(bodies.length,1);assert.equal(bodies[0].order_id,null);assert.equal(bodies[0].order_number,null);
});
test('retrying a lost response preserves event ID and frozen facts after order changes',async t=>{
  const{db,env,add}=fixture(t);add();const bodies=[];let fail=true;
  const fetcher=async(u,o)=>{bodies.push(o.body);if(fail)throw Error('network');return Response.json({state:'sent',message_id:42});};
  await dispatchBankReceiptAlerts(env,{fetcher});assert.equal(db.prepare('SELECT status FROM bank_telegram_alerts').get().status,'pending');
  db.exec("UPDATE bank_telegram_alerts SET next_attempt_at=NULL;UPDATE orders SET order_number='changed'");fail=false;
  await dispatchBankReceiptAlerts(env,{fetcher});assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);assert.equal(JSON.parse(bodies[1]).order_number,'O-123');
});
test('uncertain and rejected sends are retained without automatic replay',async t=>{
  const{db,env,add}=fixture(t);add();let calls=0;const fetcher=async()=>{calls++;return Response.json({state:'uncertain'});};
  await dispatchBankReceiptAlerts(env,{fetcher});await dispatchBankReceiptAlerts(env,{fetcher});assert.equal(calls,1);assert.equal(db.prepare('SELECT status FROM bank_telegram_alerts').get().status,'uncertain');
});
test('no credential disables delivery; a service outage keeps the event pending',async t=>{
  const{db,env,add}=fixture(t);add();let calls=0;const fetcher=async()=>{calls++;return new Response(null,{status:503});};
  assert.deepEqual(await dispatchBankReceiptAlerts({...env,EVLINE_BANK_ALERT_SECRET:undefined},{fetcher}),{enabled:false});assert.equal(calls,0);
  await dispatchBankReceiptAlerts(env,{fetcher});assert.equal(db.prepare('SELECT status FROM bank_telegram_alerts').get().status,'pending');
});
