// Recommendation scenarios, never a binding carrier tariff or statistical interval.
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => new Intl.NumberFormat('uk-UA', {style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
const cents = v => Math.round((v + Number.EPSILON) * 100) / 100;
export const finiteNumber = v => {
  if(!['string','number'].includes(typeof v)) return null;
  const text=String(v).trim().replace(',', '.');
  return text && Number.isFinite(Number(text)) ? Number(text) : null;
};
const keywordPosition = (text, keyword) => {
  const term=keyword.toLowerCase();
  let index=text.indexOf(term);
  while(index>=0) {
    if(!/^[a-z -]+$/i.test(term) || (!/[a-z]/i.test(text[index-1] || '') && !/[a-z]/i.test(text[index+term.length] || ''))) return index;
    index=text.indexOf(term,index+1);
  }
  return -1;
};
const positive = v => { const n = finiteNumber(v); return n > 0 ? n : null; };
const measurement = (v,max) => {const n=positive(v);return n!==null && n<=max?n:null;};
const midpoint = r => (r[0] + r[1]) / 2;
const multiply = (r, n) => r.map(v => v * n);
const extra = [
  {id:'shock',name:'Амортизатор',keywords:['амортиз','shock absorber','strut'],gross_weight_kg:[7,14],packed_volume_m3:[.035,.08],packaging_cost_usd:[8,20]},
  {id:'radiator-frame',name:'Рамка радіатора',keywords:['рамка радиатора','рамка радіатора','панель радиатора','radiator frame'],gross_weight_kg:[5,12],packed_volume_m3:[.12,.28],packaging_cost_usd:[12,35]},
  {id:'windshield',name:'Лобове скло',keywords:['лобовое','лобове','windshield','windscreen'],gross_weight_kg:[18,40],packed_volume_m3:[.3,.7],packaging_cost_usd:[30,75]},
  {id:'door-glass',name:'Скло дверей',keywords:['стекло двери','скло дверей','door glass','боковое стекло','бічне скло'],gross_weight_kg:[7,15],packed_volume_m3:[.10,.22],packaging_cost_usd:[15,40]},
  {id:'rear-lamp',name:'Задній ліхтар',keywords:['задний фонарь','задній ліхтар','tail light','tail lamp','задний фонар'],gross_weight_kg:[5,14],packed_volume_m3:[.06,.25],packaging_cost_usd:[10,30]},
  {id:'unknown',name:'Деталь середнього розміру',keywords:[],gross_weight_kg:[5,30],packed_volume_m3:[.05,.6],packaging_cost_usd:[10,60]},
];
export const shippingCategories = (pricelist, airGuide) => [...(airGuide?.profiles || []).map(p => ({...p,keywords:pricelist?.profiles?.find(s=>s.id===p.id)?.keywords || (p.id==='door'?['дверь','двері','door']:[])})),...extra];
export function classifyShipping(order = {}, profiles = [], ai = null) {
  const text = `${order.item_name || ''} ${order.request_text || ''}`.toLowerCase();
  const matches = profiles.flatMap(p => (p.keywords || []).filter(k=>keywordPosition(text,k)>=0).map(k=>({id:p.id,length:k.length,start:keywordPosition(text,k)})));
  matches.sort((a,b)=>b.length-a.length);
  const distinct = [...new Set(matches.filter(m=>!matches.some(other=>other!==m && other.length>m.length && other.start<=m.start && other.start+other.length>=m.start+m.length)).map(m=>m.id))];
  if (distinct.length>1) return {category:'unknown',source:'fallback',multiCategory:distinct,evidence:'Кілька типів деталей: широкий сценарій для змішаної партії'};
  if (matches.length) return {category:matches[0].id,source:'rules',evidence:'Назва деталі та опис замовлення'};
  const sourceText = `${order.item_name || ''} ${order.request_text || ''}`;
  if (ai?.status==='accepted' && profiles.some(p=>p.id===ai.category) && typeof ai.evidence==='string' && ai.evidence.length>=3 && sourceText.includes(ai.evidence)) return {category:ai.category,source:'ai',evidence:ai.evidence};
  return {category:'unknown',source:'fallback',evidence:'Категорію не визначено; середні параметри з широким діапазоном'};
}
export function shippingQuantity(order = {}) {
  const explicit = positive(order.quantity);
  if (Number.isInteger(explicit) && explicit<=100) return {value:explicit,source:'order.quantity'};
  const text = `${order.item_name || ''} ${order.request_text || ''}`;
  const match = text.match(/(?:^|[^\d])(\d{1,3})\s*(?:шт\.?|pcs?|pieces?)(?!\p{L})/iu);
  const word = /(?:^|\s)(?:пара|два|дві|две|two)(?:\s|$)/iu.test(text);
  if (match && +match[1]>0 && +match[1]<=100) return {value:+match[1],source:'request_text'};
  if (word) return {value:2,source:'request_text'};
  return {value:1,source:'assumed_one',warning:order.quantity!==undefined && order.quantity!==null && order.quantity!=='' ? 'Некоректну кількість замінено на 1; перевірте замовлення.' : null};
}
export function outerVolume(packages) {
  if (!Array.isArray(packages) || !packages.length) return null;
  let total=0;
  for (const p of packages) {
    const unit={mm:.001,cm:.01,m:1}[p.unit];
    const dims=[p.length,p.width,p.height].map(positive);
    const count=p.count===undefined?1:positive(p.count);
    if (!unit || dims.some(v=>v===null) || !Number.isInteger(count) || count>100) return null;
    total+=dims.reduce((a,v)=>a*v*unit,1)*count;
  }
  return Number.isFinite(total) && total>0 && total<=1000 ? Number(total.toFixed(8)) : null;
}
export function selectShippingAnalogues(evidence, input) {
  const groups=new Set();
  return (evidence?.quotes || []).filter(q=>q.curation?.category===input.category).map(q=>{
    const n=q.normalized, reasons=[];
    if (n.mode!==input.mode || n.mode_evidence!=='explicit_caption') reasons.push('mode_not_confirmed_or_different');
    if (String(n.carrier).toLowerCase().replace(/[ -]/g,'')!==String(input.carrier).toLowerCase().replace(/[ -]/g,'')) reasons.push('different_carrier');
    if (n.destination!==input.destination) reasons.push('different_destination');
    if (input.serviceLine && n.carrier_service_line!==input.serviceLine) reasons.push('different_or_unknown_line');
    if (q.curation.mixed_load || n.aggregate_loads) reasons.push('mixed_or_aggregate_load');
    if (q.curation.quantity!==input.quantity) reasons.push('different_quantity');
    if (!n.document_date || n.document_date>input.asOf || !positive(n.freight_usd)) reasons.push('missing_or_future_quote');
    if (q.quarantine?.some(x=>['freight_usd','total_usd','document_date','incoterm','volumetric_kg'].includes(x.field))) reasons.push('quarantined_price_context');
    return {id:q.source.message_id,group:n.quote_group,date:n.document_date,validUntil:n.valid_until,freight:n.freight_usd,total:n.total_usd,insurance:n.insurance_usd,destination:n.destination,mode:n.mode,carrier:n.carrier,reasons,source:q.source};
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)) || a.id-b.id).map(q=>{
    if (!q.reasons.length) {if(groups.has(q.group))q.reasons.push('duplicate_group');else groups.add(q.group);}
    return q;
  });
}
export function recommendShipping({order={},mode='sea',pricelist,airGuide,evidence=null,overrides={},ai=null,asOf=new Date().toISOString().slice(0,10)}={}) {
  mode=mode==='air'?'air':'sea';
  const profiles=shippingCategories(pricelist,airGuide);
  const classification=classifyShipping(order,profiles,ai);
  const category=profiles.some(p=>p.id===overrides.category)?overrides.category:classification.category;
  const profile=profiles.find(p=>p.id===category) || extra.at(-1);
  const quantity=shippingQuantity(order);
  if (classification.multiCategory && quantity.source==='assumed_one') {quantity.value=classification.multiCategory.length;quantity.source='distinct_categories_assumed_one_each';}
  const qty=quantity.value;
  const requestText=`${order.item_name || ''} ${order.request_text || ''}`.toLowerCase();
  const carFromText=pricelist?.vehicle_size_factors?.flatMap(v=>v.match_terms || []).find(t=>requestText.includes(t.toLowerCase()));
  const car=String(order.car || carFromText || '').trim();
  const vehicle=pricelist?.vehicle_size_factors?.find(v=>v.match_terms?.some(t=>car.toLowerCase().includes(t.toLowerCase())));
  // Vehicle is a qualitative packing-size hint, never vehicle mass -> part weight.
  const size=['compact','standard','large'].includes(overrides.size)?overrides.size:vehicle?.id || 'standard';
  const sizeFactor={compact:.925,standard:1,large:1.15}[size] || 1;
  const warnings=[];
  if (quantity.warning) warnings.push(quantity.warning);
  if (classification.multiCategory) warnings.push('Кілька категорій у заявці: широкий сценарій для змішаної партії; окремий аналог не застосовується.');
  const hazard=/(?:акумулятор|аккумулятор|батаре|battery|літі|лити|airbag|подушк.*безопас|подушк.*безпек|піропатрон|пиропатрон|газов|аерозол|аэрозол|палив|топлив)/iu.test(`${order.item_name || ''} ${order.request_text || ''}`);
  if (hazard) warnings.push('Можливий небезпечний вантаж: допуск і спеціальні збори потребують погодження перевізника. Сума — лише звичайний сценарій, не дозвіл на перевезення.');
  const condition=/(?:б\/?у|разборк|розбір|used|dismantled)/iu.test(requestText)?'used':/(?:новий|новая|новый|new)/iu.test(requestText)?'new':'unknown';
  const brandStatus=/(?:неориг|не ориг|аналог|aftermarket|замінник)/iu.test(requestText)?'aftermarket_declared':/(?:оригінал|оригинал|oem|original)/iu.test(requestText)?'original_declared':'unknown';
  if(condition==='used' || brandStatus!=='unknown') warnings.push('Походження/стан заявлено в описі; допуск брендових або вживаних деталей і додаткові збори потрібно підтвердити для конкретної лінії.');
  const packing=/glass|windshield|lamp|bumper|radiator|fender|door|tailgate/.test(category)?'Захисний каркас / жорстка коробка':'Захисна коробка';
  const packingFactor=overrides.packing==='separate'?1.25:1;
  const shared=overrides.packing!=='separate';
  // A shared crate is not purchased once per item. The low scenario allows
  // incremental packing; the high scenario keeps separate-place costs/volume.
  // These are planning assumptions, not a guaranteed consolidation discount.
  let gross=profile.gross_weight_kg.map((v,i)=>v*sizeFactor*(shared && i===0?1+.85*(qty-1):qty));
  let volume=profile.packed_volume_m3.map((v,i)=>v*sizeFactor*packingFactor*(shared && i===0?1+.7*(qty-1):qty));
  const packaging=profile.packaging_cost_usd.map((v,i)=>v*packingFactor*(shared && i===0?1+.35*(qty-1):qty));
  // Group paired air/sea documents before using a packaging observation. These
  // widen the planning envelope; they do not turn invoice prices into unit rates.
  const packageGroups=new Set();
  const packageObservations=(evidence?.quotes || []).filter(q=>{
    const n=q.normalized;
    if(q.curation?.category!==category || q.curation.quantity!==qty || q.curation.mixed_load || n.aggregate_loads || packageGroups.has(n.quote_group)) return false;
    if(!positive(n.gross_kg) || !positive(n.volume_m3) || q.quarantine?.some(x=>['gross_kg','volume_m3'].includes(x.field))) return false;
    packageGroups.add(n.quote_group);return true;
  });
  for(const q of packageObservations) {
    gross=[Math.min(gross[0],q.normalized.gross_kg*.8),Math.max(gross[1],q.normalized.gross_kg*1.25)];
    volume=[Math.min(volume[0],q.normalized.volume_m3*.8),Math.max(volume[1],q.normalized.volume_m3*1.25)];
  }
  if(positive(overrides.reportedWeightKg) || positive(overrides.reportedVolumeM3)) warnings.push('Старі поля ваги/об’єму не визначають нетто, брутто чи тарифну вагу. Вони не підміняють вимірювання упаковки; рекомендація використовує типовий сценарій.');
  const exactGross=measurement(overrides.packageGrossKg,100000), exactNet=measurement(overrides.itemNetKg,100000), exactBilled=measurement(overrides.chargeableKg,100000);
  const explicitVolume=measurement(overrides.outerVolumeM3,1000), measuredVolume=outerVolume(overrides.packages);
  const exactVolume=measuredVolume || explicitVolume;
  for(const [field,max] of [['packageGrossKg',100000],['itemNetKg',100000],['chargeableKg',100000],['outerVolumeM3',1000]]) {
    if(overrides[field]!==undefined && overrides[field]!==null && overrides[field]!=='' && measurement(overrides[field],max)===null) warnings.push('Некоректний точний параметр '+field+': використано типовий сценарій.');
  }
  if (exactGross) gross=[exactGross,exactGross]; // overrides are totals for the entire quoted load
  if (exactVolume) volume=[exactVolume,exactVolume];
  if (exactNet && !exactGross) { gross=[Math.max(gross[0],exactNet*1.1),Math.max(gross[1],exactNet*1.6)]; warnings.push('Відоме лише нетто: маса пакування 10–60% — сценарне припущення, не вимір.'); }
  if (exactNet && exactGross && exactGross<exactNet) {warnings.push('Брутто менше нетто: суперечливе брутто не використано.');gross=multiply(profile.gross_weight_kg,qty*sizeFactor);gross=[Math.max(gross[0],exactNet*1.1),Math.max(gross[1],exactNet*1.6)];}
  if (overrides.packages && measuredVolume===null) warnings.push('Габарити або одиниці некоректні: використано типовий зовнішній об’єм.');
  const destination=overrides.destination || order.shipping_destination || 'Kyiv';
  const carrier=overrides.carrier || 'Ukr China';
  const analogues=selectShippingAnalogues(evidence,{category,quantity:qty,mode,destination,carrier,serviceLine:overrides.serviceLine,asOf});
  const measuredOverride=exactGross || exactNet || exactVolume || exactBilled;
  const anchor=!hazard && !measuredOverride && !classification.multiCategory ? (analogues.find(q=>!q.reasons.length) || null):null;
  const volumetric=volume.map((v,i)=>v*(i===0?167:200));
  const billed=exactBilled?[exactBilled,exactBilled]:gross.map((v,i)=>Math.max(v,volumetric[i]));
  let freight, freightRange, basis;
  if (anchor) {
    // Use one same-scope historical total; never average routes or infer its unit rate.
    freight=anchor.freight;freightRange=[freight*.7,freight*1.4];basis='historical_quote';
    warnings.push(`Історична котировка Ukr China від ${anchor.date}, діяла до ${anchor.validUntil || 'невідомої дати'}, не оплачений рахунок і не чинний тариф. Лінію ще не підтверджено.`);
  } else if (mode==='air') {
    freight=Math.max(midpoint(gross),midpoint(volume)*167)*11.3*1.15;
    freightRange=[billed[0]*11.3,billed[1]*14.125];
    if (exactBilled) {freight=exactBilled*11.3*1.15;freightRange=[exactBilled*11.3,exactBilled*14.125];}
    basis='planning_fallback';
  } else {
    const rate=positive(pricelist?.quote_rate_per_m3) || 367;
    freight=Math.max(midpoint(volume)*rate,95);
    freightRange=[Math.max(volume[0]*rate*.8,60),Math.max(volume[1]*rate*1.3,200)];
    basis='planning_fallback';
  }
  // Historical quote freight excludes China and packaging procurement. Keep that scope for fallback too.
  const goods=finiteNumber(overrides.goodsValueUsd ?? order.goods_value_usd);
  const goodsValue=goods!==null && goods>=0 && goods<=1e9?goods:null;
  const insurance=goodsValue===null?null:cents(goodsValue*.015);
  const insuranceCost=insurance || 0;
  freightRange=[Math.min(freightRange[0],freight),Math.max(freightRange[1],freight)];
  if (category==='unknown' || (!vehicle && !['compact','standard','large'].includes(overrides.size))) freightRange=[freightRange[0]*.8,freightRange[1]*1.25];
  if(mode==='sea' && basis==='planning_fallback') freightRange[0]=Math.max(60,freightRange[0]);
  const total=cents(freight+insuranceCost), range=freightRange.map(v=>cents(v+insuranceCost));
  return {display:{total:Math.round(total/5)*5,range:[Math.floor(range[0]/5)*5,Math.ceil(range[1]/5)*5]},mode,category,profile,classification,quantity,car:car || null,size,packing,condition,brandStatus,basis,freight:cents(freight),insurance,insurancePercent:1.5,goodsValue,total,range,
    seaPlanningRate:positive(pricelist?.quote_rate_per_m3) || 367,
    confirmation:anchor?'обмежена: одна історична котировка':'низька: планові припущення',
    scope:{carrier:anchor?'Ukr China':null,destination,serviceLine:null,insuranceIncluded:insurance!==null,chinaLocalIncluded:false,packagingIncluded:false,customsInclusion:'unknown'},
    weights:{itemNet:{value:exactNet,source:exactNet?'optional_override':'unknown'},packageGross:{range:gross,source:exactGross && !(exactNet && exactGross<exactNet)?'optional_override':'category_planning'},outerVolume:{range:volume,source:exactVolume?'optional_override':'category_planning'},volumetric:{range:volumetric,source:'planning_167_200_not_Ukr_China_rule'},billed:{value:exactBilled,range:billed,source:exactBilled?'optional_override':'planning_max_not_confirmed_billed'},packaging:{value:exactNet && exactGross>=exactNet?exactGross-exactNet:null,source:exactNet && exactGross>=exactNet?'gross_minus_net':'unknown'}},
    packagingBudget:packaging,packageObservations:packageObservations.map(q=>({id:q.source.message_id,group:q.normalized.quote_group,gross:q.normalized.gross_kg,volume:q.normalized.volume_m3})),anchor,analogues,warnings,hazard,evidenceLoaded:!!evidence?.quotes?.length,evidenceStats:{quotes:evidence?.quotes?.length || 0,groups:new Set((evidence?.quotes || []).map(q=>q.normalized.quote_group)).size,pairs:evidence?.metadata?.air_sea_pairs || 0}};
}
export function renderShippingRecommendation(result) {
  const r=result;
  const quantitySource={ 'order.quantity':'з кількості в замовленні',request_text:'з опису заявки',assumed_one:'припущено одну деталь',distinct_categories_assumed_one_each:'припущено по одній деталі кожної категорії'}[r.quantity.source] || 'з параметрів заявки';
  const analogues=r.analogues.map(q=>`<li>#${q.id} · ${escape(q.date || 'дату не встановлено')} · ${escape(q.mode)} → ${escape(q.destination)} · ${q.freight===null?'—':money(q.freight)} без страхування${q.reasons.length?' · лише контекст, не база ціни':''}</li>`).join('');
  return `<div class="shipping-estimate__result" data-shipping-recommendation><div><span>Робочий орієнтир</span><strong>≈ ${money(r.display.total)}</strong></div><div><span>Сценарний діапазон</span><strong>${money(r.display.range[0])}–${money(r.display.range[1])}</strong></div></div>
    <p>${escape(r.profile.name)} · ${r.quantity.value} шт. · ${escape(r.car || 'модель невідома')} · ${escape(r.packing)}. Визначення: ${r.classification.source==='ai'?'AI, потребує перевірки':r.classification.source==='fallback'?'типовий fallback':'правила за текстом'}.</p>
    <p class="shipping-estimate__caveat">${r.anchor?'Ukr China: історичний аналог':'Плановий fallback, не тариф Ukr China'} → ${escape(r.scope.destination)}. Підтвердженість ${escape(r.confirmation)}. ${r.insurance===null?'Страхування не включено: вартість товару невідома.':`Страхування ${money(r.insurance)} включено за плановими 1,5%.`} Китай та придбання упаковки окремо; склад митних/спеціальних зборів не підтверджено.</p>
    ${r.warnings.map(w=>`<p class="shipping-estimate__caveat">${escape(w)}</p>`).join('')}
    <details class="order-editor__details"><summary>Чому така рекомендація</summary>
    <p>Нетто ${r.weights.itemNet.value===null?'невідоме':r.weights.itemNet.value+' кг'}; брутто з упаковкою ${r.weights.packageGross.range.map(v=>v.toFixed(1)).join('–')} кг; зовнішній об’єм ${r.weights.outerVolume.range.map(v=>v.toFixed(3)).join('–')} м³. ${r.weights.packageGross.source==='category_planning'?'Вага та упаковка — типовий сценарій, не вимірювання поточної деталі.':''} Тарифна вага ${r.weights.billed.value===null?'не підтверджена':r.weights.billed.value+' кг'}.</p>
    ${r.packageObservations.length?`<p>Пакувальні аналоги (групи без дублів): ${r.packageObservations.map(q=>`#${q.id}: ${q.gross} кг / ${q.volume} м³`).join('; ')}. Вони лише розширюють сценарій; модель та пакування можуть відрізнятися.</p>`:''}
    <p>${r.mode==='sea'?`Планова морська ставка: ${r.seaPlanningRate} USD/м³. `:''}Плановий бюджет виготовлення упаковки, окремо: ${money(r.packagingBudget[0])}–${money(r.packagingBudget[1])}. Для кількох деталей нижній сценарій допускає спільну упаковку, верхній — окремі місця; знижка не гарантована. Діапазон сценарний, не статистична гарантія. ${r.mode==='sea'?'Fallback: зовнішній об’єм × робочий орієнтир USD/м³ (ставка наведена вище); бюджет малої окремої партії 60–200 USD (центр 95) — припущення, не мінімум перевізника.':'Fallback: max(брутто, об’єм × 167–200) × 11,3–14,125 USD/кг, робочий резерв 15%; це попередня планова модель, не встановлене правило Ukr China.'}</p>
    <p>${r.evidenceLoaded?`База: ${r.evidenceStats.quotes} котировок, ${r.evidenceStats.groups} груп, ${r.evidenceStats.pairs} пари авіа/море; оплата не підтверджена.`:'Історична база недоступна; рекомендація працює на планових припущеннях.'} Кількість: ${escape(quantitySource)}. ${r.anchor?'Взято один аналог того самого типу, кількості та напрямку; ціни різних ліній не усереднювались.':''}</p>
    ${analogues?`<ul>${analogues}</ul>`:'<p>Порівнюваного аналога поки немає.</p>'}</details>`;
}
