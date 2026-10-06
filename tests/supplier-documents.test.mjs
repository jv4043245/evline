import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile,readdir } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { onRequest } from '../functions/api/admin/supplier-documents.js';
import { onRequestPost as cron } from '../functions/api/cron/supplier-documents.js';
import { uploadDocument,listDocuments,watchPayment,saveFollowup,documentVersion,selectedDocuments } from '../functions/_lib/supplier-documents.js';
import { handleSupplierDocumentsUpdate,createPairing,confirmPairing,dispatchSupplierReminders } from '../functions/_lib/supplier-documents-telegram.js';

const directory=new URL('../migrations/',import.meta.url);
const schemas=await Promise.all((await readdir(directory)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFile(new URL(f,directory),'utf8')));
const user={id:'andrii',name:'Андрій'},other={id:'ihor',name:'Ігор'};
const now=new Date().toISOString();
const file=(name='invoice.pdf',suffix='')=>new File([`%PDF-1.7\nSynthetic supplier document ${suffix}`],name,{type:'application/pdf'});
const meta={order_id:'order1',payment_id:'pay1',kind:'invoice',supplier_name:'BYD',reference:'CN-100'};
const privateMessage=(text,extra={})=>({message:{chat:{type:'private',id:1001},from:{id:1001,first_name:'Test manager'},message_id:12,text,...extra}});
async function fixture(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
  for(const schema of schemas) db.exec(schema);
  for(let i=1;i<=2;i++) {
    db.prepare('INSERT INTO orders(id,order_number,created_at,updated_at,status) VALUES(?,?,?,?,?)').run(`order${i}`,`O-00000${i}`,now,now,'paid');
    db.prepare('INSERT INTO supplier_payments(id,payment_number,order_id,created_at,updated_at,status,supplier_name,paid_at,paid_amount,requested_amount) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`pay${i}`,`P-00000${i}`,`order${i}`,now,now,'paid',i===1?'BYD':'Zeekr','2026-01-01T12:00:00.000Z',100,100);
  }
  const objects=new Map();
  const env={ADMIN_TOKEN:'test-admin',ADMIN_USERS_JSON:JSON.stringify([{...other,token:'test-ihor'}]),TELEGRAM_BOT_TOKEN:'test-bot',SUPPLIER_DOCS_CRON_TOKEN:'test-cron',
    DB:{prepare(sql){const stmt=db.prepare(sql);let values=[];const run=()=>({meta:{changes:Number(stmt.run(...values).changes)}});return{bind(...args){values=args;return this;},run:async()=>run(),_run:run,first:async()=>stmt.get(...values)||null,all:async()=>({results:stmt.all(...values)})};},async batch(statements){db.exec('BEGIN');try{const result=statements.map(s=>s._run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}},
    SUPPLIER_DOCUMENTS:{async put(key,bytes){objects.set(key,new Uint8Array(bytes));},async get(key){const bytes=objects.get(key);return bytes?{body:new Blob([bytes]).stream(),arrayBuffer:async()=>bytes.slice().buffer}:null;},async delete(key){objects.delete(key);}},
  };
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.match(String(url),/^https:\/\/api\.telegram\.org\/(bot|file\/bot)test-bot\//);
    calls.push({method:String(url).split('/').at(-1),body:options.body instanceof FormData?options.body:JSON.parse(options.body || '{}')});
    return Response.json({ok:true,result:String(url).endsWith('/getMe')?{username:'fixture_bot'}:{message_id:55}});
  });
  const request=async(action,data,params={},token='test-admin')=>onRequest({env,request:new Request(`https://evline.test/api/admin/supplier-documents?${new URLSearchParams({action,...params})}`,{
    method:data?'POST':'GET',headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(data instanceof FormData?{}:{'content-type':'application/json'})},body:data?(data instanceof FormData?data:JSON.stringify(data)):undefined,
  })});
  const connect=(adminId='andrii',telegramId='1001')=>db.prepare('INSERT INTO supplier_document_telegram VALUES(?,?,?,?,?)').run(adminId,telegramId,telegramId,'Test manager',now);
  return{db,env,objects,calls,request,connect};
}

test('authorization is required before DB, storage or parsing',async()=>{
  const env={ADMIN_TOKEN:'secret'};
  Object.defineProperty(env,'DB',{get(){assert.fail('must not access DB');}});
  for(const method of ['GET','POST']) for(const action of ['file','list','bundle','upload','confirm','send']) {
    const response=await onRequest({env,request:new Request(`https://test/?action=${action}`,{method,...(method==='POST'?{body:'invalid'}:{})})});
    assert.equal(response.status,401);
  }
});
test('upload preserves money/status; authenticated list never leaks object keys',async t=>{
  const{env,db,objects,request}=await fixture(t);
  const before=db.prepare('SELECT * FROM supplier_payments').all();
  const result=await uploadDocument(env,user,meta,file());
  assert.equal(objects.size,1);
  assert.deepEqual(db.prepare('SELECT * FROM supplier_payments').all(),before);
  assert.equal(db.prepare('SELECT count(*) n FROM supplier_payment_receipts').get().n,0);
  const response=await request('list',null,{order_id:'order1'}),list=await response.json();
  assert.equal(list.documents[0].id,result.id);assert.equal(list.followups[0].admin_id,user.id);
  assert.doesNotMatch(JSON.stringify(list),/object_key|test-admin|test-bot/);
  assert.equal(db.prepare("SELECT count(*) n FROM admin_audit_log WHERE action='supplier_document.upload'").get().n,1);
});
test('validates file bytes, size, order/payment relation, supplier and category',async t=>{
  const{env,objects}=await fixture(t);
  for(const [data,upload] of [[{...meta,kind:'receipt'},file()],[{...meta,payment_id:'pay2'},file()],[meta,new File(['<svg/>'],'image.pdf')],[meta,new File([new Uint8Array(10*1024*1024+1)],'large.pdf')]]) await assert.rejects(()=>uploadDocument(env,user,data,upload));
  assert.equal(objects.size,0);
  await assert.rejects(()=>uploadDocument({...env,SUPPLIER_DOCUMENTS:null},user,meta,file()),/сховище/);
});
test('HTTP multipart upload is bounded and uses admin identity, not caller actor',async t=>{
  const{env,db,request}=await fixture(t);
  const form=new FormData();for(const[key,value]of Object.entries(meta))form.set(key,value);
  form.set('file',file());form.set('created_by','spoofed');
  const response=await request('upload',form);assert.equal(response.status,200);
  assert.equal(db.prepare('SELECT created_by FROM supplier_documents').get().created_by,'andrii');
  const enormous=new FormData();enormous.set('file',new File([new Uint8Array(11*1024*1024)],'large.pdf'));
  assert.equal((await request('upload',enormous)).status,413);
  assert.equal(db.prepare('SELECT count(*) n FROM supplier_documents').get().n,1);
});
test('storage or DB errors cannot create partial metadata or leak private keys',async t=>{
  const{env,objects,db}=await fixture(t);
  const batch=env.DB.batch;
  env.DB.batch=async()=>{throw new Error('synthetic database outage');};
  await assert.rejects(()=>uploadDocument(env,user,meta,file()),/outage/);
  assert.equal(objects.size,0);assert.equal(db.prepare('SELECT count(*) n FROM supplier_documents').get().n,0);
  env.DB.batch=batch;
});
test('versions preserve originals and reject concurrent stale edits without leaking an orphan',async t=>{
  const{env,objects}=await fixture(t);
  const d=await uploadDocument(env,user,meta,file());
  await uploadDocument(env,user,{...meta,document_id:d.id,version:1},file('second.pdf','updated'));
  assert.equal(objects.size,2);
  assert.equal((await documentVersion(env,'order1',d.id,1)).filename,'invoice.pdf');
  assert.equal((await documentVersion(env,'order1',d.id)).version,2);
  await assert.rejects(()=>uploadDocument(env,user,{...meta,document_id:d.id,version:1},file()),/інший менеджер/);
  assert.equal(objects.size,2);
});
test('same file and same Telegram update are idempotent',async t=>{
  const{env,objects}=await fixture(t);
  const d=await uploadDocument(env,user,meta,file(),'telegram:1001:12');
  assert.equal((await uploadDocument(env,user,meta,file(),'telegram:1001:12')).duplicate,true);
  assert.equal((await uploadDocument(env,user,meta,file())).id,d.id);
  assert.equal(objects.size,1);
});
test('one original can be linked to two orders; archive is reversible; order deletion preserves shared files',async t=>{
  const{env,db,request,objects}=await fixture(t);
  const d=await uploadDocument(env,user,meta,file());
  assert.equal((await request('link',{id:d.id,order_id:'order2',payment_id:'pay2'})).status,400);
  assert.equal((await request('link',{id:d.id,order_id:'order2'})).status,200);
  assert.equal((await listDocuments(env,'order2'))[0].linked_orders,2);
  await request('archive',{id:d.id,order_id:'order1'});
  await assert.rejects(()=>selectedDocuments(env,'order1',[d.id]),/не належить/);
  await request('restore',{id:d.id,order_id:'order1'});
  assert.equal((await selectedDocuments(env,'order1',[d.id])).length,1);
  db.prepare('DELETE FROM supplier_payments WHERE id=?').run('pay1');
  db.prepare('DELETE FROM orders WHERE id=?').run('order1');
  assert.equal((await listDocuments(env,'order2')).length,1);assert.equal(objects.size,1);
});
test('download and ZIP contain only selected, linked documents; no public URLs',async t=>{
  const{env,request}=await fixture(t);
  const d=await uploadDocument(env,user,meta,file('../../invoice.pdf'));
  assert.equal((await request('file',null,{order_id:'order2',id:d.id})).status,404);
  const download=await request('file',null,{order_id:'order1',id:d.id});
  assert.equal(download.headers.get('cache-control'),'private, no-store');
  assert.equal(download.headers.get('x-content-type-options'),'nosniff');
  assert.match(download.headers.get('content-security-policy'),/sandbox/);
  const zip=await request('bundle',{order_id:'order1',ids:[d.id]});
  assert.equal(zip.status,200);
  const contents=unzipSync(new Uint8Array(await zip.arrayBuffer()));
  assert.equal(Object.keys(contents).length,1);
  assert.doesNotMatch(Object.keys(contents)[0],/\.\.\//);
  assert.match(new TextDecoder().decode(Object.values(contents)[0]),/Synthetic supplier document/);
  assert.equal((await request('bundle',{order_id:'order1',ids:[d.id,d.id]})).status,400);
});
test('Drive originals work through authenticated upload, versions, ZIP and Telegram without R2',async t=>{
  const { env,request,db,connect,calls }=await fixture(t);
  env.SUPPLIER_DOCUMENTS=null;
  Object.assign(env,{GOOGLE_DRIVE_CLIENT_ID:'test-client',GOOGLE_DRIVE_CLIENT_SECRET:'test-drive-secret',GOOGLE_DRIVE_REFRESH_TOKEN:'test-refresh',GOOGLE_DRIVE_FOLDER_ID:'folder_private_12345'});
  const originals=new Map(),staged=new Map();let count=0;
  const telegram=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    url=new URL(url);
    if(url.hostname==='api.telegram.org') return telegram(url,options);
    if(url.hostname==='oauth2.googleapis.com') return Response.json({access_token:'drive-access',expires_in:3600});
    assert.equal(url.hostname,'www.googleapis.com');
    assert.equal(options.headers.authorization,'Bearer drive-access');
    if(url.pathname.endsWith('/folder_private_12345')) return Response.json({mimeType:'application/vnd.google-apps.folder',permissions:[{type:'user'}]});
    if(url.pathname.endsWith('/generateIds')) return Response.json({ids:[`drive_original_${++count}`]});
    if(url.searchParams.get('uploadType')==='resumable') {
      const data=JSON.parse(options.body);staged.set(data.id,data);
      return new Response(null,{headers:{location:`https://www.googleapis.com/upload/drive/v3/files?upload_id=${data.id}`}});
    }
    if(url.searchParams.has('upload_id')) {
      const id=url.searchParams.get('upload_id');originals.set(id,{...staged.get(id),bytes:new Uint8Array(options.body)});
      return Response.json({id});
    }
    const original=originals.get(url.pathname.split('/').at(-1));assert.ok(original);
    if(options.method==='PATCH') {original.trashed=true;return Response.json({id:original.id});}
    if(url.searchParams.get('alt')==='media') return new Response(original.bytes);
    return Response.json({...original,bytes:undefined,size:String(original.bytes.length),permissions:[{type:'user'}]});
  });
  const form=new FormData();for(const [key,value]of Object.entries(meta))form.set(key,value);form.set('file',file());
  const d=await (await request('upload',form)).json();assert.ok(d.ok);
  assert.match(db.prepare('SELECT object_key FROM supplier_document_versions').get().object_key,/^gdrive:/);
  await uploadDocument(env,user,{...meta,document_id:d.id,version:1},file('new.pdf','updated'));
  assert.equal(originals.size,2);
  assert.match(await (await request('file',null,{order_id:'order1',id:d.id,version:'1'})).text(),/Synthetic/);
  const archive=await request('bundle',{order_id:'order1',ids:[d.id]});
  assert.match(new TextDecoder().decode(Object.values(unzipSync(new Uint8Array(await archive.arrayBuffer())))[0]),/updated/);
  connect();assert.deepEqual((await (await request('send',{order_id:'order1',ids:[d.id]})).json()).sent,[d.id]);
  assert.equal(calls.find(c=>c.method==='sendDocument').body.get('chat_id'),'1001');
  const setup=await (await request('setup')).json();assert.equal(setup.storage_ready,true);assert.equal(setup.storage_provider,'google_drive');
  assert.doesNotMatch(JSON.stringify(setup),/test-drive-secret|test-refresh|folder_private/);
  assert.doesNotMatch(await (await request('list',null,{order_id:'order1'})).text(),/gdrive:|drive_original/);
  const batch=env.DB.batch;env.DB.batch=async()=>{throw new Error('synthetic database outage');};
  await assert.rejects(()=>uploadDocument(env,user,meta,file('orphan.pdf','orphan')),/outage/);
  env.DB.batch=batch;
  assert.equal(originals.get('drive_original_3').trashed,true);
  assert.equal(db.prepare('SELECT count(*) n FROM supplier_document_versions').get().n,2);
});
test('manager pairing is one-use, expires and requires matching admin confirmation',async t=>{
  const{env,db,request}=await fixture(t);
  const {link}=await createPairing(env,user);
  const parameter=new URL(link).searchParams.get('start');
  assert.equal((await handleSupplierDocumentsUpdate(env,privateMessage(`/start ${parameter}`))).handled,true);
  assert.equal(db.prepare('SELECT count(*) n FROM supplier_document_telegram').get().n,0);
  assert.equal((await request('confirm',{telegram_id:'9999'})).status,409);
  await confirmPairing(env,user,'1001');
  assert.equal(db.prepare('SELECT chat_id FROM supplier_document_telegram').get().chat_id,'1001');
  await assert.rejects(()=>confirmPairing(env,user,'1001'));
  assert.equal(db.prepare('SELECT count(*) n FROM supplier_document_pairings').get().n,0);
});
test('send ignores caller-selected chat and sends only to current authenticated manager',async t=>{
  const{env,connect,request,calls}=await fixture(t);connect();
  const d=await uploadDocument(env,user,meta,file());
  const result=await (await request('send',{order_id:'order1',ids:[d.id],chat_id:'evil-destination'})).json();
  assert.deepEqual(result.sent,[d.id]);
  assert.equal(calls.find(c=>c.method==='sendDocument').body.get('chat_id'),'1001');
  assert.equal((await request('send',{order_id:'order1',ids:[d.id]}, {},'test-ihor')).status,400);
  await request('disconnect',{});
  assert.equal((await request('send',{order_id:'order1',ids:[d.id]})).status,400);
});
test('foreign group/payment/business updates are not document intake',async t=>{
  const{env}=await fixture(t);
  for(const update of [{message:{chat:{id:-100,type:'supergroup'},from:{id:1001},document:{file_id:'x'}}},{business_message:{chat:{id:1001,type:'private'},from:{id:1001}}},privateMessage('unrelated')]) assert.equal((await handleSupplierDocumentsUpdate(env,update)).handled,false);
});
for(const table of ['supplier_document_telegram','supplier_document_intakes']) {
  test(`routing failure in ${table} cannot turn an invoice into a payment receipt`,async t=>{
    const{env,db,connect,calls,objects}=await fixture(t);connect();
    const before=db.prepare('SELECT * FROM supplier_payments').all();
    const prepare=env.DB.prepare;
    t.mock.method(env.DB,'prepare',function(sql){
      if(sql.includes(`FROM ${table}`)) throw new Error('synthetic routing outage');
      return prepare.call(this,sql);
    });
    const result=await handleSupplierDocumentsUpdate(env,privateMessage(undefined,{photo:[{file_id:'invoice-photo'}]}));
    assert.deepEqual(result,{handled:true,error:true});
    assert.deepEqual(calls.map(c=>c.method),['sendMessage']);
    assert.doesNotMatch(calls[0].body.text,/synthetic|outage/);
    assert.equal(objects.size,0);
    assert.deepEqual(db.prepare('SELECT * FROM supplier_payments').all(),before);
    assert.equal(db.prepare('SELECT count(*) n FROM supplier_payment_receipts').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM supplier_documents').get().n,0);
  });
}
test('intake requires own explicit order/category and will not take over an active lead draft',async t=>{
  const{env,db,connect,request}=await fixture(t);connect();
  const response=await request('intake',meta);assert.equal(response.status,200);
  const parameter=new URL((await response.json()).link).searchParams.get('start');
  db.prepare("INSERT INTO screenshot_intake_managers(telegram_id,username,display_name,status,requested_at,updated_at) VALUES('1001','test','Test','approved',?,?)").run(now,now);
  db.prepare("INSERT INTO screenshot_intake_drafts(id,manager_id,chat_id,channel,active_manager_id,created_at,updated_at,expires_at) VALUES('draft','1001','1001','other','1001',?,?,?)").run(now,now,'2099-01-01');
  await handleSupplierDocumentsUpdate(env,privateMessage(`/start ${parameter}`));
  assert.equal(db.prepare('SELECT active FROM supplier_document_intakes').get().active,0);
  db.prepare("UPDATE screenshot_intake_drafts SET status='canceled',active_manager_id=NULL").run();
  await handleSupplierDocumentsUpdate(env,privateMessage(`/start ${parameter}`));
  assert.equal(db.prepare('SELECT active FROM supplier_document_intakes').get().active,1);
  assert.equal((await handleSupplierDocumentsUpdate(env,privateMessage('/intake'))).handled,true);
  await handleSupplierDocumentsUpdate(env,privateMessage('/docs_done'));
  assert.equal(db.prepare('SELECT count(*) n FROM supplier_document_intakes').get().n,0);
});
test('Telegram file intake is deduplicated and does not change payment amounts',async t=>{
  const{env,db,connect,request,objects}=await fixture(t);connect();
  const parameter=new URL((await (await request('intake',meta)).json()).link).searchParams.get('start');
  await handleSupplierDocumentsUpdate(env,privateMessage(`/start ${parameter}`));
  t.mock.method(globalThis,'fetch',async(url,options)=>String(url).includes('/file/bot') ? new Response('%PDF-1.7\ntelegram invoice') : Response.json({ok:true,result:String(url).endsWith('/getFile')?{file_path:'documents/file_1.pdf'}:{message_id:77}}));
  const message=privateMessage(undefined,{document:{file_id:'test-file',file_name:'invoice.pdf'}});
  await handleSupplierDocumentsUpdate(env,message);await handleSupplierDocumentsUpdate(env,message);
  assert.equal(objects.size,1);assert.equal(db.prepare('SELECT paid_amount FROM supplier_payments WHERE id=?').get('pay1').paid_amount,100);
});
test('five-day reminders are assigned, claimed once, postponed, and stopped by shipment',async t=>{
  const{env,db,connect,calls}=await fixture(t);connect();
  await uploadDocument(env,user,meta,file());
  assert.equal((await dispatchSupplierReminders(env,'2026-01-05T11:59:00.000Z')).sent,0);
  assert.equal((await dispatchSupplierReminders(env,'2026-01-06T12:00:00.000Z')).sent,1);
  assert.equal(calls.filter(c=>c.method==='sendDocument').length,1);
  assert.equal((await dispatchSupplierReminders(env,'2026-01-07T12:00:00.000Z')).sent,0);
  await saveFollowup(env,user,{order_id:'order1',payment_id:'pay1',state:'waiting',due_at:'2026-01-10',asked:true});
  assert.equal((await dispatchSupplierReminders(env,'2026-01-09T12:00:00.000Z')).sent,0);
  db.prepare("UPDATE orders SET status='china_warehouse' WHERE id='order1'").run();
  assert.equal((await dispatchSupplierReminders(env,'2026-01-11T12:00:00.000Z')).sent,0);
});
test('no reminders for unpaired/revoked manager, unpaid, paused or individually shipped payment',async t=>{
  const{env,db,connect}=await fixture(t);
  await watchPayment(env,'pay1',user.id);
  assert.equal((await dispatchSupplierReminders(env,now)).sent,0);connect();
  for(const status of ['requested','partial','needs_review','canceled']) {
    db.prepare('UPDATE supplier_payments SET status=? WHERE id=?').run(status,'pay1');
    assert.equal((await dispatchSupplierReminders(env,now)).sent,0);
  }
  db.prepare("UPDATE supplier_payments SET status='paid' WHERE id='pay1'").run();
  for(const state of ['paused','shipped']) {
    await saveFollowup(env,user,{order_id:'order1',payment_id:'pay1',state});
    assert.equal((await dispatchSupplierReminders(env,now)).sent,0);
  }
  await saveFollowup(env,user,{order_id:'order1',payment_id:'pay1',state:'waiting'});
  env.ADMIN_TOKEN='';assert.equal((await dispatchSupplierReminders(env,now)).sent,0);
});
test('uncertain send does not auto-retry; errors do not expose bot credentials',async t=>{
  const{env,db,connect,request}=await fixture(t);connect();await watchPayment(env,'pay1',user.id);
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('https://api.telegram.org/bottest-bot/sendDocument');});
  assert.equal((await dispatchSupplierReminders(env,now)).failed,1);
  assert.equal(db.prepare('SELECT state FROM supplier_document_followups').get().state,'failed');
  assert.equal((await dispatchSupplierReminders(env,now)).failed,0);
  const response=await request('connect',{});assert.doesNotMatch(await response.text(),/test-bot/);
});
test('cron endpoint denies absent and wrong credentials',async t=>{
  const{env}=await fixture(t);
  for(const token of ['', 'bad']) assert.equal((await cron({env,request:new Request('https://test/cron',{method:'POST',headers:{authorization:`Bearer ${token}`}})})).status,401);
  assert.equal((await cron({env,request:new Request('https://test/cron',{method:'POST',headers:{authorization:'Bearer test-cron'}})})).status,200);
});
test('eligible managers are not starved by old unpaired reminders and stale sends need manual retry',async t=>{
  const{env,db,connect}=await fixture(t);connect('ihor','1002');
  await watchPayment(env,'pay1','andrii');await watchPayment(env,'pay2','ihor');
  assert.equal((await dispatchSupplierReminders(env,now)).sent,1);
  assert.equal(db.prepare("SELECT state FROM supplier_document_followups WHERE payment_id='pay1'").get().state,'waiting');
  db.prepare("UPDATE supplier_document_followups SET state='sending',last_attempt_at='2026-01-01' WHERE payment_id='pay2'").run();
  assert.equal((await dispatchSupplierReminders(env,now)).sent,0);
  assert.equal(db.prepare("SELECT state FROM supplier_document_followups WHERE payment_id='pay2'").get().state,'failed');
});
