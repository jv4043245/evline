// Isolated synthetic browser test. No bank, production data, login or outbound requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/admin/bank-incoming.js';
import { onRequestGet as orders } from '../functions/api/admin/orders.js';
import { kyivDay } from '../functions/_lib/bank-incoming.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root=path.resolve(import.meta.dirname,'..'),output='/tmp/evline-payment-links-browser';await mkdir(output,{recursive:true});
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
for(const file of (await readdir(path.join(root,'migrations'))).filter(f=>f.endsWith('.sql')).sort())db.exec(await readFile(path.join(root,'migrations',file),'utf8'));
const env={ADMIN_TOKEN:'synthetic-manager',ADMIN_OWNER_TOKEN:'synthetic-owner',DB:{prepare(sql){const statement=db.prepare(sql);let args=[];return {bind(...v){args=v;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:Number(statement.run(...args).changes)}};}};},async batch(statements){db.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}}};
db.exec("INSERT INTO orders(id,created_at,updated_at,type,status,order_number,customer_name,revenue_uah,payment_status) VALUES('test-order','2026-10-21','2026-10-21','parts','awaiting_payment','O-SMOKE','Тестовий Покупець',100,'unpaid')");
function seed(){db.exec("DELETE FROM bank_incoming;DELETE FROM bank_order_payment_state;UPDATE orders SET payment_status='unpaid'");for(const [id,amount] of [['p1',4000],['p2',6000]])db.prepare(`INSERT INTO bank_incoming(id,bank,transaction_id,account_id,account_iban,currency,amount_minor,direction,booked_at,payer_name,purpose,fingerprint,first_seen_at,review_reason)
  VALUES(?,'pumb',?,'synthetic','SYNTHETIC','UAH',?,'INBOUND',?,'Тестовий Покупець','Оплата товару <img src=x>','synthetic-fingerprint','2026-10-21','no_invoice')`).run(id,id,amount,kyivDay()+'T10:00:00');}
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(['/', '/order-test'].includes(url.pathname)) {res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="uk"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/admin/bank-incoming.css"><style>body{font:14px Arial;margin:12px}button,input,select{font:inherit}button{padding:8px;cursor:pointer}main{max-width:1200px;margin:auto}</style>${url.pathname==='/'?'<main class="bank-incoming"></main>':'<form id="order"><input name="note" value="Зберегти мій текст"><select name="payment_status"><option>partial</option><option>paid</option></select><main class="bank-order-summary"></main></form>'}<script type="module">import{createBankIncomingView,mountBankOrderSummary}from'/admin/bank-incoming.js';const api=async(p,o={})=>{const r=await fetch(p,{...o,headers:{authorization:'Bearer synthetic-manager','content-type':'application/json'}});const j=await r.json();if(!r.ok)throw new Error(j.error);return j};if(location.pathname==='/'){window.view=createBankIncomingView(document.querySelector('main'),api);await window.view.load();}else{document.querySelector('form').onsubmit=e=>{e.preventDefault();window.unexpectedSubmit=true};await mountBankOrderSummary(document.querySelector('main'),'test-order',api,{onLinked:o=>document.querySelector('[name=payment_status]').value=o.payment_status});}</script></html>`);return;}
  if(url.pathname.startsWith('/api/')){const chunks=[];for await(const c of req)chunks.push(c);const request=new Request(url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
    const response=await (url.pathname==='/api/admin/orders'?orders({env,request}):onRequest({env,request}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))throw new Error('outside root');res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(file));
}catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {for(const width of [1440,390,320]){
  seed();const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('[data-bank-link="p1"]').waitFor();
  assert.equal(await page.locator('img').count(),0);
  assert.equal(await page.locator('[data-bank-connect]').count(),0);
  for(const id of ['p1']){
    await page.locator(`[data-bank-row-order="${id}"]`).selectOption('test-order');await page.locator('[data-bank-confirm]').waitFor();
    assert.equal(db.prepare('SELECT order_id FROM bank_incoming WHERE id=?').get(id).order_id,null);
    await page.locator(`[data-bank-link-panel="${id}"]`).scrollIntoViewIfNeeded();
    if(id==='p1')await page.screenshot({path:path.join(output,`confirm-${width}.png`),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);
    await page.locator('[name=confirmed]').check();await page.locator('[data-bank-confirm] button').click();await page.locator('[data-bank-message]').filter({hasText:'Платіж прив’язано'}).waitFor();
    assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,id==='p1'?'partial':'paid');
  }
  await page.goto(origin+'/order-test');await page.locator('[data-order-bank-payment]').waitFor();
  assert.equal(await page.locator('form form').count(),0);
  await page.locator('[data-order-bank-payment]').selectOption('p2');
  await page.locator('[data-order-bank-link]').click();assert.equal(db.prepare('SELECT order_id FROM bank_incoming WHERE id=?').get('p2').order_id,null);
  await page.locator('[data-order-bank-confirmed]').check();
  await page.screenshot({path:path.join(output,`order-confirm-${width}.png`),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`order overflow ${width}`);
  await page.locator('[data-order-bank-link]').click();await page.locator('[data-order-bank-message]').filter({hasText:'Платіж прив’язано'}).waitFor();
  assert.equal(await page.locator('[name=payment_status]').inputValue(),'paid');assert.equal(await page.locator('[name=note]').inputValue(),'Зберегти мій текст');
  assert.equal(await page.evaluate(()=>Boolean(window.unexpectedSubmit)),false);
  assert.equal(db.prepare('SELECT payment_status FROM orders').get().payment_status,'paid');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='bank.payment_link' AND order_id='test-order'").get().n%2,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_incoming').get().n,2);assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px: Andrii, inline order and receipt pickers, explicit consent, partial → paid, preserved form, no overflow, no external requests`);
}}finally{await browser.close();await new Promise(r=>server.close(r));db.close();}
