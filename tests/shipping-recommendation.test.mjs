import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recommendShipping, shippingQuantity, outerVolume, selectShippingAnalogues, renderShippingRecommendation, finiteNumber } from '../assets/js/shipping-recommendation.js';
import evidence from './fixtures/shipping-evidence.js';
import { classifyShippingWithAi } from '../functions/_lib/shipping-classification.js';
import { onRequestGet } from '../functions/api/admin/shipping-reference.js';
import { onRequestPost } from '../functions/api/admin/shipping-classify.js';

const pricelist=JSON.parse(await readFile(new URL('../admin/shipping-pricelist/pricelist.json',import.meta.url)));
const airGuide=JSON.parse(await readFile(new URL('../admin/shipping-pricelist/air-guide.json',import.meta.url)));
const estimate=(order,options={})=>recommendShipping({order,pricelist,airGuide,evidence,asOf:'2026-09-30',...options});
const input={category:'shock',quantity:2,mode:'sea',carrier:'Ukr China',destination:'Kyiv',asOf:'2026-09-30'};

test('unknown SKU/model always has a finite, wide, category-first recommendation',()=>{
  for(const mode of ['sea','air']) {
    const r=estimate({item_name:'XZ-999887'}, {mode});
    assert.equal(r.category,'unknown');assert.equal(r.classification.source,'fallback');
    assert.ok(r.total>0 && Number.isFinite(r.total));assert.ok(r.range[0]<r.total && r.range[1]>r.total);
    assert.equal(r.weights.itemNet.value,null);assert.equal(r.weights.billed.value,null);
    assert.match(renderShippingRecommendation(r),/низька|fallback/);
  }
});
test('known category needs neither SKU nor model; fragile packing and quantity automatic',()=>{
  const r=estimate({item_name:'лобовое стекло 2 шт.'});
  assert.equal(r.category,'windshield');assert.equal(r.quantity.value,2);assert.match(r.packing,/каркас/);
  assert.equal(r.size,'standard');assert.equal(r.classification.source,'rules');
});
test('all existing category profiles remain bounded and automatic',()=>{
  for (const p of pricelist.profiles) for(const mode of ['air','sea']) {
    const r=estimate({item_name:p.keywords[0],car:'unknown-model'}, {mode});
    assert.notEqual(r.category,'unknown',p.id);
    assert.ok(r.range[0]<=r.total && r.total<=r.range[1],p.id);
  }
});
test('12 quotations preserve 10 groups and 2 pairs, not 12 independent shipments',()=>{
  assert.equal(evidence.quotes.length,12);
  assert.equal(new Set(evidence.quotes.map(q=>q.normalized.quote_group)).size,10);
  assert.equal(evidence.metadata.air_sea_pairs,2);
  assert.ok(evidence.quotes.every(q=>q.normalized.carrier==='Ukr China' && q.raw_transcription.carrier===null));
  assert.ok(evidence.quotes.every(q=>q.normalized.payment_status==='not_evidenced'));
});
test('same-scope shocks use one historical quote; do not divide or extrapolate minimums',()=>{
  const r=estimate({item_name:'Амортизатори 2 шт.',car:'Zeekr'}, {overrides:{goodsValueUsd:1000}});
  assert.equal(r.basis,'historical_quote');assert.equal(r.anchor.id,1008);assert.equal(r.freight,200);
  assert.equal(r.insurance,15);assert.equal(r.total,215);
  assert.equal(estimate({item_name:'Амортизатор',quantity:1}).anchor,null);
  assert.equal(estimate({item_name:'Амортизатор',quantity:4}).anchor,null);
  assert.equal(estimate({item_name:'Амортизатори 2 шт.'},{mode:'air'}).freight,450);
});
test('routes, carriers, lines and modes never silently pooled',()=>{
  for (const patch of [{destination:'Mukachevo'},{carrier:'Meest China'},{serviceLine:'parcel'},{mode:'rail'}]) {
    assert.equal(selectShippingAnalogues(evidence,{...input,...patch}).filter(q=>!q.reasons.length).length,0);
  }
});
test('duplicate documents and same group add no extra observations',()=>{
  const duplicate=structuredClone(evidence);duplicate.quotes.push(structuredClone(evidence.quotes.find(q=>q.source.message_id===1008)));
  const rows=selectShippingAnalogues(duplicate,input);
  assert.equal(rows.filter(q=>!q.reasons.length).length,1);
  assert.ok(rows.some(q=>q.reasons.includes('duplicate_group')));
  assert.equal(estimate({item_name:'амортизатор',quantity:2},{evidence:duplicate}).freight,200);
});
test('quarantined values never restored from raw; bumper conflict stays null',()=>{
  const q=evidence.quotes.find(q=>q.source.message_id===1002);
  assert.equal(q.raw_transcription.volumetric_kg,160);assert.equal(q.normalized.volumetric_kg,null);
  assert.equal(q.raw_transcription.total_usd,2400);assert.equal(q.normalized.total_usd,null);
  const r=estimate({item_name:'комплект бампера',quantity:3},{mode:'air',overrides:{destination:'Mukachevo'}});
  assert.equal(r.anchor,null);assert.ok(r.analogues.some(a=>a.reasons.includes('quarantined_price_context')));
});
test('inferred modes, aggregates, date conflicts and missing dates cannot price an anchor',()=>{
  for (const q of evidence.quotes.filter(q=>q.curation.mixed_load || q.normalized.mode_evidence!=='explicit_caption' || !q.normalized.document_date)) {
    const rows=selectShippingAnalogues({quotes:[q]},{...input,category:q.curation.category,quantity:q.curation.quantity,mode:q.normalized.mode,destination:q.normalized.destination});
    assert.ok(rows[0].reasons.length);
  }
  assert.ok(selectShippingAnalogues(evidence,{...input,asOf:'2026-01-01'}).every(q=>q.reasons.length));
});
test('units, counts and external dimensions have equivalent volume; invalid inputs stay null',()=>{
  assert.equal(outerVolume([{length:100,width:50,height:20,unit:'cm',count:2}]),.2);
  assert.equal(outerVolume([{length:1000,width:500,height:200,unit:'mm',count:2}]),.2);
  assert.equal(outerVolume([{length:1,width:.5,height:.2,unit:'m',count:2}]),.2);
  for(const p of [{length:0,width:1,height:1,unit:'m'},{length:1,width:1,height:1,unit:'inch'},{length:1,width:1,height:1,unit:'m',count:-1}]) assert.equal(outerVolume([p]),null);
  assert.equal(finiteNumber(null),null);assert.equal(finiteNumber(''),null);assert.equal(finiteNumber(0),0);
});
test('quantities use explicit fields or text, never digits in SKU',()=>{
  assert.equal(shippingQuantity({item_name:'001 6608059141'}).value,1);
  assert.equal(shippingQuantity({item_name:'амортизатори 2 шт.'}).value,2);
  assert.equal(shippingQuantity({item_name:'пара амортизаторов'}).value,2);
  assert.equal(shippingQuantity({item_name:'2 шт.',quantity:3}).value,3);
  assert.equal(shippingQuantity({quantity:-2}).value,1);
});
test('gross includes packing; no double mass; overrides refer to entire shipment',()=>{
  const r=estimate({item_name:'лобовое стекло',quantity:2},{mode:'air',overrides:{itemNetKg:12,packageGrossKg:25,outerVolumeM3:.3}});
  assert.deepEqual(r.weights.packageGross.range,[25,25]);assert.equal(r.weights.packaging.value,13);
  assert.deepEqual(r.weights.outerVolume.range,[.3,.3]);assert.equal(r.weights.billed.value,null);
  assert.ok(r.weights.billed.range[0]>25);assert.equal(r.scope.packagingIncluded,false);
  const inconsistent=estimate({item_name:'фара'},{overrides:{itemNetKg:20,packageGrossKg:10}});
  assert.equal(inconsistent.weights.packaging.value,null);assert.ok(inconsistent.weights.packageGross.range[0]>=20);
});
test('net-only mass is not billed directly; measured gross and billed independent',()=>{
  const r=estimate({item_name:'фара'},{mode:'air',overrides:{itemNetKg:40}});
  assert.equal(r.weights.itemNet.value,40);assert.ok(r.weights.packageGross.range[0]>40);assert.equal(r.weights.billed.value,null);
  const billed=estimate({item_name:'фара',quantity:3},{mode:'air',overrides:{chargeableKg:20}});
  assert.equal(billed.freight,259.9);assert.equal(billed.weights.billed.value,20);
});
test('insurance calculated once on total declared USD, not multiplied by quantity',()=>{
  const unknown=estimate({item_name:'фара',quantity:2});assert.equal(unknown.insurance,null);
  const r=estimate({item_name:'фара',quantity:2},{overrides:{goodsValueUsd:1000}});
  assert.equal(r.insurance,15);assert.equal(r.total,Math.round((r.freight+15)*100)/100);
  assert.equal(estimate({item_name:'фара'},{overrides:{goodsValueUsd:0}}).insurance,0);
});
test('small shipment fallback budget applied once, not per item; no invented carrier minimum',()=>{
  const r=estimate({item_name:'накладка',quantity:2});
  assert.equal(r.basis,'planning_fallback');assert.ok(r.freight>=95);assert.equal(r.scope.carrier,null);
  assert.match(renderShippingRecommendation(r),/припущення, не мінімум перевізника/);
});
test('missing history keeps recommendation; missing guide keeps unknown fallback',()=>{
  assert.ok(estimate({item_name:'фара'},{evidence:null}).total>0);
  assert.ok(estimate({item_name:'unknown'},{airGuide:null,pricelist:null,evidence:null}).total>0);
});
test('dangerous items never imply permission, and rendering escapes order text',()=>{
  const r=estimate({item_name:'акумулятор battery',car:'<img onerror=alert(1)>'});
  assert.equal(r.hazard,true);assert.equal(r.anchor,null);
  const html=renderShippingRecommendation(r);assert.match(html,/не дозвіл/);assert.doesNotMatch(html,/<img/);
});
test('private reference and AI endpoints enforce existing authentication without mutation',async()=>{
  const env={ADMIN_TOKEN:'fixture-only',DB:{prepare:()=>({bind:()=>({first:async()=>({payload_json:JSON.stringify(evidence)})})})}};
  assert.equal((await onRequestGet({request:new Request('https://local/api/admin/shipping-reference'),env})).status,401);
  assert.equal((await onRequestPost({request:new Request('https://local/api/admin/shipping-classify',{method:'POST'}),env})).status,401);
  const response=await onRequestGet({request:new Request('https://local/api/admin/shipping-reference',{headers:{authorization:'Bearer fixture-only'}}),env});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();assert.equal(body.quotes.length,12);assert.equal(body.ai_enabled,false);
});
test('AI uses existing binding automatically; disable switch and mocks preserve classification-only scope',async()=>{
  let calls=0;
  const mock={AI:{run:async()=>{calls++;return {response:{category:'shock',evidence:'стойка XYZ',price:1,gross_kg:1}};}}};
  assert.equal((await classifyShippingWithAi({...mock,SHIPPING_AI_ENABLED:'false'},{item_name:'стойка XYZ'})).status,'disabled');assert.equal(calls,0);
  assert.equal((await classifyShippingWithAi({...mock,MARKET_AI_ENABLED:'false'},{item_name:'стойка XYZ'})).status,'disabled');assert.equal(calls,0);
  const ai=await classifyShippingWithAi(mock,{item_name:'стойка XYZ'});
  assert.equal(calls,1);assert.equal(ai.status,'accepted');assert.equal(ai.price,undefined);assert.equal(ai.gross_kg,undefined);
  const r=estimate({item_name:'стойка XYZ'},{ai});assert.equal(r.category,'shock');assert.equal(r.classification.source,'ai');
});
test('AI hallucination, failure, unsupported category and forged evidence fall back',async()=>{
  for (const response of [{category:'made-up',evidence:'XYZ'},{category:'shock',evidence:'not in request'},'broken']) {
    const ai=await classifyShippingWithAi({SHIPPING_AI_ENABLED:'true',AI:{run:async()=>({response})}},{item_name:'XYZ'});
    assert.notEqual(ai.status,'accepted');assert.equal(estimate({item_name:'XYZ'},{ai}).category,'unknown');
  }
  assert.equal((await classifyShippingWithAi({SHIPPING_AI_ENABLED:'true',AI:{run:async()=>{throw Error('fixture outage');}}},{item_name:'XYZ'})).status,'unavailable');
});
test('AI redacts contact data and VIN before calling existing binding',async()=>{
  let sent;
  await classifyShippingWithAi({SHIPPING_AI_ENABLED:'true',AI:{run:async(model,input)=>{sent=JSON.stringify(input);return {response:{category:'unknown'}};}}},{item_name:'XYZ user@example.com +380501234567 L1234567890123456',vin:'L1234567890123456'});
  assert.doesNotMatch(sent,/user@example|380501234567|L1234567890123456/);
});

test('generic legacy weight never silently becomes net, gross or billed',()=>{
  const original=estimate({item_name:'фара'},{mode:'air'});
  const legacy=estimate({item_name:'фара'},{mode:'air',overrides:{reportedWeightKg:200,reportedVolumeM3:8}});
  assert.equal(legacy.total,original.total);
  assert.equal(legacy.weights.billed.value,null);assert.equal(legacy.weights.itemNet.value,null);
  assert.match(legacy.warnings.join(' '),/Старі поля/);
});
test('mixed category request uses a wide bundle fallback, never just the first item',()=>{
  const r=estimate({item_name:'фара і бампер'});
  assert.equal(r.category,'unknown');assert.equal(r.quantity.value,2);assert.equal(r.anchor,null);
  assert.match(r.warnings.join(' '),/Кілька категорій/);
  assert.equal(estimate({item_name:'door glass'}).category,'door-glass');
});
test('packaging observations use safe fields and count paired quotes once',()=>{
  const r=estimate({item_name:'амортизатор',quantity:2});
  assert.equal(r.packageObservations.length,1);assert.equal(r.packageObservations[0].gross,20);
  const frame=estimate({item_name:'рамка радіатора'});
  assert.equal(frame.anchor,null,'Incoterm conflict blocks price matching');
  assert.equal(frame.packageObservations[0].volume,.24,'Unconflicted outer volume remains useful');
  assert.equal(evidence.quotes.find(q=>q.source.message_id===1012).normalized.incoterm,null);
});
test('UI surfaces need no category/packing questionnaire and share one calculation',async()=>{
  const html=await readFile(new URL('../admin/shipping-pricelist/index.html',import.meta.url),'utf8');
  const page=await readFile(new URL('../admin/shipping-pricelist/pricelist.js',import.meta.url),'utf8');
  const admin=await readFile(new URL('../admin/admin.js',import.meta.url),'utf8');
  assert.match(html,/<details[^>]*><summary>Необов’язкові точні параметри/);
  assert.doesNotMatch(html,/<(?:input|select)[^>]*required/);
  assert.match(page,/recommendShipping\(/);assert.match(admin,/recommendShipping\(/);
  assert.doesNotMatch(admin,/Тип деталі не визначено\. Оцінка доставки недоступна/);
  assert.match(admin,/reportedWeightKg:/);assert.doesNotMatch(admin,/chargeableKg:\s*Number\(order.shipping_weight_kg/);
});
test('private quotations are not imported by public JS; auth cache change is explicit',async()=>{
  const engine=await readFile(new URL('../assets/js/shipping-recommendation.js',import.meta.url),'utf8');
  const admin=await readFile(new URL('../admin/admin.js',import.meta.url),'utf8');
  const page=await readFile(new URL('../admin/shipping-pricelist/pricelist.js',import.meta.url),'utf8');
  assert.doesNotMatch(engine,/import.*shipping-evidence|PRIVATE_SKU_FIXTURE/);
  assert.match(admin,/shippingClassifier\.clear\(\)/);assert.match(admin,/event.key !== 'evline_admin_token'/);
  assert.match(page,/event.key==='evline_admin_token'/);
  const response=await onRequestGet({env:{ADMIN_TOKEN:'fixture'},request:new Request('https://local/api/admin/shipping-reference',{headers:{authorization:'Bearer fixture'}})});
  assert.equal(response.headers.get('vary'),'Authorization');
});


test('extreme or invalid exact parameters never produce Infinity or zero as unknown',()=>{
  const r=estimate({item_name:'фара'},{mode:'air',overrides:{packageGrossKg:1e308,outerVolumeM3:1e308,goodsValueUsd:1e308}});
  assert.ok(Number.isFinite(r.total));assert.ok(r.range.every(Number.isFinite));assert.equal(r.goodsValue,null);
  assert.equal(outerVolume([{length:1e308,width:1e308,height:1e308,unit:'m'}]),null);
  assert.ok(r.warnings.length>0);
});

test('brand and used declarations never imply carrier acceptance',()=>{
  const r=estimate({item_name:'оригинальный бампер с разборки'});
  assert.equal(r.condition,'used');assert.equal(r.brandStatus,'original_declared');
  assert.match(r.warnings.join(' '),/допуск/);
});

test('private D1 reference unavailable keeps fallback and does not expose database errors',async()=>{
  for(const DB of [undefined,{prepare:()=>{throw Error('private database detail');}},{prepare:()=>({bind:()=>({first:async()=>({payload_json:'invalid'})})})}]) {
    const response=await onRequestGet({env:{ADMIN_TOKEN:'fixture',DB},request:new Request('https://local/api/admin/shipping-reference',{headers:{authorization:'Bearer fixture'}})});
    const value=await response.json();assert.equal(value.reference_available,false);assert.deepEqual(value.quotes,[]);
    const result=estimate({item_name:'unknown'},{evidence:value});assert.equal(result.evidenceLoaded,false);assert.ok(result.total>0);
    assert.doesNotMatch(JSON.stringify(value),/database detail/);
  }
});
test('private D1 reference is never queried before authentication',async()=>{
  const response=await onRequestGet({request:new Request('https://local/api/admin/shipping-reference'),env:{ADMIN_TOKEN:'fixture',DB:{prepare:()=>assert.fail('unauthorized DB read')}}});
  assert.equal(response.status,401);
});
