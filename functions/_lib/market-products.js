import { parse } from 'node-html-parser';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const value = (node, selector) => {
  const el = node.querySelector(selector);
  return clean(el?.getAttribute('content') || el?.textContent);
};
export function parseMarketPrice(input) {
  let s = String(input ?? '').replace(/[^\d.,]/g, '');
  if (/[.,]\d{1,2}$/.test(s)) { const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(',')); s = s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1); }
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 10000000 ? n : 0;
}
function currency(value, fallback = '') {
  const s = String(value || '').toUpperCase();
  if (/USD|\$/.test(s)) return 'USD';
  if (/EUR|€/.test(s)) return 'EUR';
  if (/CNY|RMB|¥|￥/.test(s)) return 'CNY';
  if (/UAH|ГРН|₴/.test(s)) return 'UAH';
  return fallback;
}
export function safeProductUrl(input, base) {
  try {
    const url = new URL(input, base);
    const home = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.replace(/^www\./, '') !== home.hostname.replace(/^www\./, '')) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}
function codes(text) {
  return [...new Set((String(text).match(/[\p{L}\d][\p{L}\d._/-]{4,35}/gu) || []).filter(s => (s.match(/\d/g) || []).length >= 3))].slice(0, 12);
}
function properties(root) {
  const result = {};
  for (const row of root.querySelectorAll('.detail__info-item, .detail__characteristics-row')) {
    const key = value(row, '.detail__info-item-title, .detail__characteristics-name').toLowerCase();
    const val = value(row, '.detail__info-item-desc, .detail__characteristics-desc');
    if (key && val) result[key] = val;
  }
  for (const tr of root.querySelectorAll('tr')) {
    const cells = tr.querySelectorAll('th, td');
    if (cells.length === 2) result[clean(cells[0].textContent).toLowerCase()] = clean(cells[1].textContent);
  }
  for (const dt of root.querySelectorAll('dt')) {
    if (dt.nextElementSibling?.tagName === 'DD') result[clean(dt.textContent).toLowerCase()] = clean(dt.nextElementSibling.textContent);
  }
  return result;
}
function property(props, re) { return Object.entries(props).filter(([key]) => re.test(key)).map(([, val]) => val).join(' '); }
export function marketAvailability(text) {
  if (/немає|нет в наличии|недоступ|out.?of.?stock|discontinued/i.test(text)) return 'out_of_stock';
  if (/під замовлення|под заказ|передзамов|очікуван|preorder|backorder|поставка.*\d/i.test(text)) return 'order_needed';
  if (/в наявності|в наличии|готово до відправки|instock/i.test(text)) return 'in_stock';
  return 'unknown';
}
function productObjects(v, out = []) {
  if (!v || typeof v !== 'object') return out;
  if ([].concat(v['@type'] || []).some(t => /(?:^|\/)Product$/.test(t))) out.push(v);
  if (Array.isArray(v)) v.forEach(row => productObjects(row, out));
  else for (const [key, row] of Object.entries(v)) if (['@graph', 'itemListElement', 'item', 'mainEntity'].includes(key)) productObjects(row, out);
  return out;
}
const cardSelectors = '.product-card, .listChargers_item, .kc__card, .catalog__product, .catalogCard, [itemtype$="Product"], article';
function fromCard(card, base, productPage = false) {
  const titleNode = (productPage ? card.querySelector('h1') : null) || card.querySelector('.product-card__name, .kc__name, .product__title a, .catalogCard-title a, .listChargers_title, [itemprop="name"], h1, h2 a, h3 a, a[data-item-name]') || card.querySelector('a[href]');
  const title = clean(titleNode?.getAttribute('data-item-name') || titleNode?.textContent);
  if (!title || title.length > 350) return null;
  const priceNode = card.querySelector('[itemprop="price"], [data-item-price], .site-price__item, .product__prices-numbers, .catalogCard-price, .kc__price .base, .kc__prices .base, .price .base, .price');
  const priceText = clean(priceNode?.getAttribute('content') || priceNode?.getAttribute('data-item-price') || priceNode?.textContent);
  // A fallback may read this card, never preceding/following siblings.
  const localPrice = priceText || clean(card.textContent).match(/(?:[\d\s.,]+)\s*(?:грн|₴|UAH)/i)?.[0] || '';
  const curr = currency(value(card, '[itemprop="priceCurrency"]') || localPrice);
  const props = properties(card);
  const price = parseMarketPrice(localPrice);
  const href = titleNode?.getAttribute('href') || titleNode?.querySelector('a')?.getAttribute('href') || card.querySelector('a[href]')?.getAttribute('href');
  const url = safeProductUrl(productPage ? base : href || '', base);
  if (!url || (!price && !productPage)) return null;
  const fitment = property(props, /авто|застосув|примен|рок|год|model|fitment/u);
  const attributes = property(props, /сторон|розташ|располож|стан|состоя|тип|технолог|комплект|якість|качест/u);
  const statusNode = card.querySelector('.site-status__txt, .label__stock, .product__status, .catalogCard-availability, [itemprop="availability"]');
  const availability = clean(statusNode?.getAttribute('href') || statusNode?.getAttribute('content') || statusNode?.textContent);
  return { title, article: value(card, '[itemprop="sku"], .product-card__vendor-code, .kc__code, .product__vendor-code, .label__sku') || property(props, /^артикул$|^sku$|^mpn$/u), cross_numbers: codes(property(props, /крос|cross|oem|оригінальний номер/u)), price_uah: curr === 'UAH' ? price : 0, original_price: price, currency: curr || 'unknown', product_url: url, availability_text: availability, fitment, attributes_text: attributes, context: [title, fitment, attributes].filter(Boolean).join(' '), verified_product: productPage, evidence_scope: productPage ? 'product_page' : 'product_card' };
}

export function parseMarketProducts(sourceKey, html, base, { productPage = false } = {}) {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, pre: false } });
  if (sourceKey === 'zevs' && !root.querySelector('[data-company-id="4149823"], a[href*="/c4149823-"]')) return [];
  const out = [];
  const pageCurrency = value(root, '[itemprop="priceCurrency"], meta[property="product:price:currency"]');
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const products = productObjects(JSON.parse(script.textContent));
      for (const row of products) {
        const props = Object.fromEntries((row.additionalProperty || []).filter(p => p.name && p.value).map(p => [clean(p.name).toLowerCase(), clean(p.value)]));
        const productOffers = [].concat(row.offers || []);
        for (const offer of productOffers) {
          if (offer['@type'] === 'AggregateOffer' || !offer.price) continue;
          const curr = currency(offer.priceCurrency || row.priceCurrency || pageCurrency);
          const url = safeProductUrl(row.url || offer.url || base, base);
          if (!url) continue;
          const verified = productPage && productOffers.length === 1 && (Boolean(row.url || offer.url) || products.length === 1);
          out.push({ title: clean(row.name), article: clean(row.mpn || row.sku), cross_numbers: codes(property(props, /крос|cross|oem/u)), price_uah: curr === 'UAH' ? parseMarketPrice(offer.price) : 0, original_price: parseMarketPrice(offer.price), currency: curr || 'unknown', product_url: url, availability_text: clean(offer.availability), condition: /UsedCondition/.test(offer.itemCondition || '') ? 'used' : /NewCondition/.test(offer.itemCondition || '') ? 'new' : 'unknown', fitment: property(props, /авто|застосув|примен|рок|год|model|fitment/u), attributes_text: property(props, /сторон|стан|состоя|тип|технолог|комплект|якість|качест/u), context: clean(row.name), verified_product: verified, evidence_scope: verified ? 'product_page' : 'structured_catalog' });
        }
      }
    } catch { /* A malformed optional block is not product evidence. */ }
  }
  // Horoshop's structured catalogue prices are UAH only with a page currency marker.
  for (const script of root.querySelectorAll('script')) {
    const match = script.textContent.match(/var products\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) continue;
    try {
      for (const row of JSON.parse(match[1])) {
        const curr = currency(row.currency || pageCurrency);
        const url = safeProductUrl(row.url || '', base);
        if (!url || !row.title) continue;
        out.push({ title: clean(row.title), article: clean(row.article_for_display || row.article), cross_numbers: [], price_uah: curr === 'UAH' ? parseMarketPrice(row.price) : 0, original_price: parseMarketPrice(row.price), currency: curr || 'unknown', product_url: url, availability_text: row.in_stock === true || row.in_stock === 1 ? 'В наявності' : row.in_stock === false || row.in_stock === 0 ? 'Немає в наявності' : '', context: clean(row.title), verified_product: false, evidence_scope: 'structured_catalog' });
      }
    } catch { /* Never infer a price from unrelated script text. */ }
  }
  root.querySelectorAll('script, style, nav, header, footer, .related-products, .recommended-products').forEach(el => el.remove());
  for (const card of root.querySelectorAll(cardSelectors)) {
    if (card.querySelectorAll(cardSelectors).length) continue;
    const row = fromCard(card, base, productPage && Boolean(card.querySelector('h1')));
    if (row) out.push(row);
  }
  if (productPage && root.querySelector('h1')) {
    root.querySelectorAll(cardSelectors).filter(card => !card.querySelector('h1')).forEach(card => card.remove());
    const scope = root.querySelector('[itemtype$="Product"]') || root.querySelector('main') || root;
    const props = properties(scope);
    const cross = codes(property(props, /крос|cross|oem/u));
    const title = value(root, 'h1');
    const matching = out.filter(row => row.verified_product && (!row.title || row.title === title));
    const visibleStatus = value(scope, '.detail__availability-txt, .site-status__txt, .label__stock, .product__status');
    for (const row of matching) {
      row.cross_numbers = [...new Set([...row.cross_numbers, ...cross])];
      row.fitment ||= property(props, /авто|застосув|примен|рок|год|model|fitment/u);
      row.attributes_text ||= property(props, /сторон|розташ|располож|стан|состоя|тип|технолог|комплект|якість|качест/u);
      if (visibleStatus) {
        const structuredStatus = row.availability_text;
        const structured = marketAvailability(structuredStatus);
        const visible = marketAvailability(visibleStatus);
        row.availability_conflict = structured !== 'unknown' && visible !== 'unknown' && structured !== visible;
        row.availability_evidence = { structured: structuredStatus, visible: visibleStatus };
        row.availability_text = visibleStatus;
      }
    }
    // Single product heading plus a dedicated price selector, not a global text scan.
    if (!matching.length && scope.querySelector('.site-price__item, [itemprop="price"], .product-price, .product__price')) {
      const row = fromCard(scope, base, true);
      if (row && row.title === title) out.push(row);
    }
  }
  const seen = new Map();
  for (const row of out) {
    if (!row.title || (!row.original_price && !row.verified_product)) continue;
    const key = row.product_url;
    const previous = seen.get(key);
    if (!previous || row.verified_product && !previous.verified_product || row.price_uah && !previous.price_uah) seen.set(key, row);
  }
  return [...seen.values()].slice(0, 100);
}
