import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { fromOrder, normalizeDocument, validateReady } from '../admin/documents/model.js';
import { bankAccounts, bankTransactions, bankDate, minorUnits, parseBankJson, pumbSession } from '../functions/_lib/pumb-api.js';
import { encryptCredentials, decryptCredentials, validDay, kyivDay, invoiceIndex, hasInvoiceReference, matchingInvoices, ingestTransactions, reconcile, readIncoming, connectBank, syncBank } from '../functions/_lib/bank-incoming.js';
import { onRequest as route } from '../functions/api/admin/bank-incoming.js';
import { onRequest as cron } from '../functions/api/cron/bank-incoming.js';
import { createBankIncomingView, mountBankOrderSummary, invoiceTable, paymentTable, bankErrorMessage } from '../admin/bank-incoming.js';
import { lastConnectDiagnostic, saveConnectDiagnostic } from '../functions/_lib/bank-diagnostics.js';
import { adminApiError } from '../assets/js/admin-api-errors.js';
import { linkPayment, refreshOrderPaymentStatus, invoiceSuggestions } from '../functions/_lib/bank-payment-links.js';
import { createOrderPaymentPicker, orderPaymentButton } from '../admin/order-payment-picker.js';

const dir=new URL('../migrations/',import.meta.url);
const schemas=await Promise.all((await readdir(dir)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFile(new URL(f,dir),'utf8')));
const iban='UA'+String(98-Number(BigInt('3000010000000000000000000'+'301000')%97n)).padStart(2,'0')+'3000010000000000000000000';
const bankAccount={accountId:123,iban,currency:'UAH',isCardAccount:false};
const rawTx=(id='1234567890123456789',amount='40.15',extra={})=>({id,hostId:1,accountId:123,state:'PROCESSED',direction:'INBOUND',currencyCode:'UAH',amount,operationDate:'20.10.2026 13:00:00',senderName:'Тестовий платник',description:'Оплата за рахунком № EV-O-TEST',...extra});
const tx=(id='1',amount='40.15',extra={})=>bankTransactions([rawTx(id,amount,extra)],bankAccounts([bankAccount]))[0];
function fixtureDocument() {
  const d=fromOrder({id:'o1',order_number:'O-TEST',customer_name:'Тест',item_name:'Тестовий товар',revenue_uah:100});
  Object.assign(d.seller,{name:'ФОП Тест',tax_id:'0000000000',address:'Тестова адреса',phone:'+380000000000',iban,bank:'Тестовий банк'});
  d.invoice.date='2026-10-19';d.reviewed=true;d.tax='Без ПДВ';
  const result=normalizeDocument(d);assert.deepEqual(validateReady(result,'invoice'),[]);return result;
}
function setup(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');for(const sql of schemas)db.exec(sql);
  const env={ADMIN_TOKEN:'andrii-test',ADMIN_USERS_JSON:JSON.stringify([{id:'owner',name:'Owner',token:'owner-test'}]),PUMB_CLIENT_ID:'test-client',PUMB_CLIENT_SECRET:'test-secret',PUMB_ENCRYPTION_KEY:btoa('a'.repeat(32)),PUMB_CRON_TOKEN:'cron-test',DB:{prepare(sql){const statement=db.prepare(sql);let args=[];return {bind(...v){args=v;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:Number(statement.run(...args).changes)}};}};},async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}}};
  db.prepare("INSERT INTO orders(id,created_at,updated_at,type,status,order_number,customer_name,revenue_uah,payment_status) VALUES('o1','2026-10-19','2026-10-19','parts','awaiting_payment','O-TEST','Тест',100,'unpaid')").run();
  const addDocument=(id='doc1',data=fixtureDocument(),mode='invoice',status='ready',order='o1')=>db.prepare('INSERT INTO order_documents(id,order_id,revision,created_at,actor,status,data_json,output_mode) VALUES(?,?,?, ?,?,?,?,?)').run(id,order,db.prepare('SELECT COUNT(*) n FROM order_documents').get().n+1,'2026-10-19T10:00:00Z','test',status,JSON.stringify(data),mode);
  addDocument();return {db,env,addDocument};
}
const fakeBank=(transactions=[],calls=[])=>async(url,options)=>{calls.push({url,options});return Response.json(url.includes('/token')?{access_token:'test-access-token',expires_in:300}:url.endsWith('/account')?[bankAccount]:transactions);};
const linkPayload=(db,order_id='o1',invoice_key='')=>{const t=db.prepare('SELECT * FROM bank_incoming ORDER BY booked_at,id LIMIT 1').get();return {payment_id:t.id,order_id,invoice_key,expected_amount_minor:t.amount_minor,expected_fingerprint:t.fingerprint,confirmed:true};};
const request=(body,token='owner-test',headers={})=>new Request('https://evline.test/api/admin/bank-incoming',{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});

test('bank amounts, dates and int64 identifiers are exact; unsafe values fail closed',()=>{
  assert.equal(minorUnits('0.01'),1);assert.equal(minorUnits('100.1'),10010);
  for(const v of ['1e4','0','-1','1.001','1,20'])assert.throws(()=>minorUnits(v));
  const parsed=parseBankJson('{"id":9223372036854775807,"amount":"0.29"}');assert.equal(parsed.id,'9223372036854775807');
  assert.equal(bankDate('20.10.2026 23:59:59'),'2026-10-20T23:59:59');
  for(const v of ['31.02.2026','2026-99-99','2026-10-20T29:00:00'])assert.throws(()=>bankDate(v));
  assert.equal(validDay('2026-99-99'),false);assert.equal(validDay('2026-02-30'),false);
  assert.throws(()=>bankTransactions([rawTx(9223372036854775807) ],bankAccounts([bankAccount])));
});
test('only posted UAH account transactions are imported and response schema is checked',()=>{
  const accounts=bankAccounts([bankAccount,{...bankAccount,currency:'USD'},{...bankAccount,isCardAccount:true}]);assert.equal(accounts.length,1);
  assert.equal(bankTransactions([rawTx('1','10',{state:'READY_TO_SEND'}),rawTx('2','10',{cardTransaction:true})],accounts).length,0);
  assert.throws(()=>bankTransactions({data:[]},accounts));assert.throws(()=>bankTransactions([rawTx('1','10',{direction:'UNKNOWN'})],accounts));
  assert.equal(tx('1','0.29').amount_minor,29);
});
test('OAuth adapter sends mandatory headers, uses only read endpoints, never leaks bank errors',async()=>{
  const calls=[],api=await pumbSession({client_id:'c',client_secret:'s',username:'u',password:'p'},fakeBank([],calls));
  await api('/account');await api('/multi-account-transactions',{accountIds:[123]});
  assert.ok(calls.every(c=>c.options.redirect==='manual'));
  assert.equal(new URLSearchParams(calls[0].options.body).get('grant_type'),'password');assert.equal(calls[1].options.headers['X-App-Channel'],'pure-api');
  assert.equal(calls[1].options.headers['X-Flow-ID'].split(':')[1],calls[2].options.headers['X-Flow-ID'].split(':')[1]);
  assert.notEqual(calls[1].options.headers['X-Flow-ID'],calls[2].options.headers['X-Flow-ID']);
  await assert.rejects(api('/document/create',{}),/bank_operation_forbidden/);assert.equal(calls.length,3);
  await assert.rejects(pumbSession({client_id:'c',client_secret:'s',username:'u',password:'p'},async()=>new Response('password=p secret=s',{status:401})),e=>e.message==='bank_auth');
});
test('credentials are authenticated-encrypted, randomized, and never returned in status or audit',async t=>{
  const {env,db}=setup(t),value={username:'private-login',password:'private-password'};
  const a=await encryptCredentials(env,value),b=await encryptCredentials(env,value);assert.notEqual(a,b);assert.doesNotMatch(a,/private-/);assert.deepEqual(await decryptCredentials(env,a),value);
  await assert.rejects(decryptCredentials({...env,PUMB_ENCRYPTION_KEY:btoa('b'.repeat(32))},a));
  const result=await connectBank(env,{...value,start_date:kyivDay(),consent:true},'Owner',fakeBank());
  assert.equal(result.enabled,true);assert.doesNotMatch(JSON.stringify(result),/private-|test-secret|credentials_encrypted/);
  assert.doesNotMatch(db.prepare('SELECT details_json FROM admin_audit_log').get().details_json,/private-/);
  assert.doesNotMatch(db.prepare('SELECT credentials_encrypted FROM bank_connections').get().credentials_encrypted,/private-/);
  await assert.rejects(connectBank(env,{...value,consent:false},'Owner',fakeBank()),/bank_connection_input/);
});
test('invoice references are bounded, and match requires recipient IBAN and currency',()=>{
  assert.equal(hasInvoiceReference('Оплата № EV-O-001, без ПДВ','EV-O-001'),true);
  for(const p of ['EV-O-0012','XEV-O-001','EV-O-001-A'])assert.equal(hasInvoiceReference(p,'EV-O-001'),false);
  assert.equal(hasInvoiceReference('Рахунок A.001','A.001'),true);assert.equal(hasInvoiceReference('Рахунок AX001','A.001'),false);
  assert.equal(matchingInvoices(tx(),[{number:'EV-O-TEST',iban:'wrong',currency:'UAH'}]).length,0);
});
test('short invoice numbers require invoice wording and cannot match dates, amounts or larger IDs',()=>{
  for(const [purpose,n] of [['Згідно рахунку 1 від 19 жовтня 2026р.','1'],['Оплата згідно рахунку №2 від 19/10/2026.','2'],['Рахунок на оплату № 4 від 20 жовтня 2026 р.','4'],['По счету №12 от 19.10.2026','12']])assert.equal(hasInvoiceReference(purpose,n),true,purpose);
  for(const p of ['Оплата 1 грн','від 1.10.2026','замовлення №1','рахунок 12','рахунок 1/2','рахунок 1.20','рахунок 1-A','рахунок 01'])assert.equal(hasInvoiceReference(p,'1'),false,p);
});
test('manual link without invoice is idempotent, audited, cannot be reassigned and updates only customer payment status',async t=>{
  const {env,db}=setup(t);await ingestTransactions(env,[tx('91','40.15',{description:'Без рахунку'})],[]);
  const payload=linkPayload(db);await linkPayment(env,payload,[],'Owner');
  assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,'partial');
  assert.equal((await linkPayment(env,payload,[],'Owner')).already_linked,true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='bank.payment_link'").get().n,1);
  const order=db.prepare('SELECT * FROM orders').get();assert.equal(order.revenue_uah,100);assert.equal(order.status,'awaiting_payment');
  db.exec("INSERT INTO orders(id,created_at,updated_at,type,status) VALUES('o2','2026-10-20','2026-10-20','parts','new')");
  await assert.rejects(linkPayment(env,{...payload,order_id:'o2'},[],'Owner'),/bank_match_conflict/);
  assert.equal(db.prepare('SELECT order_id FROM bank_incoming').get().order_id,'o1');
});
test('manual confirmation rejects stale facts, no consent, canceled orders and outbound payments',async t=>{
  const {env,db}=setup(t);await ingestTransactions(env,[tx()],[]);const p=linkPayload(db);
  await assert.rejects(linkPayment(env,{...p,confirmed:false},[],'Owner'),/bank_input/);
  await assert.rejects(linkPayment(env,{...p,expected_amount_minor:1},[],'Owner'),/bank_match_conflict/);
  await assert.rejects(linkPayment(env,{...p,expected_fingerprint:'stale'},[],'Owner'),/bank_match_conflict/);
  for(const reason of ['bank_record_changed','order_deleted','manual_review']){db.prepare('UPDATE bank_incoming SET review_reason=?').run(reason);await assert.rejects(linkPayment(env,p,[],'Owner'),/bank_match_conflict/);}
  db.exec("UPDATE bank_incoming SET review_reason=NULL;UPDATE orders SET status='canceled'");await assert.rejects(linkPayment(env,p,[],'Owner'),/bank_match_conflict/);
  db.exec("UPDATE orders SET status='new';UPDATE bank_incoming SET direction='OUTBOUND'");await assert.rejects(linkPayment(env,p,[],'Owner'),/bank_match_conflict/);
});
test('concurrent manual confirmations have one winner and short-number auto matching updates the order',async t=>{
  const {env,db,addDocument}=setup(t);await ingestTransactions(env,[tx('95','100',{description:'Без рахунку'})],[]);
  db.exec("INSERT INTO orders(id,created_at,updated_at,type,status) VALUES('o2','2026-10-20','2026-10-20','parts','new')");
  const p=linkPayload(db);const results=await Promise.allSettled([linkPayment(env,p,[],'Owner'),linkPayment(env,{...p,order_id:'o2'},[],'Other')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='bank.payment_link'").get().n,1);
  db.exec("DELETE FROM bank_incoming;DELETE FROM bank_order_payment_state;DELETE FROM order_documents;UPDATE orders SET payment_status='unpaid' WHERE id='o1'");
  const d=fixtureDocument();d.invoice.number='1';addDocument('short',d);
  const invoices=await invoiceIndex(env);await ingestTransactions(env,[tx('96','100',{description:'Згідно рахунку 1 від 19 жовтня 2026р.'})],invoices);
  assert.equal(await reconcile(env,invoices),1);assert.equal(db.prepare("SELECT payment_status FROM orders WHERE id='o1'").get().payment_status,'paid');
});
test('invoice prepayment does not imply full order paid; no price, manual paid and refund are protected',async t=>{
  const {env,db,addDocument}=setup(t);db.exec('DELETE FROM order_documents');const doc=fixtureDocument();doc.invoice.mode='custom';doc.invoice.amount='40.15';addDocument('advance',doc);
  const invoices=await invoiceIndex(env);await ingestTransactions(env,[tx()],invoices);await reconcile(env,invoices);
  assert.equal((await readIncoming(env)).invoices[0].status,'paid');assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,'partial');
  db.exec('UPDATE orders SET revenue_uah=0');await refreshOrderPaymentStatus(env,'o1');assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,'partial');
  for(const s of ['paid','refunded']){db.prepare('UPDATE orders SET payment_status=?').run(s);await refreshOrderPaymentStatus(env,'o1');assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,s);}
});
test('changed bank evidence removes bank-managed paid status instead of leaving false payment confirmation',async t=>{
  const {env,db}=setup(t),invoices=await invoiceIndex(env);await ingestTransactions(env,[tx('1','100')],invoices);await reconcile(env,invoices);
  assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,'paid');
  await ingestTransactions(env,[tx('1','99')],invoices);await reconcile(env,invoices);
  assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,'unknown');
});
test('manual optional invoice checks account, date and remaining amount for owner and Andrii',async t=>{
  const {env,db}=setup(t),invoices=await invoiceIndex(env);await ingestTransactions(env,[tx('1','101')],invoices);const p=linkPayload(db,'o1',invoices[0].key);
  await assert.rejects(linkPayment(env,p,invoices,'Owner'),/bank_match_conflict/);
  await assert.rejects(linkPayment(env,p,[{...invoices[0],iban:'wrong'}],'Owner'),/bank_match_conflict/);
  const res=await route({env,request:request({action:'link',...p},'andrii-test')});assert.equal(res.status,409);
  const cross=await route({env,request:request({action:'link',...p},'owner-test',{origin:'https://evil.test'})});assert.equal(cross.status,403);
  const valid=await route({env,request:request({action:'link',...p,invoice_key:''})});assert.equal(valid.status,200);
  assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,'paid');
});
test('Andrii may link with an audit, but bank controls and other users remain restricted',async t=>{
  const {env,db}=setup(t);env.ADMIN_USERS_JSON=JSON.stringify([{id:'owner',name:'Owner',token:'owner-test'},{id:'other',name:'Other',token:'other-test'}]);
  await ingestTransactions(env,[tx('1','100',{description:'Без номера'})],[]);const payload={action:'link',...linkPayload(db)};
  for(const token of ['andrii-test','owner-test'])assert.equal((await (await route({env,request:request(null,token)})).json()).can_link,true);
  assert.equal((await (await route({env,request:request(null,'other-test')})).json()).can_link,false);
  const forbidden=await route({env,request:request(payload,'other-test')});assert.equal(forbidden.status,403);assert.equal((await forbidden.json()).error,'bank_link_forbidden');
  for(const action of ['connect','pause','sync'])assert.equal((await route({env,request:request({action},'andrii-test')})).status,403);
  assert.equal((await route({env,request:request(payload,'andrii-test',{origin:'https://evil.test'})})).status,403);
  const linked=await route({env,request:request(payload,'andrii-test')});assert.equal(linked.status,200);assert.equal((await linked.json()).order.payment_status,'paid');
  assert.equal(db.prepare("SELECT actor FROM admin_audit_log WHERE action='bank.payment_link'").get().actor,'Андрій');
  assert.equal((await route({env,request:request(payload,'andrii-test')})).status,200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='bank.payment_link'").get().n,1);
});
test('available receipt picker uses Kyiv calendar days, excludes unsafe/assigned facts, and paginates',async t=>{
  const {env,db}=setup(t),today=kyivDay(),day=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
  for(let i=1;i<=58;i++)await ingestTransactions(env,[tx(String(i),'1',{description:'Без номера'})],[]);
  db.prepare('UPDATE bank_incoming SET booked_at=?').run(today+'T00:01:00');
  const ids=db.prepare('SELECT id FROM bank_incoming ORDER BY id').all().map(r=>r.id);
  const update=(index,sql,...args)=>db.prepare(`UPDATE bank_incoming SET ${sql} WHERE id=?`).run(...args,ids[index]);
  update(0,'booked_at=?',day(-3)+'T23:59:59');update(1,'booked_at=?',day(-2)+'T00:00:00');update(2,'booked_at=?',day(1)+'T00:00:00');
  update(3,"direction='OUTBOUND'");update(4,"currency='EUR'");update(5,"order_id='o1'");update(6,"review_reason='bank_record_changed'");update(7,"review_reason='order_deleted'");update(8,"review_reason='manual_review'");update(9,'ignored=1');
  let data=await readIncoming(env,{available:true,days:3});assert.equal(data.summary.count,49);assert.ok(data.rows.some(r=>r.id===ids[1]));assert.ok(!data.rows.some(r=>r.id===ids[0]));
  data=await readIncoming(env,{available:true,days:7});assert.equal(data.summary.count,50);
  for(let i=59;i<=63;i++)await ingestTransactions(env,[tx(String(i),'1',{description:'Без номера',operationDate:today+'T01:00:00'})],[]);
  const first=await readIncoming(env,{available:true,days:0}),second=await readIncoming(env,{available:true,days:0,page:2});
  assert.equal(first.summary.count,55);assert.equal(first.rows.length,50);assert.equal(second.rows.length,5);assert.ok(second.rows.every(r=>!first.rows.some(a=>a.id===r.id)));
  for(const query of ['available=1&days=-1','available=1&days=4','available=1&days=no','available=1&order_id=o1']) {
    const response=await route({env,request:new Request('https://evline.test/api/admin/bank-incoming?'+query,{headers:{authorization:'Bearer andrii-test'}})});assert.equal(response.status,400,query);
  }
});
test('Andrii links from a row dropdown and from inside an order without nested forms or implicit writes',async t=>{
  const {env,db}=setup(t);for(const [id,amount] of [['1','40.15'],['2','59.85']])await ingestTransactions(env,[tx(id,amount,{description:'Без номера',operationDate:kyivDay()+'T10:00:00'})],[]);
  const dom=new JSDOM('<main></main><form id="order"><input name="note" value="keep"><select name="payment_status"><option>partial</option><option>paid</option></select><section id="bank"></section></form>',{url:'https://evline.test'});t.after(()=>dom.window.close());
  const posts=[];const api=async(path,options)=>{
    if(path.startsWith('/api/admin/orders?'))return {total:1,orders:[{id:'o1',order_number:'O-TEST',customer_name:'Тест',revenue_uah:100,status:'new'}]};
    if(options)posts.push(JSON.parse(options.body));
    const response=await route({env,request:new Request(new URL(path,'https://evline.test'),{method:options?'POST':'GET',headers:{authorization:'Bearer andrii-test','content-type':'application/json'},...(options?{body:options.body}:{})})});
    const body=await response.json();if(!response.ok)throw Error(body.error);return body;
  };
  const waitFor=async check=>{const end=Date.now()+10000;while(!check()){assert.ok(Date.now()<end,'UI timeout');await new Promise(r=>setTimeout(r,10));}};
  const change=el=>el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  const opened=[],root=dom.window.document.querySelector('main'),view=createBankIncomingView(root,api,{openOrder:id=>opened.push(id)});await view.load();
  assert.equal(root.querySelector('[data-bank-connect]'),null);
  const select=root.querySelector('[data-bank-row-order]');select.value='o1';change(select);await waitFor(()=>root.querySelector('[data-bank-confirm] select')?.options.length>1);
  assert.equal(posts.length,0);const form=root.querySelector('[data-bank-confirm]');form.elements.confirmed.checked=true;form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await waitFor(()=>posts.length===1 && root.querySelector('[data-bank-message]')?.textContent.includes('Платіж прив’язано'));
  const orderLink=root.querySelector('.bank-order-link');assert.ok(orderLink);assert.equal(orderLink.dataset.bankOrder,'o1');assert.match(orderLink.getAttribute('aria-label'),/Відкрити замовлення/);
  orderLink.querySelector('strong').click();orderLink.querySelector('span').click();assert.deepEqual(opened,['o1','o1']);assert.equal(posts.length,1);
  assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,'partial');
  const bank=dom.window.document.querySelector('#bank');let unsaved=true,linked=null;const busy=[];
  await mountBankOrderSummary(bank,'o1',api,{beforeLink:()=>unsaved?'Save first':'',onBusy:b=>busy.push(b),onLinked:o=>{linked=o;}});
  assert.equal(bank.querySelector('form'),null);assert.equal(bank.querySelector('[data-order-bank-days]').value,'3');
  assert.deepEqual([...new dom.window.FormData(dom.window.document.querySelector('#order'))],[['note','keep'],['payment_status','partial']]);
  const picker=bank.querySelector('[data-order-bank-payment]');picker.value=picker.options[1].value;change(picker);
  bank.querySelector('[data-order-bank-link]').click();assert.equal(posts.length,1);
  bank.querySelector('[data-order-bank-confirmed]').checked=true;bank.querySelector('[data-order-bank-link]').click();assert.equal(posts.length,1);assert.match(bank.textContent,/Save first/);
  unsaved=false;bank.querySelector('[data-order-bank-link]').click();await waitFor(()=>linked && busy.at(-1)===false);
  assert.equal(linked.payment_status,'paid');assert.equal(posts.length,2);assert.equal(bank.querySelector('[data-order-bank-payment]').options.length,1);
  assert.deepEqual(busy,[true,false]);assert.equal(dom.window.document.querySelector('[name=note]').value,'keep');view.reset();
});
test('payment action has a visible hryvnia label, accessible dropdown semantics and sits below edit in the primary stack',async t=>{
  const dom=new JSDOM(orderPaymentButton('id" onclick="bad','O-1 <script>'));t.after(()=>dom.window.close());
  const button=dom.window.document.querySelector('button');assert.match(button.textContent,/₴[\s\S]*Оплата/);
  assert.equal(button.getAttribute('aria-haspopup'),'dialog');assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(button.getAttribute('onclick'),null);assert.equal(button.getAttribute('title'),'Прив’язати оплату');assert.equal(dom.window.document.querySelector('script'),null);
  const source=await readFile(new URL('../admin/admin.js',import.meta.url),'utf8');
  assert.match(source,/<div class="orders-table__primary-stack">[\s\S]*?data-open-order=[\s\S]*?orderPaymentButton\(order.id,publicNumber,order.has_bank_payment\)[\s\S]*?<\/div>\s*<div class="orders-table__china-stack">/);
  const linked=new JSDOM(orderPaymentButton('o1','O-1',1));t.after(()=>linked.window.close());
  const linkedButton=linked.window.document.querySelector('button');assert.ok(linkedButton.classList.contains('orders-table__payment--linked'));assert.match(linkedButton.textContent,/Є оплата/);assert.match(linkedButton.title,/ще один платіж/);assert.equal(linkedButton.disabled,false);
  assert.doesNotMatch(orderPaymentButton('o1','O-1',0),/orders-table__payment--linked/);
});
test('order-list payment panel loads only unassigned last-week receipts and requires explicit confirmation',async t=>{
  const {env,db}=setup(t),today=kyivDay(),day=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
  for(const [id,offset] of [['1',0],['2',-6],['3',-7],['4',0]])await ingestTransactions(env,[tx(id,'40',{description:'Без номера '+id,operationDate:day(offset)+'T10:00:00'})],[]);
  const assigned=db.prepare("SELECT id FROM bank_incoming WHERE purpose='Без номера 4'").get().id;
  db.prepare("UPDATE bank_incoming SET order_id='o1' WHERE id=?").run(assigned);
  const dom=new JSDOM('<table><tbody><tr data-order-id="o1"><td><button data-order-payment="o1" aria-expanded="false">Оплата</button></td></tr></tbody></table>',{url:'https://evline.test'});t.after(()=>dom.window.close());
  const table=dom.window.document.querySelector('tbody'),button=table.querySelector('button'),calls=[];let updated=null,rowClicks=0;
  table.addEventListener('click',()=>rowClicks++);
  const api=async(path,options)=>{calls.push({path,options});const r=await route({env,request:new Request(new URL(path,'https://evline.test'),{method:options?'POST':'GET',headers:{authorization:'Bearer andrii-test','content-type':'application/json'},...(options?{body:options.body}:{})})});const j=await r.json();if(!r.ok)throw Error(j.error);return j;};
  const picker=createOrderPaymentPicker(table,api,{onLinked:o=>updated=o});
  assert.equal(calls.length,0);await picker.toggle(button);
  assert.ok(calls.some(c=>c.path.includes('available=1&days=7&page=1')));
  const doc=dom.window.document;assert.equal(table.querySelector('select'),null);assert.equal(table.querySelectorAll('tr').length,1);
  assert.equal(doc.querySelectorAll('[data-payment-choice]').length,2);
  assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(doc.querySelector('.order-payment-menu').parentElement,doc.body);
  doc.querySelector('[data-payment-choice]').click();assert.equal(calls.filter(c=>c.options).length,0);assert.equal(rowClicks,0);
  assert.equal(doc.querySelectorAll('.order-payment-menu input,.order-payment-menu select').length,0);
  doc.querySelector('[data-payment-confirm]').click();
  const end=Date.now()+5000;while(!doc.querySelector('.order-payment-menu__message')?.textContent.includes('Оплату прив’язано')){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,10));}
  assert.equal(updated.id,'o1');assert.equal(updated.payment_status,'partial');
  assert.equal(updated.has_bank_payment,1);assert.ok(button.classList.contains('orders-table__payment--linked'));
  assert.equal(doc.querySelectorAll('[data-payment-choice]').length,1);
  assert.equal(calls.filter(c=>c.options).length,1);
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(doc.querySelector('.order-payment-menu'),null);assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(doc.activeElement,button);
  await picker.toggle(button);assert.equal(doc.querySelectorAll('[data-payment-choice]').length,1);
  doc.body.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true}));assert.equal(doc.querySelector('.order-payment-menu'),null);
});
test('order-list panel ignores a late load after closing and switching orders',async t=>{
  const dom=new JSDOM('<table><tbody><tr data-order-id="one"><td><button>One</button></td></tr><tr data-order-id="two"><td><button>Two</button></td></tr></tbody></table>');t.after(()=>dom.window.close());
  const table=dom.window.document.querySelector('tbody'),buttons=table.querySelectorAll('button');let release;
  const picker=createOrderPaymentPicker(table,async path=>{if(path.includes('one'))return new Promise(r=>release=r);return{can_link:true,order:{order_number:'Two'},summary:{count:0},rows:[]};});
  const first=picker.toggle(buttons[0]);await picker.toggle(buttons[1]);release({can_link:false,order:{order_number:'One'},invoices:[],rows:[]});await first;
  assert.equal(dom.window.document.querySelectorAll('.order-payment-menu').length,1);assert.match(dom.window.document.querySelector('.order-payment-menu').textContent,/Two/);assert.equal(buttons[0].getAttribute('aria-expanded'),'false');picker.reset();
});
test('floating payment menu preserves confirmation guards, disables repeated submits, and clears stale choices after conflict',async t=>{
  const dom=new JSDOM('<table><tbody><tr data-order-id="o"><td><button>Open</button></td></tr></tbody></table>');t.after(()=>dom.window.close());
  const doc=dom.window.document,table=doc.querySelector('tbody');let posts=0,blocked=true,rejectPost;
  const picker=createOrderPaymentPicker(table,async(path,options)=>{
    if(options){posts++;return new Promise((resolve,reject)=>rejectPost=reject);}
    return {can_link:true,order:{id:'o',order_number:'O-1',customer_name:'Тест'},summary:{count:1},rows:[{id:'p',amount_minor:4000,booked_at:'2026-10-21',payer_name:'<img src=x>',purpose:'<script>bad</script>',fingerprint:'test'}]};
  },{beforeLink:()=>blocked?'Save first':''});
  await picker.toggle(table.querySelector('button'));assert.equal(doc.querySelector('.order-payment-menu img'),null);
  doc.querySelector('[data-payment-choice]').click();doc.querySelector('[data-payment-confirm]').click();assert.equal(posts,0);assert.match(doc.querySelector('[role=status]').textContent,/Save first/);
  blocked=false;doc.querySelector('[data-payment-confirm]').click();doc.querySelector('[data-payment-confirm]').click();assert.equal(posts,1);
  doc.body.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true}));assert.ok(doc.querySelector('.order-payment-menu'));
  rejectPost(Error('bank_match_conflict'));await new Promise(r=>setTimeout(r,10));assert.equal(doc.querySelector('[data-payment-confirm]'),null);assert.equal(doc.querySelector('[data-payment-choice]'),null);assert.ok(doc.querySelector('[data-payment-reload]'));
  picker.reset();assert.equal(doc.querySelector('.order-payment-menu'),null);
});
test('name and amount suggestions never authorize automatic association',async t=>{
  const {env,db}=setup(t),invoices=await invoiceIndex(env),payment=tx('92','100',{senderName:'Тест',description:'Оплата товару'});
  assert.deepEqual(invoiceSuggestions(payment,invoices)[0].reasons,['amount','name']);
  await ingestTransactions(env,[payment],invoices);assert.equal(await reconcile(env,invoices),0);
  assert.equal(db.prepare('SELECT order_id FROM bank_incoming').get().order_id,null);
});
test('manual UI searches and explicitly confirms a selected order without touching credentials or auto-selecting',async t=>{
  const {env,db}=setup(t);await ingestTransactions(env,[tx('93','100',{description:'Без номера'})],[]);
  const dom=new JSDOM('<main></main>',{url:'https://evline.test'});t.after(()=>dom.window.close());const root=dom.window.document.querySelector('main');
  const posts=[];const view=createBankIncomingView(root,async(path,options)=>{
    if(options){const body=JSON.parse(options.body);posts.push(body);const response=await route({env,request:request(body)});if(!response.ok)throw new Error((await response.json()).error);return response.json();}
    if(path.startsWith('/api/admin/orders?'))return {total:1,orders:[{id:'o1',order_number:'O-TEST',customer_name:'Тест',revenue_uah:100,status:'new'}]};
    return {...await readIncoming(env,{orderId:path.includes('order_id=')?'o1':''}),can_link:true,can_manage:false};
  });
  const waitFor=async check=>{const deadline=Date.now()+10000;while(!check()){assert.ok(Date.now()<deadline,'UI condition timed out');await new Promise(r=>setTimeout(r,10));}};
  await view.load();root.querySelector('[data-bank-link]').click();
  assert.equal(root.querySelector('[data-bank-confirm]'),null);
  root.querySelector('[name=query]').value='O-TEST';root.querySelector('[data-bank-search]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await waitFor(()=>root.querySelector('[data-bank-choose]'));assert.equal(root.querySelector('[data-bank-confirm]'),null);
  const select=root.querySelector('[data-bank-choose]');select.value='o1';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await waitFor(()=>root.querySelector('[data-bank-confirm]'));
  const form=root.querySelector('[data-bank-confirm]');form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));assert.equal(posts.length,0);
  form.elements.confirmed.checked=true;form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>!root.querySelector('[data-bank-link]'));
  assert.equal(posts.length,1);assert.equal(posts[0].action,'link');assert.equal(posts[0].order_id,'o1');
  assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,'paid');assert.equal(root.querySelector('[data-bank-link]'),null);view.reset();
});
test('partial receipts accumulate once; matching updates payment status but not revenue or workflow',async t=>{
  const {env,db}=setup(t),invoices=await invoiceIndex(env);assert.equal(invoices.length,1);
  assert.equal(await ingestTransactions(env,[tx()],invoices),1);assert.equal(await reconcile(env,invoices),1);
  let data=await readIncoming(env);assert.equal(data.invoices[0].received_minor,4015);assert.equal(data.invoices[0].status,'partial');
  assert.equal(await ingestTransactions(env,[tx()],invoices),0);assert.equal(await reconcile(env,invoices),0);
  await ingestTransactions(env,[tx('2','59.85')],invoices);await reconcile(env,invoices);data=await readIncoming(env,{orderId:'o1'});
  assert.equal(data.invoices[0].received_minor,10000);assert.equal(data.invoices[0].status,'paid');assert.equal(data.rows.length,2);
  const order=db.prepare('SELECT * FROM orders').get();assert.equal(order.revenue_uah,100);assert.equal(order.payment_status,'paid');assert.equal(order.status,'awaiting_payment');
});
test('duplicate invoice revisions deduplicate, but changed totals and identical numbers across orders are ambiguous',async t=>{
  const {env,addDocument}=setup(t);addDocument('doc2');let invoices=await invoiceIndex(env);assert.equal(invoices.length,1);
  const changed=fixtureDocument();changed.invoice.mode='custom';changed.invoice.amount='90.00';addDocument('doc3',changed);invoices=await invoiceIndex(env);assert.equal(invoices.length,2);
  await ingestTransactions(env,[tx()],invoices);await reconcile(env,invoices);const data=await readIncoming(env);assert.equal(data.rows[0].order_id,null);assert.equal(data.rows[0].review_reason,'ambiguous_invoice');
});
test('draft and agreement-only documents are not eligible invoices',async t=>{
  const {env,db,addDocument}=setup(t);db.exec('DELETE FROM order_documents');addDocument('draft',fixtureDocument(),'invoice','draft');addDocument('agreement',fixtureDocument(),'agreement');assert.equal((await invoiceIndex(env)).length,0);
});
test('overpayments, refunds and changed bank records require review, not a false paid badge',async t=>{
  const {env}=setup(t),invoices=await invoiceIndex(env);
  await ingestTransactions(env,[tx('1','100')],invoices);await reconcile(env,invoices);
  await ingestTransactions(env,[tx('2','1')],invoices);await reconcile(env,invoices);
  let data=await readIncoming(env);assert.equal(data.rows.find(r=>r.amount_minor===100).review_reason,'overpayment');assert.equal(data.invoices[0].status,'review');
  await ingestTransactions(env,[tx('3','10',{direction:'OUTBOUND'})],invoices);data=await readIncoming(env);assert.equal(data.rows.find(r=>r.direction==='OUTBOUND').review_reason,'possible_refund');
  await ingestTransactions(env,[tx('1','99')],invoices);data=await readIncoming(env);assert.equal(data.invoices[0].received_minor,0);assert.equal(data.rows.find(r=>r.amount_minor===10000).review_reason,'bank_record_changed');
});
test('bank facts survive deliberate order deletion and cannot be silently reassigned',async t=>{
  const {env,db}=setup(t),invoices=await invoiceIndex(env);await ingestTransactions(env,[tx()],invoices);await reconcile(env,invoices);
  db.prepare("DELETE FROM orders WHERE id='o1'").run();const row=db.prepare('SELECT * FROM bank_incoming').get();assert.equal(row.order_id,null);assert.equal(row.amount_minor,4015);assert.equal(row.review_reason,'order_deleted');
  assert.equal(await reconcile(env,[]),0);
});
test('synchronization retries safely, keeps cursor on failure, and respects cooldown/lease',async t=>{
  const {env,db}=setup(t);await connectBank(env,{username:'u',password:'p',start_date:kyivDay(),consent:true},'Owner',fakeBank());
  const calls=[];let result=await syncBank(env,{fetcher:fakeBank([rawTx()],calls)});assert.equal(result.imported,1);assert.equal(result.matched,1);
  const cursor=db.prepare('SELECT cursor_date FROM bank_connections').get().cursor_date;
  result=await syncBank(env,{fetcher:()=>{throw new Error('should not call');}});assert.equal(result.reason,'bank_cooldown');
  db.exec('UPDATE bank_connections SET last_attempt_at=NULL');
  await assert.rejects(syncBank(env,{fetcher:async()=>{throw new Error('secret provider error');}}),e=>e.message==='bank_network');
  const failed=db.prepare('SELECT * FROM bank_connections').get();assert.equal(failed.cursor_date,cursor);assert.equal(failed.lease_id,null);assert.equal(failed.last_error,'bank_network');
  db.exec('UPDATE bank_connections SET last_attempt_at=NULL');result=await syncBank(env,{fetcher:fakeBank([rawTx()])});assert.equal(result.imported,0);
  assert.equal((await readIncoming(env)).invoices[0].received_minor,4015);
});
test('API enforces owner-only setup, origin, authentication and dedicated cron secret',async t=>{
  const {env}=setup(t);
  assert.equal((await route({env,request:request(null,'wrong')})).status,401);
  assert.equal((await route({env,request:request({action:'pause'},'andrii-test')})).status,403);
  assert.equal((await route({env,request:request({action:'pause'},'owner-test',{origin:'https://evil.test'})})).status,403);
  const data=await (await route({env,request:request(null,'andrii-test')})).json();assert.equal(data.can_manage,false);
  assert.equal((await cron({env,request:request({action:'sync'},'owner-test')})).status,401);
  assert.equal((await cron({env,request:request({action:'sync'},'cron-test')})).status,200);
  const broken={...env,DB:{prepare(){throw new Error('sensitive SQL error');}}};const error=await route({env:broken,request:request()});assert.equal(error.status,503);assert.deepEqual(await error.json(),{error:'bank_unavailable'});
});
test('UI escapes bank content, hides setup for managers, clears password before request',async t=>{
  const {env}=setup(t),data=await readIncoming(env);data.can_manage=false;
  const dom=new JSDOM('<main></main>',{url:'https://evline.test'});t.after(()=>dom.window.close());const root=dom.window.document.querySelector('main');
  const calls=[];let pending;
  const view=createBankIncomingView(root,async(path,options)=>{if(!options)return data;calls.push(JSON.parse(options.body));assert.equal(root.querySelector('[name=password]').value,'');return new Promise(resolve=>pending=resolve);});
  await view.load();assert.equal(root.querySelector('form'),null);data.can_manage=true;await view.load();
  assert.equal(root.querySelector('[name=password]').type,'password');root.querySelector('[name=username]').value='test-login';root.querySelector('[name=password]').value='test-pass';root.querySelector('[name=consent]').checked=true;
  root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));assert.equal(calls.length,1);assert.equal(calls[0].password,'test-pass');view.reset();assert.equal(root.textContent,'');
  assert.doesNotMatch(invoiceTable([{number:'<img onerror=x>',order_id:'"onclick=x',amount_minor:1,received_minor:0,status:'unpaid'}]),/<img|onclick="x/);
  assert.doesNotMatch(paymentTable([{booked_at:'2026-10-20',payer_name:'<script>x</script>',purpose:'<img>',amount_minor:1}]),/<script>|<img>/);
});

test('OAuth errors are classified without provider descriptions or secret-shaped values',async()=>{
  const credentials={client_id:'secret-client',client_secret:'secret-client-key',username:'secret-login',password:'secret-password'};
  for(const [status,error,expected] of [[400,'invalid_grant','bank_login_rejected'],[401,'invalid_client','bank_client_rejected'],[400,'unauthorized_client','bank_client_rejected'],[400,'invalid_request','bank_auth_request'],[500,'server_error','bank_auth_unavailable'],[429,'invalid_grant','bank_rate_limit'],[400,'secret-provider-value','bank_auth_unavailable']]) {
    await assert.rejects(pumbSession(credentials,async()=>Response.json({error,error_description:JSON.stringify(credentials),access_token:'secret-token'},{status})),e=>{
      assert.equal(e.bankCode,expected);assert.equal(e.stage,'authorization');assert.equal(e.upstream_status,status);
      assert.doesNotMatch(JSON.stringify(e),/secret-/);return true;
    });
  }
  await assert.rejects(pumbSession(credentials,async()=>new Response('secret-'.repeat(2000),{status:500})),e=>e.bankCode==='bank_auth_unavailable' && e.oauth_code===null);
  for(const name of ['TimeoutError','TypeError'])await assert.rejects(pumbSession(credentials,async()=>{throw Object.assign(new Error('secret-url-and-body'),{name});}),e=>e.bankCode===(name==='TimeoutError'?'bank_timeout':'bank_network') && !JSON.stringify(e).includes('secret-'));
});

test('all bank redirects fail closed without following Location or exposing its contents',async()=>{
  const credentials={client_id:'c',client_secret:'s',username:'u',password:'p'};
  for(const status of [301,302,303,307,308]) {
    let calls=0;
    await assert.rejects(pumbSession(credentials,async(_url,options)=>{
      calls++;assert.equal(options.redirect,'manual');return new Response('secret-redirect-body',{status,headers:{Location:'https://untrusted.invalid/?secret-token'}});
    }),e=>e.bankCode==='bank_redirect' && e.stage==='authorization' && e.upstream_status===status && !JSON.stringify(e).includes('secret-'));
    assert.equal(calls,1);
  }
  let calls=0;const api=await pumbSession(credentials,async(_url,options)=>{
    calls++;assert.equal(options.redirect,'manual');return calls===1?Response.json({access_token:'secret-token'}):new Response(null,{status:307,headers:{Location:'https://untrusted.invalid/'}});
  });
  await assert.rejects(api('/account'),e=>e.bankCode==='bank_redirect' && e.stage==='accounts');assert.equal(calls,2);
});

test('failed connection records only safe metadata and preserves a working connection',async t=>{
  const {env,db}=setup(t),data={username:'secret-login',password:'secret-password',consent:true,start_date:kyivDay()};
  await connectBank(env,data,'Owner',fakeBank());
  const before=db.prepare('SELECT * FROM bank_connections').get();
  await assert.rejects(connectBank(env,data,'Owner',async()=>Response.json({error:'invalid_grant',error_description:'secret-password'},{status:400})),e=>{
    assert.equal(e.diagnostic.saved,true);assert.equal(e.diagnostic.stage,'authorization');assert.equal(e.diagnostic.upstream_status,400);return true;
  });
  assert.deepEqual(db.prepare('SELECT * FROM bank_connections').get(),before);
  const diagnostics=db.prepare("SELECT details_json FROM admin_audit_log WHERE action='bank.connect_diagnostic'").all();
  assert.equal(diagnostics.length,2);assert.doesNotMatch(JSON.stringify(diagnostics),/secret-|username|password|access_token|error_description/);
  const record=JSON.parse(diagnostics[1].details_json);
  assert.deepEqual(Object.keys(record).sort(),['id','at','stage','upstream_status','oauth_code','outcome','code','elapsed_ms'].sort());
  assert.equal(record.oauth_code,'invalid_grant');assert.ok(record.elapsed_ms>=0);
});

test('account-stage failures are distinguished from authorization and local save failures',async t=>{
  const {env}=setup(t),data={username:'u',password:'p',consent:true,start_date:kyivDay()};
  await assert.rejects(connectBank(env,data,'Owner',async url=>url.includes('/token')?Response.json({access_token:'secret-token'}):new Response('secret-bank-error',{status:500})),e=>e.bankCode==='bank_accounts_unavailable' && e.diagnostic.stage==='accounts' && e.diagnostic.upstream_status===500);
  await assert.rejects(connectBank({...env,PUMB_ENCRYPTION_KEY:'malformed'},data,'Owner',fakeBank()),e=>e.bankCode==='bank_encryption_failed' && e.diagnostic.stage==='encryption');
  const broken={...env,DB:{...env.DB,prepare(sql){if(sql.startsWith('UPDATE bank_connections'))throw new Error('secret-db-bindings');return env.DB.prepare(sql);}}};
  await assert.rejects(connectBank(broken,data,'Owner',fakeBank()),e=>e.bankCode==='bank_save_failed' && e.diagnostic.stage==='save' && !JSON.stringify(e).includes('secret-'));
});

test('failed diagnostic storage never logs raw errors or masks the connection failure',async t=>{
  const warns=t.mock.method(console,'warn',()=>{}),errors=t.mock.method(console,'error',()=>{});
  const {env}=setup(t),broken={...env,DB:{prepare(){throw new Error('secret-db-error');}}};
  await assert.rejects(connectBank(broken,{username:'u',password:'p',consent:true},'Owner',async()=>Response.json({error:'invalid_grant'},{status:400})),e=>e.bankCode==='bank_login_rejected' && e.diagnostic.saved===false);
  assert.equal(warns.mock.callCount(),0);assert.equal(errors.mock.callCount(),0);
});

test('diagnostics survive API error translation and refresh but are omitted for managers',async t=>{
  const {env}=setup(t);t.mock.method(globalThis,'fetch',async()=>Response.json({error:'invalid_grant',error_description:'secret-password'},{status:400}));
  const response=await route({env,request:request({action:'connect',username:'secret-login',password:'secret-password',consent:true})});
  assert.equal(response.status,503);const json=await response.clone().json();assert.doesNotMatch(JSON.stringify(json),/secret-/);
  const message=bankErrorMessage(await adminApiError(response));
  assert.match(message,/відхилив авторизацію користувача/);assert.match(message,/HTTP банку: 400/);assert.ok(message.includes(json.diagnostic.id));
  const owner=await (await route({env,request:request()})).json();assert.equal(owner.connect_diagnostic.id,json.diagnostic.id);
  const manager=await (await route({env,request:request(null,'andrii-test')})).json();assert.equal(manager.connect_diagnostic,undefined);
  const dom=new JSDOM('<main></main>');t.after(()=>dom.window.close());const root=dom.window.document.querySelector('main');
  const view=createBankIncomingView(root,async()=>owner);await view.load();assert.ok(root.querySelector('[data-bank-diagnostic]').textContent.includes(json.diagnostic.id));
  assert.equal(root.querySelector('[name=password]').value,'');view.reset();
});

test('diagnostic allowlist drops injected fields and provider-shaped strings on write and read',async t=>{
  const {env,db}=setup(t);
  const result=await saveConnectDiagnostic(env,{stage:'secret-stage',oauth_code:'secret-oauth',code:'secret-code',upstream_status:'secret-http',password:'secret-password',elapsed_ms:Infinity});
  assert.doesNotMatch(JSON.stringify(result),/secret-/);
  const corrupted={...result,username:'secret-login',stage:'secret-stage',oauth_code:'secret-token',code:'secret-code'};
  db.prepare('UPDATE admin_audit_log SET details_json=? WHERE id=?').run(JSON.stringify(corrupted),result.id);
  assert.doesNotMatch(JSON.stringify(await lastConnectDiagnostic(env)),/secret-/);
});

test('statement schema errors expose only allowlisted field and format, not bank values',async()=>{
  const accounts=bankAccounts([bankAccount]);
  for(const [extra,field,format] of [[{amount:'123.4500'},'amount','decimal_extra_zeroes'],[{amount:'123.4567'},'amount','decimal_extra_precision'],[{operationDate:'2026-10-20 12:34:56'},'operationDate','datetime_space'],[{hostId:null},'hostId','null'],[{currencyCode:'private-bank-value'},'currencyCode','other']]) {
    assert.throws(()=>bankTransactions([rawTx('1','1',extra)],accounts),e=>{
      assert.equal(e.schema_field,field);assert.equal(e.schema_format,format);assert.equal(e.stage,'transactions');
      assert.doesNotMatch(JSON.stringify(e),/private-bank-value|123\.45|12:34:56/);return true;
    });
  }
});

test('sync preserves safe schema diagnostics and does not advance the cursor on failure',async t=>{
  const {env,db}=setup(t);await connectBank(env,{username:'u',password:'p',consent:true},'Owner',fakeBank());
  const before=db.prepare('SELECT cursor_date FROM bank_connections').get().cursor_date;
  await assert.rejects(syncBank(env,{fetcher:fakeBank([rawTx('1','123.4567')])}),e=>e.schema_field==='amount' && e.schema_format==='decimal_extra_precision');
  assert.equal(db.prepare('SELECT cursor_date FROM bank_connections').get().cursor_date,before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_incoming').get().n,0);
});

test('posted transactions with a null ABS id use the exact documented docId',()=>{
  const accounts=bankAccounts([bankAccount]);
  const a=bankTransactions([rawTx(null,'42.50',{docId:'9223372036854775807'})],accounts)[0];
  assert.equal(a.transaction_id,'1:doc:9223372036854775807');assert.equal(a.amount_minor,4250);
  const b=bankTransactions([rawTx('777','42.50',{docId:'9223372036854775807'})],accounts)[0];
  assert.equal(a.transaction_id,b.transaction_id);assert.deepEqual(b.alternate_transaction_ids,['1:777']);
  assert.throws(()=>bankTransactions([rawTx(null,'42.50',{docId:null})],accounts));
  assert.throws(()=>bankTransactions([rawTx(null,'42.50',{docId:0})],accounts));
  assert.throws(()=>bankTransactions([rawTx(null,'42.50',{docId:9223372036854775807})],accounts));
  assert.notEqual(a.transaction_id,bankTransactions([rawTx('9223372036854775807','42.50')],accounts)[0].transaction_id);
});

test('document replay and a later ABS id never duplicate or flag an unchanged incoming payment',async t=>{
  const {env}=setup(t),accounts=bankAccounts([bankAccount]),invoices=await invoiceIndex(env);
  const first=bankTransactions([rawTx(null,'42.50',{docId:'999'})],accounts);
  const later=bankTransactions([rawTx('123','42.50',{docId:'999'})],accounts);
  assert.equal(await ingestTransactions(env,first,invoices),1);await reconcile(env,invoices);
  assert.equal(await ingestTransactions(env,later,invoices),0);
  assert.equal(await ingestTransactions(env,first,invoices),0);
  const data=await readIncoming(env);assert.equal(data.summary.count,1);assert.equal(data.summary.received_minor,4250);
  assert.equal(data.rows[0].review_reason,null);assert.equal(data.invoices[0].received_minor,4250);
});

test('legacy ABS identity is recognized when a document ID becomes available',async t=>{
  const {env}=setup(t),accounts=bankAccounts([bankAccount]),invoices=await invoiceIndex(env);
  await ingestTransactions(env,bankTransactions([rawTx('777','42.50')],accounts),invoices);
  assert.equal(await ingestTransactions(env,bankTransactions([rawTx('777','42.50',{docId:'999'})],accounts),invoices),0);
  const data=await readIncoming(env);assert.equal(data.summary.count,1);assert.equal(data.rows[0].review_reason,'bank_record_changed');
});
