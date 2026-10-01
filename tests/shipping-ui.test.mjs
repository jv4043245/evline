import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createShippingClassifier} from '../assets/js/shipping-classifier-client.js';
import * as recommendation from '../assets/js/shipping-recommendation.js';
import {renderAirFreight,updateAirFreightOutput} from '../assets/js/shipping-air-estimate.js';
import evidence from './fixtures/shipping-evidence.js';
import {onRequest as guardStaticSource} from '../functions/_middleware.js';

const html=await readFile(new URL('../admin/shipping-pricelist/index.html',import.meta.url),'utf8');
const pageScript=await readFile(new URL('../admin/shipping-pricelist/pricelist.js',import.meta.url),'utf8');
const adminScript=await readFile(new URL('../admin/admin.js',import.meta.url),'utf8');
const pricelist=JSON.parse(await readFile(new URL('../admin/shipping-pricelist/pricelist.json',import.meta.url)));
const airGuide=JSON.parse(await readFile(new URL('../admin/shipping-pricelist/air-guide.json',import.meta.url)));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function page({ai=false,classify=async()=>({status:'unavailable'})}={}) {
  const dom=new JSDOM(html,{url:'http://127.0.0.1:8791/admin/shipping-pricelist/',runScripts:'outside-only'});
  const w=dom.window,calls=[];
  Object.assign(w,recommendation,{createShippingClassifier,renderAirFreight,updateAirFreightOutput,adminApiError:async()=> 'fixture error'});
  w.localStorage.setItem('evline_admin_token','test-user-a');
  const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms)=>timeout(fn,ms===600?0:ms);
  w.fetch=async(url,options={})=>{
    calls.push({url,options});
    if(url==='/api/admin/shipping-classify')return {ok:true,json:()=>classify(JSON.parse(options.body),options)};
    const body=url.endsWith('pricelist.json')?pricelist:url.endsWith('air-guide.json')?airGuide:url==='/api/admin/shipping-reference'?{...evidence,ai_enabled:ai}:{carriers:[],rates:[]};
    assert.ok(['/admin/shipping-pricelist/pricelist.json','/admin/shipping-pricelist/air-guide.json','/api/admin/shipping-reference','/api/admin/shipping'].includes(url),'No unexpected/live request');
    return {ok:true,json:async()=>structuredClone(body)};
  };
  w.eval(pageScript.replace(/^import .*;\n/gm,'')+'\nwindow.qa={renderCalculator,getClassification:order=>classifier.get(order)};');
  for(let i=0;i<20 && !w.document.querySelector('[data-shipping-recommendation]');i++)await tick();
  assert.ok(w.document.querySelector('[data-shipping-recommendation]'),'Actual page script rendered');
  const set=(selector,value)=>{const el=w.document.querySelector(selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
  return {w,calls,set,close:()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();},text:()=>w.document.querySelector('[data-shipping-recommendation-root]').textContent};
}

test('real calculator script: unknown fallback, glass/bumper variants, repeat mode clicks, optional fields',async()=>{
  const p=await page();
  try {
    assert.match(p.text(),/модель невідома/);assert.match(p.text(),/Робочий орієнтир/);
    for(const [input,label] of [['лобовое стекло','Лобове скло'],['door glass','Скло дверей'],['комплект бампера','Бамперний комплект'],['бампер','Бампер, оболонка']]){
      p.set('[data-request]',input);assert.match(p.text(),new RegExp(label));
      const before=p.text();p.w.document.querySelector('[data-freight-mode="sea"]').click();p.w.document.querySelector('[data-freight-mode="sea"]').click();assert.equal(p.text(),before);
      p.w.document.querySelector('[data-freight-mode="air"]').click();assert.equal(p.w.document.querySelector('[data-freight-mode="air"]').getAttribute('aria-pressed'),'true');
      assert.doesNotMatch(p.text(),/NaN|Infinity/);p.w.document.querySelector('[data-freight-mode="sea"]').click();
    }
    assert.equal(p.w.document.querySelector('form details').open,false);
    assert.equal(p.calls.filter(c=>c.options.method==='POST').length,0);
  } finally {p.close();}
});
test('real calculator script: quantity, USD insurance and exact shipment measures do not submit an order',async()=>{
  const p=await page();
  try {
    p.set('[data-request]','амортизатор');p.set('[data-quantity]','2');p.set('[data-purchase-price]','1000');
    assert.match(p.text(),/історичний аналог/);assert.match(p.text(),/215\s*USD/);
    p.set('[data-gross]','25');p.set('[data-net]','12');p.set('[data-outer-volume]','0.3');
    assert.match(p.text(),/25\.0–25\.0 кг/);assert.match(p.text(),/0\.300–0\.300/);
    assert.doesNotMatch(p.text(),/історичний аналог/);
    assert.ok(p.calls.every(c=>c.options.method!=='POST'));
  } finally {p.close();}
});
test('real calculator script ignores late AI after changed text or pagehide; repeat clicks dedupe',async()=>{
  const pending=deferred();const p=await page({ai:true,classify:()=>pending.promise});
  try {
    p.set('[data-request]','стойка XYZ');
    await new Promise(r=>setTimeout(r,10));
    p.w.document.querySelector('[data-freight-mode="air"]').click();p.w.document.querySelector('[data-freight-mode="air"]').click();
    await new Promise(r=>setTimeout(r,10));
    assert.equal(p.calls.filter(c=>c.url.endsWith('shipping-classify')).length,1);
    p.set('[data-request]','лобовое стекло');
    pending.resolve({status:'accepted',category:'shock',evidence:'стойка XYZ'});await tick();
    assert.match(p.text(),/Лобове скло/);assert.doesNotMatch(p.text(),/Амортизатор/);
    assert.equal(p.w.qa.getClassification({item_name:'стойка XYZ'}),undefined);
  } finally {p.close();}
});
test('controller ignores stale success/failure after view switch, close, or user change even when request ignores abort',async()=>{
  let auth='A',renders=[];const pending=[];
  const c=createShippingClassifier({getAuth:()=>auth,request:()=>{const d=deferred();pending.push(d);return d.promise;},onResult:v=>renders.push(v)});
  const a={item_name:'unknown A'},b={item_name:'unknown B'};
  const pa=c.ensure('order',a);assert.equal(c.ensure('order',a),pa);await tick();
  const pb=c.ensure('order',b);await tick();pending[0].resolve({status:'accepted',category:'shock',evidence:'unknown A'});await pa;
  assert.equal(c.get(a),undefined);assert.deepEqual(renders,[]);
  c.cancel('order');pending[1].resolve({status:'unavailable'});await pb;assert.equal(c.get(b),undefined);
  const pc=c.ensure('order',a);await tick();auth='B';pending[2].resolve({status:'accepted'});await pc;assert.deepEqual(renders,[]);
  c.clear();auth='A';assert.equal(c.get(a),undefined);
});
test('actual CRM root update refuses old order after async load and leaves editable order fields untouched',()=>{
  const dom=new JSDOM('<section data-market-research-root data-order-id="B"><div data-shipping-estimate-root>current B</div></section><input name="delivery_cost_uah" value="123"><input name="item_name" value="draft B">',{runScripts:'outside-only'});
  const w=dom.window;
  w.state={selectedOrder:{id:'B'}};w.renderShippingEstimate=o=>`rendered ${o.id}`;
  const start=adminScript.indexOf('function updateShippingEstimateRoot('),end=adminScript.indexOf('\nfunction messagePreview',start);
  w.eval(adminScript.slice(start,end)+'\nwindow.update=updateShippingEstimateRoot;');
  w.update({id:'A'});assert.equal(w.document.querySelector('[data-shipping-estimate-root]').textContent,'current B');
  w.update({id:'B'});assert.equal(w.document.querySelector('[data-shipping-estimate-root]').textContent,'rendered B');
  assert.equal(w.document.querySelector('[name="delivery_cost_uah"]').value,'123');assert.equal(w.document.querySelector('[name="item_name"]').value,'draft B');
  w.state.selectedOrder=null;w.update({id:'B'});assert.equal(w.document.querySelector('[data-shipping-estimate-root]').textContent,'rendered B');w.close();
});
test('quantity two shared packing is not two full crate budgets; exact package count is authoritative',()=>{
  const run=(quantity,overrides={})=>recommendation.recommendShipping({order:{item_name:'лобовое стекло',quantity},pricelist,airGuide,overrides});
  const one=run(1),two=run(2),separate=run(2,{packing:'separate'});
  assert.ok(two.packagingBudget[0]<2*one.packagingBudget[0]);assert.ok(two.weights.outerVolume.range[0]<2*one.weights.outerVolume.range[0]);
  assert.ok(separate.packagingBudget[0]>two.packagingBudget[0]);
  assert.deepEqual(run(2,{packages:[{length:100,width:100,height:40,unit:'cm',count:1}]}).weights.outerVolume.range,[.4,.4]);
});

test('real page ignores pending AI on pagehide and after auth identity changes',async()=>{
  for(const action of ['close','auth']) {
    const pending=deferred();const p=await page({ai:true,classify:()=>pending.promise});
    try {
      p.set('[data-request]','стойка XYZ');await new Promise(r=>setTimeout(r,10));
      const before=p.text();
      if(action==='close')p.w.dispatchEvent(new p.w.Event('pagehide'));
      else p.w.localStorage.setItem('evline_admin_token','test-user-b');
      pending.resolve({status:'accepted',category:'shock',evidence:'стойка XYZ'});await tick();
      assert.equal(p.text(),before);assert.equal(p.w.qa.getClassification({item_name:'стойка XYZ'}),undefined);
    } finally {p.close();}
  }
});
test('static middleware rejects private source, encoded traversal and research artifacts; public UI and authenticated API still route',async()=>{
  for(const path of ['/functions/_lib/shipping-evidence.js','/tests/shipping-recommendation.test.mjs','/scripts/preview-shipping.mjs','/.git/config','/.dev.vars','/SHIPPING_RECOMMENDATION_REVIEW.md','/assets/%2e%2e/functions/_lib/shipping-evidence.js','/assets%2f..%2ffunctions/_lib/shipping-evidence.js']) {
    const response=await guardStaticSource({request:new Request('https://local'+path),next:()=>assert.fail('Private source reached static handler')});
    assert.equal(response.status,404,path);
  }
  for(const path of ['/admin/shipping-pricelist/','/assets/js/shipping-recommendation.js','/api/admin/shipping-reference','/api/admin/orders/fixture-id']) {
    assert.equal(await guardStaticSource({request:new Request('https://local'+path),next:()=> 'routed'}),'routed');
  }
});
test('currency and precision: never treat UAH/CNY purchasing as USD; sea budget remains within stated floor',()=>{
  const r=recommendation.recommendShipping({order:{item_name:'XYZ',purchase_cost_uah:100000,purchase_cost_cny:1000},pricelist,airGuide});
  assert.equal(r.insurance,null);assert.equal(r.goodsValue,null);assert.ok(r.range[0]>=60);
  assert.equal(r.display.total%5,0);assert.equal(r.display.range[0]%5,0);assert.equal(r.display.range[1]%5,0);
  assert.ok(r.display.range[0]<=r.display.total && r.display.total<=r.display.range[1]);
});

test('actual CRM renderer plus mode event: dedupes AI, switches order safely and never touches save fields',async()=>{
  const dom=new JSDOM('<section data-market-research-root data-order-id="A"><div data-shipping-estimate-root></div></section><input name="delivery_cost_uah" value="999">',{url:'https://fixture.local/admin/',runScripts:'outside-only'});
  const w=dom.window,pending=deferred();let calls=0;
  Object.assign(w,recommendation,{createShippingClassifier,escapeHtml:v=>String(v).replaceAll('<','&lt;'),updateMarketLookupShippingRoot:()=>{},marketLookupOrder:()=>({id:'market-lookup-fixture'})});
  w.localStorage.setItem('evline_admin_token','fixture-only');
  w.state={shippingPricelist:pricelist,shippingAirGuide:airGuide,shippingEvidence:{...evidence,ai_enabled:true},shippingEstimateSettings:{},selectedOrder:{id:'A',item_name:'стойка XYZ'}};
  w.api=async path=>{assert.equal(path,'/api/admin/shipping-classify');calls++;return pending.promise;};
  const start=adminScript.indexOf('function shippingOptions('),end=adminScript.indexOf('\nfunction messagePreview',start);
  const eventStart=adminScript.indexOf('document.addEventListener("click", event => {\n  const button = event.target.closest("[data-estimate-mode]");');
  const eventEnd=adminScript.indexOf('\n});',eventStart)+4;
  w.eval(adminScript.slice(start,end)+adminScript.slice(eventStart,eventEnd)+'\nwindow.qa={update:updateShippingEstimateRoot,clear:()=>shippingClassifier.clear()};');
  try {
    w.qa.update();await tick();assert.equal(calls,1);
    w.document.querySelector('[data-estimate-mode="air"]').click();w.document.querySelector('[data-estimate-mode="air"]').click();await tick();assert.equal(calls,1);
    w.state.selectedOrder={id:'B',item_name:'амортизатори 2 шт.'};w.document.querySelector('[data-market-research-root]').dataset.orderId='B';w.qa.update();
    const current=w.document.querySelector('[data-shipping-estimate-root]').textContent;
    assert.match(current,/Амортизатор/);
    pending.resolve({status:'accepted',category:'windshield',evidence:'стойка XYZ'});await tick();
    assert.equal(w.document.querySelector('[data-shipping-estimate-root]').textContent,current);
    assert.equal(w.document.querySelector('[name="delivery_cost_uah"]').value,'999');
    assert.equal(calls,1);
  } finally {w.qa.clear();w.close();}
});


test('empty numeric values remain unknown and vehicle names are not part-keyword substrings',()=>{
  for(const value of [' ', '\t', [], {}, false, null])assert.equal(recommendation.finiteNumber(value),null);
  const r=recommendation.recommendShipping({order:{item_name:'Land Rover Defender SKU123'},pricelist,airGuide});
  assert.equal(r.category,'unknown');
});
