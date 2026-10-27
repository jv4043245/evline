import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as model from '../admin/documents/model.js';
import * as render from '../admin/documents/render.js';
import * as delivery from '../admin/documents/delivery.js';
import { amountWords } from '../admin/documents/amount-words.js';
import { icon } from '../admin/documents/icons.js';

const html = await readFile(new URL('../admin/documents/index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../admin/documents/documents.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i=0;i<80;i++) { if(predicate())return; await tick(); } assert.ok(predicate(), 'UI settled'); }
async function fixture(t, { connected=true, share=true, standalone=false }={}) {
  const dom = new JSDOM(html, {url:`https://example.test/admin/documents/?${standalone?'invoice=00000000-0000-4000-8000-000000000001':'order=test-order'}`,runScripts:'outside-only'});
  const w=dom.window,q=s=>w.document.querySelector(s),calls=[],links=[],shares=[],pdfs=[],popups=[];
  t.after(()=>w.close());
  Object.assign(w,model,render,delivery,{esc:model.escapeHtml,amountWords,icon,structuredClone,adminApiError:async r=>(await r.json()).error});
  w.ResizeObserver=class {observe(){}}; w.URL.createObjectURL=()=> 'blob:synthetic-pdf'; w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){links.push({href:this.href,download:this.download});};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.open=()=>{const popup={location:{},close(){}};popups.push(popup);return popup;};
  w.pdfMake={createPdf:def=>({getBlob(callback,options){pdfs.push({def,options});callback(new w.Blob(['%PDF-synthetic'],{type:'application/pdf'}));}})};
  if(share) {w.navigator.canShare=()=>true;w.navigator.share=async payload=>{shares.push(payload);};}
  const defaults=model.fromOrder({id:'test-order',order_number:'O-TEST',customer_name:'Тестовий покупець',customer_phone:'+380000000001',customer_email:'test@example.invalid',item_name:'Бампер',revenue_uah:2000});
  const body='3000010000000000000000000';defaults.seller={...defaults.seller,name:'Тестовий продавець',tax_id:'0000000000',bank:'Тестовий банк',iban:`UA${String(98-Number(BigInt(body+'301000')%97n)).padStart(2,'0')}${body}`};
  defaults.reviewed=true;defaults.tax='Без ПДВ';defaults.invoice.number='';defaults.invoice.automatic=true;
  let context={defaults,document:null,order:{id:'test-order',number:'O-TEST'},recipient:connected?'123456789':'',recipient_label:'Тестовий покупець · +380000000001',versions:[],deliveries:[],latest_revision:0,seller_profiles:[{id:'primary',seller:defaults.seller}],seller_revision:1};
  w.fetch=async (url,options={})=>{
    calls.push({url,options});assert.match(url,/^\/api\/admin\//,'No external request');
    if(options.method==='POST' && /\/(send|document-send)$/.test(url)) {
      context.deliveries=[{id:`${context.document.id}:invoice`,status:'sent',created_at:'2026-10-27T12:00:00Z'}];return Response.json({ok:true});
    }
    if(options.method==='POST') {
      const payload=JSON.parse(options.body);payload.data.invoice.number||='10';
      context.document={id:payload.request_id,data:payload.data,status:payload.status,revision:++context.latest_revision,output_mode:payload.mode,actor:'Тест',created_at:'2026-10-27T12:00:00Z'};
      context.versions=[{...context.document}];
    }
    return Response.json(context);
  };
  w.eval(source.replace(/^import .*;\n/gm,'')+'\npdfLoading=Promise.resolve();');
  await until(()=>!q('[data-workspace]').hidden);
  const idle=()=>until(()=>!q('[data-editor]').inert);
  const click=async name=>{q(`[data-action="${name}"]`).click();await idle();};
  return {w,q,calls,links,shares,pdfs,popups,click,idle};
}

test('contact destinations reject active URLs and email headers; only valid contact data becomes a link',()=>{
  assert.equal(delivery.contactEmail('test@example.invalid'),'test@example.invalid');
  assert.equal(delivery.contactEmail('@some_person'),'');assert.equal(delivery.telegramContact('@some_person'),'https://t.me/some_person');
  for(const value of ['javascript:alert(1)','https://evil.test/me','https://t.me/person?x=y'])assert.equal(delivery.telegramContact(value),'');
  assert.equal(delivery.contactPhone('(067) 123-45-67'),'380671234567');assert.equal(delivery.contactPhone('unknown'),'');
  for(const email of ['', 'a@test.com\r\nBcc:other@test.com','a@test.com?bcc=x@test.com','not-email'])assert.throws(()=>delivery.emailDraftUrl(email,{subject:'Invoice',text:'Test'}));
  const url=delivery.emailDraftUrl('a@test.com',{subject:'Рахунок № 10 & test',text:'Добрий день!'});
  assert.match(url,/^mailto:a%40test.com\?subject=/);assert.equal(new URL(url).searchParams.get('subject'),'Рахунок № 10 & test');
});
test('issuing opens delivery choices without automatically contacting customer or duplicating invoice on download/print',async t=>{
  const p=await fixture(t);await p.click('issue-invoice');
  assert.equal(p.q('[data-send-dialog]').open,true,p.q('[data-error]').textContent);assert.match(p.q('[data-send-content]').textContent,/Рахунок № 10/);
  assert.equal(p.calls.filter(c=>c.options.method==='POST').length,1);
  assert.equal(p.q('[data-bot-channel]').hidden,false);assert.equal(p.q('[data-send-email]').value,'test@example.invalid');
  await p.click('send-download');assert.match(p.links.at(-1).download,/invoice-10-v1.pdf$/);
  await p.click('send-print');assert.equal(p.popups[0].location.href,'blob:synthetic-pdf');assert.equal(p.pdfs.at(-1).options.autoPrint,true);
  assert.equal(p.calls.filter(c=>c.options.method==='POST').length,1);
});
test('Telegram requires confirmation and uses order endpoint once; then hides duplicate send',async t=>{
  const p=await fixture(t);await p.click('send');await p.click('telegram');
  assert.match(p.q('[data-send-error]').textContent,/Підтвердьте/);assert.ok(!p.calls.some(c=>c.url.endsWith('/document-send')));
  p.q('[data-confirm-recipient]').checked=true;await p.click('telegram');
  const call=p.calls.find(c=>c.url.endsWith('/document-send'));assert.equal(call.options.body.get('recipient'),'123456789');assert.equal(call.options.body.get('mode'),'invoice');
  assert.equal(p.q('[data-action="telegram"]').hidden,true);assert.match(p.q('[data-bot-result]').textContent,/вже надіслано/);
});
test('standalone invoice uses standalone Telegram endpoint; file sharing passes a PDF without new saves',async t=>{
  const p=await fixture(t,{standalone:true});await p.click('send');await p.click('share');
  assert.equal(p.shares.length,1);assert.equal(p.shares[0].files[0].type,'application/pdf');assert.match(p.shares[0].title,/Рахунок № 10/);
  assert.doesNotMatch(p.q('[data-send-status]').textContent,/надіслано клієнту/i);
  p.q('[data-confirm-recipient]').checked=true;await p.click('telegram');
  assert.ok(p.calls.some(c=>/^\/api\/admin\/invoices\/[^/]+\/send$/.test(c.url)));
});
test('without bot or native sharing, email draft and PDF stay available; no email is silently sent',async t=>{
  const p=await fixture(t,{connected:false,share:false});await p.click('send');
  assert.equal(p.q('[data-bot-channel]').hidden,true);assert.equal(p.q('[data-action="share"]').hidden,true);
  await p.click('email');assert.equal(p.links.length,2);assert.match(p.links[0].download,/\.pdf$/);assert.match(p.links[1].href,/^mailto:test%40example.invalid/);
  assert.match(p.q('[data-send-status]').textContent,/Додайте його до листа/);
  assert.equal(p.calls.filter(c=>c.options.method==='POST').length,1);
  p.q('[data-send-email]').value='invalid';await p.click('email');assert.equal(p.links.length,2);assert.match(p.q('[data-send-error]').textContent,/email/);
});
