import { reviewMarketResult } from '../../assets/js/market-comparison.js';

export const FEEDBACK_REASONS = { model: 'інша модель', side: 'інша сторона', component: 'інша деталь', equipment: 'інша комплектація', price: 'некоректна ціна', other: 'не підходить' };
const keyFor = (item, offer) => JSON.stringify([String(item.car || '').toLowerCase(), String(item.label || '').toLowerCase(), item.part_numbers || [], offer.source_key, offer.product_url]);
export const offerIdentity = offer => JSON.stringify([offer.item_key, offer.source_key, offer.product_url]);
async function ensureFeedback(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_offer_feedback (
    comparison_key TEXT PRIMARY KEY, rejected INTEGER NOT NULL DEFAULT 1,
    reason TEXT NOT NULL, actor TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
}
export async function hydrateMarketResult(env, summary, offers) {
  await ensureFeedback(env);
  const keys = [...new Set(offers.map(offer => keyFor(summary.items?.find(item => item.key === offer.item_key) || {}, offer)))];
  const feedback = new Map();
  for (let start = 0; start < keys.length; start += 80) {
    const batch = keys.slice(start, start + 80);
    const rows = await env.DB.prepare(`SELECT * FROM market_offer_feedback WHERE rejected = 1 AND comparison_key IN (${batch.map(() => '?').join(',')})`).bind(...batch).all();
    for (const row of rows.results || []) feedback.set(row.comparison_key, row);
  }
  const enriched = offers.map(offer => {
    const metadata = summary.offer_details?.[offerIdentity(offer)] || {};
    const item = summary.items?.find(item => item.key === offer.item_key) || {};
    const mark = feedback.get(keyFor(item, offer));
    return { ...offer, ...metadata, feedback: mark ? { rejected: true, reason: mark.reason, reason_label: FEEDBACK_REASONS[mark.reason], actor: mark.actor } : null };
  });
  return reviewMarketResult(summary, enriched);
}
export async function saveMarketFeedback(env, result, payload, actor) {
  const offer = result.offers.find(row => offerIdentity(row) === payload.offer_key);
  const item = result.summary.items.find(row => row.key === offer?.item_key);
  if (!offer || !item || !FEEDBACK_REASONS[payload.reason || 'other']) throw Object.assign(new Error('Пропозицію або причину не знайдено.'), { status: 400 });
  await ensureFeedback(env);
  await env.DB.prepare(`INSERT INTO market_offer_feedback (comparison_key, rejected, reason, actor, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(comparison_key) DO UPDATE SET rejected = excluded.rejected,
    reason = excluded.reason, actor = excluded.actor, updated_at = excluded.updated_at`)
    .bind(keyFor(item, offer), payload.undo === true ? 0 : 1, payload.reason || 'other', actor, new Date().toISOString()).run();
  return hydrateMarketResult(env, result.summary, result.offers);
}
