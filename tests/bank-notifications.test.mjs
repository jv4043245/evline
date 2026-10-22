import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile,readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { onRequest } from '../functions/api/admin/bank-notifications.js';
import { createBankNotifications } from '../admin/bank-notifications.js';
import { createBankIncomingView } from '../admin/bank-incoming.js';

const dir=new URL('../migrations/',import.meta.url);
const migrations=await Promise.all((await readdir(dir)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFile(new URL(f,dir),'utf8')));
function setup(t) {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const sql of migrations)db.exec(sql);t.after(()=>db.close());
  const env={ADMIN_TOKEN:'manager',ADMIN_OWNER_TOKEN:'owner',DB:{prepare(sql){let args=[];const stmt=db.prepare(sql);return{bind(...v){args=v;return this;},async first(){return stmt.get(...args);},async run(){return{meta:{changes:Number(stmt.run(...args).changes)}};}};},async batch(stmts){db.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}}};
  const insert=(id,direction='INBOUND',ignored=0)=>db.prepare(`INSERT INTO bank_incoming(id,bank,transaction_id,account_id,account_iban,currency,amount_minor,direction,booked_at,fingerprint,first_seen_at,ignored)
    VALUES(?,'pumb',?,'test','TEST','UAH',100,?,'2026-10-01','test','2026-10-21',?)`).run(id,id,direction,ignored);
  const call=async(body,token='manager',headers={})=>onRequest({env,request:new Request('https://evline.test/api/admin/bank-notifications',{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})})});
  return{db,env,insert,call};
}
test('new receipts are counted individually per identity, including automatic links; reading is not linking',async t=>{
  const {db,insert,call}=setup(t);insert('a');insert('b');insert('out','OUTBOUND');insert('ignored','INBOUND',1);
  db.exec("INSERT INTO orders(id,created_at,updated_at,type,status,payment_status) VALUES('o','2026-10-21','2026-10-21','parts','new','unpaid');UPDATE bank_incoming SET order_id='o',match_method='automatic' WHERE id='a'");
  assert.deepEqual(await(await call()).json(),{count:2,unassigned_count:1});
  assert.deepEqual(await(await call({ids:['a','a','missing','out','ignored'],user_id:'owner'})).json(),{count:1,unassigned_count:1});
  assert.deepEqual(await(await call(null,'owner')).json(),{count:2,unassigned_count:1});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_receipt_views').get().n,1);
  insert('new');assert.deepEqual(await(await call({ids:['a']})).json(),{count:2,unassigned_count:2});
  await call({ids:['b','new']});assert.deepEqual(await(await call()).json(),{count:0,unassigned_count:2});
  assert.equal(db.prepare("SELECT payment_status FROM orders WHERE id='o'").get().payment_status,'unpaid');
  assert.equal(db.prepare("SELECT order_id FROM bank_incoming WHERE id='b'").get().order_id,null);
});
test('owner viewing leaves Andrii unread; unassigned reminder survives viewing until assignment, without a date limit',async t=>{
  const {db,insert,call}=setup(t);
  assert.deepEqual(await(await call()).json(),{count:0,unassigned_count:0});
  insert('old');insert('new');insert('out','OUTBOUND');insert('ignored','INBOUND',1);
  await call({ids:['old','new']},'owner');
  assert.deepEqual(await(await call(null,'owner')).json(),{count:0,unassigned_count:2});
  assert.deepEqual(await(await call()).json(),{count:2,unassigned_count:2});
  db.exec("INSERT INTO orders(id,created_at,updated_at,type,status,payment_status) VALUES('o','2026-10-21','2026-10-21','parts','new','unpaid');UPDATE bank_incoming SET order_id='o' WHERE id='old'");
  assert.deepEqual(await(await call(null,'owner')).json(),{count:0,unassigned_count:1});
  assert.deepEqual(await(await call()).json(),{count:2,unassigned_count:1});
  insert('latest');assert.deepEqual(await(await call(null,'owner')).json(),{count:1,unassigned_count:2});
  await call({ids:['latest']},'owner');db.exec("UPDATE bank_incoming SET order_id='o' WHERE direction='INBOUND'");
  assert.deepEqual(await(await call(null,'owner')).json(),{count:0,unassigned_count:0});
  assert.equal((await(await call()).json()).count,3);
});
test('only supplied visible IDs are acknowledged; pagination and concurrently arriving money stay new',async t=>{
  const {insert,call}=setup(t);for(let i=0;i<52;i++)insert('p'+i);
  const ids=Array.from({length:50},(_,i)=>'p'+i);insert('late');
  const result=await call({ids});assert.equal((await result.json()).count,3);
  assert.equal((await(await call({ids})).json()).count,3);
  await call({ids:['not-yet-imported']});insert('not-yet-imported');assert.equal((await(await call()).json()).count,4);
});
test('view state requires authentication, same origin and bounded valid IDs',async t=>{
  const {call,db}=setup(t);
  assert.equal((await call(null,'bad')).status,401);
  assert.equal((await call({ids:['a']},'manager',{origin:'https://evil.test'})).status,403);
  for(const ids of [[],Array(51).fill('a'),['x'.repeat(101)],['bad id'],[null]])assert.equal((await call({ids})).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_receipt_views').get().n,0);
});

const waitFor=async check=>{const end=Date.now()+5000;while(!check()){assert.ok(Date.now()<end,'condition timed out');await new Promise(r=>setTimeout(r,5));}};
function ui(t){const dom=new JSDOM('<button>Надходження <span hidden></span></button><main></main>',{url:'https://evline.test',pretendToBeVisual:true});t.after(()=>dom.window.close());return{dom,badge:dom.window.document.querySelector('span')};}
test('orange unread takes priority, seen unassigned stays blue, linking clears blue, errors do not hide reminders',async t=>{
  const {badge}=ui(t);let state={count:3,unassigned_count:3},fail=false;
  const n=createBankNotifications(badge,async(_p,o)=>{if(fail)throw Error('offline');if(o?.method==='POST')state.count=0;return{...state};});t.after(()=>n.destroy());
  n.start();await waitFor(()=>badge.dataset.state==='new');assert.equal(badge.textContent,'3');
  await n.markSeen([{id:'a',direction:'INBOUND'}]);assert.equal(badge.hidden,false);assert.equal(badge.dataset.state,'unassigned');assert.equal(badge.textContent,'3');assert.ok(badge.classList.contains('bank-new-badge--unassigned'));
  fail=true;await n.refresh();assert.equal(badge.dataset.state,'unassigned');fail=false;
  state={count:1,unassigned_count:4};await n.refresh();assert.equal(badge.dataset.state,'new');assert.equal(badge.textContent,'1');assert.equal(badge.classList.contains('bank-new-badge--unassigned'),false);assert.match(badge.closest('button').title,/4/);
  await n.markSeen([{id:'b',direction:'INBOUND'}]);assert.equal(badge.dataset.state,'unassigned');assert.equal(badge.textContent,'4');
  state={count:0,unassigned_count:120};await n.refresh();assert.equal(badge.textContent,'99+');assert.match(badge.getAttribute('aria-label'),/120/);
  state={count:0,unassigned_count:0};await n.markSeen([{id:'b',direction:'INBOUND'}]);assert.equal(badge.hidden,true);assert.equal(badge.dataset.state,'clear');
  state={count:1,unassigned_count:0};await n.refresh();assert.equal(badge.dataset.state,'new');assert.equal(badge.hidden,false);
  n.reset();assert.equal(badge.hidden,true);assert.equal(badge.classList.contains('bank-new-badge--unassigned'),false);
});
test('badge polls outside bank view, acknowledges exact IDs, caches successful views and preserves count on error',async t=>{
  const {dom,badge}=ui(t);let count=1,fail=false;const posts=[];
  const api=async(_path,options)=>{if(fail)throw Error('offline');if(options?.method==='POST'){posts.push(JSON.parse(options.body).ids);count=0;}return{count};};
  const n=createBankNotifications(badge,api,{intervalMs:15});t.after(()=>n.destroy());n.start();await waitFor(()=>badge.textContent==='1');assert.equal(badge.hidden,false);
  count=3;await waitFor(()=>badge.textContent==='3');fail=true;await n.refresh();assert.equal(badge.textContent,'3');fail=false;
  await n.markSeen([{id:'a',direction:'INBOUND'},{id:'out',direction:'OUTBOUND'}]);assert.equal(badge.hidden,true);assert.deepEqual(posts,[['a']]);
  await n.markSeen([{id:'a',direction:'INBOUND'}]);assert.equal(posts.length,1);
  count=120;await n.refresh();assert.equal(badge.textContent,'99+');assert.match(badge.closest('button').getAttribute('aria-label'),/120/);
  Object.defineProperty(dom.window.document,'hidden',{value:true,configurable:true});count=7;await n.refresh();assert.equal(badge.textContent,'99+');
  Object.defineProperty(dom.window.document,'hidden',{value:false,configurable:true});dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));await waitFor(()=>badge.textContent==='7');
  n.reset();assert.equal(badge.hidden,true);
});
test('serialized poll and seen requests cannot restore an obsolete badge; late logout response is ignored',async t=>{
  const {badge}=ui(t);let finish;let calls=0;
  const n=createBankNotifications(badge,async(_p,o)=>{calls++;if(calls===1)return new Promise(r=>finish=r);return{count:o?.method==='POST'?0:2};});t.after(()=>n.destroy());
  n.start();await waitFor(()=>finish);const marked=n.markSeen([{id:'a',direction:'INBOUND'}]);finish({count:1});await marked;assert.equal(badge.hidden,true);assert.equal(calls,2);
  n.reset();let release;const second=createBankNotifications(badge,()=>new Promise(r=>release=r));t.after(()=>second.destroy());second.start();await waitFor(()=>release);second.reset();release({count:8});await new Promise(r=>setTimeout(r,10));assert.equal(badge.hidden,true);
});
test('manager sees operations without technical panels; only visible active bank lists acknowledge viewing',async t=>{
  const {dom}=ui(t),root=dom.window.document.querySelector('main'),seen=[];
  const data={can_manage:false,can_link:false,connection:{enabled:true,accounts:[],last_success_at:'2026-10-21',last_error:null},summary:{count:1,review_count:1},invoices:[],rows:[{id:'a',direction:'INBOUND',currency:'UAH',booked_at:'2026-10-21',payer_name:'Тест',purpose:'Оплата',amount_minor:100}]};
  const view=createBankIncomingView(root,async()=>data,{onViewed:rows=>seen.push(rows.map(r=>r.id))});t.after(()=>view.reset());
  await view.load();assert.equal(seen.length,0);assert.match(root.textContent,/Банківські операції/);
  assert.doesNotMatch(root.textContent,/Остання успішна|Виписка рахунків|IBAN|Рахунки клієнтам|Підключено/);
  assert.equal(root.querySelector('.bank-connection'),null);assert.equal(root.querySelector('.bank-setup'),null);
  view.setActive(true);root.hidden=true;await view.load();assert.equal(seen.length,0);
  root.hidden=false;await view.load();assert.deepEqual(seen,[['a']]);
  data.can_manage=true;await view.load();assert.ok(root.querySelector('.bank-connection'));assert.ok(root.querySelector('.bank-setup'));
  assert.doesNotMatch(root.textContent,/Автоматично:|Рахунки клієнтам|Немає готових рахунків|Збереження чернетки/);
});
