import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as admin } from '../functions/api/admin/slavik-support.js';
import { onRequest as internal } from '../functions/api/internal/slavik-support-status.js';
import { onRequest as documents } from '../functions/api/admin/supplier-documents.js';
import { sendConnectionMessage } from '../functions/_lib/supplier-documents-telegram.js';
import { supportAvailable, readSupportStatus } from '../functions/_lib/slavik-support.js';

const secret='fixture_support_secret_0123456789abcdef_9876543210';
const session_id='82c9374c-b870-4ea7-a65d-68b65df9a996';
const expires_at='2099-10-17T00:00:00.000Z';
const link_expires_at='2099-10-15T00:10:00.000Z';
const empty={session_id:null,state:'none',expires_at:null,link_expires_at:null,pending:null};
const waiting={session_id,state:'waiting_start',expires_at,link_expires_at,pending:null};
const link=`https://t.me/slavik_office_bot?start=help_${'N'.repeat(43)}`;
const confirm={...waiting,state:'confirm',pending:{telegram_id:'1001',display_name:'Synthetic Andrii'}};
const user={id:'andrii',name:'Андрій'};
const baseEnv=()=>({ADMIN_TOKEN:'andrii-secret',ADMIN_USERS_JSON:JSON.stringify([{id:'owner',name:'Owner',token:'owner-secret'},{id:'ihor',name:'Ігор',token:'ihor-secret'}]),EVLINE_SUPPORT_CRM_SECRET:secret,TELEGRAM_BOT_TOKEN:'fixture-bot'});
function request(action,body,token='andrii-secret',options={}) {
  return new Request(`https://evline.test/api/admin/slavik-support${action?`?action=${action}`:''}`,{
    method:body===undefined?'GET':'POST',headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'content-type':'application/json'}),...options.headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),...options,
  });
}
function internalRequest(token=secret,options={}) {
  return new Request('https://evline.test/api/internal/slavik-support-status',{headers:{authorization:`Bearer ${token}`},...options});
}
function fixture(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE supplier_document_runtime(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE supplier_document_telegram(admin_id TEXT PRIMARY KEY,telegram_id TEXT,chat_id TEXT,display_name TEXT,created_at TEXT);
    CREATE TABLE supplier_document_pairings(admin_id TEXT PRIMARY KEY,token_hash TEXT,expires_at TEXT,telegram_id TEXT,display_name TEXT);`);
  let writes=0;
  const env={...baseEnv(),DB:{prepare(sql){const statement=db.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){writes++;return statement.run(...args);}};}}};
  const connect=(id='andrii',telegram='1001',created='2026-10-15T10:00:00.000Z')=>db.prepare('INSERT OR REPLACE INTO supplier_document_telegram VALUES(?,?,?,?,?)').run(id,telegram,telegram,'Private name',created);
  return {env,db,connect,writes:()=>writes};
}

test('support is disabled for weak/missing secrets and visible only to andrii',async t=>{
  for (const value of [undefined,'','short','a'.repeat(257),'has spaces'.repeat(8)]) {
    const env={...baseEnv(),EVLINE_SUPPORT_CRM_SECRET:value};
    assert.equal(supportAvailable(env,'andrii'),false);
    Object.defineProperty(env,'DB',{get(){assert.fail('disabled requests must not touch DB');}});
    t.mock.method(globalThis,'fetch',async()=>assert.fail('disabled request must not fetch'));
    assert.equal((await admin({env,request:request()})).status,503);
    assert.equal((await internal({env,request:internalRequest()})).status,401);
  }
  assert.equal(supportAvailable(baseEnv(),'andrii'),true);
  assert.equal(supportAvailable(baseEnv(),'owner'),false);
});
test('admin bridge rejects unauthenticated and every other admin before I/O',async t=>{
  const env=baseEnv();Object.defineProperty(env,'DB',{get(){assert.fail('no DB');}});
  t.mock.method(globalThis,'fetch',async()=>assert.fail('no fetch'));
  for (const token of ['', 'wrong']) assert.equal((await admin({env,request:request(undefined,undefined,token)})).status,401);
  for (const token of ['owner-secret','ihor-secret']) {
    assert.equal((await admin({env,request:request(undefined,undefined,token)})).status,403);
    assert.equal((await admin({env,request:request('connect',{},token)})).status,403);
  }
});
test('bridge uses fixed Worker routes and shared secret, never forwarding admin credentials or private response extras',async t=>{
  const env=baseEnv(),calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url:String(url),...options});
    const response=options.method==='GET'?empty:options.body.includes('telegram_id')?{...confirm,state:'active'}:options.body.includes('session_id')?{...waiting,state:'closed'}:{...waiting,link};
    return Response.json({...response,token_hash:'never_expose',admin_token:'never_expose',orders:['private']});
  });
  for (const [action,body,expectedRoute] of [[undefined,undefined,'session'],['connect',{},'session'],['confirm',{session_id,telegram_id:'1001'},'confirm'],['close',{session_id},'close']]) {
    const result=await admin({env,request:request(action,body)});assert.equal(result.status,200);
    assert.equal(result.headers.get('cache-control'),'no-store');
    const output=await result.json();assert.doesNotMatch(JSON.stringify(output),/never_expose|admin_token|token_hash|orders/);
    const call=calls.at(-1);
    assert.equal(call.url,`https://office-telegram-assistant.jv4043245.workers.dev/evline-support/crm/${expectedRoute}`);
    assert.equal(call.headers.authorization,`Bearer ${secret}`);assert.equal(call.redirect,'manual');
    assert.doesNotMatch(JSON.stringify(call),/andrii-secret|owner-secret|x-admin-token/);
    assert.equal(call.body,body===undefined?undefined:JSON.stringify(body));
  }
});
test('bridge validates exact action schemas, query strings and bounded JSON before external I/O',async t=>{
  const env=baseEnv();t.mock.method(globalThis,'fetch',async()=>assert.fail('invalid request fetched'));
  for (const [action,body] of [['connect',{chat_id:'1001'}],['connect',[]],['confirm',{session_id,telegram_id:1001}],['confirm',{session_id,telegram_id:'-1'}],['confirm',{session_id,telegram_id:'1001',url:'https://evil.test'}],['close',{session_id:'bad'}],['arbitrary',{}],['connect',null]]) {
    assert.equal((await admin({env,request:request(action,body)})).status,400);
  }
  for (const query of ['?action=status','?url=https://evil.test','?action=connect&action=close']) {
    assert.equal((await admin({env,request:new Request(`https://evline.test/api/admin/slavik-support${query}`,{headers:{authorization:'Bearer andrii-secret'}})})).status,400);
  }
  assert.equal((await admin({env,request:request('connect',{},'andrii-secret',{method:'PUT'})})).status,405);
  assert.equal((await admin({env,request:request('connect',{},'andrii-secret',{headers:{authorization:'Bearer andrii-secret','content-type':'text/plain'}})})).status,415);
  for (const body of ['{',JSON.stringify({padding:'x'.repeat(4200)})]) {
    const response=await admin({env,request:new Request('https://evline.test/api/admin/slavik-support?action=connect',{method:'POST',headers:{authorization:'Bearer andrii-secret','content-type':'application/json','content-length':'2'},body})});
    assert.equal(response.status,body==='{'?400:413);
  }
});
test('unsafe Worker links and responses are rejected; closed candidates and extras are redacted',async t=>{
  const env=baseEnv();let response;
  t.mock.method(globalThis,'fetch',async()=>Response.json(response));
  for (const unsafe of ['http://t.me/slavik_office_bot?start=help_'+'N'.repeat(43),link+'&redirect=https://evil.test',link.replace('slavik_office_bot','wrong_bot'),link+'#extra',link.replace('help_','sdlink_'),link.replace('https://t.me','https://t.me.evil.test')]) {
    response={...waiting,link:unsafe};assert.equal((await admin({env,request:request('connect',{})})).status,502);
  }
  for (const malformed of [{...waiting,state:'unknown'},{...waiting,session_id:12},{...confirm,pending:null},{...waiting,expires_at:'tomorrow'},{...empty,link}]) {
    response=malformed;assert.equal((await admin({env,request:request()})).status,502);
  }
  response={...confirm,state:'expired'};
  assert.equal((await (await admin({env,request:request()})).json()).pending,null);
  response={...confirm,pending:{telegram_id:'1001',display_name:'  Name\u0000\u202e  ',token:'private'}};
  assert.deepEqual((await (await admin({env,request:request()})).json()).pending,{telegram_id:'1001',display_name:'Name'});
});
test('upstream failures and malformed/oversized responses cannot expose credentials or internal errors',async t=>{
  const env=baseEnv();let status=500;
  t.mock.method(globalThis,'fetch',async()=>new Response(`${secret} private admin data`,{status}));
  for (status of [302,400,401,403,409,429,500,503]) {
    const result=await admin({env,request:request()});
    assert.equal(result.status,status===409?409:status===429?429:503);
    assert.doesNotMatch(await result.text(),/fixture_support|private admin/);
  }
  t.mock.method(globalThis,'fetch',async()=>new Response('x'.repeat(17000)));
  assert.equal((await admin({env,request:request()})).status,502);
  t.mock.method(globalThis,'fetch',async()=>{throw Error(secret);});
  assert.doesNotMatch(await (await admin({env,request:request()})).text(),/fixture_support/);
});
test('internal status accepts only shared secret and GET with no arguments; admin auth is insufficient',async t=>{
  const env=baseEnv();Object.defineProperty(env,'DB',{get(){assert.fail('invalid internal request touches DB');}});
  for (const token of ['', 'andrii-secret','owner-secret','w'.repeat(40)]) assert.equal((await internal({env,request:internalRequest(token)})).status,401);
  assert.equal((await internal({env,request:internalRequest(secret,{method:'POST'})})).status,405);
  assert.equal((await internal({env,request:new Request('https://evline.test/api/internal/slavik-support-status?admin_id=owner',{headers:{authorization:`Bearer ${secret}`}})})).status,400);
});
test('internal GET exposes only boolean status and pairing state, with no DB writes or external calls',async t=>{
  const{env,db,connect,writes}=fixture(t);connect();
  db.prepare('INSERT INTO supplier_document_pairings VALUES(?,?,?,?,?)').run('andrii','secret_hash',expires_at,'9002','Private candidate');
  db.prepare('INSERT INTO supplier_document_runtime VALUES(?,?)').run('cron_last_run_at',new Date().toISOString());
  t.mock.method(globalThis,'fetch',async()=>assert.fail('status must not fetch'));
  const response=await internal({env,request:internalRequest()});assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{connected:true,pairing_state:'confirm',control_message_sent:false,cron_ready:true});
  assert.equal(writes(),0);
  db.prepare('UPDATE supplier_document_pairings SET expires_at=?').run('2020-01-01T00:00:00.000Z');
  assert.equal((await readSupportStatus(env)).pairing_state,'expired');
  db.prepare('UPDATE supplier_document_pairings SET expires_at=?,telegram_id=NULL').run(expires_at);
  assert.equal((await readSupportStatus(env)).pairing_state,'waiting_start');
  db.prepare('DELETE FROM supplier_document_pairings').run();
  assert.equal((await readSupportStatus(env)).pairing_state,null);
});
test('successful own control delivery records digest receipt, not read status; new recipient/generation invalidates it',async t=>{
  const{env,db,connect}=fixture(t);connect();
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url:String(url),data:JSON.parse(options.body)});return Response.json({ok:true,result:{message_id:77}});});
  await sendConnectionMessage(env,user);
  assert.equal(calls.length,1);assert.equal(calls[0].data.chat_id,'1001');
  const receipt=JSON.parse(db.prepare('SELECT value FROM supplier_document_runtime').get().value);
  assert.match(receipt.recipient_digest,/^[0-9a-f]{64}$/);assert.ok(Date.parse(receipt.sent_at));
  assert.doesNotMatch(JSON.stringify(receipt),/Private name|telegram_id|chat_id|1001|message_id|read/);
  assert.equal((await readSupportStatus(env)).control_message_sent,true);
  connect('andrii','2002');assert.equal((await readSupportStatus(env)).control_message_sent,false);
  connect('andrii','1001','2026-10-15T10:00:01.000Z');assert.equal((await readSupportStatus(env)).control_message_sent,false);
  db.prepare('UPDATE supplier_document_runtime SET value=?').run('invalid');
  assert.equal((await readSupportStatus(env)).control_message_sent,false);
});
test('failed delivery never creates receipt; receipt failure cannot turn delivered connection message into an error',async t=>{
  const{env,db,connect}=fixture(t);connect();
  t.mock.method(globalThis,'fetch',async()=>Response.json({ok:false},{status:500}));
  await assert.rejects(()=>sendConnectionMessage(env,user));
  assert.equal(db.prepare('SELECT count(*) n FROM supplier_document_runtime').get().n,0);
  t.mock.method(globalThis,'fetch',async()=>Response.json({ok:true,result:{message_id:77}}));
  const prepare=env.DB.prepare;
  t.mock.method(env.DB,'prepare',sql=>{if(sql.startsWith('INSERT INTO supplier_document_runtime'))throw Error('storage failure');return prepare(sql);});
  await sendConnectionMessage(env,user);
  assert.equal((await readSupportStatus(env)).connected,true);
  assert.equal((await readSupportStatus(env)).control_message_sent,false);
});
test('setup feature flag stays private to andrii and absence of secret preserves old behavior',async t=>{
  const{env,connect,db}=fixture(t);connect('owner','3003');
  for (const [token,expected] of [['andrii-secret',true],['owner-secret',false],['ihor-secret',false]]) {
    const response=await documents({env,request:new Request('https://evline.test/api/admin/supplier-documents?action=setup',{headers:{authorization:`Bearer ${token}`}})});
    assert.equal(response.status,200);assert.equal((await response.json()).support_available,expected);
  }
  delete env.EVLINE_SUPPORT_CRM_SECRET;
  t.mock.method(globalThis,'fetch',async()=>Response.json({ok:true,result:{message_id:77}}));
  connect();await sendConnectionMessage(env,user);
  assert.equal(db.prepare('SELECT count(*) n FROM supplier_document_runtime').get().n,0);
});
