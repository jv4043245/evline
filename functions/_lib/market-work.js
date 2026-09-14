import { researchMarketItems } from './market-fetch.js';
import { reviewMarketCandidates } from './market-query.js';
import { summarizeMarketItem, canSearchMarketItem } from '../../assets/js/market-comparison.js';
import { offerIdentity } from './market-feedback.js';
import { resolveMarketVin, applyVinModel, marketVinKey } from './market-vin.js';

export function initialMarketWork(items, sources, metadata) {
  const searchable = items.filter(canSearchMarketItem);
  return { ...metadata, items: items.map(item => summarizeMarketItem(item, [])), offer_details: {},
    work: { version: 1, items: searchable, next: 0, total: searchable.length * sources.length, lease: null } };
}

// A single HTTP request checks one item at one source. The compare-and-swap
// lease prevents overlapping tabs/retries from losing another step's results.
export async function advanceMarketWork(env, kind, runId, orderId, sources, context = {}) {
  const table = kind === 'order' ? 'market_research_runs' : 'market_lookup_runs';
  const condition = kind === 'order' ? 'id = ? AND order_id = ?' : 'id = ?';
  const ids = kind === 'order' ? [runId, orderId] : [runId];
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${condition}`).bind(...ids).first();
  if (!row) throw Object.assign(new Error('Пошук не знайдено.'), { status: 404 });
  const summary = JSON.parse(row.summary_json || '{}');
  if (row.status !== 'pending' || summary.work?.version !== 1) return;
  const work = summary.work;
  if (work.lease?.until > Date.now()) return;
  const statuses = JSON.parse(row.source_status_json || '[]');
  const item = work.items[Math.floor(work.next / sources.length)];
  const source = sources[work.next % sources.length];
  const interrupted = Boolean(work.lease);
  work.lease = { id: crypto.randomUUID(), until: Date.now() + 30000 };
  const claimed = JSON.stringify(summary);
  const result = await env.DB.prepare(`UPDATE ${table} SET summary_json = ? WHERE ${condition} AND status = 'pending' AND summary_json = ?`)
    .bind(claimed, ...ids, row.summary_json).run();
  if (Number(result.meta?.changes ?? result.changes) !== 1) return;
  let offers = Object.values(summary.offer_details || {});
  let complete = false;
  if (summary.vehicle_lookup?.status === 'pending') {
    const vin = kind === 'lookup' ? row.vin : context.vin;
    const sameVin = (await marketVinKey(vin)) === JSON.parse(row.fingerprint).vin_key;
    const lookup = sameVin ? await resolveMarketVin(env, vin, summary.vehicle_lookup.requested_car) : { status: 'input_changed' };
    summary.vehicle_lookup = { ...summary.vehicle_lookup, ...lookup };
    summary.items = applyVinModel(summary.items, lookup);
    work.items = summary.items.filter(canSearchMarketItem);
    work.total = work.items.length * sources.length;
  } else if (work.next >= work.total) {
    offers = await reviewMarketCandidates(env, work.items, offers);
    complete = true;
  } else {
    try {
      if (interrupted) throw new Error('source_step_interrupted');
      const step = await researchMarketItems([item], [source]);
      offers.push(...step.offers);
      statuses.push(...step.sources);
    } catch {
      statuses.push({ key: source.key, name: source.name, url: source.search(item.query), item_key: item.key, item_label: item.label,
        status: 'failed', count: 0, parsed_count: 0, error: 'source_step_interrupted' });
    }
    work.next += 1;
  }
  work.lease = null;
  summary.offer_details = Object.fromEntries(offers.map(offer => [offerIdentity(offer), offer]));
  summary.items = summary.items.map(item => summarizeMarketItem(item, offers));
  summary.offer_count = offers.length;
  summary.exact_offer_count = offers.filter(offer => offer.match_type === 'exact').length;
  summary.confidence = summary.items.every(item => item.confidence === 'high') ? 'high' : 'low';
  await env.DB.prepare(`UPDATE ${table} SET updated_at = ?, status = ?, summary_json = ?, source_status_json = ?,
    confidence = ?, offer_count = ?, exact_offer_count = ?, error = ''
    WHERE ${condition} AND status = 'pending' AND summary_json = ?`)
    .bind(new Date().toISOString(), complete ? 'complete' : 'pending', JSON.stringify(summary), JSON.stringify(statuses),
      summary.confidence, summary.offer_count, summary.exact_offer_count, ...ids, claimed).run();
}
