// Shared by the research API and admin: cached results use the same price rules.
const compact = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const words = (value) => String(value || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

export function partTraits(value) {
  const s = ` ${String(value || '').toLowerCase()} `;
  const side = /(?:лів|лев|\bleft\b|\blh\b|\bl\b)/u.test(s) ? 'left'
    : /(?:прав|\bright\b|\brh\b|\br\b)/u.test(s) ? 'right' : '';
  const position = /задн|ліхтар|фонар|taillight|\brear\b|\btail\b/u.test(s) ? 'rear'
    : /передн|фар|headlight|headlamp|\bfront\b/u.test(s) ? 'front' : '';
  const lamp = /дхо|денн|дневн|ходов.*ог|\bdrl\b|daytime/u.test(s) ? 'drl'
    : /протитуман|противотуман|\bfog\b/u.test(s) ? 'fog'
    : /фар|ліхтар|фонар|headlight|headlamp|taillight|\blamp\b/u.test(s) ? 'lamp' : '';
  const technology = /матрич|\bmatrix\b/u.test(s) ? 'matrix'
    : /галоген|halogen/u.test(s) ? 'halogen'
    : /ксенон|xenon/u.test(s) ? 'xenon'
    : /\bled\b|світлодіод|светодиод/u.test(s) ? 'led' : '';
  return { side, position, lamp, technology };
}

export function compareMarketCandidate(candidate, item = {}) {
  const title = String(candidate.title || '');
  const label = item.label || (item.item_tokens || []).join(' ');
  const desired = partTraits(label);
  const actual = partTraits(title);
  for (const key of ['side', 'position', 'lamp', 'technology']) {
    if (desired[key] && actual[key] && desired[key] !== actual[key]) return 'irrelevant';
  }
  // Catalogue context can contain adjacent products. Never confirm an OEM from it.
  const article = compact(candidate.article || candidate.part_number);
  const exact = (item.part_numbers || []).some((number) => {
    const target = compact(number);
    if (!target) return false;
    if (article === target) return true;
    const components = words(number);
    const separated = components.join('[\\s/-]*');
    const pattern = `(?<![\\p{L}\\p{N}/-])(?:${separated}|${target})(?![\\p{L}\\p{N}/-])`;
    return new RegExp(pattern, 'iu').test(title);
  });
  if (exact) return 'exact';
  const tokens = words(title);
  const productGroups = [
    /бампер|bumper/u, /крил|крыл|fender/u, /фар|ліхтар|фонар|headlight|lamp/u,
    /скл|стекл|glass/u, /двер|door/u, /капот|hood/u, /дзерк|зерк|mirror/u,
    /амортиз|стійк|стойк|shock/u, /наклад|молдинг|trim/u, /кроншт|bracket/u,
  ];
  const product = productGroups.find((pattern) => pattern.test(label.toLowerCase()));
  const overlap = product ? product.test(title.toLowerCase())
    : words(label).filter((token) => token.length > 3 && !/^\d+$/.test(token)).some((token) => tokens.includes(token));
  return overlap ? 'probable' : 'irrelevant';
}

export function filterMarketOffers(offers, filters = {}) {
  return offers.filter((offer) => (filters.availability === 'all' || !filters.availability || offer.availability === filters.availability)
    && (filters.partType === 'all' || !filters.partType || offer.part_type === filters.partType));
}

function priceStats(rows) {
  const prices = rows.map((row) => Number(row.price_uah)).filter((price) => Number.isFinite(price) && price > 0).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  return {
    min_uah: prices[0] || 0,
    median_uah: prices.length ? (prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2) : 0,
    average_uah: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
    max_uah: prices.at(-1) || 0,
  };
}

export function reviewMarketResult(summary = {}, offers = []) {
  const items = summary.items || [];
  const reviewed = offers.map((offer) => ({ ...offer, match_type: compareMarketCandidate(offer, items.find((item) => item.key === offer.item_key)) }))
    .filter((offer) => offer.match_type !== 'irrelevant');
  return { offers: reviewed, summary: { ...summary, items: items.map((item) => summarizeMarketItem(item, reviewed)) } };
}

export function summarizeMarketItem(item, offers, filters = {}) {
  const rows = filterMarketOffers(offers.filter((offer) => offer.item_key === item.key), filters);
  const exact = rows.filter((offer) => offer.match_type === 'exact' && Number(offer.price_uah) > 0);
  const grouped = new Map();
  for (const offer of exact) {
    const traits = partTraits(offer.title);
    const key = [offer.part_type || 'unknown', offer.availability || 'unknown', traits.technology || 'unspecified', traits.side, traits.position, traits.lamp].join('|');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(offer);
  }
  const groups = [...grouped.entries()].map(([key, entries]) => ({
    key, part_type: entries[0].part_type || 'unknown', availability: entries[0].availability || 'unknown',
    technology: partTraits(entries[0].title).technology,
    side: partTraits(entries[0].title).side, position: partTraits(entries[0].title).position, lamp: partTraits(entries[0].title).lamp,
    offer_count: entries.length,
    seller_count: new Set(entries.map((row) => row.source_key || row.source_name || row.product_url)).size,
    ...priceStats(entries),
  }));
  const oneGroup = groups.length === 1 ? groups[0] : null;
  return {
    ...item, offer_count: rows.length, exact_offer_count: exact.length,
    probable_offer_count: rows.length - exact.length, groups,
    confidence: oneGroup?.seller_count >= 3 ? 'high' : 'low',
    ...priceStats(oneGroup ? exact : []),
  };
}
