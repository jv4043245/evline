const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const round = value => Math.ceil(value / 5) * 5;
const validRange = values => Array.isArray(values) && values.length === 2 && values.every(v => Number.isFinite(v) && v > 0) && values[0] <= values[1];

// Planning scenarios, not measured shipment costs or a carrier's binding quote.
export function calculateAirGuide(guide, profileId, vehicleId = 'standard', packingId = 'shared') {
  const profile = guide?.profiles?.find(row => row.id === profileId);
  if (!profile || ![profile.gross_weight_kg, profile.packed_volume_m3, profile.packaging_cost_usd].every(validRange)) return null;
  const vehicle = guide.vehicle_factors?.[vehicleId];
  const packing = guide.packing_factors?.[packingId];
  const factor = vehicle * packing;
  if (![vehicle, packing].every(v => Number.isFinite(v) && v > 0) || !Number.isFinite(guide.reserve_percent) || guide.reserve_percent < 0 || !validRange(guide.rate_usd_per_kg) || !validRange(guide.volume_kg_per_m3)) return null;
  const gross = profile.gross_weight_kg.map(v => v * vehicle);
  const volume = profile.packed_volume_m3.map(v => v * factor);
  const packaging = profile.packaging_cost_usd.map(v => v * packing);
  const billed = [0, 1].map(i => Math.max(gross[i], volume[i] * guide.volume_kg_per_m3[i]));
  const low = billed[0] * guide.rate_usd_per_kg[0] + packaging[0];
  const high = billed[1] * guide.rate_usd_per_kg[1] + packaging[1];
  const midpoint = values => (values[0] + values[1]) / 2;
  const working = Math.max(midpoint(gross), midpoint(volume) * guide.volume_kg_per_m3[0]) * guide.rate_usd_per_kg[0] * (1 + guide.reserve_percent / 100) + midpoint(packaging);
  if (![low, high, working].every(Number.isFinite) || working < low || working > high) return null;
  return { quote: round(working), range: [round(low), round(high)], gross, volume, packaging, billed, profile };
}

export function renderAirGuide(guide, profileId, vehicleId, packingId) {
  if (!guide) return '<p class="muted">Завантажуємо авіаорієнтир…</p>';
  const result = calculateAirGuide(guide, profileId, vehicleId, packingId);
  if (!result) return '<p class="muted">Оберіть тип деталі для попередньої оцінки авіадоставки.</p>';
  const rangeText = values => values.map(n => Number(n.toFixed(2)).toLocaleString('uk-UA')).join('–');
  return `<div class="shipping-estimate__result" data-air-guide-result>
    <div><span>Робочий орієнтир</span><strong>${money(result.quote)}</strong></div>
    <div><span>Діапазон</span><strong>${money(result.range[0])}–${money(result.range[1])}</strong></div>
  </div>
  <p class="shipping-estimate__caveat">${escape(result.profile.name)} · 1 деталь · пакування включено. Попередня модель, не підтверджена нашими авіавідправками.</p>
  <details class="order-editor__details"><summary>Джерела й припущення</summary>
    <p>${escape(result.profile.name)}: брутто з упаковкою ${rangeText(result.gross)} кг; об'єм упаковки ${rangeText(result.volume)} м³. Резерв на виготовлення упаковки: ${money(result.packaging[0])}–${money(result.packaging[1])}.</p>
    <p>Планова формула: більша з фізичної та об'ємної ваги × ставка + упаковка. Ставка ${rangeText(guide.rate_usd_per_kg)} USD/кг; об'ємна вага ${rangeText(guide.volume_kg_per_m3)} кг/м³; робочий резерв ${escape(guide.reserve_percent)}%. Верхня межа ставки, вага, упаковка та поправки — внутрішні припущення, не прайс перевізника.</p>
    <p>Частка у збірному відправленні. Мінімальний рахунок за окреме відправлення може підвищити суму; його не нараховуємо повторно на кожну деталь. Не включено доставку по Китаю, страхування, митні та нестандартні збори. Остаточно — за замірами й рахунком перевізника.</p>
    <p>Перевірено джерела: ${escape(guide.updated_at)}. ${guide.sources.map(source => `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)}</a>`).join(' · ')}</p>
  </details>`;
}
