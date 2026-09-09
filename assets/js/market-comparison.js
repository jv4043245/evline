// Shared rules for the API, cached results, filters and clipboard.
export const MARKET_MATCH_VERSION = 3;
export const compactPartNumber = value => String(value || '').normalize('NFKC').toUpperCase().replace(/[\s._\/-]/g, '');
const words = value => String(value || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const norm = value => words(value).join(' ');

export function partTraits(value) {
  const s = norm(value);
  const sides = [/лів|лев|\bleft\b|\blh\b/u.test(s) && 'left', /прав|\bright\b|\brh\b/u.test(s) && 'right'].filter(Boolean);
  const ends = [/передн|headlight|headlamp|\bfront\b/u.test(s) && 'front', /задн|taillight|\brear\b|\btail\b/u.test(s) && 'rear'].filter(Boolean);
  let category = '';
  // Child components precede their parent assemblies.
  if (/скл.{0,20}фар|стекл.{0,20}фар|headl(?:ight|amp)\s*(?:glass|lens)/u.test(s)) category = 'lamp_glass';
  else if (/кроншт|креплен|кріплен|bracket|mounting/u.test(s)) category = 'bracket';
  else if (/блок.{0,20}(?:фар|розпал|розжиг)|баласт|ballast|headlight module/u.test(s)) category = 'lamp_module';
  else if (/наклад|молдинг|trim|moulding|molding/u.test(s)) category = 'trim';
  else if (/підсилювач|усилител|reinforcement/u.test(s)) category = 'reinforcement';
  else if (/протитуман|противотуман|\bfog\b/u.test(s)) category = 'fog';
  else if (/дхо|денн.{0,15}(?:світ|ход)|дневн.{0,15}(?:свет|ход)|\bdrl\b|daytime/u.test(s)) category = 'drl';
  else if (/фар|headlight|headlamp/u.test(s)) category = 'headlamp';
  else if (/ліхтар|фонар|taillight|\btail\s*lamp\b/u.test(s)) category = 'tail_lamp';
  else {
    const groups = [['bumper', /бампер|bumper/u], ['fender', /крил|крыл|fender/u], ['glass', /скл|стекл|glass/u], ['door', /двер|door/u], ['hood', /капот|hood/u], ['mirror', /дзерк|зерк|mirror/u], ['shock', /амортиз|стійк|стойк|shock/u], ['grille', /решіт|решет|grille/u]];
    category = groups.find(([, re]) => re.test(s))?.[0] || '';
  }
  const technology = /матрич|\bmatrix\b/u.test(s) ? 'matrix' : /галоген|halogen/u.test(s) ? 'halogen' : /ксенон|xenon/u.test(s) ? 'xenon' : /\bled\b|світлодіод|светодиод/u.test(s) ? 'led' : '';
  const position = ends.length === 1 ? ends[0] : ends.length ? 'both' : category === 'headlamp' ? 'front' : category === 'tail_lamp' ? 'rear' : '';
  const condition = /(?:^|\s)б\s*у(?:\s|$)|вживан|бывш|\bused\b/u.test(s) ? 'used' : /нов(?:ий|ая|ый|а)(?:\s|$)|\bnew\b/u.test(s) ? 'new' : '';
  const quantity = /комплект|пара|дві|две|\btwo\b|\bpair\b|\bset\b/u.test(s) ? 'set' : '';
  return { category, side: sides.length === 1 ? sides[0] : sides.length ? 'both' : '', position, lamp: category, technology, condition, quantity };
}

const brands = ['byd', 'zeekr', 'xpeng', 'denza', 'toyota', 'lexus', 'bmw', 'volkswagen', 'audi', 'nissan', 'honda', 'tesla', 'geely', 'chery', 'kia', 'hyundai', 'xiaomi', 'li auto'];
const models = [
  ['yuan_plus', /\byuan\s*(?:plus|плюс)\b|юань\s*плюс|\batto\s*3\b/u], ['yuan_pro', /\byuan\s*pro\b|юань\s*про/u], ['yuan_up', /\byuan\s*up\b/u],
  ['song_plus', /\bsong\s*plus\b|сонг\s*плюс/u], ['song_l', /\bsong\s*l\b/u], ['song_pro', /\bsong\s*pro\b/u],
  ['sea_lion_06', /\bsea\s*lion\s*0?6\b|\bsealion\s*0?6\b/u], ['sea_lion_07', /\bsea\s*lion\s*0?7\b|\bsealion\s*0?7\b/u],
  ['han', /\bhan\b/u], ['tang', /\btang\b/u], ['seagull', /\bseagull\b/u], ['dolphin', /\bdolphin\b/u],
  ['seal_u', /\bseal\s*u\b/u], ['seal', /\bseal\b(?!\s*u\b)/u], ['zeekr_001', /\bzeekr\s*001\b/u], ['zeekr_007', /\bzeekr\s*007\b/u], ['zeekr_009', /\bzeekr\s*009\b/u], ['zeekr_x', /\bzeekr\s*x\b/u],
];
export function vehicleTraits(value) {
  const s = norm(value).replace(/бід|бид|б[іи]вайд[іи]/gu, 'byd').replace(/зікр|зикр|зикер/gu, 'zeekr').replace(/фольксваген|\bvw\b/gu, 'volkswagen');
  return { brands: brands.filter(b => new RegExp(`\\b${b}\\b`, 'u').test(s)), models: models.filter(([, re]) => re.test(s)).map(([name]) => name), years: [...s.matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1])), text: s };
}
const reasonLabels = { side: 'Інша сторона деталі', position: 'Інше розташування', category: 'Інший вузол або складова', technology: 'Інша технологія світла', brand: 'Інша марка автомобіля', model: 'Інша модель автомобіля', year: 'Інший рік застосування', condition: 'Інший стан деталі', quantity: 'Комплект замість окремої деталі' };
function titleHasNumber(title, number) {
  const parts = String(number).match(/[\p{L}\p{N}]+/gu) || [];
  return parts.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}/-])${parts.join('[\\s._/-]*')}(?![\\p{L}\\p{N}/-])`, 'iu').test(title);
}
export function assessMarketCandidate(candidate, item = {}) {
  const label = item.label || (item.item_tokens || []).join(' ');
  const desired = partTraits(label);
  const actual = partTraits([candidate.title, candidate.attributes_text].filter(Boolean).join(' '));
  if (['new', 'used'].includes(candidate.condition)) actual.condition = candidate.condition;
  const wantedCar = vehicleTraits(item.car || (item.car_tokens || []).join(' '));
  const offeredCar = vehicleTraits([candidate.title, candidate.fitment].filter(Boolean).join(' '));
  const conflicts = [];
  for (const key of ['category', 'side', 'position', 'technology', 'condition']) if (desired[key] && actual[key] && desired[key] !== actual[key]) conflicts.push(key);
  if (actual.quantity === 'set' && desired.quantity !== 'set') conflicts.push('quantity');
  if (wantedCar.brands.length && offeredCar.brands.length && !wantedCar.brands.some(b => offeredCar.brands.includes(b))) conflicts.push('brand');
  if (wantedCar.models.length && offeredCar.models.length && !wantedCar.models.some(b => offeredCar.models.includes(b))) conflicts.push('model');
  const fitYears = vehicleTraits(candidate.fitment).years;
  if (wantedCar.years.length === 1 && fitYears.length && !wantedCar.years.every(y => y >= Math.min(...fitYears) && y <= Math.max(...fitYears))) conflicts.push('year');
  if (candidate.feedback?.rejected) return { match_type: 'irrelevant', match_reason: `Відхилено менеджером: ${candidate.feedback.reason_label || 'не та деталь'}`, match_basis: 'manager', conflicts };
  if (conflicts.length) return { match_type: 'irrelevant', match_reason: conflicts.map(key => reasonLabels[key]).join(' · '), match_basis: 'conflict', conflicts };
  const wanted = item.part_numbers || [];
  const codes = [candidate.article || candidate.part_number, ...(candidate.cross_numbers || [])].filter(Boolean).map(compactPartNumber);
  const matchedNumber = wanted.find(number => codes.includes(compactPartNumber(number)) || titleHasNumber(candidate.title || '', number));
  if (candidate.ai_review) return { match_type: 'probable', match_reason: candidate.ai_note || 'Перевірте застосування та комплектацію', match_basis: 'review', conflicts: [] };
  if (matchedNumber && candidate.verified_product === true) return { match_type: 'exact', match_reason: codes[0] === compactPartNumber(matchedNumber) ? 'Артикул підтверджено в картці товару' : 'Кросномер підтверджено в картці товару', match_basis: 'article', conflicts: [] };
  const overlap = desired.category ? actual.category === desired.category : words(label).filter(t => t.length > 3 && !/^\d+$/.test(t)).some(t => words(candidate.title).includes(t));
  if (!overlap && !matchedNumber) return { match_type: 'irrelevant', match_reason: 'Не збігається тип деталі', match_basis: 'category', conflicts: ['category'] };
  const missing = [];
  if (!candidate.verified_product) missing.push('Картку товару не підтверджено');
  if (!matchedNumber) missing.push(wanted.length ? 'Артикул не збігається або не вказаний' : 'Потрібен артикул');
  if (!wantedCar.models.length || !offeredCar.models.length) missing.push('Застосування до моделі не підтверджено');
  for (const key of ['side', 'technology']) if (desired[key] && !actual[key]) missing.push(key === 'side' ? 'Сторону не вказано' : 'Комплектацію не вказано');
  return { match_type: 'probable', match_reason: missing.join(' · ') || 'Потрібна перевірка комплектації', match_basis: 'description', conflicts: [] };
}
export const compareMarketCandidate = (candidate, item) => assessMarketCandidate(candidate, item).match_type;
export function filterMarketOffers(offers, filters = {}) {
  return offers.filter(offer => (filters.availability === 'all' || !filters.availability || offer.availability === filters.availability) && (filters.partType === 'all' || !filters.partType || offer.part_type === filters.partType));
}
function priceStats(rows) {
  const prices = rows.map(row => Number(row.price_uah)).filter(price => Number.isFinite(price) && price > 0).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  return { min_uah: prices[0] || 0, median_uah: prices.length ? (prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2) : 0, average_uah: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0, max_uah: prices.at(-1) || 0 };
}
export function reviewMarketResult(summary = {}, offers = []) {
  const items = summary.items || [];
  const reviewed = offers.map(offer => ({ ...offer, ...assessMarketCandidate(offer, items.find(item => item.key === offer.item_key)) }));
  const summaries = items.map(item => summarizeMarketItem(item, reviewed));
  return { offers: reviewed, summary: { ...summary, items: summaries, offer_count: summaries.reduce((n, s) => n + s.offer_count, 0), exact_offer_count: summaries.reduce((n, s) => n + s.exact_offer_count, 0) } };
}
export function summarizeMarketItem(item, offers, filters = {}) {
  const rows = filterMarketOffers(offers.filter(offer => offer.item_key === item.key), filters);
  const exact = rows.filter(offer => offer.match_type === 'exact' && offer.verified_product === true && (offer.currency || 'UAH') === 'UAH' && Number(offer.price_uah) > 0);
  const grouped = new Map();
  for (const offer of exact) {
    const traits = partTraits([offer.title, offer.attributes_text].filter(Boolean).join(' '));
    const key = [offer.part_type || 'unknown', offer.condition || traits.condition || 'unknown', offer.availability || 'unknown', traits.technology, traits.side, traits.position, traits.category].join('|');
    if (!grouped.has(key)) grouped.set(key, []);
    const entries = grouped.get(key);
    const seller = offer.source_key || offer.source_name || offer.product_url;
    const old = entries.findIndex(row => (row.source_key || row.source_name || row.product_url) === seller);
    if (old < 0) entries.push(offer);
    else if (Number(offer.price_uah) < Number(entries[old].price_uah)) entries[old] = offer;
  }
  const groups = [...grouped.entries()].map(([key, entries]) => ({ key, ...partTraits([entries[0].title, entries[0].attributes_text].filter(Boolean).join(' ')), part_type: entries[0].part_type || 'unknown', condition: entries[0].condition || partTraits(entries[0].title).condition || 'unknown', availability: entries[0].availability || 'unknown', offer_count: entries.length, seller_count: entries.length, ...priceStats(entries) }));
  return { ...item, offer_count: rows.filter(row => row.match_type !== 'irrelevant').length, exact_offer_count: exact.length, probable_offer_count: rows.filter(row => row.match_type === 'probable').length, rejected_offer_count: rows.filter(row => row.match_type === 'irrelevant').length, groups, confidence: groups.length === 1 && groups[0].seller_count >= 3 ? 'high' : 'low', ...priceStats(groups.length === 1 ? grouped.get(groups[0].key) : []) };
}
