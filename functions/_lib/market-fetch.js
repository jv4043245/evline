import { parseMarketProducts, safeProductUrl, marketAvailability } from './market-products.js';
import { assessMarketCandidate, partTraits, compactPartNumber } from '../../assets/js/market-comparison.js';

export async function fetchMarketPage(url, source, budget) {
  let current = safeProductUrl(url, source.home);
  if (!current) throw new Error('foreign_url');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    for (let hop = 0; hop < 3; hop++) {
      if (++budget.requests > 46 || Date.now() > budget.deadline) throw new Error('request_budget');
      const response = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { accept: 'text/html,application/xhtml+xml', 'accept-language': 'uk-UA,uk;q=0.9,ru;q=0.7', 'user-agent': 'EVLineMarketResearch/2.0 (+https://evline.com.ua/)' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = safeProductUrl(response.headers.get('location') || '', current);
        await response.body?.cancel();
        if (!next || !safeProductUrl(next, source.home)) throw new Error('foreign_redirect');
        current = next;
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
      const reader = response.body?.getReader();
      let body = '';
      let size = 0;
      const decoder = new TextDecoder();
      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2500000) { await reader.cancel(); throw new Error('page_too_large'); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      if (/challenge_passed|cf-chl-|<title>\s*(?:Just a moment|Access denied)/i.test(body)) throw new Error('source_protected');
      return { body, url: current };
    }
    throw new Error('too_many_redirects');
  } finally { clearTimeout(timer); }
}
function offerFromCandidate(candidate, item, source, searchUrl) {
  const s = [candidate.title, candidate.attributes_text].join(' ').toLowerCase();
  const term = candidate.availability_text || '';
  const days = term.match(/(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\s*(?:дн|днів|дней|day)/i);
  return { ...candidate, ...assessMarketCandidate(candidate, item), item_key: item.key, item_label: item.label, source_key: source.key, source_name: source.name, source_url: searchUrl, part_number: candidate.article || '', snippet: candidate.context?.slice(0, 260) || '', availability: candidate.availability_conflict ? 'unknown' : marketAvailability(term), lead_time_min: days ? Number(days[1]) : null, lead_time_max: days ? Number(days[2] || days[1]) : null, part_type: /аналог|aftermarket|замінник|заменитель/.test(s) ? 'aftermarket' : /\boem\b/.test(s) ? 'oem' : /оригінал|оригинал|original|genuine/.test(s) ? 'original' : 'unknown', condition: candidate.condition || partTraits(s).condition || 'unknown', checked_at: new Date().toISOString() };
}
export async function researchMarketItems(items, sources) {
  const budget = { requests: 0, deadline: Date.now() + 18000 };
  // Reserve capacity for every source's initial query before optional detail reads.
  const searches = await Promise.all(items.flatMap(item => sources.map(async source => {
    const searchUrl = source.search(item.query);
    try {
      let page = await fetchMarketPage(searchUrl, source, budget);
      let candidates = parseMarketProducts(source.key, page.body, page.url);
      const empty = /нічого не знайдено|ничего не найдено|товар[іо]в? не знайдено|не знайдено жодного|no (?:results|products)|0 товар/i.test(page.body);
      return { item, source, searchUrl, candidates, empty };
    } catch (error) { return { item, source, searchUrl, candidates: [], error: error.message }; }
  })));
  const results = [];
  // Round-robin detail checks avoid spending the whole budget on one retailer.
  for (const result of searches) {
    const { item, source, searchUrl } = result;
    const ranked = result.candidates.map(candidate => offerFromCandidate(candidate, item, source, searchUrl));
    ranked.sort((a, b) => Number(b.match_type !== 'irrelevant') - Number(a.match_type !== 'irrelevant') || Number(item.part_numbers.some(code => compactPartNumber(code) === compactPartNumber(b.article))) - Number(item.part_numbers.some(code => compactPartNumber(code) === compactPartNumber(a.article))));
    result.offers = ranked.slice(0, 8);
    results.push(result);
  }
  await Promise.all(results.map(async result => {
    const { item, source, searchUrl } = result;
    // One exact-format fallback only when the primary search had no candidates.
    if (!result.error && !result.candidates.length && item.part_numbers[0]?.includes('-') && budget.requests < 36 && Date.now() < budget.deadline) {
      try {
        const page = await fetchMarketPage(source.search(compactPartNumber(item.part_numbers[0])), source, budget);
        result.candidates = parseMarketProducts(source.key, page.body, page.url);
        result.offers = result.candidates.map(c => offerFromCandidate(c, item, source, searchUrl)).slice(0, 8);
      } catch { /* The original source outcome remains visible. */ }
    }
    const candidate = result.offers.find(row => row.match_type !== 'irrelevant' && row.product_url !== searchUrl);
    if (candidate && budget.requests < 46 && Date.now() < budget.deadline) {
      try {
        const page = await fetchMarketPage(candidate.product_url, source, budget);
        const detail = parseMarketProducts(source.key, page.body, page.url, { productPage: true }).find(row => row.verified_product && row.product_url === page.url);
        if (detail) result.offers[result.offers.indexOf(candidate)] = offerFromCandidate(detail, item, source, searchUrl);
        else result.detail_error = 'product_not_parsed';
      } catch (error) { result.detail_error = error.message; }
    }
  }));
  const offers = results.flatMap(result => result.offers || []);
  const selected = items.flatMap(item => {
    const rows = offers.filter(row => row.item_key === item.key);
    return [...rows.filter(row => row.match_type === 'exact').slice(0, 20), ...rows.filter(row => row.match_type === 'probable').slice(0, 12), ...rows.filter(row => row.match_type === 'irrelevant').slice(0, 8)];
  });
  return { offers: selected, sources: results.map(result => ({ key: result.source.key, name: result.source.name, url: result.searchUrl, item_key: result.item.key, item_label: result.item.label, status: result.error ? 'failed' : !result.candidates.length ? result.empty ? 'empty' : 'unreadable' : result.detail_error ? 'partial' : 'ok', count: (result.offers || []).filter(row => row.match_type !== 'irrelevant').length, parsed_count: result.candidates.length, error: result.error || result.detail_error || '' })) };
}
