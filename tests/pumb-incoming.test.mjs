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
import { createBankIncomingView, invoiceTable, paymentTable, bankErrorMessage } from '../admin/bank-incoming.js';
import { lastConnectDiagnostic, saveConnectDiagnostic } from '../functions/_lib/bank-diagnostics.js';
import { adminApiError } from '../assets/js/admin-api-errors.js';

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
test('partial receipts accumulate once; matching does not change manual order finance or status',async t=>{
  const {env,db}=setup(t),invoices=await invoiceIndex(env);assert.equal(invoices.length,1);
  assert.equal(await ingestTransactions(env,[tx()],invoices),1);assert.equal(await reconcile(env,invoices),1);
  let data=await readIncoming(env);assert.equal(data.invoices[0].received_minor,4015);assert.equal(data.invoices[0].status,'partial');
  assert.equal(await ingestTransactions(env,[tx()],invoices),0);assert.equal(await reconcile(env,invoices),0);
  await ingestTransactions(env,[tx('2','59.85')],invoices);await reconcile(env,invoices);data=await readIncoming(env,{orderId:'o1'});
  assert.equal(data.invoices[0].received_minor,10000);assert.equal(data.invoices[0].status,'paid');assert.equal(data.rows.length,2);
  const order=db.prepare('SELECT * FROM orders').get();assert.equal(order.revenue_uah,100);assert.equal(order.payment_status,'unpaid');assert.equal(order.status,'awaiting_payment');
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
