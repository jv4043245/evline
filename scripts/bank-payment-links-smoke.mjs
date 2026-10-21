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
import { onRequest as notifications } from '../functions/api/admin/bank-notifications.js';
import { orderPaymentButton } from '../admin/order-payment-picker.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root=path.resolve(import.meta.dirname,'..'),output='/tmp/evline-payment-links-browser';await mkdir(output,{recursive:true});
const nav=(await readFile(path.join(root,'admin/index.html'),'utf8')).match(/<nav class="admin-tabs"[\s\S]*?<\/nav>/)[0];
const columns=(await readFile(path.join(root,'admin/index.html'),'utf8')).match(/<colgroup>[\s\S]*?<\/colgroup>/)[0];
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
for(const file of (await readdir(path.join(root,'migrations'))).filter(f=>f.endsWith('.sql')).sort())db.exec(await readFile(path.join(root,'migrations',file),'utf8'));
const env={ADMIN_TOKEN:'synthetic-manager',ADMIN_OWNER_TOKEN:'synthetic-owner',DB:{prepare(sql){const statement=db.prepare(sql);let args=[];return {bind(...v){args=v;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:Number(statement.run(...args).changes)}};}};},async batch(statements){db.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}}};
db.exec("INSERT INTO orders(id,created_at,updated_at,type,status,order_number,customer_name,revenue_uah,payment_status) VALUES('test-order','2026-10-21','2026-10-21','parts','awaiting_payment','O-SMOKE','Тестовий Покупець',100,'unpaid')");
function seed(){db.exec("DELETE FROM bank_incoming;DELETE FROM bank_order_payment_state;UPDATE orders SET payment_status='unpaid'");for(const [id,amount] of [['p1',4000],['p2',6000]])db.prepare(`INSERT INTO bank_incoming(id,bank,transaction_id,account_id,account_iban,currency,amount_minor,direction,booked_at,payer_name,purpose,fingerprint,first_seen_at,review_reason)
  VALUES(?,'pumb',?,'synthetic','SYNTHETIC','UAH',?,'INBOUND',?,'Тестовий Покупець','Оплата товару <img src=x>','synthetic-fingerprint','2026-10-21','no_invoice')`).run(id,id,amount,kyivDay()+'T10:00:00');}
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(url.pathname==='/list-test'){
    res.setHeader('content-type','text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="uk"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/admin/admin.css"><link rel="stylesheet" href="/admin/bank-incoming.css"><body class="admin-shell"><main class="admin-main"><h2>Замовлення · ізольований тест</h2><div class="table-wrap"><table class="orders-table orders-table--manager"><thead><tr><th>№ / дата</th><th>Клієнт</th><th>Авто / запит</th><th>Статус</th><th>Сума</th><th>Трек</th><th>Дії</th></tr></thead><tbody data-orders><tr data-order-id="test-order"><td data-label="№ / дата">O-SMOKE</td><td data-label="Клієнт">Тестовий Покупець</td><td data-label="Авто / запит">Тестовий товар</td><td data-label="Статус">Очікує оплати</td><td data-label="Сума" id="payment-status">Не оплачено</td><td data-label="Трек">—</td><td data-label="Дії"><div class="orders-table__actions"><button class="admin-btn admin-btn--icon orders-table__open" type="button">✎</button><div class="orders-table__china-stack"><button class="admin-btn admin-btn--small orders-table__china" type="button">В Китай</button><button class="admin-btn admin-btn--icon orders-table__delete" type="button">×</button></div></div><button class="admin-link-button orders-table__payment" type="button" data-order-payment="test-order" aria-expanded="false">Прив’язати оплату ▾</button></td></tr></tbody></table></div></main><script type="module">
      import{createOrderPaymentPicker}from'/admin/order-payment-picker.js';
      const api=async(p,o={})=>{const r=await fetch(p,{...o,headers:{authorization:'Bearer synthetic-manager','content-type':'application/json'}});const j=await r.json();if(!r.ok)throw Error(j.error);return j};
      const table=document.querySelector('[data-orders]'),picker=createOrderPaymentPicker(table,api,{onLinked:o=>document.querySelector('#payment-status').textContent=o.payment_status});
      table.onclick=e=>{const b=e.target.closest('[data-order-payment]');if(b){picker.toggle(b);return;}if(e.target.closest('[data-order-payment-panel-row]'))return;window.unexpectedOrderOpen=true;};
    </script></body></html>`.replace('<thead>',columns+'<thead>').replace(/<button class="admin-link-button orders-table__payment"[\s\S]*?<\/button>/,orderPaymentButton('test-order','O-SMOKE')));return;
  }
  if(url.pathname==='/notifications-test'){
    res.setHeader('content-type','text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="uk"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/admin/admin.css"><link rel="stylesheet" href="/admin/bank-incoming.css"><body class="admin-shell"><main class="admin-main">${nav}<section id="orders"><h2>Замовлення · ізольований тест</h2><input id="draft" value="Незбережений текст"></section><section class="bank-incoming" id="bank" hidden></section></main><script type="module">
      import{createBankNotifications}from'/admin/bank-notifications.js';import{createBankIncomingView}from'/admin/bank-incoming.js';
      const token=new URLSearchParams(location.search).get('role')==='owner'?'synthetic-owner':'synthetic-manager';
      const api=async(p,o={})=>{const r=await fetch(p,{...o,headers:{authorization:'Bearer '+token,'content-type':'application/json'}});const j=await r.json();if(!r.ok)throw Error(j.error);return j};
      const n=createBankNotifications(document.querySelector('[data-bank-new-badge]'),api,{intervalMs:100});n.start();
      const root=document.querySelector('#bank'),view=createBankIncomingView(root,api,{onViewed:rows=>n.markSeen(rows)});
      document.querySelector('nav').onclick=async e=>{const button=e.target.closest('button');if(!button)return;const bank=button.dataset.adminTab==='bank-incoming';root.hidden=!bank;document.querySelector('#orders').hidden=bank;view.setActive(bank);for(const b of document.querySelectorAll('nav button'))b.setAttribute('aria-selected',String(b===button));if(bank)await view.load();};
    </script></body></html>`);return;
  }
  if(['/', '/order-test'].includes(url.pathname)) {res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="uk"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/admin/bank-incoming.css"><style>body{font:14px Arial;margin:12px}button,input,select{font:inherit}button{padding:8px;cursor:pointer}main{max-width:1200px;margin:auto}</style>${url.pathname==='/'?'<main class="bank-incoming"></main>':'<form id="order"><input name="note" value="Зберегти мій текст"><select name="payment_status"><option>partial</option><option>paid</option></select><main class="bank-order-summary"></main></form>'}<script type="module">import{createBankIncomingView,mountBankOrderSummary}from'/admin/bank-incoming.js';const api=async(p,o={})=>{const r=await fetch(p,{...o,headers:{authorization:'Bearer synthetic-manager','content-type':'application/json'}});const j=await r.json();if(!r.ok)throw new Error(j.error);return j};if(location.pathname==='/'){window.view=createBankIncomingView(document.querySelector('main'),api);await window.view.load();}else{document.querySelector('form').onsubmit=e=>{e.preventDefault();window.unexpectedSubmit=true};await mountBankOrderSummary(document.querySelector('main'),'test-order',api,{onLinked:o=>document.querySelector('[name=payment_status]').value=o.payment_status});}</script></html>`);return;}
  if(url.pathname.startsWith('/api/')){const chunks=[];for await(const c of req)chunks.push(c);const request=new Request(url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
    const response=await (url.pathname==='/api/admin/orders'?orders({env,request}):url.pathname==='/api/admin/bank-notifications'?notifications({env,request}):onRequest({env,request}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
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
}
for(const width of [1440,390,320]){
  seed();
  db.prepare(`INSERT INTO bank_incoming(id,bank,transaction_id,account_id,account_iban,currency,amount_minor,direction,booked_at,payer_name,purpose,fingerprint,first_seen_at,review_reason)
    SELECT 'old','pumb','old','test','TEST','UAH',100,'INBOUND',?,'Старий платник','Старий платіж','test',?,'no_invoice'`).run(new Date(Date.parse(kyivDay()+'T12:00:00Z')-7*86400000).toISOString().slice(0,10),new Date().toISOString());
  const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/list-test');
  const before=await page.locator('[data-order-id]').boundingBox();
  await page.locator('[data-order-payment]').click();await page.locator('[data-payment-choice]').first().waitFor();
  assert.equal(await page.locator('[data-orders] tr').count(),1);assert.equal(await page.locator('.order-payment-menu select').count(),0);assert.equal(await page.locator('[data-payment-choice]').count(),2);
  const after=await page.locator('[data-order-id]').boundingBox();assert.deepEqual(after,before);
  const menu=await page.locator('.order-payment-menu').boundingBox();assert.ok(menu.x>=0 && menu.x+menu.width<=width && menu.y>=0 && menu.y+menu.height<=1000);
  await page.screenshot({path:path.join(output,`list-picker-${width}.png`),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`list overflow ${width}`);
  await page.locator('[data-payment-choice=p1]').click();assert.equal(db.prepare("SELECT order_id FROM bank_incoming WHERE id='p1'").get().order_id,null);
  await page.locator('[data-payment-confirm]').click();
  await page.locator('.order-payment-menu__message').filter({hasText:'Оплату прив’язано'}).waitFor();assert.equal(await page.locator('#payment-status').textContent(),'partial');
  assert.equal(await page.locator('[data-payment-choice]').count(),1);assert.equal(await page.locator('[data-payment-choice=p1]').count(),0);
  await page.locator('[data-payment-choice=p2]').click();await page.screenshot({path:path.join(output,`list-confirm-${width}.png`),fullPage:true});
  await page.keyboard.press('Escape');assert.equal(await page.locator('.order-payment-menu').count(),0);assert.equal(await page.locator('[data-order-payment]').getAttribute('aria-expanded'),'false');
  await page.locator('[data-order-payment]').click();await page.locator('[data-payment-choice]').waitFor();await page.locator('h2').click();assert.equal(await page.locator('.order-payment-menu').count(),0);
  assert.equal(await page.evaluate(()=>Boolean(window.unexpectedOrderOpen)),false);assert.deepEqual(errors,[]);await context.close();
  console.log(`PASS ${width}px: order-list weekly picker, excludes old/linked receipts, explicit consent, live status, Escape, no unintended order open`);
}
for(const width of [1440,390,320]){
  seed();db.exec("UPDATE bank_connections SET enabled=1");
  const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/notifications-test');
  const badge=page.locator('[data-bank-new-badge]');await page.waitForFunction(()=>document.querySelector('[data-bank-new-badge]').textContent==='2');
  const insert=id=>db.prepare(`INSERT INTO bank_incoming(id,bank,transaction_id,account_id,account_iban,currency,amount_minor,direction,booked_at,payer_name,purpose,fingerprint,first_seen_at,review_reason)
    SELECT ?,'pumb',?,'test','TEST','UAH',100,'INBOUND',?,'Тестовий платник','Тестове надходження','test',?,'no_invoice'`).run(id,id,kyivDay()+'T11:00:00',new Date().toISOString());
  insert('p3');await page.waitForFunction(()=>document.querySelector('[data-bank-new-badge]').textContent==='3');
  const badgeBox=await badge.boundingBox();assert.ok(badgeBox.x>=0 && badgeBox.x+badgeBox.width<=width,`badge offscreen ${width}`);
  assert.equal(await page.locator('#draft').inputValue(),'Незбережений текст');
  await page.screenshot({path:path.join(output,`badge-${width}.png`),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`badge overflow ${width}`);
  const owner=await context.newPage();await owner.goto(origin+'/notifications-test?role=owner');
  await owner.locator('[data-admin-tab="bank-incoming"]').click();await owner.waitForFunction(()=>document.querySelector('[data-bank-new-badge]').dataset.state==='unassigned');
  assert.equal(await badge.getAttribute('data-state'),'new');assert.equal(await badge.textContent(),'3');
  await owner.locator('[data-admin-tab="orders"]').click();
  await page.locator('[data-admin-tab="bank-incoming"]').click();await page.waitForFunction(()=>document.querySelector('[data-bank-new-badge]').dataset.state==='unassigned');await page.locator('[data-bank-reload]').waitFor();
  assert.equal(await badge.textContent(),'3');assert.equal(await badge.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(219, 234, 254)');
  assert.equal(await page.locator('.bank-connection,.bank-setup,.bank-note').count(),0);
  assert.equal(await page.getByText('Рахунки клієнтам',{exact:true}).count(),0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_incoming WHERE order_id IS NOT NULL').get().n,0);
  await page.screenshot({path:path.join(output,`manager-bank-${width}.png`),fullPage:true});
  await page.locator('[data-admin-tab="orders"]').click();await page.screenshot({path:path.join(output,`badge-blue-${width}.png`),fullPage:true});
  insert('p4');await page.waitForFunction(()=>document.querySelector('[data-bank-new-badge]').textContent==='1');assert.equal(await badge.getAttribute('data-state'),'new');
  await page.locator('[data-admin-tab="bank-incoming"]').click();await page.waitForFunction(()=>document.querySelector('[data-bank-new-badge]').dataset.state==='unassigned' && document.querySelector('[data-bank-new-badge]').textContent==='4');
  db.exec("UPDATE bank_incoming SET order_id='test-order',review_reason=NULL");await badge.waitFor({state:'hidden'});
  assert.equal(await owner.locator('[data-bank-new-badge]').getAttribute('data-state'),'new');
  await owner.locator('[data-admin-tab="bank-incoming"]').click();await owner.locator('[data-bank-new-badge]').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);await context.close();
  console.log(`PASS ${width}px: independent owner/Andrii views, orange 3 → blue 3 → orange 1 → blue 4 → assigned → hidden; synthetic data only`);
}
}finally{await browser.close();await new Promise(r=>server.close(r));db.close();}
