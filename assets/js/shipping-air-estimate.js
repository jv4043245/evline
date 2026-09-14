const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const number = value => Number(value).toLocaleString("uk-UA", { maximumFractionDigits: 2 });
const money = (value, currency) => new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);

export function airFreightRates(shipping) {
  return (shipping?.rates || []).filter(rate => rate.mode === "air" && Number(rate.active) === 1 && rate.unit === "kg" &&
    (shipping.carriers || []).some(carrier => carrier.id === rate.carrier_id && Number(carrier.active) === 1));
}

export function calculateAirFreight(rate, weight) {
  const kg = Number(weight), price = Number(rate?.rate);
  if (!rate || rate.mode !== "air" || rate.unit !== "kg" || Number(rate.active) !== 1 ||
      !["USD", "UAH", "EUR", "CNY"].includes(rate.currency) || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(kg) || kg <= 0 || kg > 100000) return null;
  const minimumKg = Number(rate.min_weight_kg || 0), minimumCharge = Number(rate.min_charge || 0);
  if (![minimumKg, minimumCharge].every(value => Number.isFinite(value) && value >= 0)) return null;
  const billedKg = Math.max(kg, minimumKg);
  return { billedKg, minimumApplied: billedKg > kg || minimumCharge > billedKg * price,
    freight: Math.round(Math.max(billedKg * price, minimumCharge) * 100) / 100, currency: rate.currency };
}

export function renderAirFreight(shipping, settings = {}) {
  const rates = airFreightRates(shipping);
  const rate = rates.find(row => row.id === settings.airRate) || rates.find(row => Number(row.rate) > 0) || rates[0];
  if (!rate) return '<p class="muted">Немає активного авіатарифу. Додайте тариф у довіднику доставки.</p>';
  const result = calculateAirFreight(rate, settings.airWeight);
  const days = Number(rate.estimated_days_min) > 0 ? `${number(rate.estimated_days_min)}${Number(rate.estimated_days_max) > Number(rate.estimated_days_min) ? `–${number(rate.estimated_days_max)}` : ""} днів` : "Строк уточнюється";
  const label = row => `${shipping.carriers.find(carrier => carrier.id === row.carrier_id)?.name || row.carrier_id} · ${Number(row.rate) > 0 ? `${number(row.rate)} ${row.currency}/кг` : "тариф уточнюється"}`;
  return `<div class="shipping-estimate__controls shipping-air-controls">
    <label>Перевізник / тариф<select data-air-rate>${rates.map(row => `<option value="${escape(row.id)}" ${row === rate ? "selected" : ""}>${escape(label(row))}</option>`).join("")}</select></label>
    <label>Оплачувана вага відправлення, кг<input data-air-weight type="number" min="0.01" max="100000" step="0.01" inputmode="decimal" value="${escape(settings.airWeight || "")}" placeholder="Вага для тарифікації"></label>
  </div>
  <div class="shipping-estimate__result" aria-live="polite">
    <div><span>Авіаперевезення</span><strong data-air-total>${result ? escape(money(result.freight, result.currency)) : "—"}</strong></div>
    <div><span>Строк за довідником</span><strong>${escape(days)}</strong></div>
  </div>
  <p class="shipping-estimate__caveat">${Number(rate.rate) > 0 ? "Вага для тарифікації враховує об'ємну вагу за правилами перевізника." : "Ціну цього перевізника потрібно уточнити. Нульова ставка не означає безкоштовну доставку."}
    ${Number(rate.min_weight_kg) > 0 ? `Мінімум за тарифом: ${number(rate.min_weight_kg)} кг на відправлення, не на кожну деталь.` : ""}
    ${Number(rate.min_charge) > 0 ? `Мінімальна сума: ${number(rate.min_charge)} ${escape(rate.currency)}.` : ""}
    ${result?.minimumApplied ? `Застосовано мінімум тарифу; розрахункова вага ${number(result.billedKg)} кг.` : ""}</p>
  <p class="shipping-estimate__caveat">Орієнтир за тарифом довідника${rate.updated_at ? ` від ${escape(String(rate.updated_at).slice(0, 10))}` : ""}; актуальну ставку й строк підтверджує перевізник. Без страхування, обрешітки, доставки по Китаю та інших зборів. Морські нормативи деталей тут не використовуються.</p>`;
}
