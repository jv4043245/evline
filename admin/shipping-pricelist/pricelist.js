import { createShippingClassifier } from '../../assets/js/shipping-classifier-client.js?v=20260930';
import { adminApiError } from "../../assets/js/admin-api-errors.js";
import { renderAirFreight, updateAirFreightOutput } from "../../assets/js/shipping-air-estimate.js?v=20260914-progress";
import { recommendShipping, renderShippingRecommendation, shippingCategories, classifyShipping } from "../../assets/js/shipping-recommendation.js?v=20260930";

const usd = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const decimal = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const date = new Intl.DateTimeFormat("uk-UA", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Kyiv",
});

let pricelist;
let airGuide;
let evidence;
const classifier = createShippingClassifier({
  getAuth: () => localStorage.getItem('evline_admin_token'),
  request: async (order,{signal}) => {
    const auth=localStorage.getItem('evline_admin_token');
    const response=await fetch('/api/admin/shipping-classify',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:`Bearer ${auth}`}:{})},body:JSON.stringify(order),cache:'no-store',signal});
    return response.ok?response.json():{status:'unavailable'};
  },
  onResult: () => renderCalculator(),
});
let classificationTimer;
let currentClassificationKey;
let freightMode = location.hash === '#air' ? 'air' : 'sea';
let shipping;
let airLoading;
let airError = "";
const airSettings = {};

function renderAirCalculator() {
  const root = document.querySelector("[data-air-calculator]");
  if (!root) return;
  if (shipping) root.innerHTML = renderAirFreight(shipping, airSettings);
  else root.textContent = airError || "Завантажуємо авіатарифи…";
}

async function loadAirRates() {
  if (shipping || airLoading) return airLoading;
  airError = "";
  renderAirCalculator();
  airLoading = (async () => {
    try {
      const token = localStorage.getItem("evline_admin_token") || "";
      const response = await fetch("/api/admin/shipping", { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
      if (!response.ok) throw new Error(await adminApiError(response));
      shipping = await response.json();
    } catch (error) {
      airError = error.message;
    } finally {
      airLoading = null;
      renderAirCalculator();
    }
  })();
  return airLoading;
}

function setFreightMode(mode) {
  freightMode = mode;
  const air = mode === "air";
  document.querySelectorAll("[data-freight-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.freightMode === mode)));
  document.querySelectorAll("[data-sea-only]").forEach(node => { node.hidden = air; });
  document.querySelector("[data-air-guide]").hidden = !air;
  document.querySelector("[data-air-advanced]").hidden = !air;
  if (pricelist) renderCalculator();
}
document.querySelector('[data-air-advanced]').addEventListener('toggle', event => { if (event.target.open) loadAirRates(); });

document.querySelectorAll("[data-freight-mode]").forEach(button => button.addEventListener("click", () => setFreightMode(button.dataset.freightMode)));
document.querySelector("[data-air-calculator]")?.addEventListener("change", event => {
  if (event.target.matches("[data-air-rate]")) airSettings.airRate = event.target.value;
  else if (event.target.matches("[data-air-weight]")) airSettings.airWeight = event.target.value;
  else return;
  renderAirCalculator();
});
document.querySelector("[data-air-calculator]")?.addEventListener("input", event => {
  if (!event.target.matches('[data-air-weight]')) return;
  airSettings.airWeight = event.target.value;
  updateAirFreightOutput(event.currentTarget, shipping, airSettings);
});
if (location.hash === "#air") setFreightMode("air");

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function appendOptions(select, rows) {
  if (!select) return;
  select.replaceChildren();
  for (const row of rows) {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = row.name;
    select.append(option);
  }
}

function renderMetadata(data) {
  const effectiveRate = data.source.freight_usd / data.source.packed_volume_m3;
  setText("[data-version]", data.version);
  setText("[data-updated]", date.format(new Date(`${data.updated_at}T12:00:00Z`)));
  setText("[data-base-rate]", `${usd.format(data.base_rate_per_m3)}/м³`);
  setText("[data-quote-rate]", `${usd.format(data.quote_rate_per_m3)}/м³`);
  setText("[data-insurance-rate]", `${decimal.format(data.insurance_percent)}%`);
  setText("[data-route]", data.route);
  setText("[data-source-label]", data.source.label);
  setText("[data-source-volume]", `${decimal.format(data.source.packed_volume_m3)} м³`);
  setText("[data-source-weight]", `${decimal.format(data.source.gross_weight_kg)} кг`);
  setText("[data-source-freight]", usd.format(data.source.freight_usd));
  setText("[data-source-insurance]", usd.format(data.source.insurance_usd));
  setText("[data-source-china-costs]", `${decimal.format(data.source.china_local_delivery_cny + data.source.wooden_crate_cny)} CNY`);
  setText("[data-source-effective-rate]", `${usd.format(effectiveRate)}/м³`);
}

function renderProfiles(data) {
  const body = document.querySelector("[data-pricelist-rows]");
  if (!body) return;
  body.replaceChildren();

  for (const profile of data.profiles) {
    const row = document.createElement("tr");
    const cells = [
      profile.name,
      decimal.format(profile.packed_volume_m3),
      usd.format(profile.calculated_cost_usd),
      usd.format(profile.working_quote_usd),
      `${usd.format(profile.working_range_usd[0])}–${usd.format(profile.working_range_usd[1])}`,
      profile.note,
    ];

    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 3) {
        const strong = document.createElement("strong");
        strong.textContent = value;
        cell.append(strong);
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    });

    body.append(row);
  }
}

function renderRules(data) {
  const list = document.querySelector("[data-pricelist-rules]");
  if (!list) return;
  list.replaceChildren();
  for (const rule of data.rules) {
    const item = document.createElement("li");
    item.textContent = rule;
    list.append(item);
  }
}

function renderCalculator() {
  if (!pricelist) return;
  const value = selector => document.querySelector(selector)?.value;
  const order = { item_name:value('[data-request]'), car:value('[data-car]'), quantity:value('[data-quantity]') };
  const key = order.item_name || '';
  clearTimeout(classificationTimer);
  // Cancel immediately on edit, before the next debounce; ignore even mocks that don't honor abort.
  if(key!==currentClassificationKey) classifier.cancel('calculator');
  currentClassificationKey=key;
  if (key.trim() && evidence?.ai_enabled && classifyShipping(order, shippingCategories(pricelist,airGuide)).category === 'unknown' && !classifier.get(order)) {
    classificationTimer=setTimeout(()=>classifier.ensure('calculator',order),600);
  }
  const result = recommendShipping({
    order, ai:classifier.get(order),
    mode: freightMode, pricelist, airGuide, evidence,
    overrides: { category: value('[data-profile]'), size: value('[data-vehicle-size]'), packing: value('[data-packing]'),
      goodsValueUsd: value('[data-purchase-price]'), itemNetKg: value('[data-net]'), packageGrossKg: value('[data-gross]'),
      outerVolumeM3: value('[data-outer-volume]'), chargeableKg: value('[data-billed]'), destination: value('[data-destination]') }
  });
  document.querySelector('[data-shipping-recommendation-root]').innerHTML = renderShippingRecommendation(result);
}

async function loadPricelist() {
  const response = await fetch("/admin/shipping-pricelist/pricelist.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Не вдалося завантажити прайс (${response.status})`);
  pricelist = await response.json();
  try {
    const airResponse = await fetch('/admin/shipping-pricelist/air-guide.json', { cache: 'no-store' });
    if (airResponse.ok) airGuide = await airResponse.json();
  } catch { /* The sea reference is independent of the air guide. */ }
  try {
    const token = localStorage.getItem('evline_admin_token') || '';
    const response = await fetch('/api/admin/shipping-reference', {headers: token ? {authorization: `Bearer ${token}`} : {}, cache:'no-store'});
    if (response.ok) { const data=await response.json(); if(token === (localStorage.getItem('evline_admin_token') || '')) evidence=data; }
  } catch { /* Unavailable history must not suppress the recommendation. */ }
  renderMetadata(pricelist);
  renderProfiles(pricelist);
  renderRules(pricelist);
  appendOptions(document.querySelector("[data-profile]"), [{id:"auto", name:"Автоматично за описом"}, ...shippingCategories(pricelist,airGuide)]);
  appendOptions(document.querySelector("[data-vehicle-size]"), [{id:"auto",name:"Автоматично"},...pricelist.vehicle_size_factors]);
  appendOptions(document.querySelector("[data-packing]"), pricelist.packing_factors);
  document.querySelector("[data-vehicle-size]").value = "auto";
  document.querySelector("[data-packing]").value = "shared";
  setFreightMode(freightMode);
}

document.querySelector("[data-shipping-calculator]")?.addEventListener("input", renderCalculator);
document.querySelector("[data-shipping-calculator]")?.addEventListener("change", renderCalculator);

loadPricelist().catch((error) => {
  setText("[data-pricelist-status]", error.message);
});

window.addEventListener('storage', event => { if(event.key==='evline_admin_token') { evidence=null; classifier.clear(); clearTimeout(classificationTimer); window.location.reload(); } });

window.addEventListener('pagehide',()=>{classifier.clear();clearTimeout(classificationTimer);});
